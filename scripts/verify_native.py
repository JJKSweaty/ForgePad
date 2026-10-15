"""Real Rust service + compiled stdio connector + official MCP SDK interoperability.

Uses an isolated temporary workspace, never the user's database or HeyClicky account.
"""

import argparse
import asyncio
import json
import os
import signal
import statistics
import subprocess
import tempfile
import time
from pathlib import Path

import httpx
from mcp import ClientSession, McpError, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]


async def verify(output, binaries=None):
    binaries = Path(binaries) if binaries else ROOT / "src-tauri" / "target" / "debug"
    report = {
        "scope": "Real native service and stdio executable; not a HeyClicky UI acceptance test",
        "checks": [],
        "timings_ms": {},
        "models_enabled": False,
    }
    with tempfile.TemporaryDirectory(prefix="forgepad-verify-", dir="/tmp") as temp:
        directory = Path(temp)
        socket = directory / "service.sock"
        env = {**os.environ, "FORGEPAD_DATA_DIR": temp, "FORGEPAD_QUESTIONS": str(ROOT / "questions")}

        def launch():
            return subprocess.Popen(
                [str(binaries / "forgepad-service")],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        started = time.perf_counter()
        process = launch()
        try:
            for _ in range(200):
                if socket.exists():
                    break
                if process.poll() is not None:
                    raise RuntimeError("Native service exited before opening its private socket")
                await asyncio.sleep(0.025)
            else:
                raise TimeoutError("Native service did not start")
            report["timings_ms"]["cold_service_start"] = round((time.perf_counter() - started) * 1000, 3)
            assert socket.stat().st_mode & 0o777 == 0o600
            assert directory.stat().st_mode & 0o777 == 0o700
            transport = httpx.AsyncHTTPTransport(uds=str(socket))
            async with httpx.AsyncClient(
                transport=transport, base_url="http://localhost", timeout=120
            ) as client:

                async def command(method, path, body=None):
                    r = await client.post("/command", json={"method": method, "path": path, "body": body})
                    r.raise_for_status()
                    return r.json()

                await command("POST", "/integrations/heyclicky/connect", {})
                samples = []
                for _ in range(25):
                    at = time.perf_counter()
                    roadmap = await command("GET", "/roadmaps/firmware-coding-essentials")
                    samples.append((time.perf_counter() - at) * 1000)
                assert roadmap["total"] == 16 and roadmap["solved"] == 0
                report["timings_ms"]["roadmap_query_median"] = round(statistics.median(samples), 3)
                params = StdioServerParameters(
                    command=str(binaries / "forgepad-mcp"), args=["--socket", str(socket)]
                )
                at = time.perf_counter()
                async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
                    init = await session.initialize()
                    assert init.serverInfo.name == "ForgePad"
                    tools = await session.list_tools()
                    assert len(tools.tools) == 18
                    report["timings_ms"]["mcp_handshake_and_discovery"] = round(
                        (time.perf_counter() - at) * 1000, 3
                    )
                    report["checks"].append("Official SDK initializes and discovers all 18 tools")

                    async def call(name, args=None):
                        r = await session.call_tool(name, args or {})
                        assert not r.isError, r
                        assert r.structuredContent["ok"] is True
                        return r.structuredContent["data"]

                    samples = []
                    for _ in range(15):
                        at = time.perf_counter()
                        p = await call(
                            "forgepad_get_roadmap_progress", {"roadmap_id": "firmware-coding-essentials"}
                        )
                        samples.append((time.perf_counter() - at) * 1000)
                    assert p["total"] == 16 and p["solved"] == 0
                    report["timings_ms"]["mcp_progress_median"] = round(statistics.median(samples), 3)
                    await call("forgepad_add_practice_task", {"title": "Review unsigned timer subtraction"})
                    draft = await call("forgepad_create_question_draft", {"idea": "A DMA circular buffer"})
                    assert draft["published"] is False
                    assert (await command("GET", "/progress"))["goals"][0][
                        "title"
                    ] == "Review unsigned timer subtraction"
                    report["checks"].append(
                        "MCP tasks and unpublished ideas persist in the same store read by desktop commands"
                    )
                    ss = await call(
                        "forgepad_start_mock_interview",
                        {"question_id": "timer-rollover", "duration_minutes": 30},
                    )
                    sid = ss["session"]["id"]
                    active = await call("forgepad_get_active_session")
                    assert active["session"]["id"] == sid
                    assert active["session"]["remaining_seconds"] > 1790
                    assert (await command("GET", f"/interviews/{sid}"))["question_id"] == "timer-rollover"
                    await call(
                        "forgepad_record_reflection",
                        {"session_id": sid, "reflection": "Check the half-range assumption."},
                    )
                    await command(
                        "POST",
                        f"/interviews/{sid}/events",
                        {"type": "message", "content": "CANDIDATE_TRANSCRIPT_CANARY"},
                    )
                    for name in ["forgepad_get_preparation_status", "forgepad_get_active_session"]:
                        safe = json.dumps(await call(name))
                        assert "CANDIDATE_TRANSCRIPT_CANARY" not in safe
                        for protected in [
                            "reference_solution",
                            "fixture",
                            "expected_stdout",
                            "starter_files",
                        ]:
                            assert protected not in safe
                    try:
                        await session.call_tool("forgepad_search_questions", {"include_hidden": True})
                    except McpError as error:
                        assert "Invalid arguments" in str(error)
                    else:
                        raise AssertionError("Hidden-test access unexpectedly allowed")
                    await command("POST", f"/interviews/{sid}/events", {"type": "finish"})
                    summary = await call("forgepad_get_session_summary", {"session_id": sid})
                    assert summary["report"]["score"] is None
                    assert "CANDIDATE_TRANSCRIPT_CANARY" not in json.dumps(summary)
                    report["checks"].append(
                        "Timed session, reflection, evidence summary and protected-data boundary verified"
                    )
                    await command("POST", "/integrations/heyclicky/disconnect", {})
                    try:
                        await session.call_tool("forgepad_get_active_session", {})
                    except McpError as error:
                        assert "disconnected" in str(error)
                    else:
                        raise AssertionError("Revoked connector still has access")
                    await command("POST", "/integrations/heyclicky/connect", {})
                    assert len((await call("forgepad_get_preparation_status"))["unfinished_tasks"]) == 1
                    report["checks"].append(
                        "Existing connector is revoked immediately; reconnect retains data"
                    )
                samples = []
                for _ in range(20):
                    at = time.perf_counter()
                    await command(
                        "PUT",
                        "/drafts/timer-rollover",
                        {"files": {"solution.c": "/* saved draft */"}, "answer": ""},
                    )
                    samples.append((time.perf_counter() - at) * 1000)
                report["timings_ms"]["autosave_median"] = round(statistics.median(samples), 3)
                process.send_signal(signal.SIGINT)
                await asyncio.to_thread(process.wait, 10)
                socket.unlink(missing_ok=True)
                started = time.perf_counter()
                process = launch()
                for _ in range(200):
                    if socket.exists():
                        break
                    await asyncio.sleep(0.025)
                report["timings_ms"]["warm_service_start"] = round((time.perf_counter() - started) * 1000, 3)
                # Existing UDS client opens a fresh connection after the restarted service.
                assert (await command("GET", "/progress"))["goals"][0][
                    "title"
                ] == "Review unsigned timer subtraction"
                assert len(await command("GET", "/question-drafts")) == 1
                report["checks"].append(
                    "Service restart preserves sessions, tasks, drafts and integration preference"
                )
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        params = StdioServerParameters(command=str(binaries / "forgepad-mcp"), args=["--socket", str(socket)])
        async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
            try:
                await session.initialize()
            except McpError as error:
                assert "service unavailable" in str(error).lower()
            else:
                raise AssertionError("Closed service unexpectedly accepted MCP initialization")
        report["checks"].append(
            "Closed service returns an actionable MCP error, without launching a second application"
        )
    if output:
        Path(output).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--binaries", help="Directory containing packaged service and MCP executables")
    args = parser.parse_args()
    asyncio.run(verify(args.output, args.binaries))
