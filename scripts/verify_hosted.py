"""Live private-site verification with a uniquely scoped disposable question."""
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://forgepad-plum.vercel.app"
CLI = ["npm", "exec", "--yes", "--package", "vercel@64.2.0", "--cache", "/private/tmp/forgepad-npm-cache", "--", "vercel"]


def request(path, method="GET", data=None):
    command = [*CLI, "curl", BASE + "/api" + path, "--scope", "jonathan-s-projects-337522df", "--",
               "--silent", "--show-error", "--fail-with-body", "--max-time", "290", "--request", method]
    if data is not None:
        command += ["--header", "Content-Type: application/json", "--data-binary", "@-"]
    result = subprocess.run(command, input=json.dumps(data) if data is not None else None,
                            capture_output=True, text=True)
    try:
        body = json.loads(result.stdout)
    except ValueError:
        raise RuntimeError(f"{method} {path} did not return JSON") from None
    if result.returncode:
        raise RuntimeError(f"{method} {path} failed: {body.get('detail', 'HTTP request failed')}")
    return body


def main():
    values = {key: value for key, value in dotenv_values(stream=io.StringIO(sys.stdin.read())).items() if value is not None}
    if values.get("SUPABASE_URL", "").rstrip("/") != "https://qslpggyytqlgxphmrfeh.supabase.co":
        raise RuntimeError("Unexpected Supabase project; refusing verification writes")
    os.environ.update(values)
    sys.path.insert(0, str(ROOT / "backend"))
    from forgepad.supabase_store import SupabaseStore
    store = SupabaseStore()
    health = request("/health")
    if health.get("storage") != "supabase" or not health.get("runner", {}).get("available"):
        raise RuntimeError("Hosted database or compiler is not ready: " + json.dumps(health))
    print("Cloud API, Supabase, and authenticated runner are healthy.", flush=True)
    original_questions = request("/questions")
    assert len(original_questions) >= 21
    print(f"Question bank loaded: {len(original_questions)} questions.", flush=True)
    package = json.loads((ROOT / "questions/uart-frame-recovery.json").read_text())
    qid = "setup-check-" + uuid4().hex[:12]
    package.update(id=qid, title="Temporary setup verification")
    session_id = None
    token = None
    try:
        validation = request("/imports/validate", "POST", {"question": package})
        assert validation.get("valid"), validation.get("errors")
        token = validation["token"]
        request("/imports/publish", "POST", {"token": token})
        print("Reference validation and transactional question import passed.", flush=True)
        public = request(f"/questions/{qid}")
        assert "reference_solution" not in public and "solution_notes" not in public
        assert len(public["test_config"]["tests"]) == 3
        session = request("/interviews", "POST", {"question_id": qid, "duration_minutes":15, "kind":"coding"})
        session_id = session["id"]
        draft = {"files":package["reference_solution"], "answer":"Verify bounded UART recovery.", "session_id":session_id}
        request(f"/drafts/{qid}", "PUT", draft)
        readback = request(f"/drafts/{qid}")
        assert readback["files"] == draft["files"] and store.draft(qid)["answer"] == draft["answer"]
        print("Draft saved and independently read back from Supabase.", flush=True)
        request(f"/interviews/{session_id}/events", "POST", {"type":"message", "content":"Check pointer guards and timer wraparound first."})
        run = request("/runs", "POST", {"question_id":qid, "files":draft["files"], "session_id":session_id, "mode":"run"})
        assert run["status"] == "complete" and run["result"]["status"] == "passed", run.get("result")
        assert run["result"]["passed"] == 3
        request(f"/interviews/{session_id}/events", "POST", {"type":"finish"})
        replay = request(f"/interviews/{session_id}/replay")
        assert replay["session"]["state"] == "COMPLETE"
        assert {"code", "candidate", "run"}.issubset({event["kind"] for event in replay["events"]})
        assert any(event.get("result", {}).get("status") == "passed" for event in replay["events"] if event.get("result"))
        print("Hosted C11 run passed 3/3 public tests; interview and replay persisted.", flush=True)
        print("Candidate responses omit reference solutions and all six hidden tests.", flush=True)
    finally:
        if session_id:
            store._request("DELETE", "forgepad_records", params={"namespace":"eq.replay", "payload->>session_id":f"eq.{session_id}"}, prefer="return=minimal")
        store._request("DELETE", "forgepad_records", params={"payload->>question_id":f"eq.{qid}"}, prefer="return=minimal")
        store._request("DELETE", "forgepad_records", params={"key":f"eq.{qid}"}, prefer="return=minimal")
        if token:
            store._request("DELETE", "forgepad_records", params={"namespace":"eq.imports", "key":f"eq.{token}"}, prefer="return=minimal")
        store._request("DELETE", "forgepad_solutions", params={"id":f"eq.{qid}"}, prefer="return=minimal")
        store._request("DELETE", "forgepad_questions", params={"id":f"eq.{qid}"}, prefer="return=minimal")
        print("Removed only this verification's temporary records.", flush=True)
    assert store.question(qid) is None
    print("Hosted setup verification passed.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Verification failed: {error}", file=sys.stderr)
        sys.exit(1)
