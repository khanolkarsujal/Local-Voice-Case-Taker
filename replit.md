# Local Real-Time Voice Chatbot

A local-only browser voice loop that transcribes microphone audio with faster-whisper, answers with Ollama, and speaks the response with Piper.

## Run & Operate

- `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload` — run the local voice app
- `python -m compileall -q backend` — check Python syntax
- `node --check frontend/app.js` — check browser JavaScript syntax
- Required local services: Ollama on `127.0.0.1:11434`, Piper on `127.0.0.1:5000`, and a cached faster-whisper model

## Stack

- Python, FastAPI, Uvicorn, Pydantic, httpx
- STT: faster-whisper small by default, configured for CPU/int8
- LLM: local Ollama qwen3:8b
- TTS: local Piper en_US-lessac-medium
- Frontend: HTML, CSS, browser MediaRecorder, WebSocket state events

## Where things live

- `backend/main.py` — FastAPI routes, lifecycle, WebSocket updates, and static frontend serving
- `backend/stt.py`, `backend/llm.py`, `backend/tts.py` — provider interfaces and local implementations
- `backend/conversation.py` — bounded in-memory history per browser session
- `frontend/` — voice-first interface and microphone/audio loop
- `.env.example` and `README.md` — local configuration and exact Windows setup

## Architecture decisions

- Provider interfaces keep STT, LLM, and TTS replaceable without changing the conversation flow.
- Whisper loads lazily once on the first transcription request; failures leave the server available so `/health` can explain what is missing.
- Audio turns use a simple REST upload/response loop; the WebSocket is reserved for lightweight state and transcript updates.
- The app binds to local service addresses by default and does not expose Ollama or Piper.

## Product

Start a voice interview, automatically stop after a short pause, view the live transcript and response, hear local Piper audio, continue the conversation, use text as a fallback, clear the session, and inspect the health of all three local providers.

## User preferences

The final application is intended to run on the user's Windows computer, not against hosted/cloud AI services.

## Gotchas

- Install dependencies inside a Windows virtual environment before starting FastAPI.
- The browser needs microphone permission and a secure/local origin; `127.0.0.1` is supported.
- The Piper HTTP wrapper must expose `POST /synthesize`; the app accepts either per-request voice selection or a server-configured voice.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
