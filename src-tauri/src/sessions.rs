use anyhow::{bail, Result};
use chrono::Utc;
use serde_json::{json, Value};
const STATES: [&str; 7] = [
    "INTRODUCTION",
    "QUESTION",
    "CLARIFICATION",
    "SOLVING",
    "FOLLOW_UP",
    "REVIEW",
    "COMPLETE",
];
pub fn message(s: &mut Value, role: &str, content: &str) {
    s["transcript"]
        .as_array_mut()
        .unwrap()
        .push(json!({"role":role,"content":content,"created_at":crate::now()}));
}
pub fn prompt(s: &Value, q: &Value) -> String {
    match s["state"].as_str().unwrap_or("") {
        "INTRODUCTION" => format!("You have {} minutes. Clarify requirements, explain your assumptions and test your work.",s["duration_minutes"]),
        "QUESTION" => q["prompt"].as_str().unwrap_or("").into(),
        "CLARIFICATION" => "Which constraints and requirements would you clarify before starting?".into(),
        "SOLVING" => "Explain your approach, implement it and discuss how you will test it.".into(),
        "FOLLOW_UP" => q["follow_ups"][s["follow_up_index"].as_u64().unwrap_or(0) as usize].as_str().unwrap_or("What failure mode would you investigate first?").into(),
        "REVIEW" => "Review the evidence. Which boundaries or trade-offs need more work?".into(),
        _ => "Session complete. Your evidence and replay are saved.".into()
    }
}
pub fn create(
    q: &Value,
    duration: u64,
    kind: &str,
    personality: &str,
    mode: &str,
    strict: bool,
) -> Value {
    let mut s = json!({"id":crate::id(),"question_id":q["id"],"question_version":q["version"],"state":"INTRODUCTION","duration_minutes":duration,"kind":kind,"personality":personality,"mode":mode,"strict":strict,"started_at":crate::now(),"clock_at":crate::now(),"remaining_seconds":duration*60,"paused":false,"transcript":[],"follow_up_index":0,"events":[]});
    message(&mut s,"interviewer",&format!("You have {duration} minutes. Clarify requirements, explain assumptions and test your work."));
    s
}
pub fn update_clock(s: &mut Value, q: &Value) -> Result<()> {
    if s["state"] == "COMPLETE" {
        return Ok(());
    }
    if s["paused"] != true {
        let at = chrono::DateTime::parse_from_rfc3339(s["clock_at"].as_str().unwrap_or(""))?;
        let elapsed = Utc::now()
            .signed_duration_since(at)
            .num_milliseconds()
            .max(0) as f64
            / 1000.0;
        s["remaining_seconds"] =
            json!((s["remaining_seconds"].as_f64().unwrap_or(0.0) - elapsed).max(0.0));
    }
    s["clock_at"] = json!(crate::now());
    if s["remaining_seconds"].as_f64().unwrap_or(0.0) <= 0.0 {
        complete(s, q, "time_expired");
    }
    Ok(())
}
pub fn complete(s: &mut Value, q: &Value, reason: &str) {
    s["state"] = json!("COMPLETE");
    s["paused"] = json!(false);
    s["completed_at"] = json!(crate::now());
    s["completion_reason"] = json!(reason);
    let count = s["transcript"]
        .as_array()
        .map_or(0, |a| a.iter().filter(|v| v["role"] == "candidate").count());
    let dimensions = [
        "Requirements clarification",
        "Functional correctness",
        "Edge-case reasoning",
        "C/C++ safety",
        "Firmware judgment",
        "Time and memory awareness",
        "Testing strategy",
        "Debugging approach",
        "Communication",
        "Follow-up reasoning",
    ];
    s["report"] = json!({"evaluation":"evidence_summary","score":null,"candidate_responses":count,"rubric":q["rubric"],"dimensions":dimensions.map(|name|json!({"dimension":name,"rating":null,"status":"ungraded","reason":"Recorded evidence is available for review; no supported rating has been assigned."})),"what_to_review":q["topics"],"deterministic_outcomes":"See linked run and submission events; transcript wording does not establish correctness."});
    message(
        s,
        "interviewer",
        "Session complete. Review your saved code, test results and explanations.",
    );
}
pub fn apply(s: &mut Value, q: &Value, body: &Value) -> Result<()> {
    update_clock(s, q)?;
    if s["state"] == "COMPLETE" {
        bail!("Session is complete");
    }
    match body["type"].as_str().unwrap_or("") {
        "pause" => s["paused"] = json!(true),
        "resume" => s["paused"] = json!(false),
        "finish" => complete(s, q, "finished"),
        _ if s["paused"] == true => bail!("Resume the interview first"),
        "message" => {
            let content = body["content"].as_str().unwrap_or("").trim();
            if content.is_empty() || content.len() > 30000 {
                bail!("Response requires 1–30,000 bytes");
            }
            message(s, "candidate", content);
        }
        "advance" => {
            let state = s["state"].as_str().unwrap_or("");
            if state == "FOLLOW_UP"
                && s["follow_up_index"].as_u64().unwrap_or(0) + 1
                    < q["follow_ups"].as_array().map_or(0, Vec::len) as u64
            {
                s["follow_up_index"] = json!(s["follow_up_index"].as_u64().unwrap_or(0) + 1);
            } else {
                let i = STATES.iter().position(|v| *v == state).unwrap_or(0);
                s["state"] = json!(STATES[(i + 1).min(6)]);
            }
            if s["state"] == "COMPLETE" {
                complete(s, q, "finished");
            } else {
                message(s, "interviewer", &prompt(s, q));
            }
        }
        _ => bail!("Invalid session event"),
    }
    Ok(())
}
