import { useEffect, useState } from 'react';
import { Download, History } from 'lucide-react';
import { api, download, message, readable } from './api';
import type { Run, Session } from './api';

type ReplayEvent = {id:string;kind:string;created_at:string;files?:Record<string,string>;answer?:string;content?:string;action?:string;state?:string;result?:Run['result']};
type Replay = {session:Session;events:ReplayEvent[]};

export function InterviewReplay({sessionId}:{sessionId:string}) {
 const [replay,setReplay]=useState<Replay|null>(null),[index,setIndex]=useState(0),[error,setError]=useState('');
 useEffect(()=>{let live=true;void api<Replay>(`/interviews/${sessionId}/replay`).then(r=>{if(live){setReplay(r);setIndex(Math.max(0,r.events.length-1))}}).catch(e=>{if(live)setError(message(e))});return()=>{live=false}},[sessionId]);
 if(error)return <div className="error-banner" role="alert">{error}</div>;
 if(!replay)return <div className="empty">Loading session replay…</div>;
 const event=replay.events[index];
 const code=replay.events.slice(0,index+1).reverse().find(e=>e.files);
 const elapsed=event?Math.max(0,Math.floor((Date.parse(event.created_at)-Date.parse(replay.session.started_at))/1000)):0;
 return <section className="panel replay-panel"><div className="section-header"><div><h2><History size={18}/>Session replay</h2><p>Code snapshots, interview responses, controls, and compiler results in order.</p></div><button onClick={()=>download(`forgepad-replay-${sessionId}.json`,replay)}><Download size={15}/>Export replay</button></div>{!event?<div className="empty">No replay events were recorded for this older session.</div>:<div className="modal-body"><label className="replay-slider">Event {index+1} of {replay.events.length} · {Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}<input aria-label="Replay position" type="range" min={0} max={replay.events.length-1} value={index} onChange={e=>setIndex(Number(e.target.value))}/></label><div className="replay-grid"><div className="replay-events" role="list" aria-label="Recorded events">{replay.events.map((e,i)=><button role="listitem" className={`replay-event ${index===i?'active':''}`} key={e.id} onClick={()=>setIndex(i)}><strong>{readable(e.kind)}</strong><small>{new Date(e.created_at).toLocaleTimeString()}</small><span>{e.content?.slice(0,110)??e.action??(e.kind==='code'?'Code saved':e.kind==='run'?'Tests executed':'')}</span></button>)}</div><div className="replay-detail"><h3>{readable(event.kind)}</h3>{event.content&&<div className="prose">{event.content}</div>}{event.action&&<p>{readable(event.action)} · {event.state}</p>}{event.result&&<><strong>{event.result.passed} / {event.result.total} tests passed</strong><p>{readable(event.result.status)}</p>{event.result.tests?.map(t=><p key={t.id}>{t.name} — {readable(t.status)}</p>)}</>}{code&&<><h3>Code at this point</h3>{Object.entries(code.files??{}).map(([name,source])=><details key={name} open><summary>{name}</summary><pre>{source}</pre></details>)}{code.answer&&<div className="prose">{code.answer}</div>}</>}</div></div></div>}</section>;
}
