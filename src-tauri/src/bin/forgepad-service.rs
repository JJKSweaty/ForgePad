use forgepad_core::{transport, Service};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dir = forgepad_core::data_dir();
    let seeds = std::env::var_os("FORGEPAD_QUESTIONS")
        .map(std::path::PathBuf::from)
        .unwrap_or(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../questions"));
    let service = Service::open(&dir, &seeds)?;
    let executable = std::env::current_exe()?
        .parent()
        .unwrap()
        .join("forgepad-mcp");
    if executable.is_file() {
        *service.mcp_path.lock().unwrap() = Some(executable.display().to_string());
    }
    let cancel = service.shutdown_token.clone();
    let stopped = cancel.clone();
    let shutting_down = service.clone();
    tokio::spawn(async move {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}};
        shutting_down.shutdown().await;
        stopped.cancel();
    });
    eprintln!("ForgePad service: {}", dir.display());
    transport::start_private(service, &dir.join("service.sock"), cancel).await
}
