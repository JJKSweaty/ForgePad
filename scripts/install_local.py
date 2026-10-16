"""Install a checked Mac build, then trash duplicate ForgePad bundles only."""

import argparse
import json
import os
import plistlib
import re
import shutil
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE_ID = "dev.forgepad.desktop"


def bundle_version(bundle):
    try:
        with (Path(bundle) / "Contents/Info.plist").open("rb") as stream:
            info = plistlib.load(stream)
        version = info.get("CFBundleShortVersionString", "")
        if info.get("CFBundleIdentifier") == BUNDLE_ID and re.fullmatch(r"\d+\.\d+\.\d+", version):
            return version
    except (OSError, ValueError, plistlib.InvalidFileException):
        pass
    return None


def version_key(version):
    return tuple(map(int, version.split(".")))


def find_bundles(roots):
    seen = set()
    for root in roots:
        if not root.is_dir():
            continue
        for directory, children, _ in os.walk(root, followlinks=False):
            for name in list(children):
                path = Path(directory) / name
                if name.endswith(".app"):
                    children.remove(name)
                    if not path.is_symlink() and bundle_version(path) and path.resolve() not in seen:
                        seen.add(path.resolve())
                        yield path
                elif name in {"node_modules", ".git", ".venv", "target", ".Trash", "Library"}:
                    children.remove(name)


def cleanup_candidates(roots, installed, version):
    return [
        bundle for bundle in find_bundles(roots)
        if bundle.resolve() != installed.resolve()
        and version_key(bundle_version(bundle)) <= version_key(version)
    ]


def verify(bundle):
    if not bundle_version(bundle):
        raise ValueError("Choose a versioned ForgePad application bundle")
    for file in (
        "Contents/MacOS/forgepad-worker", "Contents/MacOS/forgepad-mcp",
        "Contents/MacOS/forgepad-speech", "Contents/Resources/_up_/sandbox/Dockerfile",
        "Contents/Resources/_up_/questions/align-up.json",
    ):
        if not (bundle / file).is_file():
            raise ValueError(f"Incomplete application: {file}")
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True)


def move_to_trash(bundle, trash):
    trash.mkdir(parents=True, exist_ok=True)
    destination = trash / f"{bundle.stem}-{bundle_version(bundle)}-{uuid.uuid4().hex[:8]}.app"
    shutil.move(str(bundle), str(destination))
    return destination


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, default=ROOT / "src-tauri/target/release/bundle/macos/ForgePad.app")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    source = args.bundle.resolve(strict=True)
    installed = Path("/Applications/ForgePad.app")
    version = bundle_version(source)
    verify(source)
    current = bundle_version(installed)
    if current and version_key(current) > version_key(version):
        raise ValueError(f"Keep the newer installed version {current}; refusing to install {version}")
    if installed.exists() and current is None:
        raise ValueError("The destination belongs to another application; leaving it untouched")
    if source == installed:
        raise ValueError("Use the built bundle as the installation source")
    roots = [
        Path("/Applications"), Path.home() / "Applications", Path.home() / "Downloads",
        Path.home() / "Desktop", ROOT / "src-tauri/target/release/bundle/macos",
        ROOT / "src-tauri/target/debug/bundle/macos",
    ]
    report = {"version": version, "installed": str(installed), "trashed": []}
    if args.dry_run:
        report["cleanup_candidates"] = list(map(str, cleanup_candidates(roots, installed, version)))
    else:
        staging = installed.parent / f".ForgePad-install-{uuid.uuid4().hex}.app"
        previous = None
        try:
            subprocess.run(["ditto", str(source), str(staging)], check=True)
            verify(staging)
            subprocess.run(["osascript", "-e", 'if application id "dev.forgepad.desktop" is running then tell application id "dev.forgepad.desktop" to quit'], check=True)
            if installed.exists():
                previous = move_to_trash(installed, Path.home() / ".Trash")
            try:
                staging.rename(installed)
                verify(installed)
            except Exception:
                if installed.exists():
                    shutil.rmtree(installed)
                if previous:
                    previous.rename(installed)
                raise
            if previous:
                report["trashed"].append(str(previous))
            for bundle in cleanup_candidates(roots, installed, version):
                report["trashed"].append(str(move_to_trash(bundle, Path.home() / ".Trash")))
        finally:
            if staging.exists():
                shutil.rmtree(staging)
        subprocess.run(["open", str(installed)], check=True)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
