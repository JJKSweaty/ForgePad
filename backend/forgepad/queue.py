"""Bounded execution queue; only DockerRunner executes submitted programs."""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import BoundedSemaphore, Event, RLock
from uuid import uuid4

from .storage import now


def safe_result(result: dict) -> dict:
    result = dict(result)
    result["tests"] = [dict(test) for test in result.get("tests", [])]
    for test in result["tests"]:
        test["visibility"] = "public"
    return result


def attempt(question, *, files=None, result=None, answer="", confidence=None, reflection=""):
    success = result.get("status") == "passed" if result else confidence == "confident"
    days = 7 if success else 1 if confidence != "partial" else 3
    return {
        "id": str(uuid4()),
        "question_id": question["id"],
        "question_version": question["version"],
        "title": question["title"],
        "topics": question["topics"],
        "language": question["language"],
        "type": question["type"],
        "assessment_basis": "deterministic_tests" if result else "self_report",
        "created_at": now(),
        "files": files or {},
        "answer": answer,
        "confidence": confidence,
        "reflection": reflection,
        "result": result,
        "completion_status": "complete" if success else "needs_review",
        "review_due_at": (datetime.now(UTC) + timedelta(days=days)).isoformat(),
        "review_interval_days": days,
        "session_type": "coding" if result else "theory",
    }


class RunQueue:
    def __init__(self, store, runner, workers=2):
        self.store, self.runner = store, runner
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="forgepad-run")
        self.lock = RLock()
        self.slots = BoundedSemaphore(workers)
        self.events = {}
        self.closed = False
        # A lost server process cannot resume a container result honestly.
        for run in store.records("runs"):
            if run["status"] in {"queued", "running"}:
                run["status"] = "cancelled"
                run["detail"] = "Backend restarted before execution completed; run again."
                store.save_record("runs", run)

    def enqueue(self, question, files, mode):
        with self.lock:
            if self.closed:
                raise ValueError("Execution queue is shutting down")
            if len(self.events) >= 16:
                raise ValueError("Execution queue is full; wait for an existing run to finish")
            run = {
                "id": str(uuid4()),
                "status": "queued",
                "question_id": question["id"],
                "question_version": question["version"],
                "mode": mode,
                "files": files,
                "created_at": now(),
            }
            cancel = Event()
            self.events[run["id"]] = cancel
            self.store.save_record("runs", run)
            self.pool.submit(self._execute, run, question, files, cancel)
            return {"id": run["id"], "status": "queued"}

    def _execute(self, run, question, files, cancel):
        try:
            with self.lock:
                if cancel.is_set():
                    return
                run["status"] = "running"
                self.store.save_record("runs", run)
            with self.slots:
                if cancel.is_set():
                    result = {"status": "cancelled", "tests": [], "passed": 0, "total": 0}
                else:
                    result = safe_result(
                        self.runner.run(
                            question, files, include_hidden=True, cancel_event=cancel
                        )
                    )
            with self.lock:
                run["result"] = result
                run["completed_at"] = now()
                run["status"] = (
                    "cancelled" if cancel.is_set() or result.get("status") == "cancelled" else "complete"
                )
                if (
                    run["status"] == "complete"
                    and run["mode"] == "submit"
                    and result.get("status") not in {"unavailable", "unsupported"}
                ):
                    record = attempt(question, files=files, result=result)
                    self.store.add_attempt(record)
                    run["attempt_id"] = record["id"]
                self.store.save_record("runs", run)
        except Exception:
            logging.getLogger(__name__).exception("Execution worker failed")
            with self.lock:
                run["status"] = "cancelled" if cancel.is_set() else "complete"
                run["result"] = {
                    "status": "unavailable",
                    "tests": [],
                    "passed": 0,
                    "total": 0,
                    "compiler_output": "Worker failed. Check backend logs or restart the runner.",
                }
                self.store.save_record("runs", run)
        finally:
            with self.lock:
                self.events.pop(run["id"], None)

    def validate_reference(self, question):
        if not self.slots.acquire(blocking=False):
            raise ValueError("Workers are busy; wait for active runs to finish before validating an import")
        try:
            return self.runner.run(question, question["reference_solution"], include_hidden=True)
        finally:
            self.slots.release()

    def cancel(self, run_id):
        with self.lock:
            run = self.store.record("runs", run_id)
            if run is None:
                return None
            if run["status"] in {"queued", "running"}:
                if run_id in self.events:
                    self.events[run_id].set()
                run["status"] = "cancelled"
                self.store.save_record("runs", run)
            return run

    def shutdown(self):
        with self.lock:
            self.closed = True
            for run_id in list(self.events):
                self.cancel(run_id)
        self.pool.shutdown(wait=True, cancel_futures=False)
