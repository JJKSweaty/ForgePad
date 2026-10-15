use crate::Service;
use anyhow::{Context, Result};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    os::unix::fs::PermissionsExt,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Command {
    method: String,
    path: String,
    #[serde(default)]
    body: Value,
}
async fn command(State(s): State<Arc<Service>>, Json(c): Json<Command>) -> Response {
    match s.route(&c.method, &c.path, c.body).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"detail":e.to_string()})),
        )
            .into_response(),
    }
}
async fn private_mcp(State(s): State<Arc<Service>>, Json(request): Json<Value>) -> Response {
    rpc_response(s, request).await
}
async fn rpc_response(s: Arc<Service>, request: Value) -> Response {
    match crate::mcp::rpc(s, request).await {
        Some(v) => Json(v).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }
}
pub async fn start_private(
    s: Arc<Service>,
    socket: &Path,
    cancel: CancellationToken,
) -> Result<()> {
    if socket.exists() {
        std::fs::remove_file(socket)?;
    }
    let listener = tokio::net::UnixListener::bind(socket)?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
    let app = Router::new()
        .route("/command", post(command))
        .route("/mcp", post(private_mcp))
        .layer(DefaultBodyLimit::max(40 * 1024 * 1024))
        .with_state(s);
    axum::serve(listener, app)
        .with_graceful_shutdown(cancel.cancelled_owned())
        .await?;
    Ok(())
}
fn entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(
        "dev.forgepad.desktop",
        "mcp-loopback-v1",
    )?)
}
pub fn revoke_key() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
fn key(force_new: bool) -> Result<String> {
    match if force_new {
        Err(keyring::Error::NoEntry)
    } else {
        entry()?.get_password()
    } {
        Ok(s) => Ok(s),
        Err(keyring::Error::NoEntry) => {
            use rand::RngCore;
            let mut bytes = [0u8; 32];
            rand::rng().fill_bytes(&mut bytes);
            let value = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
            entry()?.set_password(&value)?;
            Ok(value)
        }
        Err(e) => Err(e.into()),
    }
}
struct HttpState {
    service: Arc<Service>,
    host: String,
    token: String,
    limiter: Mutex<(Instant, u32)>,
}
async fn http_mcp(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    if !*state.service.mcp_enabled.lock().unwrap()
        || state.service.http_url.lock().unwrap().as_deref()
            != Some(format!("http://{}/mcp", state.host).as_str())
    {
        return (StatusCode::FORBIDDEN, "ForgePad access was revoked").into_response();
    }
    if headers.get("host").and_then(|v| v.to_str().ok()) != Some(state.host.as_str()) {
        return (StatusCode::FORBIDDEN, "Invalid Host header").into_response();
    }
    if let Some(origin) = headers.get("origin") {
        if origin.to_str().ok() != Some(format!("http://{}", state.host).as_str()) {
            return (StatusCode::FORBIDDEN, "Invalid Origin header").into_response();
        }
    }
    let expected = format!("Bearer {}", state.token);
    let actual = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    // Constant-time comparison of equal-length credentials; never emit either credential.
    if actual.len() != expected.len()
        || actual
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            != 0
    {
        return (StatusCode::UNAUTHORIZED, "Invalid API key").into_response();
    }
    let accept = headers
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !accept.contains("application/json") || !accept.contains("text/event-stream") {
        return StatusCode::NOT_ACCEPTABLE.into_response();
    }
    if request["method"] != "initialize" {
        if let Some(version) = headers
            .get("mcp-protocol-version")
            .and_then(|v| v.to_str().ok())
        {
            if !["2025-11-25", "2025-06-18", "2025-03-26"].contains(&version) {
                return (StatusCode::BAD_REQUEST, "Unsupported MCP protocol version")
                    .into_response();
            }
        }
    }
    {
        let mut rate = state.limiter.lock().unwrap();
        if rate.0.elapsed() > Duration::from_secs(60) {
            *rate = (Instant::now(), 0);
        }
        if rate.1 >= 120 {
            return StatusCode::TOO_MANY_REQUESTS.into_response();
        }
        rate.1 += 1;
    }
    rpc_response(state.service.clone(), request).await
}
pub async fn enable_http(s: Arc<Service>) -> Result<Value> {
    anyhow::ensure!(
        *s.mcp_enabled.lock().unwrap(),
        "Enable the HeyClicky integration first"
    );
    // API key appears only in this explicit setup response, never in status/logs.
    let existing = s.http_url.lock().unwrap().clone();
    let token =
        key(existing.is_none()).context("macOS Keychain could not store the local MCP API key")?;
    if let Some(url) = s.http_url.lock().unwrap().clone() {
        return Ok(
            json!({"url":url,"api_key":token,"authentication":"API key (Bearer token), not OAuth"}),
        );
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let host = listener.local_addr()?.to_string();
    let url = format!("http://{host}/mcp");
    let cancel = CancellationToken::new();
    *s.http_stop.lock().unwrap() = Some(cancel.clone());
    *s.http_url.lock().unwrap() = Some(url.clone());
    let state = Arc::new(HttpState {
        service: s,
        host,
        token: token.clone(),
        limiter: Mutex::new((Instant::now(), 0)),
    });
    let app = Router::new()
        .route("/mcp", post(http_mcp))
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
        .with_state(state);
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(cancel.cancelled_owned())
            .await;
    });
    Ok(
        json!({"url":url,"api_key":token,"authentication":"API key (Bearer token), not OAuth","loopback_only":true}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    fn router() -> (tempfile::TempDir, Arc<Service>, Router) {
        let dir = tempfile::tempdir().unwrap();
        let s = Service::open(dir.path(), Path::new("/nonexistent-seeds")).unwrap();
        *s.mcp_enabled.lock().unwrap() = true;
        *s.http_url.lock().unwrap() = Some("http://127.0.0.1:8765/mcp".into());
        let state = Arc::new(HttpState {
            service: s.clone(),
            host: "127.0.0.1:8765".into(),
            token: "test-token-only".into(),
            limiter: Mutex::new((Instant::now(), 0)),
        });
        let router = Router::new()
            .route("/mcp", post(http_mcp))
            .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
            .with_state(state);
        (dir, s, router)
    }
    fn request(host: &str, origin: Option<&str>, auth: bool) -> Request<Body> {
        let mut req = Request::builder()
            .method("POST")
            .uri("/mcp")
            .header("host", host)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream");
        if let Some(origin) = origin {
            req = req.header("origin", origin);
        }
        if auth {
            req = req.header("authorization", "Bearer test-token-only");
        }
        req.body(Body::from(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}).to_string())).unwrap()
    }
    #[tokio::test]
    async fn streamable_http_auth_origin_host_and_revocation() {
        let (_dir, s, r) = router();
        assert_eq!(
            r.clone()
                .oneshot(request("evil.example", None, true))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            r.clone()
                .oneshot(request(
                    "127.0.0.1:8765",
                    Some("https://evil.example"),
                    true
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            r.clone()
                .oneshot(request("127.0.0.1:8765", None, false))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let response = r
            .clone()
            .oneshot(request("127.0.0.1:8765", None, true))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 16384)
            .await
            .unwrap();
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["result"]["serverInfo"]["name"], "ForgePad");
        *s.mcp_enabled.lock().unwrap() = false;
        assert_eq!(
            r.oneshot(request("127.0.0.1:8765", None, true))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    #[tokio::test]
    async fn rejects_unsupported_method_oversize_and_accept() {
        let (_dir, _s, r) = router();
        let get = Request::builder().uri("/mcp").body(Body::empty()).unwrap();
        assert_eq!(
            r.clone().oneshot(get).await.unwrap().status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        let req = Request::builder()
            .method("POST")
            .uri("/mcp")
            .header("content-type", "application/json")
            .body(Body::from(" ".repeat(4 * 1024 * 1024 + 1)))
            .unwrap();
        assert_eq!(
            r.clone().oneshot(req).await.unwrap().status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        let mut req = request("127.0.0.1:8765", None, true);
        req.headers_mut()
            .insert("accept", "text/plain".parse().unwrap());
        assert_eq!(
            r.oneshot(req).await.unwrap().status(),
            StatusCode::NOT_ACCEPTABLE
        );
    }
}
