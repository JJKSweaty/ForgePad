#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use forgepad_core::{schema, Service};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
#[tauri::command]
async fn api_request(
    service: tauri::State<'_, Arc<Service>>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    service
        .route(&method, &path, body.unwrap_or(Value::Null))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn validate_deep_link(value: String) -> Result<Value, String> {
    schema::deep_link(&value).map_err(|e| e.to_string())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![api_request, validate_deep_link])
        .setup(|app| {
            let dir = forgepad_core::data_dir();
            let bundled = app.path().resource_dir()?.join("_up_/questions");
            let seeds = if bundled.is_dir() {
                bundled
            } else if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../questions")
            } else {
                return Err("Bundled question resources are missing".into());
            };
            let service = Service::open(&dir, &seeds)?;
            let exe = std::env::current_exe()?
                .parent()
                .unwrap()
                .join("forgepad-mcp");
            if exe.is_file() {
                *service.mcp_path.lock().unwrap() = Some(exe.display().to_string());
            }
            let handle = app.handle().clone();
            let mut events = service.events.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(event) => {
                            if event["type"] == "navigate" {
                                if let Some(w) = handle.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                            let _ = handle.emit("forgepad-event", event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });
            let backend = service.clone();
            let socket = dir.join("service.sock");
            tauri::async_runtime::spawn(async move {
                if let Err(e) = forgepad_core::transport::start_private(
                    backend.clone(),
                    &socket,
                    backend.shutdown_token.clone(),
                )
                .await
                {
                    eprintln!("ForgePad private service failed: {e}");
                }
            });
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Ok(target) = schema::deep_link(url.as_str()) {
                        let _ = handle.emit(
                            "forgepad-event",
                            serde_json::json!({"type":"navigate","data":target}),
                        );
                    }
                }
            });
            let runner_service = service.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = runner_service.prepare_runner(false).await {
                    eprintln!("Runner setup required: {error}");
                }
            });
            app.manage(service);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ForgePad could not start")
        .run({
            let closing = Arc::new(AtomicBool::new(false));
            move |app, event| {
                if let tauri::RunEvent::ExitRequested { api, .. } = event {
                    if !closing.swap(true, Ordering::SeqCst) {
                        api.prevent_exit();
                        let handle = app.clone();
                        let service = app.state::<Arc<Service>>().inner().clone();
                        tauri::async_runtime::spawn(async move {
                            service.shutdown().await;
                            handle.exit(0);
                        });
                    }
                }
            }
        });
}
