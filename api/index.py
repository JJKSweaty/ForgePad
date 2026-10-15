"""Vercel ASGI entrypoint; production must use durable storage."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from forgepad.main import create_app

app = create_app()
