# Practice redesign verification — 0.3.9

## Changes and rationale

Practice now fills its available viewport. The problem, editor and execution output scroll independently, while checkpoint and primary actions remain reachable. A content width below 900px uses Problem / Workspace tabs; short coding workspaces use Editor / Results views. The saved problem split remains 36% by default. Other pages retain document scrolling.

Theory, Design and written Investigation use individually editable sections. Existing flat answers enter the first section unchanged. Design Architecture has Notes / Diagram views, with an architecture graph and an accessible component/connection list. Executable debugging questions retain their existing source files, compiler tests and completion rules; the written Investigation browser fixture exercises the separate code-review response mode.

Structured work follows autosave, recovery, checkpoints, exports, immutable submissions and interview replay. SQLite migration 6 adds a companion table without replacing existing draft columns. Both stores reject future database versions and incompatible legacy answer replacements. Diagram-only position changes also count as unfinished changes. Compact Dashboard/Progress lists exclude the full structured payload.

Dictation and cleanup target the original section. Sections stay locked until recording finishes. Confidence remains directly accessible; optional reflection lives under Self-assessment. Coaching uses the existing OpenRouter configuration and bounded notes/diagram context. No grading, metric or completion definitions were added.

## Local checks

- Frontend: 61 passing component/unit tests; TypeScript and production Vite build pass.
- Native: 44 passing Rust tests; formatting and Clippy with warnings denied pass.
- Python: 76 passing tests with the real Docker compiler runner required.
- Browser: 24 passing tests using a disposable native-service workspace and real Docker execution. Coverage includes date boundaries, library filter retention, all four workspace modes, independent scrolling, checkpoint restore, section targeting, canvas pointer/keyboard editing, resizing, failed autosaves, explicit local recovery, submitted diagram review and restricted interview replay.
- Official MCP SDK interoperability passes: discovery, draft round trips, stale-write rejection, permissions, service restart and persistence.
- Frontend dependency audit reports zero vulnerabilities. Release consistency, publication guard and whitespace checks pass.

Browser geometry checks cover 1440×900, 1280×720, 1024×600 and 390×844 in both themes, including visible Save, Run/Submit and recording controls, and no document overflow. Screenshot review includes desktop coding, phone Theory, desktop/phone diagrams and embedded interview layouts. Browser evidence is generated under ignored `frontend/test-results` and retained by CI on failure.

The production Mac bundle was built, ad-hoc signed, verified with `codesign --verify --deep --strict`, and installed at `/Applications/ForgePad.app`. The installed app reports 0.3.9 and was inspected with an existing written answer intact. A database backup was taken before migration. The installed database reports schema 6, passes its integrity check, and retains its attempt, draft and draft-version counts. Older matching ForgePad bundles were moved to Trash; personal drafts, progress, recordings and models remain in the existing data directory.

## Limits of this verification

Microphone/recognition events use deterministic fixtures for section locking and final transcript delivery. These checks do not establish real microphone accuracy or latency. No billed OpenRouter request was needed; existing provider-routing tests and local cleanup flows remain in place. Supabase compatibility is covered through store protocol tests rather than a live cloud workspace.

The canvas supports architecture components and directed connections, with limits of 100 components and 200 connections. Oversized structured work is rejected with an error, without truncation. Freehand drawing, collaboration and AI-generated diagrams remain outside this release.

React Flow integration follows its [keyboard accessibility guidance](https://reactflow.dev/learn/advanced-use/accessibility) and [save/restore example](https://reactflow.dev/examples/interaction/save-and-restore), while persisted nodes and connections use ForgePad-owned data rather than runtime library objects.
