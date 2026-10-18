//! Persisted activity, bounded engagement intervals and timezone-correct dashboard projections.
use crate::{store::Store, Service};
use anyhow::{bail, Context, Result};
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

pub fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS activity_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,question_id TEXT,question_version INTEGER,session_id TEXT,occurred_at TEXT NOT NULL,active_seconds INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS activity_time ON activity_events(occurred_at);
      CREATE UNIQUE INDEX IF NOT EXISTS activity_first_solve ON activity_events(question_id) WHERE kind='problem_solved';
      CREATE TABLE IF NOT EXISTS practice_visits(id TEXT PRIMARY KEY,window_id TEXT NOT NULL,question_id TEXT NOT NULL,version INTEGER NOT NULL,session_id TEXT,started_at TEXT NOT NULL,last_seen TEXT NOT NULL,last_input TEXT NOT NULL,focused INTEGER NOT NULL,status TEXT NOT NULL,active_seconds INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS practice_window ON practice_visits(window_id,status);
      CREATE TABLE IF NOT EXISTS activity_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO activity_revision VALUES(1,0);
      CREATE TRIGGER IF NOT EXISTS activity_insert AFTER INSERT ON activity_events BEGIN UPDATE activity_revision SET revision=revision+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS dashboard_drafts AFTER INSERT ON draft_versions BEGIN UPDATE activity_revision SET revision=revision+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS dashboard_draft_changes AFTER UPDATE ON draft_versions BEGIN UPDATE activity_revision SET revision=revision+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS dashboard_attempts AFTER INSERT ON attempts BEGIN UPDATE activity_revision SET revision=revision+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS dashboard_goals AFTER INSERT ON goals BEGIN UPDATE activity_revision SET revision=revision+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS dashboard_goal_changes AFTER UPDATE ON goals BEGIN UPDATE activity_revision SET revision=revision+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS dashboard_settings AFTER UPDATE ON native_records WHEN NEW.kind='settings' BEGIN UPDATE activity_revision SET revision=revision+1 WHERE id=1; END;
      COMMIT;")?;
    let version: i64 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 5 {
        db.pragma_update(None, "user_version", 5)?;
    }
    reconcile(db)
}
// Mirrors one immutable event row; callers provide all canonical event fields.
#[allow(clippy::too_many_arguments)]
fn insert(
    db: &Connection,
    id: &str,
    kind: &str,
    q: Option<&str>,
    version: Option<i64>,
    session: Option<&str>,
    at: &str,
    seconds: i64,
    data: Value,
) -> Result<()> {
    db.execute(
        "INSERT OR IGNORE INTO activity_events VALUES(?,?,?,?,?,?,?,?)",
        params![id, kind, q, version, session, at, seconds, data.to_string()],
    )?;
    Ok(())
}
pub fn attempt(db: &Connection, a: &Value) -> Result<()> {
    let q = a["question_id"].as_str();
    let id = a["id"].as_str().context("Attempt ID missing")?;
    let at = a["created_at"]
        .as_str()
        .context("Attempt timestamp missing")?;
    insert(
        db,
        &format!("attempt:{id}"),
        "solution_submitted",
        q,
        a["question_version"].as_i64(),
        None,
        at,
        0,
        json!({"attempt_id":id,"title":a["title"],"result":a["result"]["status"],"confidence":a["confidence"],"meaningful":true}),
    )?;
    if a["result"]["status"] == "passed" {
        insert(
            db,
            &format!("solved:{}", q.unwrap_or("")),
            "problem_solved",
            q,
            a["question_version"].as_i64(),
            None,
            at,
            0,
            json!({"attempt_id":id,"title":a["title"],"meaningful":false,"basis":"all authored submission tests passed"}),
        )?;
    }
    Ok(())
}
pub fn run_completed(db: &Connection, r: &Value) -> Result<()> {
    if r["status"] != "complete"
        || ["unavailable", "cancelled", "unsupported"]
            .contains(&r["result"]["status"].as_str().unwrap_or("unavailable"))
    {
        return Ok(());
    }
    insert(
        db,
        &format!("run:{}", r["id"].as_str().unwrap_or("")),
        "tests_run",
        r["question_id"].as_str(),
        r["question_version"].as_i64(),
        r["session_id"].as_str(),
        r["completed_at"].as_str().unwrap_or(""),
        0,
        json!({"run_id":r["id"],"result":r["result"]["status"],"meaningful":r["mode"]=="run"}),
    )
}
pub fn session_completed(db: &Connection, s: &Value) -> Result<()> {
    if s["state"] != "COMPLETE" {
        return Ok(());
    }
    let meaningful = s["transcript"]
        .as_array()
        .is_some_and(|ts| ts.iter().any(|t| t["role"] == "candidate"));
    let kind = if s["mode"] == "practice" {
        "practice_completed"
    } else {
        "mock_interview_completed"
    };
    insert(
        db,
        &format!("session:{}", s["id"].as_str().unwrap_or("")),
        kind,
        s["question_id"].as_str(),
        s["question_version"].as_i64(),
        s["id"].as_str(),
        s["completed_at"].as_str().unwrap_or(""),
        0,
        json!({"meaningful":meaningful,"reason":s["completion_reason"]}),
    )
}
fn reconcile(db: &Connection) -> Result<()> {
    let mut st=db.prepare("SELECT json_remove(payload,'$.files','$.answer','$.reflection','$.result.tests','$.result.compiler_output') FROM attempts ORDER BY created_at ASC,id ASC")?;
    for row in st.query_map([], |r| r.get::<_, String>(0))? {
        attempt(db, &serde_json::from_str::<Value>(&row?)?)?;
    }
    let mut st = db.prepare(
        "SELECT payload FROM interviews WHERE json_extract(payload,'$.state')='COMPLETE'",
    )?;
    for row in st.query_map([], |r| r.get::<_, String>(0))? {
        session_completed(db, &serde_json::from_str::<Value>(&row?)?)?;
    }
    Ok(())
}
fn timestamp(s: &str) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(s)?.with_timezone(&Utc))
}
fn day(at: &str, tz: Tz) -> Option<NaiveDate> {
    timestamp(at)
        .ok()
        .map(|d| d.with_timezone(&tz).date_naive())
}
fn add_time(days: &mut BTreeMap<NaiveDate, Value>, end: DateTime<Utc>, seconds: i64, tz: Tz) {
    let mut cursor = end - Duration::seconds(seconds);
    while cursor < end {
        let local = cursor.with_timezone(&tz);
        let date = local.date_naive();
        let mut next = date.succ_opt().unwrap();
        let boundary = loop {
            if let Some(time) = (0..24).find_map(|hour| {
                tz.from_local_datetime(&next.and_hms_opt(hour, 0, 0).unwrap())
                    .earliest()
            }) {
                break time.with_timezone(&Utc);
            }
            next = next.succ_opt().unwrap();
        };
        let stop = boundary.min(end);
        let interval = (stop - cursor).num_seconds().max(0);
        if let Some(v) = days.get_mut(&date) {
            v["active_seconds"] = json!(v["active_seconds"].as_i64().unwrap_or(0) + interval);
        }
        cursor = stop;
    }
}
impl Store {
    pub fn start_visit(
        &self,
        q: &Value,
        session: Option<&str>,
        window: &str,
        at: DateTime<Utc>,
    ) -> Result<Value> {
        if window.is_empty()
            || window.len() > 80
            || !window
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            bail!("Invalid practice window identifier");
        }
        let id = crate::id();
        let stamp = at.to_rfc3339();
        self.with_db(|db|{db.execute("UPDATE practice_visits SET status='closed',focused=0 WHERE window_id=? AND status='active'",[window])?;
            db.execute("INSERT INTO practice_visits VALUES(?,?,?,?,?,?,?,?,?,?,?)",params![id,window,q["id"].as_str(),q["version"].as_i64(),session,stamp,stamp,stamp,false,"active",0])?;
            insert(db,&format!("visit:{id}"),"practice_started",q["id"].as_str(),q["version"].as_i64(),session,&stamp,0,json!({"title":q["title"],"visit_id":id,"meaningful":false}))?;Ok(())})?;
        Ok(json!({"id":id,"active_seconds":0,"idle_cutoff_seconds":30,"heartbeat_seconds":15}))
    }
    pub fn heartbeat(
        &self,
        id: &str,
        focused: bool,
        interacted: bool,
        close: bool,
        at: DateTime<Utc>,
    ) -> Result<Value> {
        self.with_db(|db|{
            let (q,version,session,last_seen,last_input,was_focused,status,total):(String,i64,Option<String>,String,String,bool,String,i64)=db.query_row("SELECT question_id,version,session_id,last_seen,last_input,focused,status,active_seconds FROM practice_visits WHERE id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?)))?;
            if status!="active"{return Ok(json!({"id":id,"status":status,"active_seconds":total}));}
            let seen=timestamp(&last_seen)?;let input=timestamp(&last_input)?;
            let elapsed=(at-seen).num_seconds();
            // Credit only a continuous, recently engaged interval; gaps, background windows and restarts add zero.
            let credit=if was_focused&&(0..=30).contains(&elapsed){(at.min(input+Duration::seconds(30))-seen).num_seconds().max(0)}else{0};
            let input_at=if interacted&&focused{at.to_rfc3339()}else{last_input};
            db.execute("UPDATE practice_visits SET last_seen=?,last_input=?,focused=?,status=?,active_seconds=? WHERE id=?",params![at.to_rfc3339(),input_at,focused&&!close,if close{"closed"}else{"active"},total+credit,id])?;
            if credit>0{insert(db,&crate::id(),"active_time",Some(&q),Some(version),session.as_deref(),&at.min(input+Duration::seconds(30)).to_rfc3339(),credit,json!({"visit_id":id,"meaningful":false}))?;}
            Ok(json!({"id":id,"active_seconds":total+credit,"credited_seconds":credit,"status":if close{"closed"}else{"active"}}))
        })
    }
    pub fn activity_revision(&self) -> Result<i64> {
        self.with_db(|db| {
            Ok(db.query_row(
                "SELECT revision FROM activity_revision WHERE id=1",
                [],
                |r| r.get(0),
            )?)
        })
    }
    pub fn activity_rows(&self, since: DateTime<Utc>) -> Result<Vec<Value>> {
        self.with_db(|db|{
            let mut st=db.prepare("SELECT id,kind,question_id,session_id,occurred_at,active_seconds,payload FROM activity_events WHERE occurred_at>=? ORDER BY occurred_at DESC")?;
            let rows=st.query_map([since.to_rfc3339()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,String>(4)?,r.get::<_,i64>(5)?,r.get::<_,String>(6)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
            rows.into_iter().map(|(id,kind,q,session,at,seconds,data)|Ok(json!({"id":id,"kind":kind,"question_id":q,"session_id":session,"occurred_at":at,"active_seconds":seconds,"data":serde_json::from_str::<Value>(&data)?}))).collect()
        })
    }
    pub fn dashboard_totals(&self) -> Result<Value> {
        self.with_db(|db|{
        let solved:i64=db.query_row("SELECT COUNT(*) FROM activity_events WHERE kind='problem_solved'",[],|r|r.get(0))?;
        let seconds:i64=db.query_row("SELECT COALESCE(SUM(active_seconds),0) FROM activity_events",[],|r|r.get(0))?;
        let interviews:i64=db.query_row("SELECT COUNT(*) FROM interviews WHERE json_extract(payload,'$.state')='COMPLETE' AND COALESCE(json_extract(payload,'$.mode'),'interview')!='practice'",[],|r|r.get(0))?;
        Ok(json!({"questions_solved":solved,"practice_seconds":seconds,"mock_interviews_completed":interviews}))
    })
    }
    /// Content comparison prevents an autosave after Submit from inventing unfinished work.
    pub fn unfinished_drafts(&self) -> Result<Vec<Value>> {
        self.with_db(|db| {
            let mut st = db.prepare("SELECT d.question_id,d.version,d.files,d.answer,d.updated_at,q.package,(SELECT payload FROM attempts a WHERE a.question_id=d.question_id AND a.version=d.version ORDER BY created_at DESC LIMIT 1) FROM draft_versions d JOIN questions q ON q.id=d.question_id AND q.version=d.version LEFT JOIN question_flags f ON f.question_id=d.question_id WHERE COALESCE(f.archived,0)=0 ORDER BY d.updated_at DESC")?;
            let rows = st.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
            let mut drafts = vec![];
            for (id,version,files,answer,updated,package,last) in rows {
                let files:Value=serde_json::from_str(&files)?;
                let q:Value=serde_json::from_str(&package)?;
                if files == q["starter_files"] && answer.trim().is_empty() { continue; }
                if let Some(last)=last {
                    let a:Value=serde_json::from_str(&last)?;
                    if a["files"] == files && a["answer"].as_str().unwrap_or("") == answer { continue; }
                    if a["created_at"].as_str().is_some_and(|at|at >= updated.as_str()) { continue; }
                }
                drafts.push(json!({"question_id":id,"question_version":version,"updated_at":updated}));
            }
            Ok(drafts)
        })
    }
    pub fn unfinished_draft(&self) -> Result<Option<Value>> {
        Ok(self.unfinished_drafts()?.into_iter().next())
    }
}
impl Service {
    pub fn continuation(&self) -> Result<Value> {
        let mut active = self.active_session()?;
        let draft = self.store.unfinished_draft()?;
        let session_at = active["last_activity_at"]
            .as_str()
            .or_else(|| active["started_at"].as_str())
            .unwrap_or("");
        if draft
            .as_ref()
            .is_some_and(|d| d["updated_at"].as_str().unwrap_or("") > session_at)
        {
            active = Value::Null;
        }
        let roadmap = self
            .store
            .get("settings", "active_roadmap")
            .ok()
            .and_then(|s| s["roadmap_id"].as_str().map(str::to_string))
            .unwrap_or("complete-firmware-interview".into());
        let roadmap_title = self.roadmap(&roadmap)?["title"].clone();
        if !active.is_null() {
            let q = self.store.question(
                active["question_id"].as_str().unwrap(),
                active["question_version"].as_i64(),
            )?;
            return Ok(
                json!({"last_activity_at":active["last_activity_at"].as_str().or_else(||active["started_at"].as_str()),"kind":"session","label":"Resume","reason":"Your session and its persisted timer are ready to resume.","question":self.summary(&q)?,"session":active,"roadmap_id":roadmap,"roadmap_title":roadmap_title}),
            );
        }
        if let Some(d) = draft {
            let q = self.store.question(
                d["question_id"].as_str().unwrap(),
                d["question_version"].as_i64(),
            )?;
            return Ok(
                json!({"last_activity_at":d["updated_at"],"kind":"draft","label":"Resume","reason":"Reopen your last unfinished draft.","question":self.summary(&q)?,"session":null,"roadmap_id":roadmap,"roadmap_title":roadmap_title}),
            );
        }
        match self.next_question(&roadmap, &json!({})) {
            Ok(next) => Ok(
                json!({"kind":"question","label":if next["reason"]=="due_review"{"Review question"}else{"Continue practice"},"reason":if next["reason"]=="due_review"{"A question in this roadmap is due for review."}else{"Next in your preparation roadmap."},"question":next["question"],"session":null,"roadmap_id":roadmap,"roadmap_title":roadmap_title}),
            ),
            Err(_) => Ok(
                json!({"kind":"empty","label":"Open question library","reason":"Import a question to begin practicing.","question":null,"session":null,"roadmap_id":roadmap,"roadmap_title":roadmap_title}),
            ),
        }
    }
    pub fn dashboard_at(&self, timezone: &str, at: DateTime<Utc>) -> Result<Value> {
        let tz: Tz = timezone
            .parse()
            .context("Choose a valid IANA timezone, such as America/Toronto")?;
        let today = at.with_timezone(&tz).date_naive();
        let revision = self.store.activity_revision()?;
        let cached = self
            .dashboard_cache
            .lock()
            .unwrap()
            .get(timezone)
            .filter(|(r, d, _)| *r == revision && *d == today)
            .map(|(_, _, v)| v.clone());
        let mut result = if let Some(c) = cached {
            c
        } else {
            let first =
                today - Duration::days(51 * 7 + today.weekday().num_days_from_sunday() as i64);
            let mut days:BTreeMap<NaiveDate,Value>=(0..364).map(|i|{let date=first+Duration::days(i);(date,json!({"date":date.to_string(),"activity":0,"attempts":0,"solved":0,"active_seconds":0,"future":date>today}))}).collect();
            let rows = self.store.activity_rows(at - Duration::days(370))?;
            let mut active_dates = HashSet::new();
            for event in &rows {
                if let Some(date) = event["occurred_at"].as_str().and_then(|s| day(s, tz)) {
                    if let Some(v) = days.get_mut(&date) {
                        if event["data"]["meaningful"] == true {
                            v["activity"] = json!(v["activity"].as_i64().unwrap_or(0) + 1);
                            active_dates.insert(date);
                        }
                        if event["kind"] == "solution_submitted"
                            && event["data"]["result"].is_string()
                        {
                            v["attempts"] = json!(v["attempts"].as_u64().unwrap_or(0) + 1);
                        }
                        if event["kind"] == "problem_solved" {
                            v["solved"] = json!(v["solved"].as_i64().unwrap_or(0) + 1);
                        }
                    }
                    if event["active_seconds"].as_i64().unwrap_or(0) > 0 {
                        add_time(
                            &mut days,
                            timestamp(event["occurred_at"].as_str().unwrap())?,
                            event["active_seconds"].as_i64().unwrap(),
                            tz,
                        );
                        active_dates.insert(date);
                    }
                }
            }
            let mut streak = 0;
            let mut cursor = if active_dates.contains(&today) {
                today
            } else {
                today - Duration::days(1)
            };
            while active_dates.contains(&cursor) {
                streak += 1;
                cursor -= Duration::days(1);
            }
            let mut totals = self.store.dashboard_totals()?;
            totals["current_streak"] = json!(streak);
            let progress = self.compact_progress()?;
            let mut recent: Vec<Value> = rows
                .iter()
                .filter(|e| e["data"]["meaningful"] == true || e["kind"] == "problem_solved")
                .take(8)
                .cloned()
                .collect();
            for e in &mut recent {
                if let Some(id) = e["question_id"].as_str() {
                    if let Ok(q) = self.store.question(id, None) {
                        e["title"] = q["title"].clone();
                    }
                }
            }
            let result = json!({"timezone":timezone,"today":today.to_string(),"range_start":first.to_string(),"days":days.into_values().collect::<Vec<_>>(),"metrics":totals,"roadmaps":self.roadmaps()?,"recent_activity":recent,"due_reviews":progress["due_reviews"],"tracking":{"available":true,"idle_cutoff_seconds":30,"basis":"Focused practice with recent input; idle gaps and interview wall time are excluded."}});
            let mut cache = self.dashboard_cache.lock().unwrap();
            if cache.len() >= 8 {
                cache.clear();
            }
            cache.insert(timezone.into(), (revision, today, result.clone()));
            result
        };
        result["continuation"] = self.continuation()?;
        let progress = self.compact_progress()?;
        result["recommendations"] =
            json!({"weak_topics":progress["weak_topics"],"goals":progress["goals"]});
        result["metrics"]["completed_questions"] =
            progress["summary"]["completed_questions"].clone();
        result["metrics"]["attempts"] = progress["summary"]["attempts"].clone();
        result["generated_at"] = json!(at.to_rfc3339());
        Ok(result)
    }
    pub fn activity_day(&self, date: &str, timezone: &str) -> Result<Value> {
        let tz: Tz = timezone.parse().context("Invalid IANA timezone")?;
        let target = NaiveDate::parse_from_str(date, "%Y-%m-%d")?;
        let since =
            Utc.from_utc_datetime(&target.and_hms_opt(0, 0, 0).unwrap()) - Duration::days(2);
        let rows = self.store.activity_rows(since)?;
        let mut events = vec![];
        for mut event in rows {
            if event["occurred_at"].as_str().and_then(|s| day(s, tz)) == Some(target)
                && event["kind"] != "active_time"
            {
                if let Some(id) = event["question_id"].as_str() {
                    if let Ok(q) = self.store.question(id, None) {
                        event["title"] = q["title"].clone();
                    }
                }
                events.push(event);
            }
        }
        Ok(json!({"date":date,"timezone":timezone,"events":events}))
    }
}
