# Studio

`studio` is the Next.js dashboard frontend for Studyspace.

## Features

- Dashboard overview and workflow launchers
- Transcript workflow UI
- Study RAG workflow UI
- Docs library/editor workflow
- IDE practice workflow
- Forum workflow (**experimental / unfinished**)

## Run

```powershell
npm install
npm run dev
```

Default URL: `http://localhost:3000/dashboard`

## Quality Checks

```powershell
npm run lint
npm run typecheck
```

## Backend Integration

Studio expects these local endpoints:
- Transcript service: `http://127.0.0.1:8000/api/v1`
- Local RAG service: `http://127.0.0.1:9999`
- IDE codebot (Ollama): `http://127.0.0.1:11434` using Qwen by default (`qwen2.5-coder:3b`)

Use the workspace launcher (`../start-studyspace.ps1`) for coordinated startup.

## Forum Note

Forum is intentionally marked as unfinished. It is intended to evolve toward a Discord-style channel experience with AI assistant support, but it is not feature-complete yet.
