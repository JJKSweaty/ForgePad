//! Built-in CoreML speech models, isolated from the UI and cloud inference.
use crate::Service;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct SpeechRuntime {
    process: std::sync::Arc<tokio::sync::Mutex<Option<SpeechProcess>>>,
}
struct SpeechProcess {
    model: String,
    child: Child,
    input: ChildStdin,
    output: Lines<BufReader<ChildStdout>>,
    last_used: std::time::Instant,
}
impl SpeechProcess {
    async fn result(&mut self) -> Result<Value> {
        while let Some(line) = self.output.next_line().await? {
            if let Ok(result) = serde_json::from_str::<Value>(&line) {
                if let Some(error) = result["error"].as_str() {
                    bail!("{error}");
                }
                if result.get("text").is_some() || result["ready"] == true {
                    return Ok(result);
                }
            }
        }
        bail!("Speech engine stopped. Retry dictation to restart it.")
    }
}
impl SpeechRuntime {
    pub async fn close(&self) {
        if let Some(mut process) = self.process.lock().await.take() {
            let _ = process.child.kill().await;
            let _ = process.child.wait().await;
        }
    }
    async fn transcribe(
        &self,
        model: &str,
        path: &str,
        cancel: CancellationToken,
    ) -> Result<Value> {
        let mut slot = tokio::select! { slot = self.process.lock() => slot, _ = cancel.cancelled() => bail!("Dictation cancelled") };
        let operation = async {
            let restart = match slot.as_mut() {
                Some(process) => process.model != model || process.child.try_wait()?.is_some(),
                None => true,
            };
            if restart {
                if let Some(mut old) = slot.take() {
                    let _ = old.child.kill().await;
                }
                let mut child = Command::new(helper())
                    .args(["serve", model])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::inherit())
                    .kill_on_drop(true)
                    .spawn()
                    .context("Could not start local speech engine")?;
                let input = child
                    .stdin
                    .take()
                    .context("Speech engine input unavailable")?;
                let output = BufReader::new(
                    child
                        .stdout
                        .take()
                        .context("Speech engine output unavailable")?,
                )
                .lines();
                let mut process = SpeechProcess {
                    model: model.into(),
                    child,
                    input,
                    output,
                    last_used: std::time::Instant::now(),
                };
                if process.result().await?["ready"] != true {
                    bail!("Speech engine did not become ready");
                }
                *slot = Some(process);
            }
            let process = slot.as_mut().unwrap();
            process.last_used = std::time::Instant::now();
            let request = format!("{}\n", json!({"path":path}));
            process.input.write_all(request.as_bytes()).await?;
            process.input.flush().await?;
            process.result().await
        };
        let result = tokio::select! {
            result = tokio::time::timeout(std::time::Duration::from_secs(120), operation) => result.unwrap_or_else(|_| Err(anyhow::anyhow!("Local speech timed out. Retry a shorter phrase."))),
            _ = cancel.cancelled() => Err(anyhow::anyhow!("Dictation cancelled")),
        };
        if result.is_err() {
            if let Some(mut process) = slot.take() {
                let _ = process.child.kill().await;
            }
        } else {
            let process = self.process.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(90)).await;
                let mut slot = process.lock().await;
                if slot
                    .as_ref()
                    .is_some_and(|p| p.last_used.elapsed().as_secs() >= 90)
                {
                    if let Some(mut process) = slot.take() {
                        let _ = process.child.kill().await;
                    }
                }
            });
        }
        result
    }
}

pub fn helper() -> PathBuf {
    let installed = std::env::current_exe()
        .unwrap_or_default()
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("forgepad-speech");
    if installed.is_file() {
        return installed;
    }
    #[cfg(debug_assertions)]
    {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../native-speech/.build/release/forgepad-speech")
    }
    #[cfg(not(debug_assertions))]
    {
        installed
    }
}
pub fn validate_model(model: &str) -> Result<()> {
    if !["ultra", "v3", "v2"].contains(&model) {
        bail!("Choose Parakeet Ultra, V3, or English");
    }
    Ok(())
}
async fn run(args: &[&str], cancel: CancellationToken, seconds: u64) -> Result<Value> {
    let path = helper();
    if !path.is_file() {
        bail!("The built-in speech helper is missing. Run npm run speech:prepare, then reopen Settings.");
    }
    let output = tokio::select! {
        result = tokio::time::timeout(std::time::Duration::from_secs(seconds), tokio::process::Command::new(path).args(args).kill_on_drop(true).output()) => result.context("Speech operation timed out; retry from Settings")??,
        _=cancel.cancelled()=>bail!("Speech operation cancelled")
    };
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        bail!(
            "Local speech engine failed: {}",
            detail
                .chars()
                .rev()
                .take(1200)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
        );
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
        .context("Speech engine returned no result")
}
impl Service {
    pub async fn speech_catalog(&self) -> Value {
        let cached = if helper().is_file() {
            run(&["status"], self.shutdown_token.child_token(), 5)
                .await
                .unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        let jobs = self.store.records("jobs").unwrap_or_default();
        let models = [("ultra", "Parakeet Ultra", "Multilingual · recommended"), ("v3", "Parakeet V3", "Multilingual · 25 languages"), ("v2", "Parakeet English", "English only")].into_iter().map(|(id,name,description)| {
            let installed = cached[id] == true;
            let job = jobs.iter().find(|j|j["kind"]=="speech_download" && j["target_id"]==id && [Some("queued"),Some("running")].contains(&j["status"].as_str()));
            json!({"id":id,"name":name,"description":description,"installed":installed,"job_id":job.map(|j|j["id"].clone())})
        }).collect::<Vec<_>>();
        json!({"runtime_available":helper().is_file(),"models":models})
    }
    pub async fn prepare_speech_model(
        &self,
        model: &str,
        cancel: CancellationToken,
    ) -> Result<Value> {
        validate_model(model)?;
        let result = run(&["prepare", model], cancel, 1200).await?;
        if result["ready"] != true {
            bail!("Speech engine could not prepare the model");
        }
        self.store.save(
            "speech_models",
            &json!({"id":model,"ready":true,"prepared_at":crate::now()}),
        )?;
        Ok(result)
    }
    pub async fn builtin_transcribe(&self, bytes: &[u8], mime: &str, model: &str) -> Result<Value> {
        validate_model(model)?;
        // NamedTempFile uses private permissions and removes the audio on every exit path.
        let extension = match mime {
            "audio/mp4" => ".m4a",
            "audio/wav" => ".wav",
            "audio/ogg" => ".ogg",
            _ => ".webm",
        };
        let mut file = tempfile::Builder::new()
            .prefix("speech-")
            .suffix(extension)
            .tempfile_in(&self.store.directory)?;
        std::io::Write::write_all(&mut file, bytes)?;
        let path = file
            .path()
            .to_str()
            .context("Invalid temporary audio path")?;
        self.speech_runtime
            .transcribe(model, path, self.shutdown_token.child_token())
            .await
    }

    pub async fn speech_status(&self) -> Value {
        let config = self
            .store
            .get("settings", "speech")
            .unwrap_or(json!({"engine":"builtin","model":"ultra"}));
        if config["engine"] == "builtin" {
            let catalog = self.speech_catalog().await;
            let available = catalog["models"].as_array().is_some_and(|models| {
                models
                    .iter()
                    .any(|m| m["id"] == config["model"] && m["installed"] == true)
            });
            json!({"available":available,"model":config["model"],"detail":if available {"Parakeet is ready for live dictation."} else {"Download Parakeet Ultra in Settings → Interview & AI to enable voice answers."}})
        } else {
            json!({"available":config["endpoint"].as_str().is_some_and(|s| !s.is_empty()),"model":config["model"],"detail":"Local speech endpoint is checked at transcription time."})
        }
    }
}
