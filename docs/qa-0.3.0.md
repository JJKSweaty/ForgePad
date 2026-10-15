# ForgePad 0.3.0 QA

Verified on an Apple Silicon Mac on 2026-10-15. All generated questions, reference submissions, interview transcripts, and progress checks use disposable workspaces.

| Area | Evidence |
| --- | --- |
| API, storage, compiler and recovery | 55 Python tests passed with Docker required; four additional release guard tests passed. |
| Native core | 33 Rust tests passed; formatting and Clippy passed. |
| Frontend | 18 React/keyboard/dictation tests passed; TypeScript production build passed; npm audit found no frontend advisories. |
| Browser flows | Real code edit → Docker submission → persisted dashboard; written design response → save → reopen; guided interview → pause/resume → response → finish → replay. All three passed. |
| MCP | Official SDK initialized, discovered all 25 tools, and verified draft conflicts, session controls, privacy, revocation, and restart persistence. |
| Ultra speech | Downloaded model; synthetic 10-second technical answer transcribed through the native API. All expected technical words were retained. Partial and final requests returned the same text; measured 328 ms and 166 ms on this Mac. Audio retention remained disabled. These timings do not include microphone capture or the UI's preview window. |
| Distribution | DMG checksum verified; app ZIP extracted and passed deep strict codesign verification. Canonical installed app is `/Applications/ForgePad.app`, version 0.3.0. |
| Visual review | Installed light and dark themes, dashboard, coding editor, and native compiler controls checked. Palette uses blue/violet accents. |

The compiler runs only inside Docker. A host compiler fallback is not used. The runner's readiness check includes a real compile and execution. ForgePad can restart its own stopped Colima profile; other profiles and Docker's global context are left alone.

The release workflow is the authoritative CI record: [Verify](https://github.com/JJKSweaty/ForgePad/actions/workflows/verify.yml). Publication waits for Linux application/browser checks and Mac packaging checks to pass. An older, superseded commit cannot publish over the latest one.

## Remaining hardware and external-service checks

- Actual microphone permission prompts, varied real voices, background noise, and capture cancellation need hands-on acceptance testing. Synthetic audio success is not a claim of general transcription accuracy.
- No Ollama server was running during this pass. Local coach context/privacy and unavailable-provider behavior are covered by tests; real model answer quality was not assessed.
- HeyClicky's own client UI and account-level permissions are separate from the verified MCP tool permissions.
- Downloaded builds are ad-hoc signed until Apple Developer ID/notarization secrets are configured. Release notes explicitly identify this limitation.

Repeat synthetic voice QA with `.venv/bin/python scripts/verify_speech.py` after installing Ultra and building the native service/helper. It writes its report under `/tmp` and does not access the microphone.
