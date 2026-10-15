# Local inference and speech

The application works without models. Deterministic interview prompts, written responses, compiler tests, history, and reviews remain available. Model-generated comments never change a test verdict.

## Ollama

Install [Ollama](https://docs.ollama.com/quickstart) using its platform instructions and pull a model supported by your hardware. Configure the backend environment with the exact installed model name:

```sh
export FORGEPAD_OLLAMA_MODEL=your-installed-model
export FORGEPAD_OLLAMA_URL=http://127.0.0.1:11434
```

The adapter checks `/api/tags` and uses `/api/chat`. It sends the current interview state, public problem constraints, approved follow-ups, and a bounded recent transcript. It does not send reference implementations or hidden tests. Endpoint overrides must use loopback HTTP, without credentials or redirects to an external provider. The backend does not install or download models automatically.

## Speech

On macOS desktop, Settings → Interview & AI provides built-in Parakeet Ultra, V3, and English downloads via the pinned FluidAudio helper. Enable Voice answers, then press Speak your answer in a question workspace, Hints, or an interview. Microphone consent is requested only after that action. Live previews update about every 2.5 seconds when the engine keeps up; pauses finalize phrases. Continuous speech uses bounded overlapping windows. Capture stops after five minutes or when you leave the workspace. The service serializes transcription requests, reuses CoreML, and releases the helper after idle time. No latency or accuracy guarantee is implied.

Clean up transcript uses only the configured local language model. It proposes punctuation, filler removal, and contextual technical spelling corrections while preserving the original answer until Apply cleanup is selected. Changed numeric tokens are rejected. Review other suggested changes before applying them; this is not a technical correctness check.

The browser edition and optional desktop custom engine use a locally hosted, OpenAI-compatible transcription API:

```sh
export FORGEPAD_SPEECH_URL=http://127.0.0.1:8080
export FORGEPAD_SPEECH_MODEL=parakeet
```

The runtime must list the configured model at `GET /v1/models` and accept complete WAV audio at `POST /v1/audio/transcriptions`. Model files are downloaded explicitly, not bundled into the app. External runtimes may need an adapter; confirm supported formats before enabling voice.

Recording begins only after a microphone button is activated and permission is granted. Stop releases the microphone. Raw audio is not persisted in the browser edition; desktop final interview audio retention is opt-in. Transcripts remain editable and should be reviewed before sending. No wake word, background listening, or speech synthesis is implemented.

The command parser recognizes explicit phrases such as “run my tests,” “pause the interview,” and “show my weak topics” without using a language model. Candidate speech is not automatically treated as a command.

## Credentials and publication

No API key is required for the local adapters. If adding another provider, keep its credentials in server environment variables or a local secret store. Vite's `VITE_*` variables are included in browser bundles and must never contain secrets. `.env` files, personal SQLite databases, audio, backups, and local runtime folders are ignored by Git. `scripts/check_public.py --history` checks tracked history for common credential formats; it does not replace reviewing the files being published.
