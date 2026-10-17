# ForgePad release notes

## 0.3.8 — 2026-10-17

### Fixed
- Practice coaching now honors the enabled OpenRouter key and model used by interviews, with accurate provider labels and no silent local fallback after cloud errors.

### Improved
- Use the full Dashboard width for activity, keep the sidebar toggle in a stable upper-left location, and share OpenRouter settings with the practice reasoning coach.

## 0.3.7 — 2026-10-17

### Improved
- Make question progress unmistakable with status icons, badges, and row accents; improve spacing across Library, Dashboard, Progress, and Roadmaps.

### Fixed
- Stop daily activity dates inheriting column-header formatting; align counts and keep the table at a readable width.
- Contain narrow-screen attempt history scrolling and keep question titles, status cues, and actions readable as layouts resize.

## 0.3.6 — 2026-10-17

### Improved
- Show live transcripts while speaking and capture quieter voice answers with a short lead-in, faster previews, and microphone level feedback.

### Fixed
- Preserve quiet word onsets and short pauses during dictation, and keep the newest live preview when the local model is busy.

## 0.3.5 — 2026-10-17

### Improved
- Prioritize next actions and learning-path progress above a compact activity calendar, with keyboard guidance and a numerical daily-count view.
- Clarify all-time attempt and completion totals, current reviews due, and unavailable duration metrics.

### Fixed
- Make inactive date filtering explicit with All dates, and keep inclusive Since dates and displayed timestamps in the profile timezone.
- Preserve Question Library filters during navigation and keep active filters visible when no questions match.

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
