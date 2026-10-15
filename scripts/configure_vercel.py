"""Set server environment through the Vercel CLI without files or argv secrets."""
import json
import subprocess
import sys
import termios

if sys.stdin.isatty():
    settings = termios.tcgetattr(sys.stdin)
    settings[3] &= ~termios.ECHO
    termios.tcsetattr(sys.stdin, termios.TCSANOW, settings)
print("Ready for environment JSON on stdin (input is hidden).", flush=True)
values = json.loads(sys.stdin.readline())
for key, value in values.items():
    if key not in {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FORGEPAD_RUNNER_URL", "FORGEPAD_RUNNER_SECRET", "FORGEPAD_HOST"}:
        raise ValueError("Unsupported server environment variable")
    for target in ("production", "preview"):
        command = ["npm", "exec", "--yes", "--package", "vercel@64.2.0", "--cache", "/private/tmp/forgepad-npm-cache", "--",
                   "vercel", "env", "add", key, target, "--scope", "jonathan-s-projects-337522df",
                   "--project", "prj_JWvABadS8rjH3VlTB1vvvFdpWx8J", "--force"]
        result = subprocess.run(command, input=value, text=True, capture_output=True, check=False)
        print(f"{key} ({target}): {'configured' if result.returncode == 0 else 'failed'}", flush=True)
        if result.returncode:
            # Vercel normally prints only configuration metadata, but do not echo
            # arbitrary command output from a secret-bearing subprocess.
            sys.exit(result.returncode)
