"""Versioned, candidate-authored sections and architecture graphs; no evaluation."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator

SECTIONS = {
    "theory": [("explanation", "Explanation"), ("example", "Example"), ("edge_cases", "Edge cases")],
    "design": [("requirements", "Requirements"), ("architecture", "Architecture"), ("tradeoffs", "Tradeoffs"), ("validation", "Validation")],
    "investigation": [("observations", "Observations"), ("hypotheses", "Hypotheses"), ("experiments", "Experiments"), ("resolution", "Resolution")],
}
VALIDATOR = Draft202012Validator(json.loads(Path(__file__).with_name("written-workspace.schema.json").read_text()))


def question_mode(question):
    if question.get("test_config") or question.get("type") == "coding":
        return "coding"
    return "design" if question["type"] == "design" else "investigation" if question["type"] in {"debugging", "code_review"} else "theory"


def project(workspace):
    parts = [(title, workspace["sections"].get(key, "")) for key, title in SECTIONS[workspace["mode"]]]
    parts = [(title, text) for title, text in parts if text.strip()]
    diagram = workspace.get("diagram", {"nodes": [], "edges": []})
    if diagram["nodes"]:
        names = {n["id"]: n["label"] for n in diagram["nodes"]}
        graph = "Components:\n" + "\n".join(f'- {n["label"]} ({n["id"]})' for n in diagram["nodes"])
        if diagram["edges"]:
            graph += "\nConnections:\n" + "\n".join(f'- {names[e["source"]]} → {names[e["target"]]}' + (f': {e["label"]}' if e["label"] else "") for e in diagram["edges"])
        parts.append(("Diagram", graph))
    first_title = SECTIONS[workspace["mode"]][0][1]
    if len(parts) == 1 and parts[0][0] == first_title:
        return parts[0][1]
    return "\n\n".join(f"{title}\n{text}" for title, text in parts)


def validate(workspace, question):
    if len(json.dumps(workspace, ensure_ascii=False).encode()) > 256 * 1024:
        raise ValueError("Written workspace exceeds 256 KiB")
    if not VALIDATOR.is_valid(workspace):
        raise ValueError("Invalid written workspace or unsupported schema version")
    mode = question_mode(question)
    if workspace["mode"] != mode or not set(workspace["sections"]).issubset(dict(SECTIONS.get(mode, []))):
        raise ValueError("Written sections do not match this question")
    diagram = workspace.get("diagram")
    if diagram:
        if mode != "design":
            raise ValueError("Diagrams belong to design questions")
        nodes = [n["id"] for n in diagram["nodes"]]
        edges = [e["id"] for e in diagram["edges"]]
        if len(set(nodes)) != len(nodes) or len(set(edges)) != len(edges):
            raise ValueError("Diagram identifiers must be unique")
        if any(e["source"] not in nodes or e["target"] not in nodes for e in diagram["edges"]):
            raise ValueError("Diagram connections must reference existing components")
    answer = project(workspace)
    if len(answer.encode()) > 50000:
        raise ValueError("Combined answer exceeds 50,000 bytes. Your work has not been truncated.")
    return answer
