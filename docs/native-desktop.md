# Native ForgePad

The macOS application uses one Rust service and SQLite workspace. React, the Tauri commands, and the compiled MCP stdio proxy all use that service. The stateless Python sidecar owns Docker compilation; it never opens the database. The browser/FastAPI edition remains available separately.

## Build and run

Install the macOS Xcode command-line tools, a stable Rust toolchain, Node/npm and Python 3.11 or newer. In the repository:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
npm ci
npm ci --prefix frontend
npm run native:prepare
npm run desktop:dev
```

For an application bundle, run `npm run desktop:build`. Packaging embeds question resources and the platform-specific `forgepad-mcp` and `forgepad-worker` executables. The packaging script uses the project virtual environment when called from system Python. The resulting `.app` uses local ad-hoc signing; Developer ID signing and Apple notarization are separate distribution steps. The build finishes with `scripts/sign_local_bundle.py`, which seals resources and limits PyInstaller’s library-validation exception to the worker. The Rust app and MCP executable retain hardened-runtime signing. The audio-input entitlement supports explicit interview microphone access under hardened runtime ([Apple documentation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input)); macOS consent is still required.

Data lives in `~/Library/Application Support/ForgePad`, unless `FORGEPAD_DATA_DIR` is explicitly set. A process lock prevents a second service from writing to the same workspace. The native and browser editions can use the same compatible database sequentially; do not launch both against it at once. Export includes immutable question revisions, versioned drafts, attempts, sessions, activity and settings. Keychain credentials are not exported. Retained audio is local and optional.

## Compiler configuration

Build the runner image in an existing working Docker context:

```sh
docker build -t forgepad-runner:local sandbox
```

Open Settings → Compiler. Select that context if the desktop application's Docker environment differs from the terminal. For a Colima VM with restricted mounts, set **Shared scratch directory** to a dedicated writable directory inside a folder shared with that VM. The native default under Application Support must be shared or Docker cannot mount its temporary job files. This does not change Docker's global context or VM mount settings.

**Save and test runner** compiles and executes a bounded sanitizer-enabled preflight inside the sandbox. An image being present alone does not establish that scratch mounts work. Candidate sources, tests and cached binaries still execute only inside restricted Docker containers. [Sandbox details](runner.md).

## Dashboard data

The default landing screen uses persisted progress without waiting for AI or GitHub. Configure an IANA timezone under Settings → General. Public test runs, submissions and unique first solves are distinct records. Focused time is credited only across short, recently engaged intervals. The heatmap's four datasets remain separate. Mastery requires repeated passing evidence on separate UTC dates with the latest attempt passing; theory confidence remains self-review.

The browser edition shows recorded submissions, runs and interviews. It labels focused-time tracking as a desktop feature rather than inventing time from session duration.

## Optional connections

- **HeyClicky:** Settings → HeyClicky enables the local MCP command and displays a copyable configuration. Use the bundled executable and private socket, not a Python file. The application must be open. The local self-test verifies initialization/discovery; “last confirmed call” changes only after an external tool call. Optional authenticated loopback HTTP uses an ephemeral endpoint and Keychain token. [Firmware Coach prompt](firmware-coach.txt).
- **Local AI:** Settings → Local AI configures existing loopback OpenAI-compatible model servers, fallback order and resource budgets. A configured endpoint must actually list its model. Runtime installation/download and process lifecycle management are external to this version. Offline fallback preserves editor, compiler, history, roadmaps and prepared interview stages.
- **Speech:** Configure a compatible local transcription endpoint, explicitly choose Interview audio mode, then press the microphone. Capture is bounded push-to-talk; returned text is reviewed before sending. AudioWorklet activity detection does not imply streaming recognition. Retention is opt-in. No model performance is claimed without measurements.
- **GitHub:** Settings → GitHub accepts a credential for official read-only account/calendar requests and stores it in macOS Keychain. Use only the permissions needed to read your account/calendar. Synchronization is manual and cached, with visible errors and last successful sync. There are no repository writes or publishing controls.

## Verification

```sh
npm test --prefix frontend
npm run build --prefix frontend
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
python -m pytest -q
cargo build --locked --manifest-path src-tauri/Cargo.toml --no-default-features --bins
python scripts/verify_native.py
```

Both verification scripts accept `--binaries <directory>` to exercise the actual executables inside an application bundle. After preparing native sidecars, `python scripts/verify_dashboard_native.py` checks real Docker submissions and persisted dashboard results in a temporary workspace. Set `DOCKER_CONTEXT` when needed and `FORGEPAD_WORKER` to the prepared sidecar if testing independently of a Tauri bundle. The script chooses a dedicated scratch directory under ignored `data/`, suitable for a VM sharing this repository.

For an isolated debug UI preview, compile with `FORGEPAD_QA_DATA_DIR=/tmp/forgepad-ui-review` and a different Tauri identifier/product name. This compile-time preview option is ignored in release builds; explicit runtime `FORGEPAD_DATA_DIR` still takes priority. Never seed test metrics into the user's workspace.

[Design review, measurements and remaining acceptance](design/dashboard-review.md).
