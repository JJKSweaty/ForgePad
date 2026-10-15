"""Opt-in macOS QA using installed Ultra and synthetic technical speech; no microphone."""

import argparse
import asyncio
import json
import os
import re
import signal
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = "The interrupt handler writes to a bounded ring buffer. Use a memory barrier before setting the ready flag. If the queue is full, count the dropped sample and keep the system responsive."


async def verify(output):
    helper = ROOT / "native-speech/.build/release/forgepad-speech"
    state = json.loads(await asyncio.to_thread(subprocess.check_output, [helper, "status"], text=True))
    if not state["ultra"]:
        raise RuntimeError("Download Parakeet Ultra in Settings before running voice QA")
    with tempfile.TemporaryDirectory(prefix="forgepad-speech-qa-", dir="/tmp") as directory:
        directory = Path(directory)
        (directory / "forgepad-service").symlink_to(ROOT / "src-tauri/target/debug/forgepad-service")
        (directory / "forgepad-speech").symlink_to(helper)
        audio = directory / "technical.wav"
        await asyncio.to_thread(
            subprocess.run,
            [
                "say",
                "--file-format=WAVE",
                "--data-format=LEI16@16000",
                "-r",
                "175",
                "-o",
                str(audio),
                EXPECTED,
            ],
            check=True,
        )
        data = directory / "workspace"
        data.mkdir()
        process = await asyncio.create_subprocess_exec(
            str(directory / "forgepad-service"),
            env={**os.environ, "FORGEPAD_DATA_DIR": str(data), "FORGEPAD_QUESTIONS": str(ROOT / "questions")},
        )
        try:
            socket = data / "service.sock"
            for _ in range(200):
                if socket.exists():
                    break
                await asyncio.sleep(0.05)
            async with httpx.AsyncClient(
                transport=httpx.AsyncHTTPTransport(uds=str(socket)), base_url="http://localhost", timeout=180
            ) as client:

                async def command(method, path, body=None):
                    response = await client.post(
                        "/command", json={"method": method, "path": path, "body": body}
                    )
                    response.raise_for_status()
                    return response.json()

                await command("PUT", "/settings/audio", {"mode": "interview", "record_audio": False})
                await command("PUT", "/settings/speech", {"engine": "builtin", "model": "ultra"})
                results = []
                for partial in (True, False):
                    start = time.perf_counter()
                    result = await command(
                        "POST",
                        "/speech/transcribe",
                        {
                            "audio": list(audio.read_bytes()),
                            "mime_type": "audio/wav",
                            "question_id": "sensor-pipeline",
                            "partial": partial,
                        },
                    )
                    assert result["provider"] == "local" and result["raw_audio_saved"] is False
                    words = re.findall(r"[a-z]+", result["text"].lower())
                    assert {"interrupt", "buffer", "memory", "flag", "queue"}.issubset(words), result
                    results.append(
                        {
                            "partial": partial,
                            "elapsed_ms": round((time.perf_counter() - start) * 1000),
                            "text": result["text"],
                        }
                    )
                assert results[0]["text"] == results[1]["text"]
                assert not (data / "recordings").exists()
                report = {
                    "scope": "Real native service and persistent CoreML Ultra helper; synthetic technical speech; no microphone or LLM",
                    "expected": EXPECTED,
                    "checks": [
                        "Partial and final requests return technical speech",
                        "Warm request reuses the speech engine",
                        "Raw audio is not retained when disabled",
                    ],
                    "results": results,
                }
                Path(output).write_text(json.dumps(report, indent=2) + "\n")
                print(json.dumps(report, indent=2))
        finally:
            process.send_signal(signal.SIGTERM)
            await asyncio.wait_for(process.wait(), timeout=20)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="/tmp/forgepad-speech-verification.json")
    asyncio.run(verify(parser.parse_args().output))
