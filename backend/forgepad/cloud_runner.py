"""Authenticated cloud execution and synchronous serverless request handling."""

import os
from contextvars import ContextVar
from uuid import uuid4

import httpx

from .queue import attempt, safe_result
from .storage import now

request_oidc = ContextVar("request_oidc", default="")


class CloudRunner:
    def __init__(self):
        deployment = os.getenv("VERCEL_URL")
        self.url = f"https://{deployment}/api/runner" if deployment else os.environ["FORGEPAD_RUNNER_URL"]

    def _headers(self):
        return {"Authorization": f"Bearer {os.environ['FORGEPAD_RUNNER_SECRET']}",
                "x-vercel-trusted-oidc-idp-token": request_oidc.get() or os.getenv("VERCEL_OIDC_TOKEN", "")}

    def availability(self):
        try:
            response = httpx.get(self.url, headers=self._headers(), timeout=20)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            return {"available": False, "detail": "Cloud compiler service is unavailable; retry shortly."}

    def run(self, question, files, include_hidden=False, cancel_event=None):
        if cancel_event and cancel_event.is_set():
            return {"status": "cancelled", "tests": [], "passed": 0, "total": 0}
        try:
            response = httpx.post(self.url, headers=self._headers(), json={
                "question": question, "files": files, "include_hidden": include_hidden}, timeout=280)
            response.raise_for_status()
            return safe_result(response.json())
        except (httpx.HTTPError, ValueError):
            return {"status": "unavailable", "tests": [], "passed": 0, "total": 0,
                    "compiler_output": "Cloud compilation could not complete. Your draft is saved; retry the run."}


class SynchronousQueue:
    """Finish work before returning so serverless shutdown cannot lose background jobs."""

    def __init__(self, store, runner):
        self.store, self.runner = store, runner

    def enqueue(self, question, files, mode):
        record = {"id": str(uuid4()), "status": "running", "question_id": question["id"],
                  "question_version": question["version"], "files": files, "mode": mode, "created_at": now()}
        self.store.save_record("runs", record)
        result = safe_result(self.runner.run(question, files, include_hidden=mode == "submit"))
        record.update(status="complete", result=result, completed_at=now())
        if mode == "submit" and result["status"] not in {"unavailable", "unsupported", "cancelled"}:
            saved = attempt(question, files=files, result=result)
            self.store.add_attempt(saved)
            record["attempt_id"] = saved["id"]
        self.store.save_record("runs", record)
        return record

    def validate_reference(self, question):
        return self.runner.run(question, question["reference_solution"], include_hidden=True)

    def cancel(self, run_id):
        record = self.store.record("runs", run_id)
        if record and record["status"] == "running":
            raise ValueError("Cloud runs finish in the current request and cannot be cancelled after dispatch")
        return record

    def shutdown(self):
        pass
