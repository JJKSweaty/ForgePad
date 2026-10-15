# ForgePad architecture

Hosted deployments preserve this application and use Supabase plus Vercel Sandbox instead of local SQLite and Docker. See [hosting.md](hosting.md) for the deployment boundary, required server settings, privacy model, and current setup status.

ForgePad is a local modular monolith: React/TypeScript and Monaco, a FastAPI API, SQLite in WAL mode, and disposable Docker workers. The backend binds to loopback. The browser uses the same-origin `/api` route through Vite in development. Runtime data lives in ignored `data/`; credentials belong only in server environment variables.

The runner is the only component allowed to execute submitted code. It must fail closed if Docker is unavailable. Compiler results determine correctness; interview dialogue never changes a test result. Authoring exports contain reference solutions and hidden tests; practice responses exclude both. Historical attempts retain the question version and submitted source.

Initial delivery prioritizes the complete edit → save → run → submit → review loop, validated question imports, and persistent timed interviews usable without inference. Optional local AI and speech adapters must report unavailable capabilities honestly.

## Shared implementation contract

Question package (schema version `1.0`): `id`, `version` integer, `title`, `description`, `type` (`coding`, `theory`, `debugging`, `design`, `code_review`), `difficulty` (`beginner`, `intermediate`, `advanced`, `expert`), `topics` string[], `duration_minutes`, `language` (`c`, `cpp`, `independent`), `prompt`, `constraints` string[], `starter_files` mapping path→text, optional `test_config`, `reference_solution` mapping path→text, `rubric` string[], `follow_ups` string[], `hints` string[], `source` {`name`, `url`, `license`}.

`test_config`: `mode` (`stdio` or `fixture`), `compiler` (`gcc` or `clang`), `sanitizers` boolean, `timeout_seconds` (1–5), `tests`: [{`id`, `name`, `visibility`: `public`/`hidden`, `stdin`, `expected_stdout`, optional `fixture` (a C/C++ main file), `category`: `normal`/`boundary`/`negative`}]. Fixture tests compile source files with the provided main; stdio tests compile the user's main. Fixtures are explicit and support buffers, mutable outputs, and peripheral doubles without opaque generated assertions. Flat safe filenames only in v1.

All endpoints below are under `/api`. Responses are JSON. Error bodies contain actionable `detail`.

- `GET /health`: {status, runner:{available,detail}, ai:{available,...}, speech:{available,...}}
- `GET /questions?q=&type=&difficulty=&topic=` → question summary array, including `bookmarked`, `archived`, `completion_status`.
- `GET /questions/{id}` → practice-safe question (no reference solution or hidden test data).
- `PATCH /questions/{id}` {bookmarked?, archived?} → summary.
- `GET /questions/{id}/export` → full authoring package.
- `GET /questions/export/all` → full package array.
- `POST /imports/validate` {question: package} → {valid, errors:string[], question?:practice-safe, token?:string, validation?:runner result}. Validation compiles reference code and checks every test; publish requires successful validation.
- `POST /imports/publish` {token} → created question. Duplicate ID+version rejected; higher versions preserve history.
- `GET /schema` → JSON Schema; `POST /generator-prompt` {idea} → {prompt}.
- `GET /drafts/{question_id}` → {files, answer, updated_at} or defaults.
- `PUT /drafts/{question_id}` {files, answer?} → saved draft.
- `POST /runs` {question_id, files, mode:`run`/`submit`} → {id,status:`queued`}. `GET /runs/{id}` → {id,status:`queued`/`running`/`complete`/`cancelled`,result?:{status,tests:[{id,name,visibility,status,stdout,stderr,expected_stdout?,elapsed_ms}],compiler_output,passed,total,elapsed_ms},attempt_id?}. `DELETE /runs/{id}` cancels.
- `POST /attempts` {question_id, answer, confidence:`confident`/`partial`/`uncertain`, reflection?} → saved theory attempt.
- `GET /progress` → {attempts:[],due_reviews:[],weak_topics:[],goals:[],summary:{...}}. `POST /goals` {title} → goal; `PATCH /goals/{id}` {status}.
- `POST /interviews` {question_id?,duration_minutes,kind:`coding`/`theory`/`mixed`/`design`,personality:`neutral`/`supportive`/`challenging`} → session.
- `GET /interviews/{id}` → session; `POST /interviews/{id}/events` {type:`message`/`advance`/`pause`/`resume`/`finish`,content?} → session. Session has id, question_id, state, duration_minutes, started_at, remaining_seconds, paused, transcript:[{role,content,created_at}], follow_up_index, report?. States INTRODUCTION→QUESTION→CLARIFICATION→SOLVING→FOLLOW_UP→REVIEW→COMPLETE.
- `GET /interviews` → sessions array. `GET /context` → compact progress context. `GET /data/export` → all local user data; `DELETE /data` resets user records only.
- `POST /speech/transcribe` multipart audio → {text,confidence?}, unavailable returns 503. `POST /commands` {text} → deterministic recognized intent or unknown.

Runner module interface (backend/forgepad/runner.py): `DockerRunner().availability() -> dict`; `run(question: dict, files: dict[str,str], include_hidden: bool = False, cancel_event: threading.Event | None = None) -> dict`. Thread-safe, bounded concurrency owned by API queue. Return result statuses: passed, wrong_answer, compilation_error, runtime_error, timeout, memory_limit, sanitizer_failure, unavailable, cancelled, unsupported. Never expose hidden stdin/expected output/fixture, including compiler output, in practice responses.

## Verification boundaries

Host-side tests cover schema, storage, API privacy, and interview transitions. Docker integration tests cover compilation, correct and incorrect submissions, cancellation, time limits, and import reference validation. Host unit tests cannot establish MCU timing, ISR atomicity, or memory ordering.
