"""Disposable browser QA bridge to the real native service. Never uses the user's workspace."""

import asyncio
import os
import signal
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

ROOT = Path(__file__).resolve().parents[1]


@asynccontextmanager
async def lifespan(app):
    (ROOT / "data").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="browser-qa-", dir=ROOT / "data") as directory:
        env = {**os.environ, "FORGEPAD_DATA_DIR": directory, "FORGEPAD_QUESTIONS": str(ROOT / "questions")}
        process = await asyncio.create_subprocess_exec(
            str(ROOT / "src-tauri/target/debug/forgepad-service"),
            env=env,
        )
        socket = Path(directory) / "service.sock"
        try:
            for _ in range(200):
                if socket.exists():
                    break
                if process.returncode is not None:
                    raise RuntimeError("QA native service failed to start")
                await asyncio.sleep(0.05)
            async with httpx.AsyncClient(
                transport=httpx.AsyncHTTPTransport(uds=str(socket)), base_url="http://localhost", timeout=180
            ) as client:
                app.state.client = client
                response = await client.post(
                    "/command",
                    json={
                        "method": "PUT",
                        "path": "/settings/runner",
                        "body": {
                            "image": "forgepad-runner:local",
                            "docker_context": os.getenv("DOCKER_CONTEXT", ""),
                            "scratch_directory": os.getenv(
                                "FORGEPAD_RUNNER_TMPDIR", str(ROOT / "data/qa-runner")
                            ),
                        },
                    },
                )
                response.raise_for_status()
                yield
        finally:
            if process.returncode is None:
                process.send_signal(signal.SIGTERM)
                await asyncio.wait_for(process.wait(), timeout=20)


app = FastAPI(lifespan=lifespan)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def bridge(path: str, request: Request):
    body = await request.body()
    import json

    response = await app.state.client.post(
        "/command",
        json={
            "method": request.method,
            "path": f"/{path}" + (f"?{request.url.query}" if request.url.query else ""),
            "body": json.loads(body) if body else None,
        },
    )
    return JSONResponse(response.json(), status_code=response.status_code)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=4180)
