"""API/storage integration tests use an explicit fake worker, never a fake compiler claim."""

import json
import time
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from threading import Event

import pytest
from fastapi.testclient import TestClient
from forgepad.main import create_app
from forgepad.schema import Question
from forgepad.storage import Store


@pytest.fixture
def package():
    return {
        "schema_version": "1.0",
        "id": "test-counter",
        "version": 1,
        "title": "Counter",
        "description": "A test-only question",
        "type": "coding",
        "difficulty": "beginner",
        "topics": ["integer arithmetic"],
        "duration_minutes": 15,
        "language": "c",
        "prompt": "Print 1.",
        "constraints": ["No allocation"],
        "starter_files": {"main.c": "int main(void) {return 0;}"},
        "reference_solution": {"main.c": "REFERENCE_SECRET"},
        "test_config": {
            "mode": "stdio",
            "compiler": "gcc",
            "sanitizers": False,
            "timeout_seconds": 1,
            "tests": [
                {
                    "id": "normal",
                    "name": "normal",
                    "visibility": "public",
                    "stdin": "",
                    "expected_stdout": "1",
                    "category": "normal",
                },
                {
                    "id": "hidden",
                    "name": "private",
                    "visibility": "hidden",
                    "stdin": "INPUT_SECRET",
                    "expected_stdout": "OUTPUT_SECRET",
                    "category": "boundary",
                },
            ],
        },
        "rubric": ["Explain integer bounds"],
        "follow_ups": ["What if it wraps?", "What about concurrency?"],
        "hints": ["Check the return value"],
        "source": {"name": "Test", "url": "", "license": "MIT"},
    }


class FakeRunner:
    """Only tests API handling of trusted worker responses; does not compile source."""

    def __init__(self, status="passed"):
        self.status = status
        self.calls = []

    def availability(self):
        return {"available": True, "detail": "Test double"}

    def run(self, question, files, include_hidden=False, cancel_event=None):
        self.calls.append((question, files, include_hidden))
        selected = [
            item
            for item in question["test_config"]["tests"]
            if include_hidden or item["visibility"] == "public"
        ]
        return {
            "status": self.status,
            "tests": [
                {
                    "id": item["id"],
                    "name": "test",
                    "visibility": item["visibility"],
                    "status": self.status,
                    "stdout": "OUTPUT_SECRET" if item["visibility"] == "hidden" else "1",
                    "expected_stdout": item["expected_stdout"],
                    "stderr": "",
                    "elapsed_ms": 1,
                }
                for item in selected
            ],
            "passed": len(selected) if self.status == "passed" else 0,
            "total": len(selected),
            "compiler_output": "",
            "elapsed_ms": 1,
        }


def client_for(tmp_path, package, runner=None):
    directory = tmp_path / "questions"
    directory.mkdir(exist_ok=True)
    (directory / "question.json").write_text(json.dumps(package))
    app = create_app(tmp_path / "db.sqlite3", directory, runner=runner or FakeRunner())
    return TestClient(app, base_url="http://localhost")


def wait_run(client, run_id):
    for _ in range(200):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] not in {"queued", "running"}:
            return run
        time.sleep(0.01)
    pytest.fail("Worker did not complete")


def test_practice_privacy_and_authoring_export(tmp_path, package):
    with client_for(tmp_path, package) as client:
        result = client.get("/api/questions/test-counter")
        assert result.status_code == 200
        for secret in ("REFERENCE_SECRET", "INPUT_SECRET", "OUTPUT_SECRET"):
            assert secret not in result.text
        exported = client.get("/api/questions/test-counter/export").json()
        assert exported == Question.model_validate(package).model_dump()
        assert len(client.get("/api/questions/export/all").json()) == 1
        assert client.get("/api/questions?topic=unrelated").json() == []


def test_schema_errors_and_reference_validation_gate(tmp_path, package):
    runner = FakeRunner("wrong_answer")
    with client_for(tmp_path, package, runner) as client:
        invalid = deepcopy(package)
        invalid["id"] = "bad"
        invalid["starter_files"] = {"../escape.c": "bad"}
        response = client.post("/api/imports/validate", json={"question": invalid}).json()
        assert not response["valid"] and "Unsafe source filename" in " ".join(response["errors"])
        package["id"] = "new"
        response = client.post("/api/imports/validate", json={"question": package}).json()
        assert not response["valid"] and "token" not in response
        assert runner.calls[-1][2] is True
        assert client.post("/api/imports/publish", json={"token": "invented"}).status_code == 409


def test_publish_roundtrip_version_history_and_token_once(tmp_path, package):
    with client_for(tmp_path, package) as client:
        run = client.post(
            "/api/runs",
            json={"question_id": package["id"], "files": {"main.c": "snapshot"}, "mode": "submit"},
        ).json()
        assert wait_run(client, run["id"])["attempt_id"]
        package["version"] = 2
        package["title"] = "Revised counter"
        validated = client.post("/api/imports/validate", json={"question": package}).json()
        assert validated["valid"]
        assert client.post("/api/imports/publish", json={"token": validated["token"]}).status_code == 201
        assert client.post("/api/imports/publish", json={"token": validated["token"]}).status_code == 409
        history = client.get("/api/progress").json()["attempts"]
        assert history[0]["question_version"] == 1 and history[0]["files"]["main.c"] == "snapshot"
        assert client.get("/api/questions/test-counter/export").json()["version"] == 2
        assert len(client.get("/api/data/export").json()["questions"]) == 2


def test_drafts_survive_restart_and_wal(tmp_path, package):
    with client_for(tmp_path, package) as client:
        assert (
            client.put(
                "/api/drafts/test-counter", json={"files": {"main.c": "saved source"}, "answer": "notes"}
            ).status_code
            == 200
        )
    with client_for(tmp_path, package) as client:
        assert client.get("/api/drafts/test-counter").json()["files"]["main.c"] == "saved source"
        with client.app.state.store.connect() as db:
            assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_run_submit_scope_privacy_and_theory_cannot_bypass(tmp_path, package):
    runner = FakeRunner()
    with client_for(tmp_path, package, runner) as client:
        for mode in ("run", "submit"):
            run = client.post(
                "/api/runs", json={"question_id": "test-counter", "files": {"main.c": "code"}, "mode": mode}
            ).json()
            result = wait_run(client, run["id"])
            assert runner.calls[-1][2] is (mode == "submit")
            assert "OUTPUT_SECRET" not in json.dumps(result)
        assert len(client.get("/api/progress").json()["attempts"]) == 1
        assert (
            client.post(
                "/api/attempts",
                json={"question_id": "test-counter", "answer": "pretend pass", "confidence": "confident"},
            ).status_code
            == 422
        )


def test_interview_persistence_pause_followups_finish(tmp_path, package):
    with client_for(tmp_path, package) as client:
        record = client.post(
            "/api/interviews", json={"question_id": "test-counter", "duration_minutes": 15}
        ).json()
        path = f"/api/interviews/{record['id']}"
        assert record["state"] == "INTRODUCTION"
        paused = client.post(path + "/events", json={"type": "pause"}).json()
        assert paused["paused"]
        assert client.post(path + "/events", json={"type": "advance"}).status_code == 409
    with client_for(tmp_path, package) as client:
        resumed = client.post(path + "/events", json={"type": "resume"}).json()
        assert resumed["remaining_seconds"] <= paused["remaining_seconds"]
        for expected in (
            "QUESTION",
            "CLARIFICATION",
            "SOLVING",
            "FOLLOW_UP",
            "FOLLOW_UP",
            "REVIEW",
            "COMPLETE",
        ):
            record = client.post(path + "/events", json={"type": "advance"}).json()
            assert record["state"] == expected
            if expected == "SOLVING":
                assert (
                    client.post(
                        path + "/events", json={"type": "message", "content": "I would bound the counter."}
                    ).status_code
                    == 200
                )
        assert record["follow_ups_attempted"] == [0, 1]
        assert "1 responses recorded" in record["report"]["interview_communication"]
        assert "REFERENCE_SECRET" not in json.dumps(record)
        assert client.post(path + "/events", json={"type": "message", "content": "late"}).status_code == 409


def test_interview_clock_expiration_after_restart(tmp_path, package):
    with client_for(tmp_path, package) as client:
        record = client.post(
            "/api/interviews", json={"question_id": "test-counter", "duration_minutes": 1}
        ).json()
        record["clock_at"] = (datetime.now(UTC) - timedelta(minutes=2)).isoformat()
        client.app.state.store.save_record("interviews", record)
    with client_for(tmp_path, package) as client:
        finished = client.get(f"/api/interviews/{record['id']}").json()
        assert finished["state"] == "COMPLETE" and finished["remaining_seconds"] == 0
        assert finished["completion_reason"] == "time_expired"


def test_loopback_origin_host_and_request_bounds(tmp_path, package):
    with client_for(tmp_path, package) as client:
        assert client.get("/api/questions", headers={"Host": "attacker.test"}).status_code == 400
        assert client.get("/api/data/export", headers={"Origin": "https://attacker.test"}).status_code == 403
        assert (
            client.post("/api/goals", headers={"Origin": "null"}, json={"title": "injected"}).status_code
            == 403
        )
        assert client.get("/api/data/export", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
        assert client.get("/api/questions", headers={"Origin": "http://localhost:5173"}).status_code == 200
        assert client.post("/api/commands", content=b"x" * (10 * 1024 * 1024 + 1)).status_code == 413


def test_theory_review_goals_export_reset_backup(tmp_path, package):
    package.update(
        type="theory", language="independent", test_config=None, starter_files={}, reference_solution={}
    )
    with client_for(tmp_path, package) as client:
        record = client.post(
            "/api/attempts",
            json={
                "question_id": "test-counter",
                "answer": "Atomicity depends on width.",
                "confidence": "uncertain",
            },
        ).json()
        assert record["review_interval_days"] == 1
        assert client.get("/api/progress").json()["weak_topics"][0]["topic"] == "integer arithmetic"
        goal = client.post("/api/goals", json={"title": "Review atomics"}).json()
        assert (
            client.patch(f"/api/goals/{goal['id']}", json={"status": "active"}).json()["status"] == "active"
        )
        assert client.get("/api/context").json()["recent_attempts"][0]["id"] == record["id"]
        backup = tmp_path / "backup.sqlite3"
        client.app.state.store.backup(backup)
        assert Store(backup).records("attempts")[0]["id"] == record["id"]
        assert client.delete("/api/data").json()["questions_preserved"]
        assert client.get("/api/progress").json()["attempts"] == []
        assert len(client.get("/api/questions").json()) == 1


def test_cancel_run_does_not_create_attempt(tmp_path, package):
    started = Event()

    class WaitingRunner(FakeRunner):
        def run(self, question, files, include_hidden=False, cancel_event=None):
            started.set()
            assert cancel_event.wait(5)
            return {"status": "cancelled", "tests": [], "passed": 0, "total": 0}

    with client_for(tmp_path, package, WaitingRunner()) as client:
        run = client.post(
            "/api/runs", json={"question_id": "test-counter", "files": {"main.c": "code"}, "mode": "submit"}
        ).json()
        assert started.wait(2)
        assert client.delete(f"/api/runs/{run['id']}").json()["status"] == "cancelled"
        assert client.get("/api/progress").json()["attempts"] == []


def test_commands_and_disabled_speech(tmp_path, package):
    with client_for(tmp_path, package) as client:
        assert client.post(
            "/api/commands", json={"text": "Hey Clicky, start a 30-minute mock interview."}
        ).json() == {"intent": "start_interview", "parameters": {"duration_minutes": 30}}
        assert (
            client.post("/api/commands", json={"text": "I would run my tests after coding"}).json()["intent"]
            == "unknown"
        )
        assert (
            client.post(
                "/api/speech/transcribe", files={"file": ("answer.webm", b"audio", "audio/webm")}
            ).status_code
            == 503
        )
