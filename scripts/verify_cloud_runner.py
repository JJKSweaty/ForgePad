"""Verify the protected cloud runner without putting credentials in arguments."""
import json
import subprocess
import sys
import termios
from pathlib import Path

if sys.stdin.isatty():
    settings = termios.tcgetattr(sys.stdin)
    settings[3] &= ~termios.ECHO
    termios.tcsetattr(sys.stdin, termios.TCSANOW, settings)
print("Ready for verification JSON on stdin (input is hidden).", flush=True)
config = json.loads(sys.stdin.readline())
question = json.loads((Path(__file__).resolve().parents[1] / "questions/uart-frame-recovery.json").read_text())
for label, files in (("reference", question["reference_solution"]), ("broken", question["starter_files"])):
    request = {"question": question, "files": files, "include_hidden": True}
    curl_config = '\n'.join([
        'request = "POST"', 'max-time = "290"',
        'header = ' + json.dumps("Authorization: Bearer " + config["secret"]),
        'header = "Content-Type: application/json"',
        'data = ' + json.dumps(json.dumps(request)),
    ]) + '\n'
    result = subprocess.run(["npm", "exec", "--yes", "--package", "vercel@64.2.0", "--cache", "/private/tmp/forgepad-npm-cache", "--",
        "vercel", "curl", config["url"] + "/api/runner", "--scope", "jonathan-s-projects-337522df",
        "--", "--silent", "--show-error", "--config", "-"], input=curl_config, capture_output=True, text=True)
    try:
        response = json.loads(result.stdout)
    except ValueError:
        print(f"{label}: request did not return a JSON verdict (exit {result.returncode})", flush=True)
        # CLI diagnostics do not receive the credential as an argument.
        print(result.stderr[-1600:].replace(config["secret"], "[redacted]"), flush=True)
        sys.exit(1)
    print(json.dumps({"case": label, "status": response.get("status"), "passed": response.get("passed"),
                      "total": response.get("total"), "detail": response.get("detail")}), flush=True)
    if label == "reference" and (response.get("status") != "passed" or response.get("passed") != 9):
        print(json.dumps(response)[:3000].replace(config["secret"], "[redacted]"), flush=True)
        sys.exit(1)
    if label == "broken" and response.get("status") in {None, "passed", "unavailable"}:
        sys.exit(1)
