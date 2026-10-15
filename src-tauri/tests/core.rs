use forgepad_core::{mcp, schema, Service};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
fn seeds() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../questions")
}
fn workspace() -> (tempfile::TempDir, Arc<Service>) {
    let dir = tempfile::tempdir().unwrap();
    let s = Service::open(dir.path(), &seeds()).unwrap();
    (dir, s)
}
async fn tool(s: Arc<Service>, name: &str, args: Value) -> Value {
    mcp::rpc(s,json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":name,"arguments":args}})).await.unwrap()
}
async fn enable(s: &Arc<Service>) {
    s.route("POST", "/integrations/heyclicky/connect", json!({}))
        .await
        .unwrap();
}
#[tokio::test]
async fn local_coach_uses_candidate_context_and_rejects_strict_interviews() {
    let (_dir, s) = workspace();
    let q = s.store.question("uart-frame-recovery", None).unwrap();
    let context = forgepad_core::coach::context(
        &schema::candidate(&q),
        &json!({"message":"What should I consider?","answer":"My reasoning","files":{}}),
    )
    .unwrap();
    let text = context.to_string();
    assert!(!text.contains("reference_solution"));
    assert!(!text.contains("hidden"));
    assert_eq!(context["answer"], "My reasoning");
    s.start_session(&json!({"question_id":"uart-frame-recovery"}), "interview")
        .unwrap();
    let error = s
        .route(
            "POST",
            "/questions/uart-frame-recovery/coach",
            json!({"message":"Give a hint"}),
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("strict interview"));
}
#[tokio::test]
async fn written_interview_response_is_recorded_in_replay_as_self_review() {
    let (_dir, s) = workspace();
    let session = s
        .start_session(&json!({"question_id":"sensor-pipeline"}), "interview")
        .unwrap();
    let result = s.route("POST", "/attempts", json!({"question_id":"sensor-pipeline","session_id":session["id"],"answer":"Use bounded queues and measure deadlines.","confidence":"partial"})).await.unwrap();
    assert!(result["result"].is_null());
    assert_eq!(result["assessment_basis"], "self_report");
    let replay = s.store.replay(session["id"].as_str().unwrap()).unwrap();
    let response = replay
        .iter()
        .find(|e| e["kind"] == "written_response")
        .unwrap();
    assert_eq!(
        response["content"],
        "Use bounded queues and measure deadlines."
    );
    assert_eq!(response["confidence"], "partial");
}
#[tokio::test]
async fn mcp_can_read_working_material_and_control_sessions_without_protected_answers() {
    let (_dir, s) = workspace();
    enable(&s).await;
    let result = tool(
        s.clone(),
        "forgepad_get_question",
        json!({"question_id":"uart-frame-recovery"}),
    )
    .await;
    assert_eq!(result["result"]["isError"], false);
    let q = &result["result"]["structuredContent"]["data"]["question"];
    assert!(q["prompt"].is_string());
    assert!(q.get("reference_solution").is_none());
    assert!(q["test_config"]["tests"]
        .as_array()
        .unwrap()
        .iter()
        .all(|t| t["visibility"] == "public"));
    let draft = tool(
        s.clone(),
        "forgepad_get_working_draft",
        json!({"question_id":"uart-frame-recovery"}),
    )
    .await;
    let mut body = draft["result"]["structuredContent"]["data"]["draft"].clone();
    body["question_id"] = json!("uart-frame-recovery");
    body["updated_at"] = Value::Null;
    body["answer"] = json!("Check bounds");
    let saved = tool(s.clone(), "forgepad_save_working_draft", body.clone()).await;
    assert_eq!(saved["result"]["isError"], false);
    assert_eq!(
        tool(s.clone(), "forgepad_save_working_draft", body).await["result"]["isError"],
        true
    );
    assert_eq!(
        s.store
            .draft(&s.store.question("uart-frame-recovery", None).unwrap())
            .unwrap()["answer"],
        "Check bounds"
    );
    let session = s
        .start_session(&json!({"question_id":"uart-frame-recovery"}), "interview")
        .unwrap();
    let paused = tool(
        s.clone(),
        "forgepad_control_session",
        json!({"session_id":session["id"],"action":"pause"}),
    )
    .await;
    assert_eq!(
        paused["result"]["structuredContent"]["data"]["session"]["paused"],
        true
    );
    assert!(paused["result"]["structuredContent"]["data"]["session"]
        .get("transcript")
        .is_none());
    let hint = tool(
        s.clone(),
        "forgepad_get_hint",
        json!({"question_id":"uart-frame-recovery","index":0}),
    )
    .await;
    assert_eq!(hint["result"]["isError"], true);
    let q = tool(
        s,
        "forgepad_get_question",
        json!({"question_id":"uart-frame-recovery"}),
    )
    .await;
    assert_eq!(
        q["result"]["structuredContent"]["data"]["question"]["hints"],
        json!([])
    );
}
#[test]
fn deep_links_reject_commands_paths_credentials_and_ambiguity() {
    for s in [
        "forgepad://question/timer-rollover",
        "forgepad://interview/5c79f785",
        "forgepad://app",
    ] {
        assert!(schema::deep_link(s).is_ok(), "{s}");
    }
    for s in [
        "file:///etc/passwd",
        "forgepad://question/../../etc/passwd",
        "forgepad://question/%2Fetc",
        "forgepad://question/x?command=rm",
        "forgepad://evil/x",
        "forgepad://user:pass@question/x",
        "forgepad://app/extra",
        "forgepad://question/",
    ] {
        assert!(schema::deep_link(s).is_err(), "{s}");
    }
}
#[test]
fn private_projection_removes_every_protected_field() {
    let (_dir, s) = workspace();
    let q = s.store.question("uart-frame-recovery", None).unwrap();
    let safe = schema::candidate(&q);
    for k in [
        "reference_solution",
        "solution_notes",
        "time_complexity",
        "space_complexity",
    ] {
        assert!(safe.get(k).is_none());
    }
    assert!(safe["test_config"]["tests"]
        .as_array()
        .unwrap()
        .iter()
        .all(|t| t["visibility"] == "public"));
}
#[test]
fn only_one_service_can_own_a_workspace() {
    let (dir, s) = workspace();
    assert!(Service::open(dir.path(), &seeds()).is_err());
    drop(s);
    assert!(Service::open(dir.path(), &seeds()).is_ok());
}
#[test]
fn new_packages_match_the_shared_schema() {
    let (_dir, s) = workspace();
    for id in [
        "align-up",
        "reverse-bits",
        "debounce-state",
        "uart-frame-recovery",
    ] {
        let q = s.store.question(id, None).unwrap();
        assert_eq!(schema::validate(&q), Vec::<String>::new(), "{id}");
    }
}
#[test]
fn roadmap_counts_real_tests_and_theory_separately() {
    let (_dir, s) = workspace();
    let r = s.roadmap("firmware-coding-essentials").unwrap();
    assert_eq!(r["total"], 16);
    assert!(r["steps"]
        .as_array()
        .unwrap()
        .iter()
        .all(|v| v["available"] == true));
    let q = s.store.question("align-up", None).unwrap();
    s.attempt(
        &q,
        json!({}),
        json!({"status":"passed","passed":8,"total":8}),
        "",
        "",
        "",
    )
    .unwrap();
    let r = s.roadmap("firmware-coding-essentials").unwrap();
    assert_eq!(r["solved"], 1);
    assert_eq!(r["mastered"], 0);
    assert_eq!(r["completion_percent"], 6.25);
}
#[tokio::test]
async fn mcp_handshake_discovery_validation_and_revocation() {
    let (_dir, s) = workspace();
    let req = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}});
    assert!(mcp::rpc(s.clone(), req.clone())
        .await
        .unwrap()
        .get("error")
        .is_some());
    enable(&s).await;
    assert_eq!(
        mcp::rpc(s.clone(), req).await.unwrap()["result"]["serverInfo"]["name"],
        "ForgePad"
    );
    let discovered = mcp::rpc(
        s.clone(),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    )
    .await
    .unwrap();
    assert_eq!(discovered["result"]["tools"].as_array().unwrap().len(), 25);
    let bad = tool(
        s.clone(),
        "forgepad_search_questions",
        json!({"include_hidden":true}),
    )
    .await;
    assert_eq!(bad["error"]["code"], -32602);
    let forbidden = tool(s.clone(), "forgepad_publish_question", json!({})).await;
    assert_eq!(forbidden["error"]["code"], -32602);
    *s.mcp_enabled.lock().unwrap() = false;
    assert!(tool(s, "forgepad_get_preparation_status", json!({}))
        .await
        .get("error")
        .is_some());
}
#[tokio::test]
async fn mcp_drafts_tasks_and_sessions_write_the_authoritative_store() {
    let (_dir, s) = workspace();
    enable(&s).await;
    let d = tool(
        s.clone(),
        "forgepad_create_question_draft",
        json!({"idea":"A DMA circular buffer"}),
    )
    .await;
    assert_eq!(d["result"]["isError"], false);
    assert_eq!(s.store.records("question_drafts").unwrap().len(), 1);
    let task = tool(
        s.clone(),
        "forgepad_add_practice_task",
        json!({"title":"Explain timer rollover"}),
    )
    .await;
    assert_eq!(task["result"]["isError"], false);
    assert_eq!(
        s.progress().unwrap()["goals"][0]["title"],
        "Explain timer rollover"
    );
    let result = tool(
        s.clone(),
        "forgepad_start_mock_interview",
        json!({"question_id":"timer-rollover","duration_minutes":30}),
    )
    .await;
    assert_eq!(result["result"]["isError"], false);
    let session = result["result"]["structuredContent"]["data"]["session"].clone();
    assert_eq!(session["duration_minutes"], 30);
    assert!(session.get("transcript").is_none());
    assert!(session["remaining_seconds"].as_f64().unwrap() > 1790.0);
    let repeated = tool(
        s.clone(),
        "forgepad_start_mock_interview",
        json!({"duration_minutes":30}),
    )
    .await;
    assert_eq!(repeated["result"]["isError"], true);
    let text =
        serde_json::to_string(&tool(s.clone(), "forgepad_get_preparation_status", json!({})).await)
            .unwrap();
    assert!(!text.contains("reference_solution"));
    assert!(!text.contains("transcript"));
    assert!(!text.contains("fixture"));
    let saved = s
        .store
        .get("interviews", session["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(saved["strict"], true);
}
#[tokio::test]
async fn publication_requires_validation_and_preserves_old_revisions() {
    let (_dir, s) = workspace();
    let mut q = s.store.question("volatile-atomicity", None).unwrap();
    q["version"] = json!(2);
    q["follow_ups"] = json!(["One?", "Two?", "Three?"]);
    q["hints"] = json!(["Review the target memory model."]);
    let d = s.stage(q, None, "test").unwrap();
    let id = d["id"].as_str().unwrap();
    assert!(s.store.publish(id).is_err());
    let report = s
        .validate_draft(id, tokio_util::sync::CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(report["valid"], true, "{report}");
    let published = s
        .route(
            "POST",
            &format!("/question-drafts/{id}/publish"),
            json!({"approved":true}),
        )
        .await
        .unwrap();
    assert_eq!(published["version"], 2);
    assert_eq!(
        s.store.question("volatile-atomicity", Some(1)).unwrap()["version"],
        1
    );
    assert!(s.store.publish(id).is_err());
}
#[tokio::test]
async fn changing_a_validated_draft_invalidates_approval() {
    let (_dir, s) = workspace();
    let mut q = s.store.question("volatile-atomicity", None).unwrap();
    q["version"] = json!(2);
    q["follow_ups"] = json!(["One?", "Two?", "Three?"]);
    q["hints"] = json!(["Hint"]);
    let d = s.stage(q.clone(), None, "test").unwrap();
    let id = d["id"].as_str().unwrap();
    s.validate_draft(id, tokio_util::sync::CancellationToken::new())
        .await
        .unwrap();
    q["title"] = json!("Edited after validation");
    s.route(
        "PUT",
        &format!("/question-drafts/{id}"),
        json!({"package":q}),
    )
    .await
    .unwrap();
    assert!(s.store.publish(id).is_err());
}
#[test]
fn background_jobs_cannot_overwrite_an_edited_draft() {
    let (_dir, s) = workspace();
    let d = s.stage(json!({}), None, "test").unwrap();
    let mut changed = d.clone();
    changed["idea"] = json!("User revision");
    s.store.save("question_drafts", &changed).unwrap();
    let mut result = d.clone();
    result["status"] = json!("validated");
    assert!(s
        .store
        .replace_if_unchanged("question_drafts", &d, &result)
        .is_err());
    assert_eq!(
        s.store
            .get("question_drafts", d["id"].as_str().unwrap())
            .unwrap()["idea"],
        "User revision"
    );
}
#[tokio::test]
async fn old_session_uses_its_original_question_revision() {
    let (_dir, s) = workspace();
    let q = s.store.question("timer-rollover", None).unwrap();
    let session = s
        .start_session(
            &json!({"question_id":"timer-rollover","duration_minutes":1}),
            "interview",
        )
        .unwrap();
    let mut newer = q.clone();
    newer["version"] = json!(2);
    newer["prompt"] = json!("Different contract");
    s.store.insert_seed(&newer).unwrap();
    let pinned = s
        .route(
            "GET",
            &format!(
                "/questions/timer-rollover?session_id={}",
                session["id"].as_str().unwrap()
            ),
            Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(pinned["version"], 1);
    assert_eq!(pinned["prompt"], q["prompt"]);
}
#[tokio::test]
async fn completion_remains_ungraded_without_evidence() {
    let (_dir, s) = workspace();
    let session = s
        .start_session(
            &json!({"question_id":"timer-rollover","duration_minutes":1}),
            "interview",
        )
        .unwrap();
    let id = session["id"].as_str().unwrap();
    let s = s
        .route(
            "POST",
            &format!("/interviews/{id}/events"),
            json!({"type":"finish"}),
        )
        .await
        .unwrap();
    assert!(s["report"]["score"].is_null());
    assert!(s["report"]["dimensions"]
        .as_array()
        .unwrap()
        .iter()
        .all(|d| d["rating"].is_null()));
}

#[tokio::test]
async fn autosaves_preserve_drafts_for_each_revision_and_export_all_history() {
    let (_dir, s) = workspace();
    let q = s.store.question("timer-rollover", None).unwrap();
    s.store
        .save_draft(
            &q,
            &json!({"files":{"old.c":"/* original draft */"},"answer":"old"}),
        )
        .unwrap();
    let mut next = q.clone();
    next["version"] = json!(2);
    s.store.insert_seed(&next).unwrap();
    s.store
        .save_draft(
            &next,
            &json!({"files":{"new.c":"/* new draft */"},"answer":"new"}),
        )
        .unwrap();
    assert_eq!(
        s.store.draft(&q).unwrap()["files"]["old.c"],
        "/* original draft */"
    );
    assert_eq!(
        s.store.draft(&next).unwrap()["files"]["new.c"],
        "/* new draft */"
    );
    let export = s.store.export().unwrap();
    assert_eq!(export["drafts"].as_array().unwrap().len(), 2);
    assert_eq!(
        export["questions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|q| q["id"] == "timer-rollover")
            .count(),
        2
    );
    s.route("DELETE", "/data", Value::Null).await.unwrap();
    assert!(s.progress().unwrap()["attempts"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        s.store.question("timer-rollover", Some(1)).unwrap()["version"],
        1
    );
}
