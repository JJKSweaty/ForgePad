"""Structured work is an additive, lossless extension to old drafts and attempts."""
import json
import sqlite3
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from forgepad.main import create_app
from forgepad.storage import Store, StorageConflict
from forgepad.written_workspace import validate

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads(Path(__file__).with_name("fixtures").joinpath("written-workspace.json").read_text())


def test_migration_reopen_export_and_legacy_write_protection(tmp_path):
    path = tmp_path / "workspace.sqlite"
    store = Store(path)
    store.seed(ROOT / "questions")
    q = store.question("sensor-pipeline")
    store.save_draft(q, {}, "  My original answer\n")
    with sqlite3.connect(path) as db:
        db.executescript("DROP TABLE written_workspaces; PRAGMA user_version=5;")
    store = Store(path)
    assert store.draft(q["id"])["answer"] == "  My original answer\n"
    saved = store.save_draft(q, {}, "", FIXTURE)
    assert "Sensor → Bounded queue: samples" in saved["answer"]
    assert store.save_draft(q, {}, saved["answer"])["written_workspace"] == FIXTURE
    with pytest.raises(StorageConflict): store.save_draft(q, {}, "different answer")
    reopened = Store(path)
    assert reopened.draft(q["id"])["written_workspace"] == FIXTURE
    assert reopened.export()["drafts"][0]["written_workspace"] == FIXTURE
    with sqlite3.connect(path) as db: assert db.execute("PRAGMA user_version").fetchone()[0] == 6


def test_api_snapshots_sections_and_diagrams_in_immutable_submissions(tmp_path):
    with TestClient(create_app(tmp_path / "workspace.sqlite", ROOT / "questions"), base_url="http://localhost") as client:
        body = {"files": {}, "answer": "", "written_workspace": FIXTURE}
        response = client.put("/api/drafts/sensor-pipeline", json=body)
        assert response.status_code == 200, response.text
        answer = response.json()["answer"]
        response = client.post("/api/attempts", json={"question_id":"sensor-pipeline", "answer":answer, "confidence":"confident", "written_workspace":FIXTURE})
        assert response.status_code == 201, response.text
        attempt = response.json()
        assert attempt["confidence"] == "partial"
        assert attempt["assessment_basis"] == "self_report"
        changed = deepcopy(FIXTURE); changed["diagram"]["nodes"][0]["label"] = "Changed"
        assert client.put("/api/drafts/sensor-pipeline", json={**body, "written_workspace":changed}).status_code == 200
        assert client.get(f'/api/attempts/{attempt["id"]}').json()["written_workspace"] == FIXTURE
        assert "written_workspace" not in client.get("/api/progress?compact=true").json()["attempts"][0]


@pytest.mark.parametrize("change", [
    lambda w: w.update(schema_version=2),
    lambda w: w["diagram"]["edges"][0].update(target="missing"),
    lambda w: w["diagram"]["nodes"][1].update(id="sensor"),
    lambda w: w["diagram"]["nodes"][0].update(x=100001),
    lambda w: w["sections"].update(unexpected="lost text"),
    lambda w: w["sections"].update(requirements="é" * 25001),
])
def test_invalid_workspace_never_replaces_a_saved_answer(tmp_path, change):
    store = Store(tmp_path / "workspace.sqlite"); store.seed(ROOT / "questions")
    q = store.question("sensor-pipeline"); store.save_draft(q, {}, "", FIXTURE)
    broken = deepcopy(FIXTURE); change(broken)
    with pytest.raises(ValueError): store.save_draft(q, {}, "", broken)
    assert store.draft(q["id"])["written_workspace"] == FIXTURE


def test_single_section_preserves_legacy_whitespace():
    workspace = {"schema_version":1,"mode":"theory","sections":{"explanation":"  Old\nanswer  "},"confidence":"partial","reflection":""}
    assert validate(workspace, {"type":"theory"}) == "  Old\nanswer  "
