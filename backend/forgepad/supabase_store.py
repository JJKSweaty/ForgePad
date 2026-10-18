"""Server-only PostgREST storage; all tables deny browser roles through RLS."""

import json
import os
from pathlib import Path
from uuid import uuid4

import httpx

from .schema import Question
from .storage import StorageConflict, now

AUTHOR_KEYS = {"reference_solution", "solution_notes", "time_complexity", "space_complexity"}


class SupabaseStore:
    def __init__(self):
        self.base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.client = httpx.Client(headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=25)

    def _request(self, method, path, *, params=None, data=None, prefer="return=representation"):
        response = self.client.request(method, self.base + "/" + path, params=params, json=data,
                                       headers={"Prefer": prefer})
        if response.status_code >= 400:
            # Avoid propagating credential-bearing HTTP request objects or database internals.
            if response.status_code == 409:
                raise ValueError("This record already exists; reload and retry")
            raise RuntimeError(f"Supabase storage request failed ({response.status_code}); check migrations and server configuration")
        return response.json() if response.content else None

    def _rows(self, table, params=None):
        rows, offset = [], 0
        while True:
            page = self._request("GET", table, params={**(params or {}), "limit": "500", "offset": str(offset)})
            rows.extend(page)
            if len(page) < 500:
                return rows
            offset += len(page)

    def seed(self, directory: Path):
        packages = []
        for path in sorted(directory.glob("*.json")):
            raw = json.loads(path.read_text())
            packages.extend(raw if isinstance(raw, list) else [raw])
        questions, solutions = [], []
        for raw in packages:
            question = Question.model_validate(raw).model_dump()
            identity = {"id": question["id"], "version": question["version"]}
            questions.append({**identity, "payload": {k: v for k, v in question.items() if k not in AUTHOR_KEYS}})
            solutions.append({**identity, "payload": {k: v for k, v in question.items() if k in AUTHOR_KEYS}})
        if questions:
            for table, data in (("forgepad_questions", questions), ("forgepad_solutions", solutions)):
                self._request("POST", table, params={"on_conflict": "id,version"}, data=data,
                              prefer="resolution=ignore-duplicates,return=minimal")

    def question(self, question_id, version=None):
        params = {"id": f"eq.{question_id}", "order": "version.desc", "limit": "1"}
        if version is not None:
            params["version"] = f"eq.{version}"
        rows = self._request("GET", "forgepad_questions", params=params)
        if not rows:
            return None
        package = rows[0]["payload"]
        solution = self._request("GET", "forgepad_solutions", params={"id": f"eq.{question_id}",
                                  "version": f"eq.{package['version']}"})
        from .schema import visible_test_package
        return visible_test_package({**package, **(solution[0]["payload"] if solution else {})})

    def questions(self):
        rows = self._rows("forgepad_questions", {"order": "version.desc,id.asc"})
        solutions = self._rows("forgepad_solutions", {"order": "id.asc,version.asc"})
        private = {(r["id"], r["version"]): r["payload"] for r in solutions}
        latest = {}
        for row in rows:
            latest.setdefault(row["id"], {**row["payload"], **private.get((row["id"], row["version"]), {})})
        from .schema import visible_test_package
        return [visible_test_package(latest[key]) for key in sorted(latest)]

    def records(self, table):
        rows = self._rows("forgepad_records", {"namespace": f"eq.{table}", "order": "created_at.desc,key.desc"})
        return [row["payload"] for row in rows]

    def attempt_metadata(self):
        # PostgREST projects only summary fields, keeping source and test payloads off the wire.
        fields = ("id", "question_id", "question_version", "title", "topics", "language", "type", "created_at", "confidence", "completion_status", "review_due_at", "review_interval_days", "assessment_basis", "session_type", "duration_seconds")
        select = ",".join(f"{key}:payload->{key}" for key in fields)
        select += ",result_status:payload->result->status,result_passed:payload->result->passed,result_total:payload->result->total"
        rows = self._rows("forgepad_records", {"namespace": "eq.attempts", "order": "created_at.desc,key.desc", "select": select})
        for a in rows:
            status, passed, total = a.pop("result_status", None), a.pop("result_passed", None), a.pop("result_total", None)
            a["result"] = {"status": status, "passed": passed, "total": total} if status else None
        return rows

    def unfinished_drafts(self):
        drafts = self.records("draft_versions")
        keys = {(d["question_id"], d["version"]) for d in drafts if "question_id" in d}
        for d in self.records("drafts"):
            if (d["id"], d["version"]) not in keys:
                drafts.append({**d, "question_id": d["id"]})
        attempts = self.records("attempts")
        out = []
        for d in sorted(drafts, key=lambda d: d["updated_at"], reverse=True):
            qid = d.get("question_id", d["id"].rsplit(":", 1)[0])
            q = self.question(qid, d["version"])
            if not q or self.flags(qid).get("archived") or (d["files"] == q["starter_files"] and not d["answer"].strip()):
                continue
            a = next((a for a in attempts if a["question_id"] == qid and a["question_version"] == d["version"]), None)
            if a and ((a.get("files", {}) == d["files"] and a.get("answer", "") == d["answer"]) or a["created_at"] >= d["updated_at"]):
                continue
            out.append({"question_id": qid, "question_version": d["version"], "updated_at": d["updated_at"]})
        return out

    def record(self, table, record_id):
        rows = self._request("GET", "forgepad_records", params={"namespace": f"eq.{table}",
                            "key": f"eq.{record_id}", "limit": "1"})
        if not rows:
            return None
        record = dict(rows[0]["payload"])
        if table == "interviews":
            record["_revision"] = rows[0]["revision"]
        return record

    def delete_goal(self, goal_id):
        self._request("DELETE", "forgepad_records", params={"namespace": "eq.goals", "key": f"eq.{goal_id}"})

    def save_record(self, table, record):
        if table == "interviews" and "_revision" in record:
            expected = record["_revision"]
            rows = self._request("PATCH", "forgepad_records", params={"namespace": "eq.interviews",
                "key": f"eq.{record['id']}", "revision": f"eq.{expected}"},
                data={"payload": {k: v for k, v in record.items() if k != "_revision"}, "revision": expected + 1})
            if not rows:
                raise StorageConflict("This interview changed in another request. Reload and retry.")
            record["_revision"] = expected + 1
            return
        self._request("POST", "forgepad_records", params={"on_conflict": "namespace,key"}, data={
            "namespace": table, "key": record["id"], "payload": record,
            "created_at": record.get("created_at", record.get("started_at", now()))},
            prefer="resolution=merge-duplicates,return=minimal")
        if table == "interviews":
            record["_revision"] = 1

    def add_attempt(self, record):
        self.save_record("attempts", record)

    def latest_attempt(self, question_id):
        rows = self._request("GET", "forgepad_records", params={"namespace": "eq.attempts",
            "payload->>question_id": f"eq.{question_id}", "order": "created_at.desc", "limit": "1"})
        return rows[0]["payload"] if rows else None

    def flags(self, question_id):
        return self.record("flags", question_id) or {"bookmarked": False, "archived": False}

    def summary_state(self):
        flags = {r["id"]: r for r in self.records("flags")}
        latest = {}
        for record in self.attempt_metadata():
            latest.setdefault(record["question_id"], record)
        return flags, latest

    def save_flags(self, question_id, bookmarked, archived):
        self.save_record("flags", {"id": question_id, "bookmarked": bookmarked, "archived": archived})

    def stage_import(self, token, question):
        self.save_record("imports", {"id": token, "question": question, "created_at": now()})

    def publish_import(self, token):
        result = self._request("POST", "rpc/forgepad_publish_import", data={"p_token": token})
        if result.get("error"):
            raise ValueError(result["error"])
        return result

    def draft(self, question_id, version=None):
        if version is not None:
            pinned = self.record("draft_versions", f"{question_id}:{version}")
            if pinned:
                return pinned
        draft = self.record("drafts", question_id)
        return draft if draft and (version is None or draft["version"] == version) else None

    def save_draft(self, question, files, answer, written_workspace=None):
        from .written_workspace import validate
        previous = self.draft(question["id"], question["version"])
        if written_workspace is not None:
            answer = validate(written_workspace, question)
        elif previous and previous.get("written_workspace"):
            if previous["answer"] != answer:
                raise StorageConflict("Structured answer exists. Reload the full written workspace before replacing its answer.")
            written_workspace = previous["written_workspace"]
        record = {"id": question["id"], "version": question["version"], "question_version": question["version"], "question_id": question["id"],
                  "files": files, "answer": answer, "updated_at": now()}
        if written_workspace is not None: record["written_workspace"] = written_workspace
        self.save_record("draft_versions", {**record, "id": f"{question['id']}:{question['version']}"})
        current = self.draft(question["id"])
        if not current or current["version"] <= question["version"]:
            self.save_record("drafts", record)
        return record

    def add_replay(self, session_id, kind, data):
        record = {"id": str(uuid4()), "session_id": session_id, "kind": kind, "created_at": now(), **data}
        self.save_record("replay", record)
        return record

    def replay(self, session_id):
        rows = self._rows("forgepad_records", {"namespace": "eq.replay",
            "payload->>session_id": f"eq.{session_id}", "order": "created_at.asc,key.asc"})
        return [r["payload"] for r in rows]

    def export(self):
        result = {"schema_version": "1.0", "exported_at": now(), "questions": []}
        rows = self._rows("forgepad_questions", {"order": "id.asc,version.asc"})
        private = self._rows("forgepad_solutions", {"order": "id.asc,version.asc"})
        solutions = {(r["id"], r["version"]): r["payload"] for r in private}
        result["questions"] = [{**r["payload"], **solutions.get((r["id"], r["version"]), {})} for r in rows]
        for table in ("drafts", "draft_versions", "attempts", "runs", "interviews", "goals", "replay"):
            result[table] = self.records(table)
        result["question_flags"] = self.records("flags")
        return result

    def reset_user_data(self):
        self._request("DELETE", "forgepad_records", params={"namespace": "in.(drafts,draft_versions,attempts,runs,interviews,goals,replay,flags,imports)"}, prefer="return=minimal")
