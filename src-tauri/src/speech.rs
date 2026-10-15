//! Built-in CoreML speech models, isolated from the UI and cloud inference.
use crate::Service;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

pub fn helper() -> PathBuf {
    let installed = std::env::current_exe().unwrap_or_default().parent().unwrap_or(std::path::Path::new(".")).join("forgepad-speech");
    if installed.is_file() { return installed; }
    #[cfg(debug_assertions)]
    {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native-speech/.build/release/forgepad-speech")
    }
    #[cfg(not(debug_assertions))]
    { installed }
}
pub fn validate_model(model: &str) -> Result<()> {
    if !["ultra", "v3", "v2"].contains(&model) { bail!("Choose Parakeet Ultra, V3, or English"); }
    Ok(())
}
async fn run(args: &[&str], cancel: CancellationToken, seconds: u64) -> Result<Value> {
    let path = helper();
    if !path.is_file() { bail!("The built-in speech helper is missing. Run npm run speech:prepare, then reopen Settings."); }
    let output = tokio::select! {
        result = tokio::time::timeout(std::time::Duration::from_secs(seconds), tokio::process::Command::new(path).args(args).kill_on_drop(true).output()) => result.context("Speech operation timed out; retry from Settings")??,
        _=cancel.cancelled()=>bail!("Speech operation cancelled")
    };
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        bail!("Local speech engine failed: {}", detail.chars().rev().take(1200).collect::<String>().chars().rev().collect::<String>());
    }
    String::from_utf8_lossy(&output.stdout).lines().rev().find_map(|line|serde_json::from_str::<Value>(line).ok()).context("Speech engine returned no result")
}
impl Service {
    pub async fn speech_catalog(&self) -> Value {
        let cached = if helper().is_file() { run(&["status"],self.shutdown_token.child_token(),5).await.unwrap_or(Value::Null) } else { Value::Null };
        let jobs = self.store.records("jobs").unwrap_or_default();
        let models = [("ultra", "Parakeet Ultra", "Multilingual · recommended"), ("v3", "Parakeet V3", "Multilingual · 25 languages"), ("v2", "Parakeet English", "English only")].into_iter().map(|(id,name,description)| {
            let installed = cached[id] == true;
            let job = jobs.iter().find(|j|j["kind"]=="speech_download" && j["target_id"]==id && [Some("queued"),Some("running")].contains(&j["status"].as_str()));
            json!({"id":id,"name":name,"description":description,"installed":installed,"job_id":job.map(|j|j["id"].clone())})
        }).collect::<Vec<_>>();
        json!({"runtime_available":helper().is_file(),"models":models})
    }
    pub async fn prepare_speech_model(&self, model: &str, cancel: CancellationToken) -> Result<Value> {
        validate_model(model)?;
        let result = run(&["prepare",model],cancel,1200).await?;
        if result["ready"] != true { bail!("Speech engine could not prepare the model"); }
        self.store.save("speech_models", &json!({"id":model,"ready":true,"prepared_at":crate::now()}))?;
        Ok(result)
    }
    pub async fn builtin_transcribe(&self, bytes: &[u8], mime: &str, model: &str) -> Result<Value> {
        validate_model(model)?;
        // NamedTempFile uses private permissions and removes the audio on every exit path.
        let extension = match mime { "audio/mp4"=>".m4a", "audio/wav"=>".wav", "audio/ogg"=>".ogg", _=>".webm" };
        let mut file = tempfile::Builder::new().prefix("speech-").suffix(extension).tempfile_in(&self.store.directory)?;
        std::io::Write::write_all(&mut file,bytes)?;
        let path = file.path().to_str().context("Invalid temporary audio path")?;
        run(&["transcribe",model,path],self.shutdown_token.child_token(),120).await
    }
}
