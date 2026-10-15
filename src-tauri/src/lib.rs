pub mod activity;
pub mod ai;
pub mod audit;
pub mod github;
pub mod mcp;
pub mod roadmaps;
pub mod schema;
pub mod service;
pub mod sessions;
pub mod store;
pub mod transport;
pub mod worker;
pub use service::Service;

pub fn data_dir() -> std::path::PathBuf {
    if let Some(path) = std::env::var_os("FORGEPAD_DATA_DIR") {
        return path.into();
    }
    std::path::PathBuf::from(std::env::var_os("HOME").expect("HOME is required"))
        .join("Library/Application Support/ForgePad")
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
