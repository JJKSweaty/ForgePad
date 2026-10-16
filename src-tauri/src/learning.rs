//! Shared projections of immutable assessments and unfinished drafts; no stored counters.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub fn states(attempts: &[Value], drafts: &[Value]) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    let mut completed = HashSet::new();
    for a in attempts {
        let id = a["question_id"].as_str().unwrap_or("");
        if a["completion_status"] == "complete" {
            completed.insert(id);
        }
        let due = a["review_due_at"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_some_and(|d| d <= chrono::Utc::now());
        let v = out.entry(id.to_string()).or_insert_with(||json!({
            "progress_status":if due || a["completion_status"] != "complete" {"needs_review"}else{"completed"},
            "attempt_count":0,"latest_attempt_id":a["id"],"latest_result":a["result"]["status"],
            "last_activity_at":a["created_at"],"review_due_at":a["review_due_at"]
        }));
        v["attempt_count"] = json!(v["attempt_count"].as_u64().unwrap_or(0) + 1);
    }
    for id in completed {
        out.get_mut(id).unwrap()["has_completed"] = json!(true);
    }
    // Most recent version wins; an identical submitted draft is excluded by Store.
    for d in drafts.iter().rev() {
        let id = d["question_id"].as_str().unwrap_or("");
        let v = out
            .entry(id.to_string())
            .or_insert_with(|| json!({"attempt_count":0}));
        if d["updated_at"].as_str().unwrap_or("") >= v["last_activity_at"].as_str().unwrap_or("") {
            v["progress_status"] = json!("in_progress");
            v["draft_version"] = d["question_version"].clone();
            v["last_activity_at"] = d["updated_at"].clone();
        }
    }
    out
}
