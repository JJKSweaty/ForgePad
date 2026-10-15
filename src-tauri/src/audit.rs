use serde_json::{json, Value};
use std::collections::HashSet;

pub fn inspect(q: &Value) -> Value {
    let mut findings = vec![];
    let mut add = |code: &str, severity: &str, evidence: String, suggestion: &str| {
        findings.push(json!({"id":crate::id(),"code":code,"severity":severity,"classification":"confirmed_structure","evidence":evidence,"suggestion":suggestion,"requires_approval":true}));
    };
    let errors = crate::schema::validate(q);
    for e in errors {
        add(
            "schema",
            "error",
            e,
            "Revise the unpublished package and validate again.",
        );
    }
    if let Some(tests) = q["test_config"]["tests"].as_array() {
        let mut cases = HashSet::new();
        for t in tests {
            let key = (t["stdin"].to_string(), t["fixture"].to_string());
            if !cases.insert(key) {
                add("duplicate_input","warning",format!("Test {} duplicates an existing stimulus.",t["id"]),"Replace redundant tests with an independently justified partition or boundary.");
            }
        }
        if !tests.iter().any(|t| t["category"] == "negative") {
            add("negative_partition","review","No authored tests are labelled negative.".into(),"Determine whether invalid inputs are in the contract; add tests only for specified behavior.");
        }
        if q["test_config"]["sanitizers"] != true {
            add(
                "sanitizers",
                "warning",
                "The authored execution configuration disables sanitizers.".into(),
                "Review address/undefined-behavior sanitizer findings from validation.",
            );
        }
    }
    let prompt = format!("{} {}", q["prompt"], q["constraints"]).to_lowercase();
    let topics = q["topics"].to_string().to_lowercase();
    let mut reviews = vec![];
    if topics.contains("wrap") || prompt.contains("wraparound") {
        reviews.push("Confirm modular arithmetic, integer width and the half-range/time-distance assumption. Exercise values on both sides of rollover.");
    }
    if topics.contains("uart") || topics.contains("parser") {
        reviews.push("Confirm recovery after noise, partial frames, malformed lengths, checksum failure and timeout. Justify every expected recovery state from the contract.");
    }
    if topics.contains("ring") {
        reviews.push("Confirm empty/full representation, index wrap, capacity and producer/consumer ownership. State concurrency and memory-ordering assumptions.");
    }
    for suggestion in reviews {
        findings.push(json!({"id":crate::id(),"code":"domain_review","severity":"review","classification":"plausible_gap","evidence":"Topic-specific review checklist; no missing behavior has been proved.","suggestion":suggestion,"requires_approval":true}));
    }
    json!({"findings":findings,"coverage":{"status":"not_measured"},"fuzzing":{"status":"not_run"},"mutation":{"status":"not_run"},"proposed_tests":[],"publication":"approval_required","notes":"Structural checks are evidence; topic checklists are recommendations. No active tests were changed."})
}

pub fn mutations(q: &Value) -> Vec<Value> {
    let mut results = vec![];
    if let Some(files) = q["reference_solution"].as_object() {
        for (name, text) in files {
            let Some(text) = text.as_str() else {
                continue;
            };
            // Deliberately small mutation budget; compile errors are inconclusive, not killed mutants.
            for (from, to, label) in [
                ("<=", "<", "inclusive boundary"),
                ("==", "!=", "equality decision"),
                ("+ 1", "+ 0", "increment"),
            ] {
                if text.contains(from) {
                    let mut mutant = q["reference_solution"].clone();
                    mutant[name] = json!(text.replacen(from, to, 1));
                    results.push(json!({"label":label,"file":name,"files":mutant}));
                    if results.len() == 3 {
                        return results;
                    }
                }
            }
        }
    }
    results
}
