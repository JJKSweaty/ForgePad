import { Sandbox } from '@vercel/sandbox';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function authorized(req) {
 const actual=Buffer.from(req.headers.authorization??'');
 const expected=Buffer.from(`Bearer ${process.env.FORGEPAD_RUNNER_SECRET??''}`);
 return !!process.env.FORGEPAD_RUNNER_SECRET&&actual.length===expected.length&&timingSafeEqual(actual,expected);
}

export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(!authorized(req))return res.status(401).json({detail:'Authenticated backend access required'});
 if(req.method==='GET')return res.json({available:true,detail:'Cloud compiler service configured; each run uses a disposable VM.'});
 if(req.method!=='POST')return res.status(405).json({detail:'Method not allowed'});
 const request=typeof req.body==='string'?JSON.parse(req.body):req.body;
 if(!request?.question?.test_config||!request.files||JSON.stringify(request).length>3*1024*1024)
  return res.status(422).json({detail:'Invalid compilation request'});
 let sandbox;
 try {
  sandbox=await Sandbox.create({persistent:false,timeout:260000,resources:{vcpus:1}});
  const install=await sandbox.runCommand({cmd:'bash',args:['-c','command -v gcc >/dev/null && command -v g++ >/dev/null && command -v clang >/dev/null || (apt-get update -qq && apt-get install -y -qq gcc g++ clang libc6-dev libclang-rt-dev)'],sudo:true});
  if(install.exitCode!==0)throw new Error('Toolchain installation failed: '+(await install.stderr()).slice(-500));
  await sandbox.update({networkPolicy:'deny-all'});
  const supervisor=await readFile(path.join(process.cwd(),'cloud/lib/supervisor.py'));
  const supervisorPath=path.posix.join(sandbox.cwd,'supervisor.py');
  const requestPath=path.posix.join(sandbox.cwd,'request.json');
  await sandbox.writeFiles([{path:supervisorPath,content:supervisor,mode:0o600},{path:requestPath,content:Buffer.from(JSON.stringify(request)),mode:0o600}]);
  // Hide the test specification from the nobody user before executing any source.
  const secure=await sandbox.runCommand({cmd:'chmod',args:['600',requestPath,supervisorPath],sudo:true});
  if(secure.exitCode!==0)throw new Error('Worker setup failed: '+(await secure.stderr()).slice(-400));
  const execution=await sandbox.runCommand({cmd:'python3',args:[supervisorPath,requestPath],sudo:true});
  if(execution.exitCode!==0)throw new Error('Supervisor failed');
  return res.json(JSON.parse(await execution.stdout()));
 } catch(error) {
  console.error('ForgePad cloud runner failed',String(error?.message??error).slice(0,700));
  return res.status(503).json({detail:'Cloud execution unavailable. Retry shortly.'});
 } finally {
  if(sandbox)await sandbox.stop().catch(()=>{});
 }
}
