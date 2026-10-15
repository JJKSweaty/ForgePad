# ForgePad dashboard and interface review

Design reference: [supplied apple-design skill](apple-design.md), read in full before UI changes. No Woven image was attached, so the written direction guided the layout.

## Audit and implementation

The previous overview emphasized question totals and repeated cards rather than the user's next action. Navigation mixed authoring and practice; large library rows, very tall conversation panels, inconsistent secondary labels, and flat roadmap lists made routine work slower. The editor and history logic were retained.

The new dashboard leads with service-selected continuation, followed by one four-column metric strip, a lightweight 52-week calendar, two primary roadmap summaries, and compact activity/review lists. System type, neutral surfaces, one green accent, shared spacing and control tokens replace scattered visual choices. Radix primitives provide the command dialog and anchored day popover; no chart framework was added. Secondary pages and Monaco load lazily.

Continuation rechecks the native service when pressed: active persisted session, unfinished version-pinned draft, then the active roadmap's next required exercise or review. Navigation and interview workspace changes wait for draft saves. Final autosaves remain version-pinned after a session ends without reopening its execution. Native interview state changes are pushed, with a one-shot timer expiry check instead of periodic polling. A draggable separator supports arrow keys and remembers pane width; the editor also resizes vertically. Roadmap topics form connected groups with suggested, nonblocking prerequisites. Questions remain canonical across paths.

The same SQLite service records submissions, first successful solves, completed interviews, public test runs and bounded practice visits. Practice time requires a focused window and recent input; 30-second idle gaps, background time and discontinuities are excluded. UTC intervals split at the configured IANA timezone's midnight, including daylight-saving transitions. Aggregate projections are cached by database revision and local date, with indexed time-range reads. Historical unique solves remain solved counts even when a later attempt needs review. Mastery additionally requires the latest attempt to pass and passing evidence on two UTC dates; theory self-review is separate.

GitHub is optional and read-only: fixed official account/GraphQL endpoints, macOS Keychain credential storage, cached calendar counts, identity, last-sync time, manual refresh and retained offline cache. It never publishes solutions or converts ForgePad practice into GitHub contributions. API references: [GraphQL user contribution collection](https://docs.github.com/en/graphql/reference/objects#user), [REST token authentication](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api).

## Rendered review and iteration

The packaged Tauri application was opened through computer-use controls. A separate `ForgePad QA.app` used `/tmp/forgepad-ui-review`, preserving the user's open authoring draft and production workspace. This is disposable development data, never production analytics.

Live screenshots were inspected for Dashboard (empty and populated), Roadmaps, Practice/Monaco, Question Library, Mock Interview (setup and active session), Progress and Settings/HeyClicky. Captures are present in the task's computer-use outputs; standalone PNG files were not exported by the available capture interface.

The first rendered pass prompted concrete changes:

- Library rows changed from approximately 150px stacked entries to compact aligned rows.
- Interview transcript height now adapts to viewport height, keeping response controls nearer the visible workspace.
- Roadmap progress meters gained explicit width inside selection buttons.
- Grouped roadmap questions use neutral pending markers instead of out-of-order global numbers.
- Hover and selection treatments were separated; small operational labels were increased where needed.

The date-detail data and click behavior were verified in accessibility output and UI tests. A native screenshot capture did not reliably paint the floating overlay after accessibility-driven activation; independent browser capture was unavailable. Its final native visual placement remains a manual acceptance check.

## Verification

- TypeScript and production Vite build pass. Monaco is a separate lazy chunk; its large bundle does not load on the dashboard.
- Seven frontend tests cover dataset separation, five intensity levels, 364 dates, year/month boundaries, roving keyboard focus, future dates, disconnected/unsynchronized GitHub, matching date records, and separator keyboard controls.
- Rust core/security/dashboard tests cover zero data, repeated solves, timer/draft continuation, question revisions, cache invalidation/restart, focus/idle discontinuities, midnight and both DST changes. A partial idle interval crossing midnight has its own regression test.
- Python backend tests pass, including the browser dashboard's real draft continuation and unique-solve semantics. Browser practice-time tracking is explicitly unavailable rather than inferred.
- [Real native/Docker verification](../dashboard-verification.json): preflight compilation, two complete eight-test submissions, one unique solve, shared roadmap updates and matching local-day events. Packaged release run: first submission 4.19s; cached submission 2.16s; two dashboard reads 5.65ms. These are observations, not universal latency guarantees.
- [Official MCP SDK interoperability](../native-verification.json): initialization, discovery, same-store changes, strict session boundaries, revocation/reconnect, restart persistence and closed-service errors.
- Full-repository Ruff still reports pre-existing issues in hosting/publication helper files; changed dashboard and worker Python files pass targeted lint. Desktop Rust Clippy passes with warnings denied. The optimized macOS bundle is 47.83 MiB. Local ad-hoc signing is verified separately from Apple notarization. Only the isolated PyInstaller worker has the library-validation exception needed to load its extracted Python runtime; the Rust app and MCP connector keep hardened-runtime signing without that exception.

## Remaining external acceptance

No local inference or ASR model was configured, so actual model TTFT, throughput, memory-pressure scheduling, transcription accuracy and continuous speech responsiveness are unverified. Speech currently records bounded push-to-talk audio for a compatible local transcription endpoint; it is not a measured streaming ASR implementation.

An authenticated GitHub account was unavailable; account authorization, live contribution synchronization and offline recovery need acceptance with the user's credential. The local parser and disconnected behavior are tested.

HeyClicky's installed Settings window returned a blank/1px surface in this environment. The real compiled MCP connector passes official SDK tests, but an actual HeyClicky UI tool call is not claimed. The app distinguishes local self-test from an externally confirmed call.

Solution publishing is deliberately absent from the UI. Native model downloads/process lifecycle management, notarized distribution, and device-specific performance certification are not implemented by this change.
