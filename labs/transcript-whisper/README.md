# Transcript Whisper

Production-ready, open-source Whisper transcription project built with FastAPI.

## Features

- Clean package structure under `src/`
- Versioned API (`/api/v1`)
- File upload transcription endpoint
- Media path processing endpoint
- Multiple transcript formats (`txt`, `srt`, `vtt`, `tsv`, `json`)
- Health endpoint for monitoring
- Safer defaults for local use (`127.0.0.1`, bounded model cache, restricted path processing)
- Test suite with CI for GitHub
- CLI entrypoint for local usage

## Project Structure

```text
transcript_whisper/
├── .github/workflows/ci.yml
├── .env.example
├── LICENSE
├── Makefile
├── README.md
├── app.py
├── pyproject.toml
├── requirements.txt
├── src/transcript_whisper/
│   ├── api/
│   │   ├── deps.py
│   │   ├── router.py
│   │   └── routes/
│   │       ├── health.py
│   │       └── transcription.py
│   ├── core/
│   │   ├── config.py
│   │   └── logging.py
│   ├── schemas/transcription.py
│   ├── services/
│   │   ├── audio.py
│   │   ├── exporters.py
│   │   └── transcription.py
│   ├── utils/timecode.py
│   ├── cli.py
│   └── main.py
├── static/index.html
├── tests/test_app.py
├── transcribe_whisper.py
└── video_to_audio.py
```

## Quick Start

### 1. Create environment and install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
```

### 2. Install ffmpeg

```bash
brew install ffmpeg
```

### 3. Configure environment

```bash
cp .env.example .env
```

Defaults are local-first:
- `APP_HOST=127.0.0.1`
- `WHISPER_MODEL_CACHE_SIZE=1`
- `WHISPER_ALLOWED_INPUT_DIRS` limits `/process` file access. Leave it empty to allow your home directory, or set it to a path-separated list. Use `*` only if you intentionally want unrestricted path access.
- `FFMPEG_BINARY` can be set explicitly if `ffmpeg` is installed but not visible on `PATH`. On Windows, the service also attempts to auto-detect Winget-installed FFmpeg.

### 4. Run API

```bash
uvicorn transcript_whisper.main:app --host 0.0.0.0 --port 8000
```

Open:
- `http://localhost:8000/`
- `http://localhost:8000/docs`

## API Endpoints

- `GET /api/v1/healthz`
- `POST /api/v1/transcriptions/upload`
- `POST /api/v1/transcriptions/process`

Backward-compatible:
- `POST /upload`
- `POST /process`

## CLI

```bash
transcript-whisper-cli ./sample.mp4 --model small --format all --out outputs
```

## Local Quality Checks

```bash
make lint
make test
```

## Publishing to GitHub

1. `git init`
2. `git add .`
3. `git commit -m "Initial production-ready structure"`
4. Create repo on GitHub
5. `git remote add origin <repo-url>`
6. `git push -u origin main`
