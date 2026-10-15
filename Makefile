.PHONY: setup runner backend frontend test build check-public

setup:
	python3 -m venv .venv
	.venv/bin/python -m pip install -e '.[dev]'
	cd frontend && npm ci

runner:
	docker build -t forgepad-runner:local sandbox

backend:
	.venv/bin/python -m uvicorn forgepad.api:app --host 127.0.0.1 --port 8000

frontend:
	cd frontend && npm run dev -- --host 127.0.0.1

test:
	.venv/bin/python -m pytest
	cd frontend && npm test

build:
	cd frontend && npm run build

check-public:
	python3 scripts/check_public.py --history
