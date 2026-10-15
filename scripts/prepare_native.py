"""Build platform sidecars before Tauri bundles the app."""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    python = sys.executable
    project_python = ROOT / ".venv/bin/python"
    if sys.prefix == sys.base_prefix and project_python.is_file():
        python = str(project_python)
    cargo = shutil.which("cargo")
    rustc = shutil.which("rustc")
    if not cargo or not rustc:
        raise SystemExit("Install the official Rust toolchain and add cargo/rustc to PATH.")
    target = next(
        line.split(": ", 1)[1]
        for line in subprocess.check_output([rustc, "-vV"], text=True).splitlines()
        if line.startswith("host:")
    )
    dest = ROOT / "src-tauri" / "binaries"
    dest.mkdir(exist_ok=True)
    subprocess.run(
        [
            cargo,
            "build",
            "--locked",
            "--release",
            "--no-default-features",
            "--manifest-path",
            str(ROOT / "src-tauri" / "Cargo.toml"),
            "--bin",
            "forgepad-mcp",
        ],
        check=True,
    )
    shutil.copy2(ROOT / "src-tauri" / "target" / "release" / "forgepad-mcp", dest / f"forgepad-mcp-{target}")
    # Package a tiny stateless entrypoint, never the API or its database implementations.
    with tempfile.TemporaryDirectory(prefix="forgepad-worker-build-") as temp:
        entry = Path(temp) / "worker_entry.py"
        entry.write_text("from forgepad.worker import main\nmain()\n")
        subprocess.run(
            [
                python,
                "-m",
                "PyInstaller",
                "--noconfirm",
                "--clean",
                "--onefile",
                "--name",
                f"forgepad-worker-{target}",
                "--paths",
                str(ROOT / "backend"),
                "--distpath",
                str(dest),
                "--workpath",
                str(Path(temp) / "build"),
                "--specpath",
                temp,
                str(entry),
            ],
            check=True,
            cwd=ROOT,
            env={**os.environ, "PYINSTALLER_CONFIG_DIR": str(Path(temp) / "cache")},
        )
    for name in ("forgepad-mcp", "forgepad-worker"):
        path = dest / f"{name}-{target}"
        path.chmod(0o755)
    print(f"Native sidecars ready for {target}. Run npm run desktop:dev or npm run desktop:build.")


if __name__ == "__main__":
    main()
