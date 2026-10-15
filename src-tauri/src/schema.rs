use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::sync::LazyLock;

pub static SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../backend/forgepad/question.schema.json")).unwrap()
});
static VALIDATOR: LazyLock<jsonschema::Validator> =
    LazyLock::new(|| jsonschema::validator_for(&SCHEMA).expect("bundled schema"));

pub fn files(value: &Value, require_source: bool) -> Result<()> {
    let files = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("files must be an object"))?;
    if files.len() > 20 {
        bail!("At most 20 source files are supported");
    }
    let mut bytes = 0;
    for (name, content) in files {
        let s = content
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("{name}: expected source text"))?;
        let valid_ext = [".c", ".cc", ".cpp", ".h", ".hpp"]
            .iter()
            .any(|ext| name.ends_with(ext));
        if !valid_ext
            || name.len() > 84
            || name.contains("..")
            || !name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            || s.contains('\0')
        {
            bail!("{name}: use a safe flat C/C++ filename and text without NUL bytes");
        }
        bytes += s.len();
    }
    if bytes > 256 * 1024 {
        bail!("Combined source exceeds 256 KiB");
    }
    if require_source
        && !files
            .keys()
            .any(|n| [".c", ".cc", ".cpp"].iter().any(|ext| n.ends_with(ext)))
    {
        bail!("At least one C/C++ translation unit is required");
    }
    Ok(())
}

pub fn validate(q: &Value) -> Vec<String> {
    let mut errors: Vec<String> = VALIDATOR
        .iter_errors(q)
        .map(|e| format!("{}: {}", e.instance_path, e))
        .take(50)
        .collect();
    if !errors.is_empty() {
        return errors;
    }
    for key in ["starter_files", "reference_solution"] {
        if let Some(f) = q.get(key) {
            if let Err(e) = files(f, q["test_config"].is_object()) {
                errors.push(format!("{key}: {e}"));
            }
        }
    }
    if let Some(tests) = q["test_config"]["tests"].as_array() {
        let mut ids = std::collections::HashSet::new();
        let mut categories = std::collections::HashSet::new();
        for t in tests {
            if !ids.insert(t["id"].as_str()) {
                errors.push("test_config.tests: test IDs must be unique".into());
            }
            categories.insert(t["category"].as_str().unwrap_or_default());
            if q["test_config"]["mode"] == "fixture"
                && t["fixture"].as_str().unwrap_or("").is_empty()
            {
                errors.push("Each fixture test requires a main fixture".into());
            }
            if q["test_config"]["mode"] == "stdio" && !t["fixture"].is_null() && t["fixture"] != ""
            {
                errors.push("stdio tests cannot also define fixtures".into());
            }
        }
        if !categories.contains("normal") || !categories.contains("boundary") {
            errors.push("Tests require normal and boundary categories".into());
        }
    }
    errors
}

pub fn candidate(q: &Value) -> Value {
    let mut q = q.clone();
    if let Some(obj) = q.as_object_mut() {
        for k in [
            "reference_solution",
            "solution_notes",
            "time_complexity",
            "space_complexity",
        ] {
            obj.remove(k);
        }
    }
    if let Some(tests) = q["test_config"]["tests"].as_array_mut() {
        tests.retain(|t| t["visibility"] == "public");
    }
    q
}

pub fn deep_link(value: &str) -> Result<Value> {
    let u = url::Url::parse(value)?;
    if u.scheme() != "forgepad"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        bail!("Invalid ForgePad deep link");
    }
    let action = u.host_str().unwrap_or("app");
    if ![
        "app",
        "roadmap",
        "question",
        "practice",
        "interview",
        "report",
    ]
    .contains(&action)
    {
        bail!("Unsupported ForgePad action");
    }
    let target = u.path().trim_start_matches('/');
    if (action == "app" && !target.is_empty())
        || (action != "app" && target.is_empty())
        || target.len() > 80
        || !target
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        bail!("Invalid deep-link target");
    }
    Ok(json!({"action":action,"id":target}))
}
