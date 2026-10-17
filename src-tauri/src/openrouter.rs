//! Shared interviewer and practice-coach cloud inference. Credentials stay in macOS Keychain.
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
        request_reply(ENDPOINT, &key, &config["model"], system, context, cancel).await
    }
}

// The endpoint is fixed in production; an isolated HTTP server exercises the same transport in tests.
async fn request_reply(
    endpoint: &str,
    key: &str,
    model: &Value,
    system: &str,
    context: Value,
    cancel: CancellationToken,
) -> Result<String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let request = client.post(format!("{endpoint}/chat/completions"))
            .bearer_auth(key).header("X-Title", "ForgePad")
            .json(&json!({"model":model,"messages":[{"role":"system","content":system},{"role":"user","content":context.to_string()}],"max_tokens":600,"temperature":0.3}));
    let response = tokio::select! {
        r=request.send()=>r?,
        _=cancel.cancelled()=>bail!("AI reply cancelled")
    };
    if !response.status().is_success() {
        // Do not echo upstream bodies: they may contain sensitive request data.
        bail!(
            "OpenRouter returned HTTP {}. Check your API key, model access, and credit balance.",
            response.status().as_u16()
        );
    }
    let body: Value = tokio::select! {
        r=response.json()=>r?,
        _=cancel.cancelled()=>bail!("AI reply cancelled")
    };
    let text = body["choices"][0]["message"]["content"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .context("OpenRouter returned no reply")?;
    Ok(text.chars().take(8000).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        http::{HeaderMap, StatusCode},
        routing::post,
        Json, Router,
    };

    #[tokio::test]
    async fn sends_shared_credentials_and_bounded_coach_context() {
        let app = Router::new().route("/chat/completions", post(|headers: HeaderMap, Json(body): Json<Value>| async move {
            assert_eq!(headers["authorization"], "Bearer test-only-credential");
            assert_eq!(body["model"], "test/model");
            assert_eq!(body["max_tokens"], 600);
            assert_eq!(body["messages"][0]["content"], "Coach system prompt");
            let context: Value = serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
            assert_eq!(context["answer"], "Consider a bounded queue");
            Json(json!({"choices":[{"message":{"content":"What happens when the queue fills?"}}]}))
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let text = request_reply(
            &endpoint,
            "test-only-credential",
            &json!("test/model"),
            "Coach system prompt",
            json!({"answer":"Consider a bounded queue"}),
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(text, "What happens when the queue fills?");
        server.abort();
    }

    #[tokio::test]
    async fn upstream_failures_hide_response_bodies() {
        let app = Router::new().route(
            "/chat/completions",
            post(|| async { (StatusCode::UNAUTHORIZED, "upstream_sensitive_content") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let error = request_reply(
            &endpoint,
            "test-only-credential",
            &json!("test/model"),
            "Coach",
            json!({}),
            CancellationToken::new(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("HTTP 401"));
        assert!(!error.contains("upstream_sensitive_content"));
        server.abort();
    }
}
