"""Stateless sandbox worker for the native Rust core. Never opens the database."""

import json
import signal
import sys
from threading import Event

from .runner import DockerRunner


def main():
    try:
        raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("Worker request exceeds 4 MiB")
        request = json.loads(raw)
        cancel = Event()
        signal.signal(signal.SIGTERM, lambda *_: cancel.set())
        runner = DockerRunner()
        if request["operation"] == "availability":
            result = runner.availability()
        elif request["operation"] == "run":
            result = runner.run(
                request["question"],
                request["files"],
                request.get("include_hidden", False),
                cancel_event=cancel,
            )
        else:
            raise ValueError("Unknown worker operation")
        print(json.dumps(result, separators=(",", ":")))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"ForgePad worker: {type(error).__name__}: {error}", file=sys.stderr)
        print(
            json.dumps(
                {
                    "status": "unavailable",
                    "tests": [],
                    "passed": 0,
                    "total": 0,
                    "compiler_output": "Sandbox worker failed. Check worker logs.",
                }
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
