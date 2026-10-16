"""Read-only dashboard projection for the browser edition; native engagement is separate."""

import json
from datetime import UTC, datetime, timedelta
from importlib.resources import files
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def supplemental_events(store):
    events = []
    for session in store.records("interviews"):
        if session["state"] != "COMPLETE" or not session.get("completed_at"):
            continue
        events.append(
            {
                "id": "session:" + session["id"],
                "kind": "mock_interview_completed",
                "question_id": session["question_id"],
                "session_id": session["id"],
                "occurred_at": session["completed_at"],
                "title": "Mock interview completed",
                "data": {"meaningful": any(m["role"] == "candidate" for m in session.get("transcript", []))},
            }
        )
    for run in store.records("runs"):
        if run.get("status") != "complete" or run.get("mode") != "run" or not run.get("completed_at"):
            continue
        if (run.get("result") or {}).get("status") in {None, "unavailable", "cancelled", "unsupported"}:
            continue
        events.append(
            {
                "id": "run:" + run["id"],
                "kind": "tests_run",
                "question_id": run["question_id"],
                "session_id": run.get("session_id"),
                "occurred_at": run["completed_at"],
                "title": "Tests run",
                "data": {"meaningful": True, "result": run["result"]["status"]},
            }
        )
    return events


def snapshot(store, timezone="UTC"):
    try:
        zone = ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        raise ValueError("Choose a valid IANA timezone") from None
    today = datetime.now(UTC).astimezone(zone).date()
    first = today - timedelta(days=357 + (today.weekday() + 1) % 7)
    days = {
        str(first + timedelta(days=i)): {
            "date": str(first + timedelta(days=i)),
            "activity": 0,
            "attempts": 0,
            "solved": 0,
            "active_seconds": 0,
            "future": first + timedelta(days=i) > today,
        }
        for i in range(364)
    }
    attempts = store.attempt_metadata()
    questions = {q["id"]: q for q in store.questions()}
    solved = set()
    recent = []
    successful_days = {}
    for a in reversed(attempts):
        date = datetime.fromisoformat(a["created_at"]).astimezone(zone).date().isoformat()
        if date in days:
            days[date]["activity"] += 1
            days[date]["attempts"] += bool(a.get("result"))
        event = {
            "id": a["id"],
            "kind": "solution_submitted",
            "question_id": a["question_id"],
            "session_id": None,
            "occurred_at": a["created_at"],
            "title": a.get("title", a["question_id"]),
            "data": {"result": (a.get("result") or {}).get("status"), "meaningful": True},
        }
        recent.append(event)
        if (a.get("result") or {}).get("status") == "passed":
            successful_days.setdefault(a["question_id"], set()).add(
                datetime.fromisoformat(a["created_at"]).astimezone(UTC).date().isoformat()
            )
        if (a.get("result") or {}).get("status") == "passed" and a["question_id"] not in solved:
            solved.add(a["question_id"])
            if date in days:
                days[date]["solved"] += 1
    for event in supplemental_events(store):
        recent.append(event)
        date = datetime.fromisoformat(event["occurred_at"]).astimezone(zone).date().isoformat()
        if date in days and event["data"]["meaningful"]:
            days[date]["activity"] += 1
    active_days = {date for date, d in days.items() if d["activity"]}
    streak = 0
    cursor = today if str(today) in active_days else today - timedelta(days=1)
    while str(cursor) in active_days:
        streak += 1
        cursor -= timedelta(days=1)
    definitions = json.loads(files("forgepad").joinpath("roadmaps.json").read_text())
    roadmaps = []
    latest = {}
    for a in attempts:
        latest.setdefault(a["question_id"], a)
    for r in definitions:
        steps = []
        for i, qid in enumerate(r["question_ids"]):
            q = questions.get(qid, {})
            passed = (latest.get(qid, {}).get("result") or {}).get("status") == "passed"
            status = (
                "mastered"
                if passed and len(successful_days.get(qid, set())) >= 2
                else "solved"
                if passed
                else "self_reviewed"
                if latest.get(qid, {}).get("confidence") == "confident"
                else "needs_review"
                if qid in latest
                else "not_started"
            )
            steps.append(
                {
                    "question_id": qid,
                    "title": q.get("title", qid),
                    "topics": q.get("topics", []),
                    "order": i + 1,
                    "available": bool(q),
                    "status": status,
                }
            )
        count = sum(s["question_id"] in solved for s in steps)
        roadmaps.append(
            {
                **r,
                "steps": steps,
                "total": len(steps),
                "solved": count,
                "mastered": sum(s["status"] == "mastered" for s in steps),
                "completion_percent": 100 * count / len(steps),
                "mastery_rule": "Two deterministic passing submissions on separate UTC dates, with latest attempt passing. Theory self-review is tracked separately.",
            }
        )
    roadmap = roadmaps[0]
    sessions = store.records("interviews")
    from .interviews import update_clock

    for session in sessions:
        update_clock(session)
    active = next(
        (s for s in sessions if s["state"] != "COMPLETE" and s.get("remaining_seconds", 0) > 0), None
    )
    from .learning import states, progress
    learning = states(store, list(questions.values()), attempts)
    unfinished = [(v["last_activity_at"], qid) for qid, v in learning.items() if v["progress_status"] == "in_progress" and not v.get("session_id")]
    draft_q = max(unfinished, default=None)
    if active and draft_q and draft_q[0] > active.get("last_activity_at", active["started_at"]):
        active = None
    due_ids = {
        a["question_id"]
        for a in latest.values()
        if a.get("review_due_at") and datetime.fromisoformat(a["review_due_at"]) <= datetime.now(UTC)
    }
    next_id = next(
        (
            step["question_id"]
            for step in roadmap["steps"]
            if step["available"]
            and (step["question_id"] in due_ids or step["status"] in {"not_started", "needs_review"})
        ),
        None,
    )
    if next_id is None:
        next_id = next(
            (
                step["question_id"]
                for step in roadmap["steps"]
                if step["available"] and step["status"] != "mastered"
            ),
            None,
        )
    q = questions.get(active["question_id"] if active else draft_q[1] if draft_q else next_id)
    if draft_q and not active:
        q = store.question(draft_q[1], learning[draft_q[1]]["draft_version"]) or q
    public = (
        {k: q[k] for k in ["id", "version", "title", "topics", "difficulty", "duration_minutes", "type"]}
        if q
        else None
    )
    due = [
        {
            "question_id": a["question_id"],
            "title": a.get("title", a["question_id"]),
            "due_at": a["review_due_at"],
        }
        for a in latest.values()
        if datetime.fromisoformat(a["review_due_at"]) <= datetime.now(UTC)
    ]
    projected = progress(store, True)
    return {
        "recommendations": {"weak_topics": projected["weak_topics"], "goals": projected["goals"]},
        "timezone": timezone,
        "today": str(today),
        "range_start": str(first),
        "days": list(days.values()),
        "metrics": {
            "questions_solved": len(solved),
            "completed_questions": projected["summary"]["completed_questions"],
            "attempts": len(attempts),
            "practice_seconds": 0,
            "mock_interviews_completed": sum(s["state"] == "COMPLETE" for s in sessions),
            "current_streak": streak,
        },
        "roadmaps": roadmaps,
        "recent_activity": sorted(recent, key=lambda event: event["occurred_at"], reverse=True)[:8],
        "due_reviews": due,
        "tracking": {
            "available": False,
            "basis": "Focused practice time is recorded by the native desktop app.",
        },
        "continuation": {
            "kind": "session" if active else "draft" if draft_q else "question" if q else "empty",
            "label": "Resume" if active or draft_q else "Start Practice",
            "last_activity_at": active.get("last_activity_at", active["started_at"]) if active else draft_q[0] if draft_q else None,
            "reason": "Continue from your recorded preparation state.",
            "question": public,
            "session": {k: active[k] for k in ["id", "question_id", "state", "remaining_seconds", "paused"]}
            if active
            else None,
            "roadmap_id": roadmap["id"],
            "roadmap_title": roadmap["title"],
        },
        "generated_at": datetime.now(UTC).isoformat(),
    }
