"""Keep application versions and human-written release notes consistent."""

import argparse
import json
import re
import subprocess
import tomllib
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def version():
    return json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["version"]


def notes(value):
    text = (ROOT / "CHANGELOG.md").read_text()
    match = re.search(rf"^## {re.escape(value)} — [^\n]+\n(.*?)(?=^## |\Z)", text, re.MULTILINE | re.DOTALL)
    if not match or len(re.findall(r"^- .+", match[1], re.MULTILINE)) < 1:
        raise ValueError(f"Add useful release notes for {value} to CHANGELOG.md")
    return match[1].strip() + "\n"


def check(base=None):
    value = version()
    if not re.fullmatch(r"\d+\.\d+\.\d+", value):
        raise ValueError("Use a stable major.minor.patch version")
    for path in ("package.json", "frontend/package.json", "frontend/package-lock.json", "package-lock.json"):
        if json.loads((ROOT / path).read_text())["version"] != value:
            raise ValueError(f"Synchronize {path} with {value}")
    for path, section in (("pyproject.toml", "project"), ("src-tauri/Cargo.toml", "package")):
        if tomllib.loads((ROOT / path).read_text())[section]["version"] != value:
            raise ValueError(f"Synchronize {path} with {value}")
    notes(value)
    if base and set(base) != {"0"}:
        files = subprocess.check_output(
            ["git", "diff", "--name-only", base, "HEAD"], cwd=ROOT, text=True
        ).splitlines()
        if any(
            p.startswith(("frontend/src/", "backend/forgepad/", "src-tauri/src/", "native-speech/"))
            for p in files
        ):
            previous = json.loads(
                subprocess.check_output(
                    ["git", "show", f"{base}:src-tauri/tauri.conf.json"], cwd=ROOT, text=True
                )
            )["version"]
            published = bool(
                subprocess.check_output(["git", "tag", "--list", f"v{value}"], cwd=ROOT, text=True).strip()
            )
            if tuple(map(int, value.split("."))) < tuple(map(int, previous.split("."))) or (
                value == previous and published
            ):
                raise ValueError(
                    "Application changes need a version bump and release notes. Run python scripts/release.py bump --note 'What changed'."
                )
    print(f"Release {value}: versions and patch notes verified")


def set_version(value):
    for path in (
        "package.json",
        "frontend/package.json",
        "frontend/package-lock.json",
        "package-lock.json",
        "src-tauri/tauri.conf.json",
    ):
        file = ROOT / path
        data = json.loads(file.read_text())
        data["version"] = value
        if "packages" in data:
            data["packages"][""]["version"] = value
        file.write_text(json.dumps(data, indent=2) + "\n")
    for path in ("pyproject.toml", "src-tauri/Cargo.toml"):
        file = ROOT / path
        file.write_text(
            re.sub(
                r'^version = "[^"]+"', f'version = "{value}"', file.read_text(), count=1, flags=re.MULTILINE
            )
        )
    lock = ROOT / "src-tauri/Cargo.lock"
    lock.write_text(
        re.sub(r'(name = "forgepad-desktop"\nversion = ")[^"]+', rf"\g<1>{value}", lock.read_text())
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "notes", "version", "bump"])
    parser.add_argument("--base")
    parser.add_argument("--note")
    args = parser.parse_args()
    if args.command == "version":
        print(version())
    elif args.command == "notes":
        print(notes(version()), end="")
    elif args.command == "bump":
        if not args.note:
            parser.error("--note is required: describe the user-visible change")
        parts = list(map(int, version().split(".")))
        parts[-1] += 1
        value = ".".join(map(str, parts))
        set_version(value)
        file = ROOT / "CHANGELOG.md"
        file.write_text(
            file.read_text().replace(
                "\n## ",
                f"\n## {value} — {date.today()}\n\n### Improved\n- {args.note}\n\n## ",
                1,
            )
        )
        check()
    else:
        check(args.base)
