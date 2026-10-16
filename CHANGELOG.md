# ForgePad release notes

## 0.3.4 — 2026-10-16

### Improved
- Restore colorful C/C++ syntax and make every test visible, with a shared authoring contract for complete reference/starter code and justified edge-case coverage.

### Fixed
- Run and Submit execute the same complete suite; Submit records an attempt. Legacy test labels no longer hide cases or diagnostics.
- New executable questions require 8–30 distinct visible cases, at least two normal and three boundary cases; duplicate stimuli and hidden cases are rejected.
- HeyClicky can retrieve the shared schema and full authoring contract through `forgepad_get_authoring_prompt`.

## 0.3.3 — 2026-10-16

### Improved
- Connect Dashboard, Question Library, and Progress with persisted learning states, compact controls, versioned retries, and review history.

### Fixed
- Keep submitted code, question versions, completion totals, review evidence, and resumable drafts consistent across the three learning pages.
- Restore older-version drafts and submit retries against their original version in both native and browser workspaces.
- Move confirmed practice-data deletion to Settings → Data Management; preserve published questions.

## 0.3.2 — 2026-10-16

### Improved
- Neutral light and dark themes, a clearer question-to-workspace practice flow, visible autocomplete guidance, and an upper-left sidebar control.

### Fixed
- Browser CI starts the compiler worker with the test server's Python interpreter, including on hosted runners without a local virtual environment.
- Local desktop installation verifies the new signed app before replacing the installed build and moves older ForgePad copies to Trash.

## 0.3.1 — 2026-10-16

### Improved
- A more comfortable coding workspace with local C/C++ autocomplete, remembered resizable panels and a hideable sidebar, explicit autosave and checkpoint controls, and line-linked compiler diagnostics.

## 0.3.0 — 2026-10-15

### Added
- Dedicated workspaces for coding, system design, theory, and debugging questions.
- An optional local reasoning coach in Hints and editable live Parakeet dictation.
- One-button compiler setup and repair, automatic reconnection, and recovery of ForgePad's own compiler VM.
- Browser tests covering real compiler submissions, saved written answers, interview controls, and replay.
- Checked Mac downloads, checksums, and automatic releases after the verification workflow passes.

### Improved
- A blue and violet palette, a brighter light theme, matching code editor colors, and a new app icon.
- Cleaner progress panels, fewer explanatory captions, and simpler runner settings.
- HeyClicky can work with drafts, question workspaces, and interview controls through the local connector.

### Fixed
- Compiler connection selection, missing VM file sharing, and command lookup that could request unrelated Desktop permissions.
- Draft navigation and written interview response persistence.
- The native speech build error that blocked GitHub verification.
- Outdated test dependencies with published security advisories.

### Requirements
- Apple Silicon Mac running macOS 14 or later.
- Docker Desktop, or Docker with Colima, for C/C++ execution. The first runner setup needs internet access.
- Local speech models are downloaded separately in Settings. AI coaching is optional.
