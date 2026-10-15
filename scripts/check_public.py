"""Reject private runtime files and common credential formats before publication.

This is a deterministic guard, not a guarantee that arbitrary sensitive prose is safe.
It reads Git objects rather than printing file contents or credentials.
"""
import argparse
from pathlib import PurePosixPath
import re
import subprocess
import sys

PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "GitHub token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "API credential": re.compile(rb"\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{32,}\b"),
    "AWS access key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "Slack token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "assigned secret": re.compile(rb'''(?im)^\s*(?:[A-Z_]*(?:API_KEY|ACCESS_TOKEN|SECRET_KEY|AUTH_TOKEN|PASSWORD))\s*=\s*["']?(?!your[-_]|example|placeholder|changeme|\$\{|os\.|None|""|'')[A-Za-z0-9_/.+:-]{16,}["']?\s*$'''),
}


def git(*args):
    return subprocess.check_output(["git", *args])


def blocked_path(name):
    path = PurePosixPath(name)
    return (any(part in {"data", "recordings", "backups", ".venv", "node_modules", ".local"} for part in path.parts)
            or (path.name.startswith(".env") and path.name != ".env.example")
            or path.suffix in {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".p12"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--staged", action="store_true")
    parser.add_argument("--history", action="store_true")
    args = parser.parse_args()
    revisions = git("rev-list", "--all").decode().splitlines() if args.history else [None]
    findings, seen = [], set()
    for revision in revisions:
        names = (git("ls-tree", "-r", "--name-only", "-z", revision) if revision
                 else git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z") if args.staged
                 else git("ls-files", "-z")).decode().split("\0")
        for name in filter(None, names):
            if blocked_path(name):
                findings.append(f"Private runtime path is tracked: {name}")
            data = git("show", f"{revision or ''}:{name}")
            marker = (name, hash(data))
            if marker in seen:
                continue
            seen.add(marker)
            for label, pattern in PATTERNS.items():
                if pattern.search(data):
                    findings.append(f"Possible {label} in {name}; inspect locally (value withheld)")
    if findings:
        print("\n".join(sorted(set(findings))), file=sys.stderr)
        return 1
    print(f"Publication guard passed: {len(seen)} file versions checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
