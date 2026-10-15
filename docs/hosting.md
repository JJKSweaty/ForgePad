# ForgePad hosting

The hosted application uses the existing React frontend and FastAPI backend on Vercel, Supabase PostgreSQL through its server-only REST API, and disposable Vercel Sandbox VMs for C11/C++17 execution. It does not depend on the developer laptop remaining awake.

## Current project

- Vercel team: `jonathan-s-projects-337522df`
- Vercel project: `prj_JWvABadS8rjH3VlTB1vvvFdpWx8J` (`forgepad`)
- Assigned stable URL: `https://forgepad-plum.vercel.app`
- Vercel Authentication is configured for all deployments. Keep this owner workspace private: the current database adapter stores one workspace, and is not a multi-user authorization implementation.

Supabase must be connected and configured before the workspace can load. Until then, the hosted API returns an explicit 503 setup message instead of storing data in an ephemeral filesystem.

## Database setup

1. Select or create the intended Supabase project through its connected MCP.
2. Apply `supabase/migrations/202610150001_forgepad.sql` once.
3. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel's production and preview server environments. Never use a `VITE_` variable for the service role key.
4. Redeploy and verify that drafts, attempts, interviews, and replay events survive another deployment.

All three tables have RLS enabled and deny anonymous and authenticated browser roles. The service role key stays in the Python API. Reference implementations and solution explanations are in `forgepad_solutions`; candidate views remove both solutions and hidden test bodies. Import publication is transactional and consumes the validation token once. Interview updates use optimistic revisions to reject conflicting writes.

The hosted seed import is idempotent and does not replace existing versions. Existing local SQLite data remains local; export and review it before arranging any separate migration.

## Runtime settings

The API also needs `FORGEPAD_HOST`, `FORGEPAD_RUNNER_URL`, and a random server-only `FORGEPAD_RUNNER_SECRET`. The runner URL uses the exact deployment's `VERCEL_URL` at runtime so a deployment calls its matching compiler function. Vercel OIDC authenticates the Sandbox SDK; same-project trusted OIDC headers authenticate internal calls through deployment protection.

`scripts/configure_vercel.py` accepts the allowlisted environment values through hidden stdin and passes them to the CLI through stdin. It never writes credentials to files or command arguments. The `.vercel` directory, local databases, environment files, and dependency directories are excluded from source uploads.

## Code execution

Each run creates a nonpersistent VM with a 260-second lifetime and stops it in `finally`. Toolchain setup completes before submitted sources are written, then outbound networking is denied. Compiler and executable children run as UID/GID 65534 with no-new-privileges, bounded CPU time, file sizes, process counts, and output. Runtime address space is limited to 256 MiB without sanitizers; sanitizer shadow memory uses the VM memory limit instead.

Hidden inputs and expected outputs live in a private mode-0600 request file that the submitted process cannot read. Candidate units compile before hidden fixture sources are written. Fixture source is deleted before execution; prior test directories are inaccessible. The supervisor compares output outside the submitted process and redacts hidden diagnostics and outputs.

Cloud runs complete in the HTTP request so serverless shutdown cannot lose a background worker. Cloud cancellation after dispatch is not supported. The service must pass real compiler verification before being reported ready; host unit tests do not verify VM isolation or compiler installation.

`scripts/verify_cloud_runner.py` accepts a deployment URL and runner secret through hidden stdin, runs the original UART reference against all nine fixtures, and verifies that the broken starter fails. This is separate from `pytest` protocol tests.

Cloud verification on October 15, 2026: UART reference 9/9 passed; intentionally broken starter 4/9 passed and received `wrong_answer`. Local protocol/storage/API checks: 29 passed, 15 Docker integration tests skipped because Docker was unavailable. Supabase remains unconnected, so live database persistence has not been verified.

Vercel and Supabase plan limits, sleep policies, and service availability still apply. Local Ollama and local speech services do not become cloud services automatically; hosted guided interviews and typed responses do not require either.

## Deploy

Use the already selected project explicitly:

```sh
vercel deploy --project prj_JWvABadS8rjH3VlTB1vvvFdpWx8J --scope jonathan-s-projects-337522df --prod
```

Inspect the resulting build and verify the API before calling it operational. Production hosting is configured, but Git-triggered automatic deployment has not been connected.
