"""Browser dashboard projections use explicit temporary records, never production fixtures."""

from datetime import UTC, datetime
from pathlib import Path

from forgepad.dashboard import snapshot
from forgepad.storage import Store


def test_browser_dashboard_continues_a_real_draft_and_counts_only_unique_passes(tmp_path):
    store = Store(tmp_path / "workspace.sqlite")
    store.seed(Path(__file__).resolve().parents[2] / "questions")
    empty = snapshot(store, "America/Toronto")
    assert len(empty["days"]) == 364
    assert empty["metrics"]["questions_solved"] == 0
    assert empty["tracking"]["available"] is False
    q = store.question("align-up")
    store.save_draft(q, {"main.c": "// unfinished user work"}, "")
    data = snapshot(store, "America/Toronto")
    assert data["continuation"]["kind"] == "draft"
    assert data["continuation"]["question"]["id"] == "align-up"
    stamp = datetime.now(UTC).isoformat()
    for i in range(2):
        store.add_attempt(
            {
                "id": f"test-{i}",
                "question_id": q["id"],
                "question_version": 1,
                "created_at": stamp,
                "result": {"status": "passed"},
                "review_due_at": "2099-01-01T00:00:00+00:00",
                "title": q["title"],
            }
        )
    data = snapshot(store, "America/Toronto")
    assert data["metrics"]["questions_solved"] == 1
    assert sum(d["solved"] for d in data["days"]) == 1
    assert data["roadmaps"][1]["mastered"] == 0  # Same-day repetition is not mastery.
