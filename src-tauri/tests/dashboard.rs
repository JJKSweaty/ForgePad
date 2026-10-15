use chrono::{DateTime, Utc};
use forgepad_core::Service;
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
fn at(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}
fn workspace() -> (tempfile::TempDir, Arc<Service>) {
    let d = tempfile::tempdir().unwrap();
    let s = Service::open(
        d.path(),
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../questions"),
    )
    .unwrap();
    (d, s)
}
fn passing(s: &Service, question: &str, stamp: &str) -> Value {
    let q = s.store.question(question, None).unwrap();
    let a = json!({"id":forgepad_core::id(),"question_id":question,"question_version":1,"title":q["title"],"topics":q["topics"],"created_at":stamp,"result":{"status":"passed","passed":8,"total":8},"completion_status":"complete","review_due_at":"2026-12-01T00:00:00Z"});
    s.store.save("attempts", &a).unwrap();
    a
}
#[test]
fn no_data_is_empty_without_fabricated_metrics() {
    let (_d, s) = workspace();
    let d = s
        .dashboard_at("America/Toronto", at("2026-10-15T18:00:00Z"))
        .unwrap();
    assert_eq!(d["days"].as_array().unwrap().len(), 364);
    assert_eq!(d["metrics"]["questions_solved"], 0);
    assert_eq!(d["metrics"]["practice_seconds"], 0);
    assert_eq!(d["metrics"]["current_streak"], 0);
    assert!(d["continuation"]["question"]["id"].is_string());
    assert!(s.dashboard_at("not/a-zone", Utc::now()).is_err());
}
#[test]
fn repeated_success_is_one_solve_and_public_runs_are_not_solutions() {
    let (_d, s) = workspace();
    passing(&s, "align-up", "2026-10-15T01:00:00Z");
    passing(&s, "align-up", "2026-10-15T01:05:00Z");
    let d = s
        .dashboard_at("America/Toronto", at("2026-10-15T18:00:00Z"))
        .unwrap();
    assert_eq!(d["metrics"]["questions_solved"], 1);
    let prev = d["days"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["date"] == "2026-10-14")
        .unwrap();
    assert_eq!(prev["solved"], 1);
    assert_eq!(prev["activity"], 2);
    assert_eq!(d["metrics"]["current_streak"], 1);
}
#[test]
fn engagement_excludes_idle_windows_and_restart_gaps() {
    let (_d, s) = workspace();
    let q = s.store.question("align-up", None).unwrap();
    let visit = s
        .store
        .start_visit(&q, None, "test-window", at("2026-10-15T10:00:00Z"))
        .unwrap();
    let id = visit["id"].as_str().unwrap();
    s.store
        .heartbeat(id, true, true, false, at("2026-10-15T10:00:00Z"))
        .unwrap();
    assert_eq!(
        s.store
            .heartbeat(id, true, false, false, at("2026-10-15T10:00:15Z"))
            .unwrap()["active_seconds"],
        15
    );
    assert_eq!(
        s.store
            .heartbeat(id, true, false, false, at("2026-10-15T10:00:30Z"))
            .unwrap()["active_seconds"],
        30
    );
    assert_eq!(
        s.store
            .heartbeat(id, true, false, false, at("2026-10-15T10:00:45Z"))
            .unwrap()["active_seconds"],
        30
    );
    assert_eq!(
        s.store
            .heartbeat(id, true, true, false, at("2026-10-15T12:00:00Z"))
            .unwrap()["active_seconds"],
        30
    );
    s.store
        .heartbeat(id, false, false, false, at("2026-10-15T12:00:05Z"))
        .unwrap();
    assert_eq!(
        s.store
            .heartbeat(id, false, false, false, at("2026-10-15T12:00:20Z"))
            .unwrap()["active_seconds"],
        35
    );
}
#[test]
fn midnight_time_is_split_without_losing_seconds() {
    let (_d, s) = workspace();
    let q = s.store.question("align-up", None).unwrap();
    let start = at("2026-01-01T04:59:40Z");
    let v = s.store.start_visit(&q, None, "w", start).unwrap();
    let id = v["id"].as_str().unwrap();
    s.store.heartbeat(id, true, true, false, start).unwrap();
    s.store
        .heartbeat(id, true, true, false, at("2026-01-01T05:00:10Z"))
        .unwrap();
    let d = s
        .dashboard_at("America/Toronto", at("2026-01-01T06:00:00Z"))
        .unwrap();
    let days = d["days"].as_array().unwrap();
    assert_eq!(
        days.iter().find(|d| d["date"] == "2025-12-31").unwrap()["active_seconds"],
        20
    );
    assert_eq!(
        days.iter().find(|d| d["date"] == "2026-01-01").unwrap()["active_seconds"],
        10
    );
}
#[test]
fn daylight_saving_changes_do_not_add_or_subtract_an_hour() {
    for (start, end) in [
        ("2026-03-08T06:59:50Z", "2026-03-08T07:00:10Z"),
        ("2026-11-01T05:59:50Z", "2026-11-01T06:00:10Z"),
    ] {
        let (_d, s) = workspace();
        let q = s.store.question("align-up", None).unwrap();
        let v = s.store.start_visit(&q, None, "w", at(start)).unwrap();
        let id = v["id"].as_str().unwrap();
        s.store.heartbeat(id, true, true, false, at(start)).unwrap();
        s.store.heartbeat(id, true, true, false, at(end)).unwrap();
        let d = s.dashboard_at("America/Toronto", at(end)).unwrap();
        assert_eq!(d["metrics"]["practice_seconds"], 20);
    }
}
#[test]
fn continuation_resumes_a_session_before_opening_a_saved_draft() {
    let (_d, s) = workspace();
    let q = s.store.question("align-up", None).unwrap();
    s.store
        .save_draft(
            &q,
            &json!({"files":{"exercise.c":"/* candidate code */"},"answer":""}),
        )
        .unwrap();
    assert_eq!(s.continuation().unwrap()["kind"], "draft");
    let session = s
        .start_session(
            &json!({"question_id":"timer-rollover","duration_minutes":30}),
            "interview",
        )
        .unwrap();
    let next = s.continuation().unwrap();
    assert_eq!(next["kind"], "session");
    assert_eq!(next["session"]["id"], session["id"]);
    assert!(next["session"]["remaining_seconds"].as_f64().unwrap() > 1790.0);
}
#[test]
fn dashboard_cache_invalidates_after_new_evidence_and_survives_restart() {
    let (d, s) = workspace();
    let at = at("2026-10-15T18:00:00Z");
    assert_eq!(
        s.dashboard_at("UTC", at).unwrap()["metrics"]["questions_solved"],
        0
    );
    passing(&s, "align-up", "2026-10-15T10:00:00Z");
    assert_eq!(
        s.dashboard_at("UTC", at).unwrap()["metrics"]["questions_solved"],
        1
    );
    drop(s);
    let s = Service::open(
        d.path(),
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../questions"),
    )
    .unwrap();
    assert_eq!(
        s.dashboard_at("UTC", at).unwrap()["metrics"]["questions_solved"],
        1
    );
}
#[test]
fn local_day_details_match_the_selected_timezone() {
    let (_d, s) = workspace();
    passing(&s, "align-up", "2026-01-01T01:00:00Z");
    assert!(
        s.activity_day("2025-12-31", "America/Toronto").unwrap()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "problem_solved")
    );
    assert!(
        s.activity_day("2026-01-01", "America/Toronto").unwrap()["events"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn continuation_opens_the_draft_revision_even_after_question_update() {
    let (_temp, service) = workspace();
    let original = service.store.question("register-field", None).unwrap();
    service
        .store
        .save_draft(
            &original,
            &json!({"files":{"main.c":"saved revision one"},"answer":""}),
        )
        .unwrap();
    let mut newer = original.clone();
    newer["version"] = json!(2);
    newer["title"] = json!("Updated register field");
    service.store.insert_seed(&newer).unwrap();
    let draft = service
        .route("GET", "/drafts/register-field?version=1", Value::Null)
        .await
        .unwrap();
    assert_eq!(draft["files"]["main.c"], "saved revision one");
    let question = service
        .route("GET", "/questions/register-field?version=1", Value::Null)
        .await
        .unwrap();
    assert_eq!(question["version"], 1);
    service
        .route(
            "PUT",
            "/drafts/register-field",
            json!({"question_version":1,"files":{"main.c":"continued one"},"answer":""}),
        )
        .await
        .unwrap();
    assert_eq!(
        service.store.draft(&original).unwrap()["files"]["main.c"],
        "continued one"
    );
    assert_ne!(
        service.store.draft(&newer).unwrap()["files"]["main.c"],
        "continued one"
    );
}

#[test]
fn idle_cutoff_credits_the_actual_interval_before_midnight() {
    let (_d, s) = workspace();
    let q = s.store.question("align-up", None).unwrap();
    let v = s
        .store
        .start_visit(&q, None, "midnight-idle", at("2026-10-15T03:59:20Z"))
        .unwrap();
    let id = v["id"].as_str().unwrap();
    s.store
        .heartbeat(id, true, true, false, at("2026-10-15T03:59:20Z"))
        .unwrap();
    s.store
        .heartbeat(id, true, false, false, at("2026-10-15T03:59:40Z"))
        .unwrap();
    s.store
        .heartbeat(id, true, false, true, at("2026-10-15T04:00:10Z"))
        .unwrap();
    let d = s
        .dashboard_at("America/Toronto", at("2026-10-15T12:00:00Z"))
        .unwrap();
    let days = d["days"].as_array().unwrap();
    assert_eq!(
        days.iter().find(|d| d["date"] == "2026-10-14").unwrap()["active_seconds"],
        30
    );
    assert_eq!(
        days.iter().find(|d| d["date"] == "2026-10-15").unwrap()["active_seconds"],
        0
    );
}

#[test]
fn a_later_failed_attempt_requires_review_without_erasing_a_unique_solve() {
    let (_d, s) = workspace();
    let mut last = passing(&s, "align-up", "2026-10-14T12:00:00Z");
    last["id"] = json!(forgepad_core::id());
    last["created_at"] = json!("2026-10-15T12:00:00Z");
    last["result"]["status"] = json!("failed");
    last["completion_status"] = json!("needs_review");
    s.store.save("attempts", &last).unwrap();
    let roadmap = s.roadmap("firmware-coding-essentials").unwrap();
    assert_eq!(roadmap["solved"], 1);
    assert_eq!(
        roadmap["steps"]
            .as_array()
            .unwrap()
            .iter()
            .find(|step| step["question_id"] == "align-up")
            .unwrap()["status"],
        "needs_review"
    );
}

#[tokio::test]
async fn final_autosave_survives_session_completion_without_reopening_execution() {
    let (_d, s) = workspace();
    let mut session = s
        .start_session(
            &json!({"question_id":"align-up","duration_minutes":30}),
            "interview",
        )
        .unwrap();
    let q = s.store.question("align-up", None).unwrap();
    forgepad_core::sessions::complete(&mut session, &q, "finished");
    s.store.save("interviews", &session).unwrap();
    let body = json!({"session_id":session["id"],"files":{"solution.c":"// final editor change"},"answer":""});
    s.route("PUT", "/drafts/align-up", body.clone())
        .await
        .unwrap();
    assert_eq!(
        s.store.draft(&q).unwrap()["files"]["solution.c"],
        "// final editor change"
    );
    let mut run = body.clone();
    run["question_id"] = json!("align-up");
    assert!(s.enqueue_run(&run).is_err());
    assert!(s
        .route("PUT", "/drafts/register-field", body)
        .await
        .is_err());
    assert_eq!(
        s.store
            .get("interviews", session["id"].as_str().unwrap())
            .unwrap()["state"],
        "COMPLETE"
    );
}
