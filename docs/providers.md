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

Speech is an optional adapter for a locally hosted, OpenAI-compatible transcription API:

```sh
export FORGEPAD_SPEECH_URL=http://127.0.0.1:8080
export FORGEPAD_SPEECH_MODEL=parakeet
```

The runtime must list the configured model at `GET /v1/models` and accept browser-recorded audio at `POST /v1/audio/transcriptions`. Parakeet is a preferred model family when a compatible runtime and hardware are available. This repository does not bundle or claim to implement a Parakeet Ultra runtime. Different runtimes may need audio conversion or an adapter; confirm their actual supported formats before enabling voice.

Recording begins only after a microphone button is activated and browser permission is granted. Stop releases the microphone; raw audio is not persisted by ForgePad. Transcripts can contain recognition mistakes and should be reviewed before sending. No wake word, background listening, OS-wide microphone access, or speech synthesis is implemented.

The command parser recognizes explicit phrases such as “run my tests,” “pause the interview,” and “show my weak topics” without using a language model. Candidate speech is not automatically treated as a command.

## Credentials and publication

No API key is required for the local adapters. If adding another provider, keep its credentials in server environment variables or a local secret store. Vite's `VITE_*` variables are included in browser bundles and must never contain secrets. `.env` files, personal SQLite databases, audio, backups, and local runtime folders are ignored by Git. `scripts/check_public.py --history` checks tracked history for common credential formats; it does not replace reviewing the files being published.
