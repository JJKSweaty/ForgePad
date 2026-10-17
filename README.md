# ForgePad

[![Verify](https://github.com/JJKSweaty/ForgePad/actions/workflows/verify.yml/badge.svg)](https://github.com/JJKSweaty/ForgePad/actions/workflows/verify.yml)

A desktop workspace for embedded engineering practice. Write and run C/C++, work through system design and theory questions, and rehearse interviews with saved progress and replay.

**[Download the latest Mac release](https://github.com/JJKSweaty/ForgePad/releases/latest)** · [Release notes](CHANGELOG.md) · [Report a problem](https://github.com/JJKSweaty/ForgePad/issues)

## Install

1. Download `ForgePad_<version>_aarch64.dmg` from the latest release.
2. Open it and drag **ForgePad** into **Applications**. Keep this copy in your Dock; remove older copies from Downloads or build folders.
3. Open ForgePad and choose a question in **Practice**.
4. For coding, install [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) and start it, or install Docker and Colima with `brew install docker colima`. In **Settings → Workspace & data**, select **Set up / repair runner** once. ForgePad downloads the compiler and verifies execution.

Requires an **Apple Silicon Mac with macOS 14 or later**. Design and theory practice do not need Docker. There is no account or API key requirement for basic practice.

Release notes state whether a download is Apple notarized. Until a Developer ID is configured, builds are ad-hoc signed: macOS may require **System Settings → Privacy & Security → Open Anyway** after the first launch attempt. Only open a download you obtained from this repository's release page. Checksums are attached to each release.

## Use

- **Coding:** edit source files with local C/C++ autocomplete, then **Run all tests** to check the entire visible suite or **Submit all tests** to run that same suite and record an attempt. `⌘/Ctrl + Enter` runs; add `Shift` to submit. `Ctrl + Space` opens suggestions; use arrows to choose, `Tab` to accept, and `Escape` to close. Suggestions include keywords, snippets, common functions, and identifiers from your draft files.
- **Editor layout:** drag the problem/editor divider, or focus it and use arrow keys, `Home`, or `End`. Hide the problem panel or sidebar when you want more editing space; ForgePad remembers these choices. Narrow windows stack the problem above the editor.
- **Drafts and checkpoints:** drafts autosave as you type. **Save checkpoint** (`⌘/Ctrl + S`) keeps a manual restore point on this device. **Reset to starter files** and **Restore saved checkpoint** confirm before replacing the draft; the replacement autosaves. Compiler diagnostics appear below the editor and link to their source line.
- **Design, theory, debugging:** use the question's writing workspace and thinking prompts. Submit a response for self-review.
- **Hints:** view progressive hints or use OpenRouter or an optional local model as a reasoning coach.
- **Mock Interview:** start a guided rehearsal, pause when needed, then finish and review its replay. Guided interviews work without an AI provider.
- **Voice:** in **Settings → Interview & AI**, enable built-in speech and download Parakeet Ultra. Dictation stays editable. Optional local cleanup suggests changes for you to review before applying.

Drafts and progress stay on your Mac in `~/Library/Application Support/ForgePad`. Export a backup in Settings before moving to another computer. Installing an updated app preserves this workspace. Local speech model downloads are separate from the app download.

If code will not run, choose **Set up / repair runner**. ForgePad manages only its own Colima profile and does not change Docker's global connection. Custom Docker connections and shared folders are available under **Connection settings**.

## Development

Use Python 3.11+, Node 22+, Rust stable, Xcode with Swift 6.2+, and Docker. Install dependencies with `python3 -m venv .venv`, `.venv/bin/pip install -e '.[dev]'`, `npm ci`, and `npm ci --prefix frontend`.

```sh
docker build -t forgepad-runner:local sandbox
python -m pytest
npm test --prefix frontend
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features
npm run desktop:dev
```

[QA and release process](docs/quality-and-releases.md) documents browser tests, packaging, signing, and the required version/patch-note updates for features. The web hosting experiment is documented separately in [hosting.md](docs/hosting.md); desktop releases provide a separate local workspace for each user.

After changing the desktop app, use `npm run desktop:install` to build, sign, and verify the new bundle, install it in `/Applications/ForgePad.app`, and move older duplicate ForgePad apps to Trash. The installer checks the bundle identifier and refuses to replace a newer installed version. Drafts, progress, recordings, and models are preserved. The interface uses the [Radix neutral gray scale](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette) for surfaces and text.
