"""Apply reviewed migrations using environment data piped from Vercel, without logging secrets."""

import hashlib
import io
import os
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
PROJECT_REF = "qslpggyytqlgxphmrfeh"


def main():
    values = {key: value for key, value in dotenv_values(stream=io.StringIO(sys.stdin.read())).items() if value is not None}
    url = values.get("SUPABASE_URL", values.get("NEXT_PUBLIC_SUPABASE_URL", ""))
    if urlsplit(url).hostname != f"{PROJECT_REF}.supabase.co":
        raise RuntimeError("Environment does not match the approved ForgePad Supabase project")
    candidates = []
    for key in ("POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"):
        if not values.get(key):
            continue
        parsed = urlsplit(values[key])
        if PROJECT_REF not in (parsed.hostname or "") and PROJECT_REF not in (parsed.username or ""):
            continue
        options = dict(parse_qsl(parsed.query))
        # Marketplace URLs also carry provider tracking/ORM options (e.g. supa)
        # that libpq rejects. Keep only connection options needed by PostgreSQL.
        options = {key: value for key, value in options.items() if key in {"sslmode", "options", "application_name"}}
        candidates.append(urlunsplit(parsed._replace(query=urlencode(options))))
    if not candidates:
        raise RuntimeError("No approved PostgreSQL connection was provisioned; available variable names: " + ", ".join(sorted(values)))
    connection = None
    print("Connecting to ForgePad PostgreSQL...", flush=True)
    for candidate in dict.fromkeys(candidates):
        try:
            connection = psycopg.connect(candidate, connect_timeout=15, sslmode="require")
            break
        except psycopg.OperationalError:
            continue
    if connection is None:
        raise RuntimeError("The provisioned PostgreSQL endpoints are not reachable; no migration was applied")
    with connection:
        print("Connected; applying schema transaction.", flush=True)
        connection.execute("select pg_advisory_xact_lock(hashtext('forgepad-migrations'))")
        connection.execute("""create table if not exists public.forgepad_migrations (
            name text primary key, checksum text not null, applied_at timestamptz not null default now())""")
        connection.execute("alter table public.forgepad_migrations enable row level security")
        connection.execute("revoke all on public.forgepad_migrations from public, anon, authenticated")
        connection.execute("grant all on public.forgepad_migrations to service_role")
        for path in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            sql = path.read_text()
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            existing = connection.execute("select checksum from public.forgepad_migrations where name=%s", (path.name,)).fetchone()
            if existing:
                if existing[0] != checksum:
                    raise RuntimeError("An applied migration has changed; refusing to modify it")
                print(f"Already applied: {path.name}", flush=True)
                continue
            connection.execute(sql)
            connection.execute("insert into public.forgepad_migrations(name,checksum) values(%s,%s)", (path.name, checksum))
            print(f"Applied: {path.name}", flush=True)
        protected = connection.execute("""select relname,relrowsecurity from pg_class
            where oid in ('public.forgepad_questions'::regclass,'public.forgepad_solutions'::regclass,
                          'public.forgepad_records'::regclass)""").fetchall()
        if len(protected) != 3 or not all(row[1] for row in protected):
            raise RuntimeError("Row-level security verification failed")
        connection.execute("NOTIFY pgrst, 'reload schema'")
    print("Database migration committed; row-level security verified.", flush=True)
    os.environ.update(values)
    os.environ["SUPABASE_URL"] = url
    sys.path.insert(0, str(ROOT / "backend"))
    from forgepad.supabase_store import SupabaseStore
    store = SupabaseStore()
    for attempt in range(4):
        try:
            store.seed(ROOT / "questions")
            break
        except RuntimeError as error:
            if "(404)" not in str(error) or attempt == 3:
                raise
            time.sleep(attempt + 1)
    print(f"Seeded and read back {len(store.questions())} question packages.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Connection exceptions can contain credentials; only our controlled errors are printed.
        message = str(error) if type(error) is RuntimeError else f"Setup failed ({type(error).__name__}, SQLSTATE={getattr(error, 'sqlstate', None)}); credentials withheld."
        print(message, file=sys.stderr)
        sys.exit(1)
