//! Interview-only cloud inference. Credentials stay in macOS Keychain.
use crate::Service;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

const ENDPOINT: &str = "https://openrouter.ai/api/v1";
impl Service {
    fn openrouter_entry(&self) -> Result<keyring::Entry> {
        let hash = format!(
            "{:x}",
            Sha256::digest(self.store.directory.to_string_lossy().as_bytes())
        );
        Ok(keyring::Entry::new(
            "dev.forgepad.desktop",
            &format!("openrouter-{}", &hash[..16]),
        )?)
    }
    pub fn openrouter_settings(&self) -> Value {
        let config = self
            .store
            .get("settings", "openrouter")
            .unwrap_or(json!({"id":"openrouter","enabled":false,"model":""}));
        json!({"enabled":config["enabled"]==true,"model":config["model"],"connected":self.openrouter_entry().and_then(|e|Ok(e.get_password()?)).is_ok()})
    }
    pub fn openrouter_enabled(&self) -> bool {
        self.store
            .get("settings", "openrouter")
            .is_ok_and(|v| v["enabled"] == true)
    }
    pub fn configure_openrouter(&self, body: &Value) -> Result<Value> {
        let model = body["model"].as_str().unwrap_or("").trim();
        if model.len() > 200 || (body["enabled"] == true && model.is_empty()) {
            bail!("Enter an OpenRouter model ID before enabling AI replies");
        }
        let entry = self.openrouter_entry()?;
        if let Some(key) = body["api_key"].as_str().filter(|k| !k.trim().is_empty()) {
            if key.len() > 512 || key.chars().any(char::is_whitespace) {
                bail!("Enter a valid OpenRouter API key");
            }
            entry.set_password(key)?;
        }
        if body["enabled"] == true {
            entry
                .get_password()
                .context("Add your OpenRouter API key first")?;
        }
        self.store.save(
            "settings",
            &json!({"id":"openrouter","enabled":body["enabled"]==true,"model":model}),
        )?;
        Ok(self.openrouter_settings())
    }
    pub fn disconnect_openrouter(&self) -> Result<Value> {
        match self.openrouter_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.into()),
        }
        self.store.save(
            "settings",
            &json!({"id":"openrouter","enabled":false,"model":""}),
        )?;
        Ok(self.openrouter_settings())
    }
    pub async fn openrouter_reply(
        &self,
        system: &str,
        context: Value,
        cancel: CancellationToken,
    ) -> Result<String> {
        let config = self.store.get("settings", "openrouter")?;
        if config["enabled"] != true {
            bail!("OpenRouter is disabled");
        }
        let key = self
            .openrouter_entry()?
            .get_password()
            .context("Reconnect OpenRouter in Settings")?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(60))
            .build()?;
        let request = client.post(format!("{ENDPOINT}/chat/completions"))
            .bearer_auth(key).header("X-Title", "ForgePad")
            .json(&json!({"model":config["model"],"messages":[{"role":"system","content":system},{"role":"user","content":context.to_string()}],"max_tokens":600,"temperature":0.3}));
        let response = tokio::select! {
            r=request.send()=>r?,
            _=cancel.cancelled()=>bail!("Interview reply cancelled")
        };
        if !response.status().is_success() {
            // Do not echo upstream bodies: they may contain sensitive request data.
            bail!("OpenRouter returned HTTP {}. Check your API key, model access, and credit balance.", response.status().as_u16());
        }
        let body: Value = tokio::select! {
            r=response.json()=>r?,
            _=cancel.cancelled()=>bail!("Interview reply cancelled")
        };
        let text = body["choices"][0]["message"]["content"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .context("OpenRouter returned no reply")?;
        Ok(text.chars().take(8000).collect())
    }
}
