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
        return {**package, **(solution[0]["payload"] if solution else {})}

    def questions(self):
        rows = self._rows("forgepad_questions", {"order": "version.desc,id.asc"})
        solutions = self._rows("forgepad_solutions", {"order": "id.asc,version.asc"})
        private = {(r["id"], r["version"]): r["payload"] for r in solutions}
        latest = {}
        for row in rows:
            latest.setdefault(row["id"], {**row["payload"], **private.get((row["id"], row["version"]), {})})
        return [latest[key] for key in sorted(latest)]

    def records(self, table):
        rows = self._rows("forgepad_records", {"namespace": f"eq.{table}", "order": "created_at.desc,key.desc"})
        return [row["payload"] for row in rows]

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
        for record in self.records("attempts"):
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

    def draft(self, question_id):
        return self.record("drafts", question_id)

    def save_draft(self, question, files, answer):
        record = {"id": question["id"], "version": question["version"], "question_version": question["version"],
                  "files": files, "answer": answer, "updated_at": now()}
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
        for table in ("drafts", "attempts", "runs", "interviews", "goals", "replay"):
            result[table] = self.records(table)
        result["question_flags"] = self.records("flags")
        return result

    def reset_user_data(self):
        self._request("DELETE", "forgepad_records", params={"namespace": "in.(drafts,attempts,runs,interviews,goals,replay,flags,imports)"}, prefer="return=minimal")
