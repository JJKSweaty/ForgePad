use forgepad_core::{written_workspace, Service};
use serde_json::{json, Value};
use std::path::Path;
fn seeds() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../questions")
}
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../backend/tests/fixtures/written-workspace.json"
    ))
    .unwrap()
}
#[tokio::test]
async fn migration_preserves_old_drafts_and_workspace_survives_restart_and_legacy_writes() {
    let dir = tempfile::tempdir().unwrap();
    {
        let service = Service::open(dir.path(), &seeds()).unwrap();
        let q = service.store.question("sensor-pipeline", None).unwrap();
        service
            .store
            .save_draft(&q, &json!({"files":{},"answer":"Original answer"}))
            .unwrap();
    }
    {
        let db = rusqlite::Connection::open(dir.path().join("forgepad.sqlite3")).unwrap();
        db.execute_batch("DROP TABLE written_workspaces; PRAGMA user_version=5;")
            .unwrap();
    }
    let text;
    {
        let service = Service::open(dir.path(), &seeds()).unwrap();
        let q = service.store.question("sensor-pipeline", None).unwrap();
        assert_eq!(
            service.store.draft(&q).unwrap()["answer"],
            "Original answer"
        );
        let saved = service
            .store
            .save_draft(
                &q,
                &json!({"files":{},"answer":"ignored projection","written_workspace":fixture()}),
            )
            .unwrap();
        text = saved["answer"].as_str().unwrap().to_string();
        assert!(text.contains("Sensor → Bounded queue: samples"));
        assert_eq!(saved["written_workspace"], fixture());
        assert_eq!(
            service
                .store
                .save_draft(&q, &json!({"files":{},"answer":text}))
                .unwrap()["written_workspace"],
            fixture()
        );
        assert!(service
            .store
            .save_draft(&q, &json!({"files":{},"answer":"flattened replacement"}))
            .unwrap_err()
            .to_string()
            .contains("Structured answer exists"));
        let export = service.store.export().unwrap();
        assert_eq!(export["drafts"][0]["written_workspace"], fixture());
    }
    let service = Service::open(dir.path(), &seeds()).unwrap();
    let q = service.store.question("sensor-pipeline", None).unwrap();
    assert_eq!(service.store.draft(&q).unwrap()["answer"], text);
    assert_eq!(
        service.store.draft(&q).unwrap()["written_workspace"],
        fixture()
    );
    let db = rusqlite::Connection::open(dir.path().join("forgepad.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        6
    );
}
#[tokio::test]
async fn written_submissions_snapshot_graphs_without_changing_assessment_rules() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::open(dir.path(), &seeds()).unwrap();
    let session = service
        .start_session(&json!({"question_id":"sensor-pipeline"}), "interview")
        .unwrap();
    let attempt=service.route("POST","/attempts",json!({"question_id":"sensor-pipeline","session_id":session["id"],"answer":"","confidence":"confident","written_workspace":fixture()})).await.unwrap();
    assert_eq!(attempt["assessment_basis"], "self_report");
    assert_eq!(attempt["completion_status"], "needs_review");
    let mut changed = fixture();
    changed["diagram"]["nodes"][0]["label"] = json!("Changed after submit");
    service
        .route(
            "PUT",
            "/drafts/sensor-pipeline",
            json!({"files":{},"answer":"","written_workspace":changed}),
        )
        .await
        .unwrap();
    let stored = service
        .route(
            "GET",
            &format!("/attempts/{}", attempt["id"].as_str().unwrap()),
            Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(stored["written_workspace"], fixture());
    let compact = service
        .route("GET", "/progress?compact=true", Value::Null)
        .await
        .unwrap();
    assert!(compact["attempts"][0].get("written_workspace").is_none());
    let replay = service
        .store
        .replay(session["id"].as_str().unwrap())
        .unwrap();
    assert!(replay
        .iter()
        .any(|e| e["kind"] == "written_response" && e["written_workspace"] == fixture()));
}
#[test]
fn validates_graph_boundaries_and_keeps_legacy_text_unchanged() {
    let q = json!({"type":"design"});
    let mut w = fixture();
    w["diagram"]["edges"][0]["target"] = json!("missing");
    assert!(written_workspace::validate(&w, &q).is_err());
    let mut w = fixture();
    w["diagram"]["nodes"][1]["id"] = json!("sensor");
    assert!(written_workspace::validate(&w, &q).is_err());
    let mut w = fixture();
    w["schema_version"] = json!(2);
    assert!(written_workspace::validate(&w, &q).is_err());
    let w = json!({"schema_version":1,"mode":"theory","sections":{"explanation":"  Original\ntext  "},"confidence":"partial","reflection":""});
    assert_eq!(
        written_workspace::validate(&w, &json!({"type":"theory"})).unwrap(),
        "  Original\ntext  "
    );
    let mut w = fixture();
    w["sections"]["requirements"] = json!("é".repeat(25001));
    assert!(written_workspace::validate(&w, &q).is_err());
    let mut w = fixture();
    w["diagram"]["nodes"] = json!((0..101)
        .map(|i| json!({"id":format!("n{i}"),"label":"N","x":0,"y":0}))
        .collect::<Vec<_>>());
    assert!(written_workspace::validate(&w, &q).is_err());
}
