from __future__ import annotations

import base64
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .conversation import ConversationStore
from .health import get_health
from .llm import LLMError, OllamaProvider
from .models import AudioEvent, ResponseEvent, StateEvent, TextTurnRequest, TranscriptEvent, TurnResponse
from .stt import LocalWhisperProvider, NoSpeechDetectedError, STTError, WhisperUnavailableError
from .tts import PiperProvider, TTSError


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(session_id, set()).add(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        session = self._connections.get(session_id)
        if not session:
            return
        session.discard(websocket)
        if not session:
            self._connections.pop(session_id, None)

    async def send(self, session_id: str, payload: object) -> None:
        stale: list[WebSocket] = []
        for websocket in self._connections.get(session_id, set()):
            try:
                await websocket.send_text(json.dumps(payload))
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(session_id, websocket)


conversation_store = ConversationStore()
connections = ConnectionManager()
whisper_provider = LocalWhisperProvider(
    settings.whisper_model,
    settings.whisper_device,
    settings.whisper_compute_type,
)
ollama_provider = OllamaProvider(settings.ollama_url, settings.ollama_model, settings.request_timeout_seconds)
piper_provider = PiperProvider(settings.piper_url, settings.piper_voice, settings.request_timeout_seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    whisper_provider.load()
    yield
    await ollama_provider.close()
    await piper_provider.close()


app = FastAPI(
    title="Local Real-Time Voice Chatbot",
    description="A local-only microphone, Whisper, Ollama, Piper, and browser speaker pipeline.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _process_turn(session_id: str, transcript: str) -> TurnResponse:
    await connections.send(session_id, StateEvent(state="processing").model_dump())
    messages = conversation_store.messages_for(session_id, transcript)

    try:
        response_text = await ollama_provider.chat(messages)
    except LLMError as exc:
        await connections.send(session_id, StateEvent(state="error").model_dump())
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    conversation_store.add_turn(session_id, transcript, response_text)
    await connections.send(session_id, ResponseEvent(text=response_text).model_dump())
    await connections.send(session_id, StateEvent(state="speaking").model_dump())

    try:
        audio = await piper_provider.synthesize(response_text)
    except TTSError as exc:
        await connections.send(session_id, StateEvent(state="error").model_dump())
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    await connections.send(session_id, AudioEvent().model_dump())
    return TurnResponse(
        session_id=session_id,
        transcript=transcript,
        response=response_text,
        audio_base64=base64.b64encode(audio).decode("ascii"),
    )


@app.get("/health")
async def health():
    return await get_health(ollama_provider, piper_provider, whisper_provider)


@app.post("/api/turn", response_model=TurnResponse)
async def voice_turn(
    audio: UploadFile = File(...),
    session_id: str = Query(default="default", min_length=1, max_length=120),
):
    audio_bytes = await audio.read()
    if len(audio_bytes) > settings.max_audio_bytes:
        raise HTTPException(status_code=413, detail="Audio recording is too large.")

    try:
        transcript = await whisper_provider.transcribe(
            audio_bytes,
            suffix=Path(audio.filename or "recording.webm").suffix or ".webm",
        )
    except NoSpeechDetectedError as exc:
        await connections.send(session_id, StateEvent(state="error").model_dump())
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except WhisperUnavailableError as exc:
        await connections.send(session_id, StateEvent(state="error").model_dump())
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except STTError as exc:
        await connections.send(session_id, StateEvent(state="error").model_dump())
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await connections.send(session_id, TranscriptEvent(text=transcript).model_dump())
    return await _process_turn(session_id, transcript)


@app.post("/api/text-turn", response_model=TurnResponse)
async def text_turn(request: TextTurnRequest):
    transcript = request.text.strip()
    if not transcript:
        raise HTTPException(status_code=422, detail="Text cannot be empty.")
    await connections.send(request.session_id, TranscriptEvent(text=transcript).model_dump())
    return await _process_turn(request.session_id, transcript)


@app.post("/api/conversation/clear")
async def clear_conversation(session_id: str = Query(default="default", min_length=1, max_length=120)):
    conversation_store.clear(session_id)
    await connections.send(session_id, StateEvent(state="idle").model_dump())
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, session_id: str = Query(default="default")):
    await connections.connect(session_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connections.disconnect(session_id, websocket)
    except Exception:
        connections.disconnect(session_id, websocket)


frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/assets", StaticFiles(directory=frontend_dir), name="assets")


@app.get("/")
async def index():
    return FileResponse(frontend_dir / "index.html")