"""Transactional local storage. Questions are immutable, versioned snapshots."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

from .schema import Question


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def encode(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > 1:
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
                    db.execute("INSERT OR IGNORE INTO questions VALUES (?,?,?,?)", (
                        question["id"], question["version"], encode(question), now()))

    def question(self, question_id: str, version: int | None = None) -> dict | None:
        with self.connect() as db:
            if version is None:
                row = db.execute("SELECT package FROM questions WHERE id=? ORDER BY version DESC LIMIT 1",
                                 (question_id,)).fetchone()
            else:
                row = db.execute("SELECT package FROM questions WHERE id=? AND version=?",
                                 (question_id, version)).fetchone()
        return json.loads(row[0]) if row else None

    def questions(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT q.package FROM questions q JOIN "
                              "(SELECT id,MAX(version) version FROM questions GROUP BY id) latest "
                              "ON q.id=latest.id AND q.version=latest.version ORDER BY q.id").fetchall()
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
                db.execute("INSERT INTO interviews VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                           (record["id"], record["question_id"], record["question_version"], encode(record)))
            else:
                db.execute(f"INSERT INTO {table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                           (record["id"], encode(record)))

    def add_attempt(self, record: dict):
        with self.connect() as db:
            db.execute("INSERT INTO attempts VALUES (?,?,?,?,?)", (
                record["id"], record["question_id"], record["question_version"], record["created_at"], encode(record)))

    def export(self) -> dict:
        result = {"schema_version": "1.0", "exported_at": now(), "questions": []}
        with self.connect() as db:
            result["questions"] = [json.loads(row[0]) for row in db.execute("SELECT package FROM questions")]
            result["drafts"] = [{**dict(row), "files": json.loads(row["files"])}
                                for row in db.execute("SELECT * FROM drafts")]
            result["question_flags"] = [dict(row) for row in db.execute("SELECT * FROM question_flags")]
        for table in ("attempts", "runs", "interviews", "goals"):
            result[table] = self.records(table)
        return result

    def reset_user_data(self):
        with self.connect() as db:
            for table in ("attempts", "runs", "interviews", "goals", "drafts", "question_flags", "imports"):
                db.execute(f"DELETE FROM {table}")

    def backup(self, destination: Path):
        with self.connect() as source, sqlite3.connect(destination) as target:
            source.backup(target)
