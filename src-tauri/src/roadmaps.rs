use serde_json::{json, Value};
pub fn definitions(questions: &[Value]) -> Vec<Value> {
    let essential = [
        "register-field",
        "popcount32",
        "little-endian-read",
        "saturating-add",
        "timer-rollover",
        "sequence-window",
        "bounded-ring",
        "frame-checksum",
        "crc8-atm",
        "sample-lower-bound",
        "spi-sensor",
        "adc-average",
        "uart-frame-recovery",
        "align-up",
        "reverse-bits",
        "debounce-state",
    ];
    let all = [
        "volatile-atomicity",
        "register-field",
        "vector-table",
        "popcount32",
        "little-endian-read",
        "saturating-add",
        "align-up",
        "reverse-bits",
        "timer-rollover",
        "sequence-window",
        "debounce-state",
        "bounded-ring",
        "frame-checksum",
        "crc8-atm",
        "uart-frame-recovery",
        "spi-sensor",
        "i2c-stuck-low",
        "adc-average",
        "dma-cache",
        "priority-inversion",
        "sample-lower-bound",
        "boot-power-loss",
        "sensor-pipeline",
        "linux-serial",
    ];
    [("complete-firmware-interview","Complete Firmware Interview",all.as_slice()),("firmware-coding-essentials","16 Firmware Coding Essentials",essential.as_slice()),("crushing-firmware-interview","Crushing the Firmware Interview · companion",all.as_slice())].into_iter().map(|(id,title,ids)| {
        let steps: Vec<Value> = ids.iter().enumerate().map(|(i,id)| {
            let q = questions.iter().find(|q|q["id"]==*id);
            json!({"question_id":id,"order":i+1,"available":q.is_some(),"title":q.map(|q|q["title"].clone()),"topics":q.map(|q|q["topics"].clone())})
        }).collect();
        json!({"id":id,"title":title,"description":"A curated path through original ForgePad exercises. Companion coverage is not a reproduction of any book.","steps":steps,"total":steps.len()})
    }).collect()
}
pub fn progress(roadmap: &Value, attempts: &[Value]) -> Value {
    let mut result = roadmap.clone();
    let mut solved = 0;
    let mut mastered = 0;
    let mut active = vec![];
    if let Some(steps) = result["steps"].as_array_mut() {
        for step in steps {
            let records: Vec<&Value> = attempts
                .iter()
                .filter(|a| a["question_id"] == step["question_id"])
                .collect();
            let successes = records
                .iter()
                .filter(|a| a["result"]["status"] == "passed")
                .count();
            let self_review = records
                .first()
                .is_some_and(|a| a["confidence"] == "confident");
            let passed = records
                .first()
                .is_some_and(|a| a["result"]["status"] == "passed");
            let mastery = passed
                && successes >= 2
                && records
                    .iter()
                    .filter(|a| a["result"]["status"] == "passed")
                    .map(|a| a["created_at"].as_str().unwrap_or("").get(..10))
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    >= 2;
            step["status"] = json!(if mastery {
                "mastered"
            } else if passed {
                "solved"
            } else if self_review {
                "self_reviewed"
            } else if !records.is_empty() {
                "needs_review"
            } else {
                "not_started"
            });
            if passed {
                solved += 1;
            }
            if mastery {
                mastered += 1;
            }
            if !records.is_empty() && !passed {
                if let Some(t) = step["topics"].as_array() {
                    active.extend(t.clone());
                }
            }
        }
    }
    active.sort_by_key(Value::to_string);
    active.dedup();
    let total = result["total"].as_u64().unwrap_or(0);
    result["solved"] = json!(solved);
    result["mastered"] = json!(mastered);
    result["active_topics"] = json!(active);
    result["completion_percent"] = json!(if total > 0 {
        solved as f64 / total as f64 * 100.0
    } else {
        0.0
    });
    result["mastery_rule"] = json!("Two deterministic passing submissions on separate calendar days, with latest attempt passing. Theory self-review is tracked separately.");
    result
}
