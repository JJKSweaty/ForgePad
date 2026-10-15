"""Real native command -> worker -> Docker -> persisted dashboard verification.

Uses original reference code only in a disposable test workspace. Never touches user progress.
"""

import argparse
import asyncio
import json
import os
import signal
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


async def verify(binaries=None, output=None):
    binaries = Path(binaries) if binaries else ROOT / "src-tauri/target/debug"
    with tempfile.TemporaryDirectory(prefix="forgepad-dashboard-test-", dir="/tmp") as directory:
        socket = Path(directory) / "service.sock"
        env = {**os.environ, "FORGEPAD_DATA_DIR": directory, "FORGEPAD_QUESTIONS": str(ROOT / "questions")}
        process = await asyncio.create_subprocess_exec(
            str(binaries / "forgepad-service"),
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        report = {
            "scope": "Isolated real native service, bundled worker and Docker; no AI models",
            "checks": [],
            "timings_ms": {},
        }
        try:
            for _ in range(200):
                if socket.exists():
                    break
                if process.returncode is not None:
                    raise RuntimeError("Native service exited")
                await asyncio.sleep(0.025)
            async with httpx.AsyncClient(
                transport=httpx.AsyncHTTPTransport(uds=str(socket)), base_url="http://localhost", timeout=120
            ) as client:

                async def command(method, path, body=None):
                    r = await client.post("/command", json={"method": method, "path": path, "body": body})
                    r.raise_for_status()
                    return r.json()

                await command(
                    "PUT",
                    "/settings/runner",
                    {
                        "image": "forgepad-runner:local",
                        "docker_context": os.environ.get("DOCKER_CONTEXT", ""),
                        "scratch_directory": str(ROOT / "data/native-verification-runner"),
                    },
                )
                assert (await command("POST", "/settings/runner/verify", {}))["status"] == "passed"
                q = await command("GET", "/questions/align-up/export")
                await command(
                    "PUT",
                    "/drafts/align-up",
                    {"question_version": 1, "files": q["reference_solution"], "answer": ""},
                )
                assert (await command("GET", "/dashboard?timezone=America/Toronto"))["continuation"][
                    "kind"
                ] == "draft"
                for i in range(2):
                    start = time.perf_counter()
                    job = await command(
                        "POST",
                        "/runs",
                        {
                            "question_id": q["id"],
                            "question_version": 1,
                            "files": q["reference_solution"],
                            "mode": "submit",
                        },
                    )
                    for _ in range(300):
                        run = await command("GET", f"/runs/{job['id']}")
                        if run["status"] == "complete":
                            break
                        await asyncio.sleep(0.1)
                    assert run["result"]["status"] == "passed", run["result"]
                    assert run["result"]["total"] == 8
                    report["timings_ms"][f"submission_{i + 1}"] = round(
                        (time.perf_counter() - start) * 1000, 2
                    )
                start = time.perf_counter()
                dashboard = await command("GET", "/dashboard?timezone=America/Toronto")
                await command("GET", "/dashboard?timezone=America/Toronto")
                report["timings_ms"]["dashboard_two_reads"] = round((time.perf_counter() - start) * 1000, 2)
                assert dashboard["metrics"]["questions_solved"] == 1
                assert sum(d["solved"] for d in dashboard["days"]) == 1
                assert dashboard["roadmaps"][1]["solved"] == 1
                details = await command("GET", f"/activity/{dashboard['today']}?timezone=America/Toronto")
                assert len([e for e in details["events"] if e["kind"] == "solution_submitted"]) == 2
                assert (await command("GET", "/integrations/github"))["connected"] is False
                report["checks"] = [
                    "Saved draft selected by continuation",
                    "Two real submissions pass all eight tests",
                    "Repeated success counts as one solve",
                    "Shared roadmap progress updates",
                    "Matching local-day detail records",
                    "Disconnected GitHub never blocks local progress",
                ]
        finally:
            process.send_signal(signal.SIGTERM)
            await asyncio.wait_for(process.wait(), timeout=15)
        (Path(output) if output else ROOT / "docs/dashboard-verification.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binaries", help="Directory containing packaged service and worker")
    parser.add_argument("--output")
    args = parser.parse_args()
    asyncio.run(verify(args.binaries, args.output))
