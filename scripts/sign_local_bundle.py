"""Finish local macOS ad-hoc signing without broadening the Rust app's entitlements.

PyInstaller extracts its own ad-hoc-signed Python library. Only that isolated worker
requires a library-validation exception; candidate C/C++ still runs inside Docker.
"""

import argparse
import plistlib
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sign(bundle):
    bundle = Path(bundle).resolve(strict=True)
    worker = bundle / "Contents/MacOS/forgepad-worker"
    if not worker.is_file() or not (bundle / "Contents/Info.plist").is_file():
        raise ValueError("Choose the built ForgePad.app containing its compiler worker")
    with tempfile.TemporaryDirectory(prefix="forgepad-worker-sign-") as directory:
        entitlements = Path(directory) / "worker.plist"
        entitlements.write_bytes(plistlib.dumps({"com.apple.security.cs.disable-library-validation": True}))
        subprocess.run(
            [
                "codesign",
                "--force",
                "--options",
                "runtime",
                "--sign",
                "-",
                "--entitlements",
                str(entitlements),
                str(worker),
            ],
            check=True,
        )
    # Re-seal the parent after changing the worker signature; do not re-sign other children.
    subprocess.run(
        [
            "codesign",
            "--force",
            "--options",
            "runtime",
            "--sign",
            "-",
            "--entitlements",
            str(ROOT / "src-tauri/Entitlements.plist"),
            str(bundle),
        ],
        check=True,
    )
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True)
    print(f"Local ad-hoc bundle verified: {bundle.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--bundle", type=Path, default=ROOT / "src-tauri/target/release/bundle/macos/ForgePad.app"
    )
    sign(parser.parse_args().bundle)
