"""Sign, optionally notarize, and package an already built Mac application."""

import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from release import ROOT, notes, version
from sign_local_bundle import sign


def run(*args):
    subprocess.run(args, check=True)


def notarize(path):
    run(
        "xcrun",
        "notarytool",
        "submit",
        str(path),
        "--apple-id",
        os.environ["APPLE_ID"],
        "--password",
        os.environ["APPLE_PASSWORD"],
        "--team-id",
        os.environ["APPLE_TEAM_ID"],
        "--wait",
    )


def main():
    value = version()
    bundle = ROOT / "src-tauri/target/release/bundle/macos/ForgePad.app"
    for relative in (
        "Contents/MacOS/forgepad-worker",
        "Contents/MacOS/forgepad-mcp",
        "Contents/MacOS/forgepad-speech",
        "Contents/Resources/_up_/sandbox/Dockerfile",
        "Contents/Resources/_up_/questions/align-up.json",
    ):
        if not (bundle / relative).is_file():
            raise ValueError(f"Incomplete app bundle: {relative}")
    identity = os.getenv("APPLE_SIGNING_IDENTITY", "-") or "-"
    credentials = [os.getenv(k) for k in ("APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID")]
    signed = identity != "-"
    if signed and not all(credentials):
        raise ValueError("Developer ID releases require complete notarization credentials")
    sign(bundle, identity=identity)
    output = ROOT / "dist/release"
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"ForgePad_{value}_aarch64.app.zip"
    run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(bundle), str(archive))
    if signed:
        notarize(archive)
        run("xcrun", "stapler", "staple", str(bundle))
        run("spctl", "--assess", "--type", "execute", "--verbose", str(bundle))
        archive.unlink()
        run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(bundle), str(archive))
    dmg = output / f"ForgePad_{value}_aarch64.dmg"
    with tempfile.TemporaryDirectory(prefix="forgepad-dmg-") as directory:
        stage = Path(directory)
        run("ditto", str(bundle), str(stage / "ForgePad.app"))
        (stage / "Applications").symlink_to("/Applications")
        run(
            "hdiutil",
            "create",
            "-volname",
            "ForgePad",
            "-srcfolder",
            str(stage),
            "-ov",
            "-format",
            "UDZO",
            str(dmg),
        )
    if signed:
        run("codesign", "--force", "--timestamp", "--sign", identity, str(dmg))
        notarize(dmg)
        run("xcrun", "stapler", "staple", str(dmg))
    run("hdiutil", "verify", str(dmg))
    (output / "SHA256SUMS.txt").write_text(
        "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in (archive, dmg))
    )
    status = (
        "Signed with Developer ID and Apple notarized."
        if signed
        else "Ad-hoc signed; Apple notarization is not configured. On first launch macOS may require System Settings → Privacy & Security → Open Anyway."
    )
    (output / "release-notes.md").write_text(
        f"Download the DMG below, open it, and drag ForgePad into Applications. Requires Apple Silicon and macOS 14+.\n\n{status}\n\n"
        f"For coding, install/start Docker Desktop or install Docker + Colima, then choose Settings → Workspace & data → Set up / repair runner.\n\n"
        + notes(value)
    )
    # Exercise extraction as a user would, then verify all signatures survived transport.
    with tempfile.TemporaryDirectory(prefix="forgepad-download-check-") as directory:
        run("ditto", "-x", "-k", str(archive), directory)
        run("codesign", "--verify", "--deep", "--strict", str(Path(directory) / "ForgePad.app"))
    print(f"Verified release artifacts: {output}")


if __name__ == "__main__":
    main()
