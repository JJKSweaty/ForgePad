"""Build the pinned CoreML speech helper; model downloads happen in the app on request."""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    package = ROOT / "native-speech"
    subprocess.run(["swift", "build", "-c", "release", "--package-path", str(package)], check=True)
    target = subprocess.check_output(["rustc", "-vV"], text=True).split("host: ")[1].splitlines()[0]
    destination = ROOT / "src-tauri/binaries" / f"forgepad-speech-{target}"
    destination.parent.mkdir(exist_ok=True)
    shutil.copy2(package / ".build/release/forgepad-speech", destination)
    destination.chmod(0o755)
    print(f"Local speech helper ready: {destination.name}")


if __name__ == "__main__":
    main()
