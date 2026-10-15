"""Transactional local storage. Questions are immutable, versioned snapshots."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from .schema import Question


class StorageConflict(RuntimeError):
    pass


def now() -> str:
    return datetime.now(UTC).isoformat()


def encode(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > 5:
                raise RuntimeError("Database was created by a newer ForgePad version")
            if version < 1:
                db.executescript("""
                BEGIN;
                CREATE TABLE questions(id TEXT NOT NULL, version INTEGER NOT NULL, package TEXT NOT NULL,
                  created_at TEXT NOT NULL, PRIMARY KEY(id, version));
                CREATE TABLE question_flags(question_id TEXT PRIMARY KEY, bookmarked INTEGER NOT NULL DEFAULT 0,
                  archived INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE drafts(question_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
                  files TEXT NOT NULL, answer TEXT NOT NULL, updated_at TEXT NOT NULL,
                  FOREIGN KEY(question_id,version) REFERENCES questions(id,version));
                CREATE TABLE attempts(id TEXT PRIMARY KEY, question_id TEXT NOT NULL, version INTEGER NOT NULL,
                  created_at TEXT NOT NULL, payload TEXT NOT NULL,
                  FOREIGN KEY(question_id,version) REFERENCES questions(id,version));
                CREATE INDEX attempts_question ON attempts(question_id,created_at);
                CREATE TABLE runs(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE interviews(id TEXT PRIMARY KEY, question_id TEXT NOT NULL, version INTEGER NOT NULL,
                  payload TEXT NOT NULL, FOREIGN KEY(question_id,version) REFERENCES questions(id,version));
                CREATE TABLE goals(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE imports(token TEXT PRIMARY KEY, package TEXT NOT NULL, created_at TEXT NOT NULL);
                PRAGMA user_version=1;
                COMMIT;
                """)
            if version < 2:
                db.executescript("""
                CREATE TABLE IF NOT EXISTS solutions(id TEXT NOT NULL, version INTEGER NOT NULL,
                  payload TEXT NOT NULL, PRIMARY KEY(id,version),
                  FOREIGN KEY(id,version) REFERENCES questions(id,version));
                CREATE TABLE IF NOT EXISTS replay(id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                  created_at TEXT NOT NULL, payload TEXT NOT NULL,
                  FOREIGN KEY(session_id) REFERENCES interviews(id));
                CREATE INDEX IF NOT EXISTS replay_session ON replay(session_id,created_at);
                """)
                for row in db.execute("SELECT id,version,package FROM questions").fetchall():
                    package = json.loads(row["package"])
                    solution = {key: package.pop(key) for key in (
                        "reference_solution", "solution_notes", "time_complexity", "space_complexity"
                    ) if key in package}
                    db.execute("INSERT OR IGNORE INTO solutions VALUES (?,?,?)",
                               (row["id"], row["version"], encode(solution)))
                    db.execute("UPDATE questions SET package=? WHERE id=? AND version=?",
                               (encode(package), row["id"], row["version"]))
                db.execute("PRAGMA user_version=2")
            if version < 4:
                db.executescript("""
                CREATE TABLE IF NOT EXISTS draft_versions(question_id TEXT NOT NULL, version INTEGER NOT NULL,
                    files TEXT NOT NULL, answer TEXT NOT NULL, updated_at TEXT NOT NULL,
                    PRIMARY KEY(question_id,version), FOREIGN KEY(question_id,version) REFERENCES questions(id,version));
                INSERT OR IGNORE INTO draft_versions SELECT * FROM drafts;
                PRAGMA user_version=4;
                """)
            integrity = db.execute("PRAGMA quick_check").fetchone()[0]
            if integrity != "ok":
                raise RuntimeError(f"SQLite integrity check failed: {integrity}")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def seed(self, directory: Path):
        for path in sorted(directory.glob("*.json")):
            raw = json.loads(path.read_text())
            packages = raw if isinstance(raw, list) else [raw]
            for package in packages:
                question = Question.model_validate(package).model_dump()
                with self.connect() as db:
                    self._insert_question(db, question)

    def _insert_question(self, db, question):
        package = dict(question)
        solution = {key: package.pop(key) for key in (
            "reference_solution", "solution_notes", "time_complexity", "space_complexity"
        ) if key in package}
        db.execute("INSERT OR IGNORE INTO questions VALUES (?,?,?,?)",
                   (package["id"], package["version"], encode(package), now()))
        db.execute("INSERT OR IGNORE INTO solutions VALUES (?,?,?)",
                   (package["id"], package["version"], encode(solution)))

    def question(self, question_id: str, version: int | None = None) -> dict | None:
        with self.connect() as db:
            if version is None:
                row = db.execute(
                    "SELECT package FROM questions WHERE id=? ORDER BY version DESC LIMIT 1", (question_id,)
                ).fetchone()
            else:
                row = db.execute(
                    "SELECT package FROM questions WHERE id=? AND version=?", (question_id, version)
                ).fetchone()
            if not row:
                return None
            package = json.loads(row[0])
            solution = db.execute("SELECT payload FROM solutions WHERE id=? AND version=?",
                                  (package["id"], package["version"])).fetchone()
            return {**package, **(json.loads(solution[0]) if solution else {})}

    def questions(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT q.package FROM questions q JOIN "
                "(SELECT id,MAX(version) version FROM questions GROUP BY id) latest "
                "ON q.id=latest.id AND q.version=latest.version ORDER BY q.id"
            ).fetchall()
        return [self.question(json.loads(row[0])["id"]) for row in rows]

    def flags(self, question_id):
        with self.connect() as db:
            row = db.execute("SELECT bookmarked,archived FROM question_flags WHERE question_id=?",
                             (question_id,)).fetchone()
        return dict(row) if row else {"bookmarked": False, "archived": False}

    def summary_state(self):
        with self.connect() as db:
            flags = {r["question_id"]: dict(r) for r in db.execute("SELECT * FROM question_flags")}
        latest = {}
        for record in self.records("attempts"):
            latest.setdefault(record["question_id"], record)
        return flags, latest

    def latest_attempt(self, question_id):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM attempts WHERE question_id=? ORDER BY created_at DESC LIMIT 1",
                             (question_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_flags(self, question_id, bookmarked, archived):
        with self.connect() as db:
            db.execute("INSERT INTO question_flags VALUES (?,?,?) ON CONFLICT(question_id) DO UPDATE SET bookmarked=excluded.bookmarked,archived=excluded.archived",
                       (question_id, bookmarked, archived))

    def stage_import(self, token, question):
        with self.connect() as db:
            db.execute("DELETE FROM imports WHERE created_at<?",
                       ((datetime.now(UTC) - timedelta(hours=1)).isoformat(),))
            db.execute("INSERT INTO imports VALUES (?,?,?)", (token, encode(question), now()))

    def publish_import(self, token):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT package,created_at FROM imports WHERE token=?", (token,)).fetchone()
            if not row or datetime.fromisoformat(row[1]) < datetime.now(UTC) - timedelta(hours=1):
                raise ValueError("Validation token expired or was already published; validate again")
            question = json.loads(row[0])
            latest = db.execute("SELECT MAX(version) FROM questions WHERE id=?", (question["id"],)).fetchone()[0]
            if latest is not None and latest >= question["version"]:
                raise ValueError("A same or newer question version already exists")
            self._insert_question(db, question)
            db.execute("DELETE FROM imports WHERE token=?", (token,))
        return question

    def draft(self, question_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM draft_versions WHERE question_id=? ORDER BY version DESC LIMIT 1", (question_id,)).fetchone()
        return {**dict(row), "files": json.loads(row["files"])} if row else None

    def save_draft(self, question, files, answer):
        record = {"files": files, "answer": answer, "updated_at": now(), "question_version": question["version"]}
        with self.connect() as db:
            db.execute("INSERT INTO draft_versions VALUES(?,?,?,?,?) ON CONFLICT(question_id,version) DO UPDATE SET files=excluded.files,answer=excluded.answer,updated_at=excluded.updated_at",
                       (question["id"], question["version"], encode(files), answer, record["updated_at"]))
            db.execute("INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET version=excluded.version,files=excluded.files,answer=excluded.answer,updated_at=excluded.updated_at",
                       (question["id"], question["version"], encode(files), answer, record["updated_at"]))
        return record

    def add_replay(self, session_id, kind, data):
        record = {"id": str(uuid4()), "session_id": session_id, "kind": kind, "created_at": now(), **data}
        with self.connect() as db:
            db.execute("INSERT INTO replay VALUES (?,?,?,?)",
                       (record["id"], session_id, record["created_at"], encode(record)))
        return record

    def replay(self, session_id):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM replay WHERE session_id=? ORDER BY created_at,id",
                              (session_id,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def records(self, table: str) -> list[dict]:
        assert table in {"attempts", "runs", "interviews", "goals"}
        with self.connect() as db:
            rows = db.execute(f"SELECT payload FROM {table} ORDER BY rowid DESC").fetchall()
        return [json.loads(row[0]) for row in rows]

    def record(self, table: str, record_id: str) -> dict | None:
        assert table in {"runs", "interviews", "goals"}
        with self.connect() as db:
            row = db.execute(f"SELECT payload FROM {table} WHERE id=?", (record_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_record(self, table: str, record: dict):
        assert table in {"runs", "interviews", "goals"}
        with self.connect() as db:
            if table == "interviews":
                db.execute(
                    "INSERT INTO interviews VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                    (record["id"], record["question_id"], record["question_version"], encode(record)),
                )
            else:
                db.execute(
                    f"INSERT INTO {table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                    (record["id"], encode(record)),
                )

    def add_attempt(self, record: dict):
        with self.connect() as db:
            db.execute(
                "INSERT INTO attempts VALUES (?,?,?,?,?)",
                (
                    record["id"],
                    record["question_id"],
                    record["question_version"],
                    record["created_at"],
                    encode(record),
                ),
            )

    def export(self) -> dict:
        result = {"schema_version": "1.0", "exported_at": now(), "questions": []}
        with self.connect() as db:
            result["questions"] = [self.question(row[0], row[1]) for row in db.execute("SELECT id,version FROM questions")]
            result["drafts"] = [
                {**dict(row), "files": json.loads(row["files"])} for row in db.execute("SELECT * FROM drafts")
            ]
            result["question_flags"] = [dict(row) for row in db.execute("SELECT * FROM question_flags")]
            result["replay"] = [json.loads(row[0]) for row in db.execute("SELECT payload FROM replay ORDER BY created_at")]
        for table in ("attempts", "runs", "interviews", "goals"):
            result[table] = self.records(table)
        return result

    def reset_user_data(self):
        with self.connect() as db:
            for table in ("replay", "attempts", "runs", "interviews", "goals", "drafts", "draft_versions", "question_flags", "imports"):
                db.execute(f"DELETE FROM {table}")

    def backup(self, destination: Path):
        with self.connect() as source, sqlite3.connect(destination) as target:
            source.backup(target)
