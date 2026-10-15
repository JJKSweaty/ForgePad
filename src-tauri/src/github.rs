//! Read-only GitHub account/calendar boundary. No repository writes or solution publishing.
use crate::Service;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn entry(s: &Service) -> Result<keyring::Entry> {
    let hash = format!(
        "{:x}",
        Sha256::digest(s.store.directory.to_string_lossy().as_bytes())
    );
    Ok(keyring::Entry::new(
        "dev.forgepad.desktop",
        &format!("github-calendar-{}", &hash[..16]),
    )?)
}
fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("ForgePad/0.2 (read-only contribution calendar)")
        .timeout(std::time::Duration::from_secs(12))
        .build()?)
}
pub fn calendar(response: &Value) -> Result<Value> {
    if response["errors"].is_array() {
        bail!("GitHub could not provide the contribution calendar. Check token permissions and retry.");
    }
    let viewer = &response["data"]["viewer"];
    let login = viewer["login"]
        .as_str()
        .context("GitHub did not return an authenticated account")?;
    let weeks = viewer["contributionsCollection"]["contributionCalendar"]["weeks"]
        .as_array()
        .context("GitHub calendar is missing")?;
    if weeks.len() > 54 {
        bail!("GitHub returned an unexpected calendar size");
    }
    let mut days = vec![];
    for week in weeks {
        for d in week["contributionDays"].as_array().into_iter().flatten() {
            let date = d["date"].as_str().context("GitHub date missing")?;
            chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")?;
            let count = d["contributionCount"]
                .as_u64()
                .context("Invalid GitHub contribution count")?;
            days.push(json!({"date":date,"count":count}));
        }
    }
    Ok(
        json!({"login":login,"days":days,"total":viewer["contributionsCollection"]["contributionCalendar"]["totalContributions"],"last_sync_at":crate::now()}),
    )
}
impl Service {
    pub fn github_status(&self) -> Result<Value> {
        let config = self
            .store
            .get("settings", "github")
            .unwrap_or(json!({"id":"github","connected":false}));
        let cache = self.store.get("github_cache", "calendar").ok();
        Ok(
            json!({"connected":config["connected"]==true,"login":config["login"],"last_sync_at":cache.as_ref().map(|c|c["last_sync_at"].clone()),"calendar":cache,"error":config["error"],"publishing_available":false}),
        )
    }
    pub async fn github_connect(&self, token: &str) -> Result<Value> {
        if token.len() < 10 || token.len() > 512 || token.chars().any(char::is_whitespace) {
            bail!(
                "Enter a valid GitHub personal access token. It is stored only in macOS Keychain."
            );
        }
        let r = client()?
            .get("https://api.github.com/user")
            .header("accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .send()
            .await?;
        if !r.status().is_success() {
            bail!(
                "GitHub did not accept this credential (HTTP {}). No token was stored.",
                r.status().as_u16()
            );
        }
        let user: Value = r.json().await?;
        let login = user["login"]
            .as_str()
            .context("GitHub did not return an account identity")?;
        entry(self)?
            .set_password(token)
            .context("Could not save the read-only GitHub credential in macOS Keychain")?;
        self.store.save(
            "settings",
            &json!({"id":"github","connected":true,"login":login,"error":null}),
        )?;
        self.github_sync().await
    }
    pub async fn github_sync(&self) -> Result<Value> {
        if self.store.get("settings", "github")?["connected"] != true {
            bail!("Connect a GitHub account first");
        }
        let operation=async{
            let token=entry(self)?.get_password().context("GitHub credential unavailable. Reconnect the account in Settings.")?;
            let at=chrono::Utc::now();
            let query="query Calendar($from: DateTime!, $to: DateTime!) { viewer { login contributionsCollection(from: $from, to: $to) { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }";
            let response=client()?.post("https://api.github.com/graphql").bearer_auth(token).json(&json!({"query":query,"variables":{"from":(at-chrono::Duration::days(364)).to_rfc3339(),"to":at.to_rfc3339()}})).send().await?;
            if !response.status().is_success(){bail!("GitHub calendar sync failed (HTTP {}). Cached activity remains available.",response.status().as_u16());}
            let response:Value=response.json().await?;let mut cache=calendar(&response)?;cache["id"]=json!("calendar");self.store.save("github_cache",&cache)?;
            let mut config=self.store.get("settings","github")?;config["error"]=Value::Null;config["login"]=cache["login"].clone();self.store.save("settings",&config)?;Ok::<(),anyhow::Error>(())
        }.await;
        if let Err(error) = operation {
            let mut config = self.store.get("settings", "github")?;
            config["error"] = json!(error.to_string());
            self.store.save("settings", &config)?;
        }
        self.notify("github_changed", json!({}));
        self.github_status()
    }
    pub fn github_disconnect(&self) -> Result<Value> {
        match entry(self)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.into()),
        }
        self.store
            .save("settings", &json!({"id":"github","connected":false}))?;
        self.store.with_db(|db| {
            db.execute("DELETE FROM native_records WHERE kind='github_cache'", [])?;
            Ok(())
        })?;
        self.notify("github_changed", json!({}));
        self.github_status()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar_keeps_only_dates_counts_and_identity() {
        let r = json!({"data":{"viewer":{"login":"fixture-account","contributionsCollection":{"contributionCalendar":{"totalContributions":3,"weeks":[{"contributionDays":[{"date":"2026-01-01","contributionCount":3,"secret_repository":"excluded"}]}]}}}}});
        let c = calendar(&r).unwrap();
        assert_eq!(c["days"][0]["count"], 3);
        assert!(!c.to_string().contains("secret_repository"));
    }
    #[test]
    fn rejects_graphql_errors_instead_of_faking_empty_success() {
        assert!(calendar(&json!({"errors":[{"message":"denied"}]})).is_err());
    }
}
