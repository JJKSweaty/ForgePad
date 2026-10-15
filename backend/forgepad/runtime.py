"""Discover local Docker and maintain only ForgePad's dedicated Colima profile."""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
from pathlib import Path

PROFILE = "forgepad"
CONTEXT = "colima-forgepad"


def command(*args: str, timeout: int = 15) -> subprocess.CompletedProcess:
    with subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            # Colima invokes Lima children. Killing only the CLI leaves blocked children
            # holding pipes and makes every retry accumulate another process.
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise ValueError(
                "The compiler service did not respond. Start Docker or Colima, then try Repair runner."
            ) from None
        return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def context_candidates(selected: str, current: str) -> list[str]:
    # An explicit connection must never silently switch to another engine.
    return [selected] if selected else list(dict.fromkeys([current, CONTEXT, "desktop-linux", "default"]))


def prepare(runner, preflight, *, setup: bool = False) -> dict:
    if not shutil.which("docker"):
        raise ValueError(
            "Install Docker Desktop, or install Docker and Colima with: brew install docker colima"
        )
    selected = os.getenv("DOCKER_CONTEXT", "")
    active = command("docker", "context", "show")
    candidates = context_candidates(selected, active.stdout.strip() if active.returncode == 0 else "default")
    scratch = Path(os.environ["FORGEPAD_RUNNER_TMPDIR"]).resolve()
    scratch.mkdir(parents=True, exist_ok=True)

    def build_image():
        recipe = Path(os.environ.get("FORGEPAD_RUNNER_RECIPE", ""))
        if not (recipe / "Dockerfile").is_file():
            raise ValueError("The compiler recipe is missing. Reinstall the latest ForgePad release.")
        built = command("docker", "build", "-t", runner.image, str(recipe), timeout=600)
        if built.returncode:
            raise ValueError("Compiler download failed. Check your internet connection and try again.")

    for context in candidates:
        os.environ["DOCKER_CONTEXT"] = context
        if not runner.availability()["available"]:
            if setup and command("docker", "info", "--format", "{{.ServerVersion}}").returncode == 0:
                build_image()
            else:
                continue
        result = preflight()
        if result["status"] == "passed":
            return {
                "available": True,
                "detail": "Compiler verified",
                "config": {
                    "image": runner.image,
                    "docker_context": context,
                    "scratch_directory": str(scratch),
                },
            }
    # Recovery is limited to the dedicated profile, never other Colima machines.
    managed = (
        selected == CONTEXT
        or (setup and not selected)
        or (not selected and (Path.home() / ".colima" / PROFILE / "colima.yaml").is_file())
    )
    if managed and shutil.which("colima"):
        os.environ["DOCKER_CONTEXT"] = CONTEXT
        status = command("colima", "status", "--profile", PROFILE)
        if setup and status.returncode == 0:
            # A successful preflight above would already have returned. Restart to repair
            # old profiles whose file sharing omitted the app's temporary directory.
            stopped = command("colima", "stop", "--profile", PROFILE, timeout=120)
            if stopped.returncode:
                raise ValueError("Could not restart the ForgePad compiler. Close running jobs and try again.")
        if setup or status.returncode:
            args = ["colima", "start", "--profile", PROFILE, "--activate=false"]
            if setup:
                args += ["--cpu", "2", "--memory", "2", "--disk", "12", "--mount", f"{scratch}:w"]
            started = command(*args, timeout=240)
            if started.returncode:
                raise ValueError(
                    "The ForgePad compiler VM could not start. Check Colima and try Repair runner."
                )
        if setup and not runner.availability()["available"]:
            build_image()
        if runner.availability()["available"] and preflight()["status"] == "passed":
            return {
                "available": True,
                "detail": "Compiler verified",
                "config": {
                    "image": runner.image,
                    "docker_context": CONTEXT,
                    "scratch_directory": str(scratch),
                },
            }
    os.environ["DOCKER_CONTEXT"] = selected
    raise ValueError(
        "Runner needs setup. Open Settings → Workspace & data and choose Set up / repair runner. Start Docker Desktop if you use it."
    )
