"""CLI for local API operations and consistent SQLite backups."""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

import httpx

from .providers import local_endpoint
from .storage import Store


def main():
    parser = argparse.ArgumentParser(prog="forgepad", description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="List practice questions")
    get = commands.add_parser("get", help="Get a practice-safe question")
    get.add_argument("id")
    for name in ("validate", "import"):
        sub = commands.add_parser(name, help="Validate or publish a JSON/JSONL question package")
        sub.add_argument("file", type=Path)
    export = commands.add_parser("export", help="Export authoring packages or local user data")
    export.add_argument("--data", action="store_true")
    export.add_argument("--format", choices=("json", "jsonl", "markdown"), default="json")
    commands.add_parser("context", help="Export compact preparation context")
    for name in ("backup", "integrity"):
        sub = commands.add_parser(name)
        sub.add_argument(
            "--database", type=Path, default=Path(os.getenv("FORGEPAD_DB", "data/forgepad.sqlite3"))
        )
        if name == "backup":
            sub.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        if args.command in {"backup", "integrity"}:
            if not args.database.is_file():
                raise ValueError(f"Database does not exist: {args.database}")
            if args.command == "backup":
                if args.destination.exists():
                    raise ValueError("Backup destination already exists; choose another filename")
                args.destination.parent.mkdir(parents=True, exist_ok=True)
                Store(args.database).backup(args.destination)
                print(f"Backup written to {args.destination}")
            else:
                with sqlite3.connect(f"file:{args.database}?mode=ro", uri=True) as db:
                    result = [row[0] for row in db.execute("PRAGMA integrity_check")]
                print("\n".join(result))
                if result != ["ok"]:
                    sys.exit(1)
            return
        base = local_endpoint(args.url)
        with httpx.Client(base_url=base, timeout=300, trust_env=False) as client:

            def request(method, path, **kwargs):
                response = client.request(method, "/api" + path, **kwargs)
                response.raise_for_status()
                return response.json()

            if args.command == "list":
                result = request("GET", "/questions")
            elif args.command == "get":
                result = request("GET", f"/questions/{args.id}")
            elif args.command == "context":
                result = request("GET", "/context")
            elif args.command in {"validate", "import"}:
                text = args.file.read_text()
                if args.file.suffix == ".jsonl":
                    packages = [json.loads(line) for line in text.splitlines() if line.strip()]
                else:
                    raw = json.loads(text)
                    packages = raw if isinstance(raw, list) else [raw]
                validated = [
                    request("POST", "/imports/validate", json={"question": item}) for item in packages
                ]
                result = validated
                if not all(item["valid"] for item in validated):
                    print(json.dumps(validated, indent=2))
                    sys.exit(1)
                if args.command == "import":
                    # Explicit CLI import authorizes publishing each successfully validated package.
                    result = [
                        request("POST", "/imports/publish", json={"token": item["token"]})
                        for item in validated
                    ]
            else:
                result = request("GET", "/data/export" if args.data else "/questions/export/all")
                if args.format == "jsonl":
                    for item in result if isinstance(result, list) else [result]:
                        print(json.dumps(item, ensure_ascii=False))
                    return
                if args.format == "markdown":
                    if args.data:
                        raise ValueError("Markdown export supports question packages; use JSON for user data")
                    for item in result:
                        print(f"# {item['title']}\n\n{item['prompt']}\n\n## Constraints\n")
                        print("\n".join(f"- {value}" for value in item["constraints"]))
                        print("\n## Rubric\n\n" + "\n".join(f"- {value}" for value in item["rubric"]) + "\n")
                    return
            print(json.dumps(result, indent=2, ensure_ascii=False))
    except (ValueError, OSError, httpx.HTTPError) as error:
        print(f"forgepad: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
