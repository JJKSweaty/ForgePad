//! Versioned user-authored notes and graphs, separate from executable source files.
use anyhow::{bail, Result};
use serde_json::Value;
use std::{collections::HashSet, sync::LazyLock};
static VALIDATOR: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    jsonschema::validator_for(
        &serde_json::from_str::<Value>(include_str!(
            "../../backend/forgepad/written-workspace.schema.json"
        ))
        .unwrap(),
    )
    .unwrap()
});
pub fn sections(mode: &str) -> &'static [(&'static str, &'static str)] {
    match mode {
        "design" => &[
            ("requirements", "Requirements"),
            ("architecture", "Architecture"),
            ("tradeoffs", "Tradeoffs"),
            ("validation", "Validation"),
        ],
        "investigation" => &[
            ("observations", "Observations"),
            ("hypotheses", "Hypotheses"),
            ("experiments", "Experiments"),
            ("resolution", "Resolution"),
        ],
        "theory" => &[
            ("explanation", "Explanation"),
            ("example", "Example"),
            ("edge_cases", "Edge cases"),
        ],
        _ => &[],
    }
}
pub fn validate(workspace: &Value, question: &Value) -> Result<String> {
    if workspace.to_string().len() > 256 * 1024 {
        bail!("Written workspace exceeds 256 KiB");
    }
    if !VALIDATOR.is_valid(workspace) {
        bail!("Invalid written workspace or unsupported schema version");
    }
    let mode = if question["test_config"].is_object() || question["type"] == "coding" {
        "coding"
    } else if question["type"] == "design" {
        "design"
    } else if [Some("debugging"), Some("code_review")].contains(&question["type"].as_str()) {
        "investigation"
    } else {
        "theory"
    };
    let ordered = sections(mode);
    if workspace["mode"] != mode
        || workspace["sections"]
            .as_object()
            .unwrap()
            .keys()
            .any(|key| !ordered.iter().any(|(id, _)| key == id))
    {
        bail!("Written sections do not match this question");
    }
    let mut parts = ordered
        .iter()
        .filter_map(|(id, title)| {
            workspace["sections"][id]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(|s| (title.to_string(), s.to_string()))
        })
        .collect::<Vec<_>>();
    if let Some(diagram) = workspace.get("diagram") {
        if mode != "design" {
            bail!("Diagrams belong to design questions");
        }
        let nodes = diagram["nodes"].as_array().unwrap();
        let edges = diagram["edges"].as_array().unwrap();
        let ids = nodes
            .iter()
            .map(|n| n["id"].as_str().unwrap())
            .collect::<HashSet<_>>();
        let edge_ids = edges
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect::<HashSet<_>>();
        if ids.len() != nodes.len() || edge_ids.len() != edges.len() {
            bail!("Diagram identifiers must be unique");
        }
        if edges.iter().any(|e| {
            !ids.contains(e["source"].as_str().unwrap())
                || !ids.contains(e["target"].as_str().unwrap())
        }) {
            bail!("Diagram connections must reference existing components");
        }
        if !nodes.is_empty() {
            let mut graph = format!(
                "Components:\n{}",
                nodes
                    .iter()
                    .map(|n| format!(
                        "- {} ({})",
                        n["label"].as_str().unwrap(),
                        n["id"].as_str().unwrap()
                    ))
                    .collect::<Vec<_>>()
                    .join("\n")
            );
            if !edges.is_empty() {
                let name = |id: &Value| {
                    nodes.iter().find(|n| n["id"] == *id).unwrap()["label"]
                        .as_str()
                        .unwrap()
                };
                graph.push_str("\nConnections:\n");
                graph.push_str(
                    &edges
                        .iter()
                        .map(|e| {
                            let label = e["label"].as_str().unwrap();
                            format!(
                                "- {} → {}{}",
                                name(&e["source"]),
                                name(&e["target"]),
                                if label.is_empty() {
                                    String::new()
                                } else {
                                    format!(": {label}")
                                }
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            }
            parts.push(("Diagram".into(), graph));
        }
    }
    let answer = if parts.len() == 1 && parts[0].0 == ordered[0].1 {
        parts[0].1.clone()
    } else {
        parts
            .into_iter()
            .map(|(title, text)| format!("{title}\n{text}"))
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    if answer.len() > 50000 {
        bail!("Combined answer exceeds 50,000 bytes. Your work has not been truncated.");
    }
    Ok(answer)
}
