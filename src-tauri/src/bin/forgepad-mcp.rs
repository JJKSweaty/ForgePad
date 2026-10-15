//! Thin stdio bridge: no database, models, shell evaluation, or stdout diagnostics.
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let socket = match args.as_slice() {
        [] => forgepad_core::data_dir().join("service.sock"),
        [flag, path] if flag == "--socket" => path.into(),
        _ => {
            eprintln!("Usage: forgepad-mcp [--socket /absolute/path/service.sock]");
            std::process::exit(2)
        }
    };
    if !socket.is_absolute() {
        anyhow::bail!("Socket path must be absolute");
    }
    let client = reqwest::Client::builder()
        .unix_socket(socket.clone())
        .no_proxy()
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let mut input = BufReader::new(tokio::io::stdin());
    let mut output = tokio::io::stdout();
    loop {
        // Bound a line before allocating it; JSON-RPC stdio messages are newline-delimited.
        let mut line = Vec::new();
        loop {
            let chunk = input.fill_buf().await?;
            if chunk.is_empty() {
                break;
            }
            let n = chunk
                .iter()
                .position(|b| *b == b'\n')
                .map_or(chunk.len(), |i| i + 1);
            if line.len() + n > 4 * 1024 * 1024 {
                anyhow::bail!("MCP request exceeds 4 MiB");
            }
            let end = chunk[n - 1] == b'\n';
            line.extend_from_slice(&chunk[..n]);
            input.consume(n);
            if end {
                break;
            }
        }
        if line.is_empty() {
            break;
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let request: Value = match serde_json::from_slice(&line) {
            Ok(v) => v,
            Err(_) => {
                output.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"Invalid JSON\"}}\n").await?;
                output.flush().await?;
                continue;
            }
        };
        let response = client
            .post("http://localhost/mcp")
            .json(&request)
            .send()
            .await;
        let value = match response {
            Ok(r) if r.status() == 202 => None,
            Ok(r) if r.status().is_success() => Some(r.json::<Value>().await?),
            Ok(_) | Err(_) => {
                eprintln!("ForgePad service is unavailable. Open ForgePad and enable Settings → Integrations → HeyClicky.");
                request.get("id").map(|id|json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":"ForgePad service unavailable. Open ForgePad, then enable Settings → Integrations → HeyClicky and reconnect."}}))
            }
        };
        if let Some(value) = value {
            output.write_all(value.to_string().as_bytes()).await?;
            output.write_all(b"\n").await?;
            output.flush().await?;
        }
    }
    Ok(())
}
