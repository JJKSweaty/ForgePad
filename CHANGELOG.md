# ForgePad release notes

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
- Compiler connection selection and missing VM file sharing for the installed app.
- Draft navigation and written interview response persistence.
- The native speech build error that blocked GitHub verification.
- Outdated test dependencies with published security advisories.

### Requirements
- Apple Silicon Mac running macOS 14 or later.
- Docker Desktop, or Docker with Colima, for C/C++ execution. The first runner setup needs internet access.
- Local speech models are downloaded separately in Settings. AI coaching is optional.
