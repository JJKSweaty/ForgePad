use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunnerConfig {
    pub image: String,
    pub docker_context: String,
}
impl Default for RunnerConfig {
    fn default() -> Self {
        Self {
            image: std::env::var("FORGEPAD_RUNNER_IMAGE").unwrap_or("forgepad-runner:local".into()),
            docker_context: std::env::var("DOCKER_CONTEXT").unwrap_or_default(),
        }
    }
}
impl RunnerConfig {
    pub fn validate(&self) -> Result<()> {
        if self.image.is_empty()
            || self.image.len() > 200
            || !self
                .image
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/._-:@".contains(&b))
            || self.docker_context.len() > 100
            || !self
                .docker_context
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        {
            bail!("Use a Docker image name and an existing local Docker context name");
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct Worker {
    pub executable: PathBuf,
    pub python_module: bool,
    pub directory: PathBuf,
    pub config: Arc<Mutex<RunnerConfig>>,
}
impl Worker {
    pub fn discover(directory: &std::path::Path) -> Self {
        if let Some(path) = std::env::var_os("FORGEPAD_WORKER") {
            return Self {
                executable: path.into(),
                python_module: false,
                directory: directory.into(),
                config: Arc::new(Mutex::new(RunnerConfig::default())),
            };
        }
        let installed = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .join("forgepad-worker");
        if installed.exists() {
            return Self {
                executable: installed,
                python_module: false,
                directory: directory.into(),
                config: Arc::new(Mutex::new(RunnerConfig::default())),
            };
        }
        Self {
            executable: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.venv/bin/python"),
            python_module: true,
            directory: directory.into(),
            config: Arc::new(Mutex::new(RunnerConfig::default())),
        }
    }
    pub async fn request(&self, request: Value, cancel: CancellationToken) -> Result<Value> {
        let mut cmd = Command::new(&self.executable);
        if self.python_module {
            cmd.args(["-m", "forgepad.worker"]);
        }
        let config = self.config.lock().unwrap().clone();
        cmd.env("FORGEPAD_RUNNER_IMAGE", &config.image);
        if !config.docker_context.is_empty() {
            cmd.env("DOCKER_CONTEXT", &config.docker_context);
        }
        let path = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("/opt/homebrew/bin:/usr/local/bin:{path}"));
        cmd.env("FORGEPAD_RUNNER_TMPDIR", self.directory.join("runner"))
            .env(
                "FORGEPAD_COMPILE_CACHE",
                self.directory.join("compiler-cache"),
            );
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        let mut child = cmd
            .spawn()
            .context("Sandbox worker missing. Build or configure forgepad-worker.")?;
        let mut input = child.stdin.take().unwrap();
        input.write_all(request.to_string().as_bytes()).await?;
        input.shutdown().await?;
        drop(input);
        let output = child.stdout.take().unwrap();
        let read = tokio::spawn(async move {
            let mut buf = Vec::new();
            output
                .take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut buf)
                .await?;
            Ok::<_, std::io::Error>(buf)
        });
        // The Python worker owns bounded Docker containers; SIGTERM is handled there for cancellation.
        let status = tokio::select! {
            status = child.wait() => status?,
            _ = cancel.cancelled() => {
                if let Some(pid) = child.id() { let _ = Command::new("/bin/kill").args(["-TERM",&pid.to_string()]).status().await; }
                let _ = tokio::time::timeout(Duration::from_secs(8),child.wait()).await;
                let _ = child.kill().await; read.abort();
                return Ok(json!({"status":"cancelled","tests":[],"passed":0,"total":0}));
            },
            _ = tokio::time::sleep(Duration::from_secs(1000)) => { child.kill().await?; read.abort(); bail!("Sandbox worker timed out"); }
        };
        let bytes = read.await??;
        if bytes.len() > 2 * 1024 * 1024 {
            bail!("Worker output limit exceeded");
        }
        let value: Value =
            serde_json::from_slice(&bytes).context("Invalid sandbox worker response")?;
        if !status.success() && value["status"] != "unavailable" {
            bail!("Worker exited unsuccessfully");
        }
        Ok(value)
    }
    pub async fn availability(&self) -> Value {
        match self
            .request(
                json!({"operation":"availability"}),
                CancellationToken::new(),
            )
            .await
        {
            Ok(v) => v,
            Err(e) => json!({"available":false,"detail":e.to_string()}),
        }
    }
}
