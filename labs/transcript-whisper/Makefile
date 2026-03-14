.PHONY: install dev lint test run

install:
	python3 -m pip install -e .

dev:
	python3 -m pip install -e ".[dev]"

lint:
	ruff check src tests

test:
	pytest

run:
	uvicorn transcript_whisper.main:app --host 0.0.0.0 --port 8000
