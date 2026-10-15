"""Loopback FastAPI application. Run with: uvicorn forgepad.main:app --host 127.0.0.1."""

import logging
import os
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Literal
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import Field, ValidationError, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import interviews
from .generator import authoring_prompt
from .providers import LocalSpeechProvider, OllamaProvider, command
from .queue import RunQueue, attempt
from .runner import DockerRunner
from .schema import (
    Question,
    StrictModel,
    authoring_errors,
    authoring_schema,
    practice_question,
    validate_files,
)
from .storage import StorageConflict, Store, now

ROOT = Path(__file__).resolve().parents[2]


class Flags(StrictModel):
    bookmarked: bool | None = None
    archived: bool | None = None


class Draft(StrictModel):
    files: dict[str, str]
    answer: str = Field(default="", max_length=50000)
    session_id: str | None = Field(default=None, max_length=80)
    _files = field_validator("files")(validate_files)


class RunRequest(Draft):
    question_id: str
    mode: Literal["run", "submit"] = "run"


class ImportRequest(StrictModel):
    question: dict


class TokenRequest(StrictModel):
    token: str = Field(min_length=1, max_length=200)


class TextRequest(StrictModel):
    text: str = Field(min_length=1, max_length=30000)


class IdeaRequest(StrictModel):
    idea: str = Field(min_length=1, max_length=5000)
    difficulty: Literal["beginner", "intermediate", "advanced", "expert"] = "intermediate"
    duration_minutes: Literal[15, 30, 45] = 30
    language: Literal["c", "cpp", "independent"] = "c"
    type: Literal["coding", "theory", "debugging", "design"] = "coding"


class AttemptRequest(StrictModel):
    question_id: str
    answer: str = Field(min_length=1, max_length=50000)
    confidence: Literal["confident", "partial", "uncertain"]
    reflection: str = Field(default="", max_length=10000)


class GoalRequest(StrictModel):
    title: str = Field(min_length=1, max_length=500)


class GoalUpdate(StrictModel):
    status: Literal["pending", "active", "blocked", "complete"]


class InterviewRequest(StrictModel):
    question_id: str | None = None
    duration_minutes: int = Field(default=30, ge=1, le=240)
    kind: Literal["coding", "theory", "mixed", "design"] = "coding"
    personality: Literal["neutral", "supportive", "challenging"] = "neutral"


class InterviewEvent(StrictModel):
    type: Literal["message", "advance", "pause", "resume", "finish"]
    content: str | None = Field(default=None, max_length=30000)


def create_app(db_path=None, seed_dir=None, runner=None, ai=None, speech=None):
    data_path = db_path or os.getenv("FORGEPAD_DB", str(ROOT / "data" / "forgepad.sqlite3"))
    seed_path = Path(seed_dir) if seed_dir is not None else ROOT / "questions"
    session_lock = RLock()

    @asynccontextmanager
    async def lifespan(app):
        if os.getenv("VERCEL") and not all(os.getenv(key) for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")):
            app.state.setup_pending = True
            yield
            return
        if os.getenv("SUPABASE_URL"):
            from .supabase_store import SupabaseStore
            app.state.store = SupabaseStore()
        else:
            app.state.store = Store(data_path)
        app.state.store.seed(seed_path)
        if not runner and os.getenv("FORGEPAD_RUNNER_URL"):
            from .cloud_runner import CloudRunner
            runner_instance = CloudRunner()
        else:
            runner_instance = runner or DockerRunner()
        app.state.runner = runner_instance
        app.state.ai = ai or OllamaProvider()
        app.state.speech = speech or LocalSpeechProvider()
        if os.getenv("VERCEL"):
            from .cloud_runner import SynchronousQueue
            app.state.queue = SynchronousQueue(app.state.store, app.state.runner)
        else:
            app.state.queue = RunQueue(app.state.store, app.state.runner)
        yield
        app.state.queue.shutdown()

    app = FastAPI(title="ForgePad", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(StorageConflict)
    async def storage_conflict(request, error):
        return JSONResponse(status_code=409, content={"detail": str(error)})
    cloud_host = os.getenv("FORGEPAD_HOST", "")
    hosts = ["localhost", "127.0.0.1", "[::1]"]
    if cloud_host:
        hosts += [cloud_host, "*.vercel.app"]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        if getattr(app.state, "setup_pending", False):
            return JSONResponse(status_code=503, content={"detail":
                "Backend setup is incomplete: connect Supabase and configure the server database environment."})
        from .cloud_runner import request_oidc
        oidc_token = request_oidc.set(request.headers.get("x-vercel-oidc-token", ""))
        origin = request.headers.get("origin")
        if origin:
            parsed = urlparse(origin)
            # The Vite proxy preserves its browser origin. Restrict to configured local UI ports.
            allowed = {
                "http://127.0.0.1:5173",
                "http://localhost:5173",
                "http://127.0.0.1:8000",
                "http://localhost:8000",
            }
            configured = os.getenv("FORGEPAD_UI_ORIGIN", "")
            if configured:
                configured_url = urlparse(configured)
                if configured_url.scheme == "http" and configured_url.hostname in {
                    "127.0.0.1",
                    "localhost",
                    "::1",
                }:
                    allowed.add(configured.rstrip("/"))
            if cloud_host:
                allowed.add(f"https://{cloud_host}")
                deployment_host = os.getenv("VERCEL_URL", "")
                if deployment_host:
                    allowed.add(f"https://{deployment_host}")
            if origin.rstrip("/") not in allowed or parsed.username or parsed.password:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Request origin is not a configured local ForgePad UI."},
                )
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse(
                status_code=403, content={"detail": "Cross-site requests to local data are blocked."}
            )
        if request.method in {"POST", "PUT", "PATCH"}:
            # Consume with a hard bound before JSON or multipart parsing.
            chunks, count = [], 0
            async for chunk in request.stream():
                count += len(chunk)
                if count > 10 * 1024 * 1024:
                    return JSONResponse(status_code=413, content={"detail": "Request exceeds 10 MiB."})
                chunks.append(chunk)
            request._body = b"".join(chunks)
        try:
            return await call_next(request)
        finally:
            request_oidc.reset(oidc_token)

    def store():
        return app.state.store

    def question_or_404(question_id, version=None):
        question = store().question(question_id, version)
        if question is None:
            raise HTTPException(404, "Question not found")
        return question

    def summary(question, state=None):
        flags = state[0].get(question["id"], {"bookmarked": False, "archived": False}) if state else store().flags(question["id"])
        latest = state[1].get(question["id"]) if state else store().latest_attempt(question["id"])
        result = {
            key: question[key]
            for key in (
                "id",
                "version",
                "title",
                "description",
                "type",
                "difficulty",
                "topics",
                "duration_minutes",
                "language",
                "source",
            )
        }
        result.update(
            bookmarked=bool(flags["bookmarked"]),
            archived=bool(flags["archived"]),
            completion_status=latest["completion_status"] if latest else "not_started",
        )
        return result

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "runner": app.state.runner.availability(),
            "ai": app.state.ai.availability(),
            "speech": app.state.speech.availability(),
            "hosting": "cloud" if os.getenv("VERCEL") else "local",
            "storage": "supabase" if os.getenv("SUPABASE_URL") else "sqlite",
        }

    @app.get("/api/questions")
    def list_questions(
        q: str = "",
        type: str = "",
        difficulty: str = "",
        topic: str = "",
        language: str = "",
        completion_status: str = "",
        source: str = "",
        max_duration: int | None = None,
    ):
        items = []
        state = store().summary_state()
        for question in store().questions():
            if (
                q
                and q.casefold()
                not in " ".join([question["title"], question["description"], *question["topics"]]).casefold()
            ):
                continue
            if type and question["type"] != type or difficulty and question["difficulty"] != difficulty:
                continue
            if topic and topic.casefold() not in [item.casefold() for item in question["topics"]]:
                continue
            if (
                language
                and language != question["language"]
                or max_duration
                and question["duration_minutes"] > max_duration
            ):
                continue
            if source and source.casefold() not in question["source"]["name"].casefold():
                continue
            item = summary(question, state)
            if completion_status and item["completion_status"] != completion_status:
                continue
            items.append(item)
        return items

    @app.get("/api/questions/export/all")
    def export_all():
        return store().questions()

    @app.get("/api/questions/{question_id}/export")
    def export_question(question_id: str):
        return question_or_404(question_id)

    @app.get("/api/questions/{question_id}")
    def get_question(question_id: str):
        question = question_or_404(question_id)
        return {**practice_question(question), **summary(question)}

    @app.patch("/api/questions/{question_id}")
    def update_question(question_id: str, request: Flags):
        question = question_or_404(question_id)
        existing = summary(question)
        store().save_flags(question_id,
                           request.bookmarked if request.bookmarked is not None else existing["bookmarked"],
                           request.archived if request.archived is not None else existing["archived"])
        return summary(question)

    @app.get("/api/schema")
    def schema():
        return authoring_schema()

    @app.post("/api/generator-prompt")
    def generator_prompt(request: IdeaRequest):
        return {"prompt": authoring_prompt(request.idea, request.difficulty, request.duration_minutes,
                                           request.language, request.type)}

    @app.post("/api/imports/validate")
    def validate_import(request: ImportRequest):
        try:
            question = Question.model_validate(request.question).model_dump()
        except ValidationError as error:
            return {
                "valid": False,
                "errors": [f"{'.'.join(map(str, item['loc']))}: {item['msg']}" for item in error.errors()],
            }
        latest = store().question(question["id"])
        if latest and latest["version"] >= question["version"]:
            return {
                "valid": False,
                "errors": ["Question ID exists. Publish a strictly higher version, or choose a new ID."],
            }
        errors = authoring_errors(question)
        if errors:
            return {"valid": False, "errors": errors}
        validation = None
        if question.get("test_config"):
            try:
                validation = app.state.queue.validate_reference(question)
            except ValueError as error:
                raise HTTPException(429, str(error)) from None
            count = len(question["test_config"]["tests"])
            if (
                validation.get("status") != "passed"
                or validation.get("passed") != count
                or validation.get("total") != count
            ):
                return {
                    "valid": False,
                    "errors": [
                        "Reference solution did not pass every test. Check runner availability, compiler output and test expectations."
                    ],
                    "validation": validation,
                }
        token = secrets.token_urlsafe(32)
        store().stage_import(token, question)
        return {
            "valid": True,
            "errors": [],
            "question": practice_question(question),
            "token": token,
            "validation": validation,
        }

    @app.post("/api/imports/publish", status_code=201)
    def publish_import(request: TokenRequest):
        try:
            question = store().publish_import(request.token)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        return practice_question(question)

    @app.get("/api/drafts/{question_id}")
    def get_draft(question_id: str):
        question = question_or_404(question_id)
        row = store().draft(question_id)
        return (
            {
                "files": row["files"],
                "answer": row["answer"],
                "updated_at": row["updated_at"],
                "question_version": row["version"],
            }
            if row
            else {
                "files": question["starter_files"],
                "answer": "",
                "updated_at": None,
                "question_version": question["version"],
            }
        )

    @app.put("/api/drafts/{question_id}")
    def save_draft(question_id: str, request: Draft):
        question = question_or_404(question_id)
        if request.session_id:
            session = load_session(request.session_id)
            if session["question_id"] != question_id or session["state"] == "COMPLETE":
                raise HTTPException(409, "Draft does not belong to an active interview")
        previous = store().draft(question_id)
        record = store().save_draft(question, request.files, request.answer)
        if request.session_id and (not previous or previous["files"] != request.files or previous["answer"] != request.answer):
            store().add_replay(request.session_id, "code", {"files": request.files, "answer": request.answer})
        return record

    @app.post("/api/runs", status_code=202)
    def create_run(request: RunRequest):
        question = question_or_404(request.question_id)
        if not question.get("test_config"):
            raise HTTPException(422, "This question has no executable tests. Save a theory response instead.")
        if not request.files:
            raise HTTPException(422, "Add at least one source file before running")
        if request.session_id:
            session = load_session(request.session_id)
            if session["question_id"] != request.question_id or session["state"] == "COMPLETE":
                raise HTTPException(409, "Run does not belong to an active interview")
        try:
            run = app.state.queue.enqueue(question, request.files, request.mode)
            if request.session_id:
                store().add_replay(request.session_id, "run", {"run_id": run["id"], "files": request.files,
                                                              "mode": request.mode})
            return run
        except ValueError as error:
            raise HTTPException(429, str(error)) from None

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str):
        result = store().record("runs", run_id)
        if result is None:
            raise HTTPException(404, "Run not found")
        return result

    @app.delete("/api/runs/{run_id}")
    def cancel_run(run_id: str):
        result = app.state.queue.cancel(run_id)
        if result is None:
            raise HTTPException(404, "Run not found")
        return result

    @app.post("/api/attempts", status_code=201)
    def create_attempt(request: AttemptRequest):
        question = question_or_404(request.question_id)
        if question.get("test_config"):
            raise HTTPException(
                422, "Use Submit for executable questions; confidence cannot mark code tests correct"
            )
        result = attempt(
            question, answer=request.answer, confidence=request.confidence, reflection=request.reflection
        )
        store().add_attempt(result)
        return result

    @app.get("/api/progress")
    def progress():
        attempts = store().records("attempts")
        latest = {}
        for item in attempts:
            latest.setdefault(item["question_id"], item)
        due = [
            item
            for item in latest.values()
            if datetime.fromisoformat(item["review_due_at"]) <= datetime.now(UTC)
        ]
        topic_counts = {}
        for item in attempts:
            for topic in item["topics"]:
                counts = topic_counts.setdefault(topic, {"topic": topic, "attempts": 0, "needs_review": 0})
                counts["attempts"] += 1
                counts["needs_review"] += item["completion_status"] != "complete"
        weak = sorted(
            (item for item in topic_counts.values() if item["needs_review"]),
            key=lambda item: (-item["needs_review"] / item["attempts"], -item["needs_review"]),
        )
        return {
            "attempts": attempts,
            "due_reviews": due,
            "weak_topics": weak[:10],
            "goals": store().records("goals"),
            "summary": {
                "attempts": len(attempts),
                "completed_questions": sum(
                    item["completion_status"] == "complete" for item in latest.values()
                ),
                "due_reviews": len(due),
                "interviews": len(store().records("interviews")),
            },
        }

    @app.post("/api/goals", status_code=201)
    def create_goal(request: GoalRequest):
        record = {
            "id": str(uuid4()),
            "title": request.title.strip(),
            "status": "pending",
            "created_at": now(),
        }
        store().save_record("goals", record)
        return record

    @app.patch("/api/goals/{goal_id}")
    def update_goal(goal_id: str, request: GoalUpdate):
        record = store().record("goals", goal_id)
        if record is None:
            raise HTTPException(404, "Goal not found")
        record.update(status=request.status, updated_at=now())
        store().save_record("goals", record)
        return record

    def load_session(session_id):
        record = store().record("interviews", session_id)
        if record is None:
            raise HTTPException(404, "Interview not found")
        if interviews.update_clock(record):
            interviews.complete(
                record, question_or_404(record["question_id"], record["question_version"]), "time_expired"
            )
        store().save_record("interviews", record)
        return record

    @app.post("/api/interviews", status_code=201)
    def start_interview(request: InterviewRequest):
        if request.question_id:
            question = question_or_404(request.question_id)
        else:
            options = [
                item
                for item in store().questions()
                if not summary(item)["archived"] and (request.kind == "mixed" or item["type"] == request.kind)
            ]
            if not options:
                raise HTTPException(404, "No questions match this interview kind")
            counts = {}
            weak_topics = set()
            for record in store().records("attempts"):
                counts[record["question_id"]] = counts.get(record["question_id"], 0) + 1
                if record.get("result") and record["result"].get("status") != "passed":
                    weak_topics.update(record["topics"])
            question = min(options, key=lambda item: (
                not bool(set(item["topics"]) & weak_topics), counts.get(item["id"], 0)))
        memory = [{key: item[key] for key in ("id", "title", "topics", "created_at", "result", "confidence")}
                  for item in store().records("attempts") if set(item["topics"]) & set(question["topics"])][:5]
        for evidence in memory:
            if evidence.get("result"):
                evidence["result"] = {key: evidence["result"][key] for key in ("status", "passed", "total")
                                      if key in evidence["result"]}
        record = interviews.create_session(
            question, request.duration_minutes, request.kind, request.personality, memory
        )
        store().save_record("interviews", record)
        for entry in record["transcript"]:
            store().add_replay(record["id"], "interviewer", {"content": entry["content"]})
        return record

    @app.get("/api/interviews")
    def list_interviews():
        with session_lock:
            return [load_session(record["id"]) for record in store().records("interviews")]

    @app.get("/api/interviews/{session_id}")
    def get_interview(session_id: str):
        with session_lock:
            return load_session(session_id)

    @app.get("/api/interviews/{session_id}/replay")
    def replay_interview(session_id: str):
        session = load_session(session_id)
        events = store().replay(session_id)
        for event in events:
            if event["kind"] == "run":
                run = store().record("runs", event["run_id"])
                event["result"] = run.get("result") if run else None
        return {"session": session, "events": events}

    @app.post("/api/interviews/{session_id}/events")
    def interview_event(session_id: str, request: InterviewEvent):
        with session_lock:
            record = load_session(session_id)
            question = question_or_404(record["question_id"], record["question_version"])
            previous_messages = len(record["transcript"])
            try:
                interviews.apply_event(record, question, request.type, request.content)
            except ValueError as error:
                raise HTTPException(409, str(error)) from None
            store().save_record("interviews", record)
            for entry in record["transcript"][previous_messages:]:
                store().add_replay(session_id, entry["role"], {"content": entry["content"]})
            store().add_replay(session_id, "control", {"action": request.type, "state": record["state"]})
        if request.type == "message" and record["state"] != "COMPLETE" and getattr(app.state.ai, "model", ""):
            try:
                reply = app.state.ai.respond(
                    {
                        "state": record["state"],
                        "personality": record["personality"],
                        "prompt": question["prompt"],
                        "constraints": question["constraints"],
                        "follow_ups": question["follow_ups"],
                        "transcript": record["transcript"],
                        "technical_memory": record.get("technical_memory", []),
                    }
                )
                with session_lock:
                    latest = load_session(session_id)
                    if latest["state"] == record["state"] and not latest["paused"]:
                        interviews.add_message(latest, "interviewer", reply)
                        store().save_record("interviews", latest)
                        store().add_replay(session_id, "interviewer", {"content": reply})
                        record = latest
            except Exception:
                logging.getLogger(__name__).exception("Local interview inference failed")
                # Candidate text is already committed; inference outages never discard it.
                record["provider_note"] = (
                    "Local inference unavailable. Continue using the interview controls."
                )
        return record

    @app.get("/api/context")
    def context():
        data = progress()
        return {
            "schema_version": "1.0",
            "goals": data["goals"],
            "weak_topics": data["weak_topics"],
            "completed_topics": sorted(
                {
                    topic
                    for item in data["attempts"]
                    if item["completion_status"] == "complete"
                    for topic in item["topics"]
                }
            ),
            "recent_attempts": [
                {
                    key: item[key]
                    for key in ("id", "question_id", "question_version", "completion_status", "created_at")
                }
                for item in data["attempts"][:10]
            ],
            "next_topics": [item["topic"] for item in data["weak_topics"][:3]],
            "summary": data["summary"],
        }

    @app.get("/api/data/export")
    def export_data():
        return store().export()

    @app.delete("/api/data")
    def delete_data():
        with app.state.queue.lock, session_lock:
            if app.state.queue.events:
                raise HTTPException(
                    409, "Cancel active runs and wait for workers to stop before deleting local data"
                )
            store().reset_user_data()
        return {"deleted": True, "questions_preserved": True}

    @app.post("/api/speech/transcribe")
    async def transcribe(file: UploadFile):
        data = await file.read(8 * 1024 * 1024 + 1)
        if not data or len(data) > 8 * 1024 * 1024:
            raise HTTPException(413, "Audio must contain 1 byte to 8 MiB")
        try:
            from starlette.concurrency import run_in_threadpool

            return await run_in_threadpool(
                app.state.speech.transcribe, data, file.content_type or "audio/webm"
            )
        except Exception:
            logging.getLogger(__name__).exception("Local transcription failed")
            raise HTTPException(
                503,
                "Local speech transcription is unavailable; configure a compatible runtime or type your answer",
            ) from None
        finally:
            await file.close()

    @app.post("/api/commands")
    def recognize_command(request: TextRequest):
        return command(request.text)

    return app


app = create_app()
