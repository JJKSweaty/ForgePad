"""Shared read projections of persisted attempts and drafts."""
from datetime import UTC, datetime


def completed(a):
    return a.get("completion_status") == "complete" or (a.get("result") or {}).get("status") == "passed" or (not a.get("result") and a.get("confidence") == "confident")


def metadata(a):
    return {**{k: v for k, v in a.items() if k not in {"files", "answer", "reflection"}},
            "result": {k: v for k, v in (a.get("result") or {}).items() if k not in {"tests", "compiler_output"}} or None}


def states(store, questions, attempts=None):
    attempts = attempts if attempts is not None else store.records("attempts")
    out = {}
    for a in attempts:
        due = a.get("review_due_at") and datetime.fromisoformat(a["review_due_at"]) <= datetime.now(UTC)
        v = out.setdefault(a["question_id"], {
            "progress_status": "needs_review" if due or not completed(a) else "completed",
            "attempt_count": 0, "latest_attempt_id": a["id"], "latest_result": (a.get("result") or {}).get("status"),
            "last_activity_at": a["created_at"], "review_due_at": a.get("review_due_at"), "has_completed": False})
        v["attempt_count"] += 1
        v["has_completed"] |= completed(a)
    for q in questions:
        d = store.draft(q["id"])
        if not d or store.flags(q["id"]).get("archived"):
            continue
        version = d.get("question_version", d.get("version", q["version"]))
        pinned = store.question(q["id"], version) or q
        if d["files"] == pinned.get("starter_files", {}) and not d["answer"].strip():
            continue
        last = next((a for a in attempts if a["question_id"] == q["id"] and a["question_version"] == version), None)
        if last and ((last.get("files", {}) == d["files"] and last.get("answer", "") == d["answer"]) or last["created_at"] >= d["updated_at"]):
            continue
        v = out.setdefault(q["id"], {"attempt_count": 0})
        if d["updated_at"] >= v.get("last_activity_at", ""):
            v.update(progress_status="in_progress", draft_version=version, last_activity_at=d["updated_at"])
    from .interviews import update_clock
    for session in sorted(store.records("interviews"), key=lambda s: s.get("last_activity_at", s["started_at"])):
        update_clock(session)
        if session["state"] == "COMPLETE":
            continue
        at = session.get("last_activity_at", session["started_at"])
        v = out.setdefault(session["question_id"], {"attempt_count": 0})
        if at >= v.get("last_activity_at", ""):
            v.update(progress_status="in_progress", session_id=session["id"], draft_version=session["question_version"], last_activity_at=at)
    return out


def progress(store, compact=False):
    attempts = store.records("attempts")
    latest, topics = {}, {}
    for a in attempts:
        latest.setdefault(a["question_id"], a)
        for topic in a.get("topics", []):
            v = topics.setdefault(topic, {"topic": topic, "attempts": 0, "needs_review": 0, "evidence_ids": []})
            v["attempts"] += 1
            if not completed(a):
                v["needs_review"] += 1
                v["evidence_ids"].append(a["id"])
    due = [{"question_id": a["question_id"], "title": a.get("title", a["question_id"]),
            "due_at": a["review_due_at"], "topics": a.get("topics", []),
            "previous_result": (a.get("result") or {}).get("status") or a.get("confidence"),
            "last_attempted_at": a["created_at"],
            "reason": "Scheduled review after a completed attempt" if completed(a) else "Revisit the previous assessment"}
           for a in latest.values() if a.get("review_due_at") and datetime.fromisoformat(a["review_due_at"]) <= datetime.now(UTC)]
    return {"attempts": [metadata(a) for a in attempts] if compact else attempts, "due_reviews": due,
            "weak_topics": sorted((v for v in topics.values() if v["needs_review"]), key=lambda v: -v["needs_review"])[:10],
            "goals": store.records("goals"), "summary": {"attempts": len(attempts),
            "passed_attempts": sum((a.get("result") or {}).get("status") == "passed" for a in attempts),
            "completed_questions": len({a["question_id"] for a in attempts if completed(a)}),
            "due_reviews": len(due), "interviews": len(store.records("interviews"))}}
