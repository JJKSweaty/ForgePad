"""Persistent interview state and clock; no inference is needed to complete a session."""

from datetime import UTC, datetime
from uuid import uuid4

from .storage import now

STATES = ("INTRODUCTION", "QUESTION", "CLARIFICATION", "SOLVING", "FOLLOW_UP", "REVIEW", "COMPLETE")


def add_message(session, role, content):
    session["transcript"].append({"role": role, "content": content, "created_at": now()})


def prompt_for(session, question):
    state = session["state"]
    if state == "INTRODUCTION":
        return f"We have {session['duration_minutes']} minutes. Explain your assumptions and trade-offs as you work."
    if state == "QUESTION":
        return question["prompt"]
    if state == "CLARIFICATION":
        return "Which constraints or requirements would you clarify before starting?"
    if state == "SOLVING":
        return "Describe your approach, then work through the problem. Explain how you would test it."
    if state == "FOLLOW_UP":
        follow_ups = question.get("follow_ups", [])
        index = session["follow_up_index"]
        return (
            follow_ups[index] if index < len(follow_ups) else "What failure mode would you investigate first?"
        )
    if state == "REVIEW":
        return "Review your result. Which edge cases or trade-offs need further work?"
    return "Session complete. Your transcript and review are saved locally."


def create_session(question, duration, kind, personality):
    session = {
        "id": str(uuid4()),
        "question_id": question["id"],
        "question_version": question["version"],
        "state": "INTRODUCTION",
        "duration_minutes": duration,
        "kind": kind,
        "personality": personality,
        "started_at": now(),
        "clock_at": now(),
        "remaining_seconds": duration * 60.0,
        "paused": False,
        "transcript": [],
        "follow_up_index": 0,
        "follow_ups_attempted": [],
        "events": [],
    }
    add_message(session, "interviewer", prompt_for(session, question))
    return session


def update_clock(session):
    current = datetime.now(UTC)
    if not session["paused"] and session["state"] != "COMPLETE":
        elapsed = max(0, (current - datetime.fromisoformat(session["clock_at"])).total_seconds())
        session["remaining_seconds"] = max(0.0, session["remaining_seconds"] - elapsed)
    session["clock_at"] = current.isoformat()
    return session["remaining_seconds"] <= 0 and session["state"] != "COMPLETE"


def complete(session, question, reason="finished"):
    session["state"] = "COMPLETE"
    session["paused"] = False
    session["completed_at"] = now()
    session["completion_reason"] = reason
    answers = [m for m in session["transcript"] if m["role"] == "candidate"]
    session["report"] = {
        "what_worked": [f"Recorded {len(answers)} candidate response(s)."] if answers else [],
        "what_failed": ["Technical correctness has not been assessed by a human or language model."],
        "missed_edge_cases": [],
        "interview_communication": f"{len(answers)} responses recorded; explanation quality is unassessed.",
        "what_to_review": question["topics"][:3],
        "next_challenge": question.get("follow_ups", ["Review the rubric and retry."])[0]
        if question.get("follow_ups")
        else "Review the rubric and retry.",
        "rubric": question["rubric"],
        "functional_correctness": "See separately recorded submissions; transcript is not a correctness verdict.",
        "evaluation": "deterministic transcript summary; no inferred technical score",
    }
    add_message(session, "interviewer", prompt_for(session, question))


def apply_event(session, question, event_type, content=None):
    expired = update_clock(session)
    if expired:
        complete(session, question, "time_expired")
        return session
    if session["state"] == "COMPLETE":
        raise ValueError("This interview is complete")
    if event_type == "pause":
        session["paused"] = True
    elif event_type == "resume":
        session["paused"] = False
    elif event_type == "finish":
        complete(session, question)
    elif session["paused"]:
        raise ValueError("Resume the interview before adding responses or advancing")
    elif event_type == "message":
        if not content or not content.strip():
            raise ValueError("A message requires nonempty content")
        add_message(session, "candidate", content.strip())
        # Deliberately no fabricated answer grading; optional providers operate on this transcript.
    elif event_type == "advance":
        if session["state"] == "FOLLOW_UP":
            session["follow_ups_attempted"].append(session["follow_up_index"])
            if session["follow_up_index"] + 1 < len(question.get("follow_ups", [])):
                session["follow_up_index"] += 1
            else:
                session["state"] = "REVIEW"
        else:
            session["state"] = STATES[STATES.index(session["state"]) + 1]
        if session["state"] == "COMPLETE":
            complete(session, question)
        else:
            add_message(session, "interviewer", prompt_for(session, question))
    else:
        raise ValueError("Unknown interview event")
    session["events"].append({"type": event_type, "created_at": now(), "state": session["state"]})
    return session
