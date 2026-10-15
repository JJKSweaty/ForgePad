use anyhow::{bail, Context, Result};
use fs2::FileExt;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct Store {
    db: Mutex<Connection>,
    _lock: File,
    pub directory: PathBuf,
}
impl Store {
    pub fn open(directory: &Path, seeds: &Path) -> Result<Self> {
        fs::create_dir_all(directory)?;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(directory.join("service.lock"))?;
        lock.try_lock_exclusive().context("ForgePad already owns this workspace. Use the running application instead of starting a second service.")?;
        let db = Connection::open(directory.join("forgepad.sqlite3"))?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        )?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > 5 {
            bail!("Workspace was created by a newer ForgePad version");
        }
        // Compatible with the web edition's v2 database, with native-only records in a separate migration.
        db.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS questions(id TEXT NOT NULL,version INTEGER NOT NULL,package TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,version));
            CREATE TABLE IF NOT EXISTS solutions(id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(id,version),FOREIGN KEY(id,version) REFERENCES questions(id,version));
            CREATE TABLE IF NOT EXISTS question_flags(question_id TEXT PRIMARY KEY,bookmarked INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS drafts(question_id TEXT PRIMARY KEY,version INTEGER NOT NULL,files TEXT NOT NULL,answer TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(question_id,version) REFERENCES questions(id,version));
            CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,question_id TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,FOREIGN KEY(question_id,version) REFERENCES questions(id,version));
            CREATE INDEX IF NOT EXISTS attempts_question ON attempts(question_id,created_at);
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS interviews(id TEXT PRIMARY KEY,question_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,FOREIGN KEY(question_id,version) REFERENCES questions(id,version));
            CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS imports(token TEXT PRIMARY KEY,package TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS replay(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES interviews(id));
            CREATE INDEX IF NOT EXISTS replay_session ON replay(session_id,created_at);
            CREATE TABLE IF NOT EXISTS native_records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS draft_versions(question_id TEXT NOT NULL,version INTEGER NOT NULL,files TEXT NOT NULL,answer TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(question_id,version),FOREIGN KEY(question_id,version) REFERENCES questions(id,version));
            INSERT OR IGNORE INTO draft_versions SELECT * FROM drafts;
            PRAGMA user_version=4; COMMIT;")?;
        crate::activity::migrate(&db)?;
        let store = Self {
            db: Mutex::new(db),
            _lock: lock,
            directory: directory.into(),
        };
        if seeds.is_dir() {
            for entry in fs::read_dir(seeds)? {
                let p = entry?.path();
                if p.extension().is_some_and(|s| s == "json") {
                    let q: Value = serde_json::from_slice(&fs::read(&p)?)
                        .with_context(|| format!("Invalid seed {}", p.display()))?;
                    if let Some(qs) = q.as_array() {
                        for q in qs {
                            store.insert_seed(q)?;
                        }
                    } else {
                        store.insert_seed(&q)?;
                    }
                }
            }
        }
        Ok(store)
    }
    pub(crate) fn with_db<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        f(&mut self.db.lock().unwrap())
    }
    fn insert_question(db: &Connection, question: &Value) -> Result<()> {
        let mut q = question.clone();
        let mut solution = json!({});
        for key in [
            "reference_solution",
            "solution_notes",
            "time_complexity",
            "space_complexity",
        ] {
            if let Some(v) = q.as_object_mut().and_then(|o| o.remove(key)) {
                solution[key] = v;
            }
        }
        db.execute(
            "INSERT OR IGNORE INTO questions VALUES(?,?,?,?)",
            params![
                q["id"].as_str(),
                q["version"].as_i64(),
                q.to_string(),
                crate::now()
            ],
        )?;
        db.execute(
            "INSERT OR IGNORE INTO solutions VALUES(?,?,?)",
            params![
                q["id"].as_str(),
                q["version"].as_i64(),
                solution.to_string()
            ],
        )?;
        Ok(())
    }
    pub fn insert_seed(&self, q: &Value) -> Result<()> {
        Self::insert_question(&self.db.lock().unwrap(), q)
    }
    pub fn question(&self, id: &str, version: Option<i64>) -> Result<Value> {
        let db = self.db.lock().unwrap();
        let row: Option<(String,i64)> = db.query_row("SELECT package,version FROM questions WHERE id=?1 AND (?2 IS NULL OR version=?2) ORDER BY version DESC LIMIT 1", params![id,version], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        let (package, version) = row.context("Question not found")?;
        let mut q: Value = serde_json::from_str(&package)?;
        let solution: Option<String> = db
            .query_row(
                "SELECT payload FROM solutions WHERE id=? AND version=?",
                params![id, version],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(s) = solution {
            if let Some(o) = serde_json::from_str::<Value>(&s)?.as_object() {
                for (k, v) in o {
                    q[k] = v.clone();
                }
            }
        }
        Ok(q)
    }
    pub fn questions(&self) -> Result<Vec<Value>> {
        let ids = {
            let db = self.db.lock().unwrap();
            let mut statement = db.prepare("SELECT DISTINCT id FROM questions ORDER BY id")?;
            let ids = statement
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            ids
        };
        ids.iter().map(|id| self.question(id, None)).collect()
    }
    pub fn records(&self, kind: &str) -> Result<Vec<Value>> {
        let db = self.db.lock().unwrap();
        let table = ["attempts", "runs", "interviews", "goals"].contains(&kind);
        let sql = if table {
            format!("SELECT payload FROM {kind} ORDER BY rowid DESC")
        } else {
            "SELECT payload FROM native_records WHERE kind=? ORDER BY rowid DESC".into()
        };
        let mut s = db.prepare(&sql)?;
        let mut rows = if table {
            s.query([])?
        } else {
            s.query([kind])?
        };
        let mut values = vec![];
        while let Some(r) = rows.next()? {
            values.push(serde_json::from_str(&r.get::<_, String>(0)?)?);
        }
        Ok(values)
    }
    pub fn get(&self, kind: &str, id: &str) -> Result<Value> {
        let db = self.db.lock().unwrap();
        let payload: Option<String> = if ["runs", "interviews", "goals"].contains(&kind) {
            db.query_row(
                &format!("SELECT payload FROM {kind} WHERE id=?"),
                [id],
                |r| r.get(0),
            )
            .optional()?
        } else {
            db.query_row(
                "SELECT payload FROM native_records WHERE kind=? AND id=?",
                params![kind, id],
                |r| r.get(0),
            )
            .optional()?
        };
        Ok(serde_json::from_str(
            &payload.context(format!("{kind} record not found"))?,
        )?)
    }
    pub fn attempt_metadata(&self) -> Result<Vec<Value>> {
        let db = self.db.lock().unwrap();
        let mut st=db.prepare("SELECT json_remove(payload,'$.files','$.answer','$.reflection','$.result.tests','$.result.compiler_output') FROM attempts ORDER BY created_at DESC")?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows.iter().map(|p| Ok(serde_json::from_str(p)?)).collect()
    }
    pub fn latest_attempt(&self, id: &str) -> Result<Option<Value>> {
        let db = self.db.lock().unwrap();
        let payload:Option<String>=db.query_row("SELECT json_remove(payload,'$.files','$.answer','$.reflection','$.result.tests','$.result.compiler_output') FROM attempts WHERE question_id=? ORDER BY created_at DESC LIMIT 1",[id],|r|r.get(0)).optional()?;
        payload.map(|p| Ok(serde_json::from_str(&p)?)).transpose()
    }
    pub fn save(&self, kind: &str, record: &Value) -> Result<()> {
        let db = self.db.lock().unwrap();
        let id = record["id"].as_str().context("Record ID required")?;
        let payload = record.to_string();
        match kind {
            "interviews" => {
                db.execute("INSERT INTO interviews VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![id,record["question_id"].as_str(),record["question_version"].as_i64(),payload])?;
            }
            "attempts" => {
                db.execute(
                    "INSERT INTO attempts VALUES(?,?,?,?,?)",
                    params![
                        id,
                        record["question_id"].as_str(),
                        record["question_version"].as_i64(),
                        record["created_at"].as_str(),
                        payload
                    ],
                )?;
            }
            "goals" | "runs" => {
                db.execute(&format!("INSERT INTO {kind} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload"),params![id,payload])?;
            }
            _ => {
                db.execute("INSERT INTO native_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload",params![kind,id,payload])?;
            }
        }
        if kind == "attempts" {
            crate::activity::attempt(&db, record)?;
        }
        if kind == "runs" {
            crate::activity::run_completed(&db, record)?;
        }
        if kind == "interviews" && record["state"] == "COMPLETE" {
            crate::activity::session_completed(&db, record)?;
        }
        Ok(())
    }
    pub fn replace_if_unchanged(&self, kind: &str, before: &Value, after: &Value) -> Result<()> {
        let count = self.db.lock().unwrap().execute(
            "UPDATE native_records SET payload=? WHERE kind=? AND id=? AND payload=?",
            params![
                after.to_string(),
                kind,
                before["id"].as_str(),
                before.to_string()
            ],
        )?;
        if count != 1 {
            bail!("Draft changed while the job was running. Review current contents and validate again.");
        }
        Ok(())
    }
    pub fn draft(&self, q: &Value) -> Result<Value> {
        let db = self.db.lock().unwrap();
        let row: Option<(String, String, String, i64)> = db
            .query_row(
                "SELECT files,answer,updated_at,version FROM draft_versions WHERE question_id=?1 AND version=?2",
                params![q["id"].as_str(),q["version"].as_i64()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        Ok(match row {
            Some((files, answer, updated, version)) => {
                json!({"files":serde_json::from_str::<Value>(&files)?,"answer":answer,"updated_at":updated,"question_version":version})
            }
            None => json!({"files":q["starter_files"],"answer":"","question_version":q["version"]}),
        })
    }
    pub fn save_draft(&self, q: &Value, body: &Value) -> Result<Value> {
        crate::schema::files(&body["files"], false)?;
        let answer = body["answer"].as_str().unwrap_or("");
        if answer.len() > 50000 {
            bail!("Answer exceeds 50,000 bytes");
        }
        {
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
            let id = q["id"].as_str();
            let version = q["version"].as_i64();
            let files = body["files"].to_string();
            let at = crate::now();
            tx.execute("INSERT INTO draft_versions VALUES(?,?,?,?,?) ON CONFLICT(question_id,version) DO UPDATE SET files=excluded.files,answer=excluded.answer,updated_at=excluded.updated_at",params![id,version,files,answer,at])?;
            tx.execute("INSERT INTO drafts VALUES(?,?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET version=excluded.version,files=excluded.files,answer=excluded.answer,updated_at=excluded.updated_at WHERE excluded.version>=drafts.version",params![id,version,files,answer,at])?;
            tx.commit()?;
        }
        self.draft(q)
    }
    pub fn export(&self) -> Result<Value> {
        let revisions = {
            let db = self.db.lock().unwrap();
            let mut statement =
                db.prepare("SELECT id,version FROM questions ORDER BY id,version")?;
            let rows = statement
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        let mut out = json!({"schema_version":"1.0","exported_at":crate::now(),"questions":revisions.iter().map(|(id,v)|self.question(id,Some(*v))).collect::<Result<Vec<_>>>()?});
        for kind in [
            "attempts",
            "runs",
            "interviews",
            "goals",
            "question_drafts",
            "events",
            "reflections",
            "jobs",
            "settings",
        ] {
            out[kind] = json!(self.records(kind)?);
        }
        out["activity"] = json!(self.activity_rows(chrono::DateTime::<chrono::Utc>::UNIX_EPOCH)?);
        let db = self.db.lock().unwrap();
        let mut st =
            db.prepare("SELECT question_id,version,files,answer,updated_at FROM draft_versions")?;
        let rows = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        out["drafts"]=json!(rows.into_iter().map(|(id,version,files,answer,at)|json!({"question_id":id,"version":version,"files":serde_json::from_str::<Value>(&files).unwrap_or(Value::Null),"answer":answer,"updated_at":at})).collect::<Vec<_>>());
        Ok(out)
    }
    pub fn reset_user_data(&self) -> Result<()> {
        let recordings = self.records("recordings")?;
        for r in recordings {
            if let Some(filename) = r["filename"].as_str() {
                if !filename.contains("..")
                    && filename
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-.".contains(&b))
                {
                    let file = self.directory.join("recordings").join(filename);
                    if file.exists() {
                        std::fs::remove_file(file)?;
                    }
                }
            }
        }
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        for table in [
            "replay",
            "attempts",
            "runs",
            "interviews",
            "goals",
            "drafts",
            "draft_versions",
            "question_flags",
            "imports",
            "activity_events",
            "practice_visits",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        tx.execute("DELETE FROM native_records WHERE kind IN ('events','reflections','jobs','code_drafts','recordings')",[])?;
        tx.execute(
            "UPDATE activity_revision SET revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn flags(&self, id: &str, update: Option<&Value>) -> Result<Value> {
        let db = self.db.lock().unwrap();
        let (mut bookmarked, mut archived): (bool, bool) = db
            .query_row(
                "SELECT bookmarked,archived FROM question_flags WHERE question_id=?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .unwrap_or((false, false));
        if let Some(u) = update {
            if let Some(b) = u["bookmarked"].as_bool() {
                bookmarked = b;
            }
            if let Some(a) = u["archived"].as_bool() {
                archived = a;
            }
            db.execute("INSERT INTO question_flags VALUES(?,?,?) ON CONFLICT(question_id) DO UPDATE SET bookmarked=excluded.bookmarked,archived=excluded.archived",params![id,bookmarked,archived])?;
        }
        Ok(json!({"bookmarked":bookmarked,"archived":archived}))
    }
    pub fn publish(&self, draft_id: &str) -> Result<Value> {
        let mut draft = self.get("question_drafts", draft_id)?;
        if draft["status"] != "validated" {
            bail!("Question must pass validation before approval");
        }
        let q = &draft["package"];
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let latest: Option<i64> = tx.query_row(
            "SELECT MAX(version) FROM questions WHERE id=?",
            [q["id"].as_str()],
            |r| r.get(0),
        )?;
        if latest.is_some_and(|v| v >= q["version"].as_i64().unwrap_or(0)) {
            bail!("A same or newer revision exists. Stage a higher version; published criteria are immutable.");
        }
        Self::insert_question(&tx, q)?;
        draft["status"] = json!("published");
        tx.execute(
            "UPDATE native_records SET payload=? WHERE kind='question_drafts' AND id=?",
            params![draft.to_string(), draft_id],
        )?;
        tx.commit()?;
        Ok(crate::schema::candidate(&draft["package"]))
    }
    pub fn event(&self, session: Option<&str>, kind: &str, data: Value) -> Result<Value> {
        let record = json!({"id":crate::id(),"session_id":session,"kind":kind,"created_at":crate::now(),"data":data});
        self.save("events", &record)?;
        if let Some(session) = session {
            let mut replay = record.clone();
            if let Some(obj) = data.as_object() {
                for (k, v) in obj {
                    replay[k] = v.clone();
                }
            }
            self.db.lock().unwrap().execute(
                "INSERT INTO replay VALUES(?,?,?,?)",
                params![
                    record["id"].as_str(),
                    session,
                    crate::now(),
                    replay.to_string()
                ],
            )?;
        }
        Ok(record)
    }
    pub fn replay(&self, session: &str) -> Result<Vec<Value>> {
        let db = self.db.lock().unwrap();
        let mut s =
            db.prepare("SELECT payload FROM replay WHERE session_id=? ORDER BY created_at,id")?;
        let items = s
            .query_map([session], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        items.iter().map(|s| Ok(serde_json::from_str(s)?)).collect()
    }
}
