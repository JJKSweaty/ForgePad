# Live voice-answer improvements

## Changes grounded in the capture path

`VoiceInput` already called `startDictation` for written practice answers and interview responses. The old capture path used an RMS onset threshold of 0.012, dropped audio before detection, and requested previews only after 2.5 seconds. These changes keep the configured local model and API:

- Request microphone automatic gain control in addition to the existing noise suppression and echo cancellation. Browser/device support determines whether gain control is applied.
- Admit quieter speech with a 0.005 onset threshold and 0.003 continuation threshold. Keep up to 300 ms before onset and allow a 900 ms pause before finalization. The 12-second rolling window, overlap handling, and bounded final queue remain.
- Request replaceable previews every 800 ms of captured audio. While inference is busy, retain only the newest pending preview; complete phrases still take priority and stay ordered. Responses from a finalized or disposed segment cannot replace its text.
- Display an explicitly labeled Live transcript panel and microphone level, bring it into view on capture start, and explain that provisional wording may change. Completed phrases still append to the editable answer once. Users continue to submit/send manually.
- Dispose a pending capture if its input becomes disabled while microphone startup is awaiting permission.

## Evidence

- 52 frontend tests passed, including quiet onset retention, silence-only rejection, text before a pause, short pauses, queued preview replacement, ordered final insertion, Stop during inference, navigation cleanup, microphone permissions, and the live transcript UI.
- Two Playwright flows passed for theory and design practice: provisional text appears in the viewport while speaking, updates in place, and final text appends once to existing notes; submission stays disabled during capture and remains manual afterward. These use deterministic PCM and ASR fixtures, not a physical microphone.
- The production TypeScript/Vite build and four release-metadata tests passed. The existing large Monaco chunk warning remains.
- `scripts/verify_speech.py` passed against the installed real Parakeet Ultra model and native API using synthetic technical speech. Partial/final requests retained interrupt, bounded ring buffer, memory barrier, ready flag, and queue wording; raw audio retention stayed off. Measured request times on this Mac were 470 ms and 163 ms, excluding microphone capture and the preview interval.

These checks establish capture and live-preview behavior, not a measured improvement in recognition accuracy across accents, microphones, or background noise. No model weights, language selection, or automatic transcript rewriting changed. Actual microphone quality still needs a representative spoken answer on the user's device.
