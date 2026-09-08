from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


VoiceState = Literal["idle", "listening", "processing", "speaking", "error", "completed"]


class HealthResponse(BaseModel):
    status: str
    ollama: str
    piper: str
    whisper: str
    details: dict[str, str] = Field(default_factory=dict)


class TextTurnRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)
    session_id: str = Field(default="default", min_length=1, max_length=120)


class TurnResponse(BaseModel):
    session_id: str
    transcript: str
    response: str
    audio_base64: str
    audio_mime: str = "audio/wav"


class StateEvent(BaseModel):
    type: Literal["state"] = "state"
    state: VoiceState


class TranscriptEvent(BaseModel):
    type: Literal["transcript"] = "transcript"
    text: str


class ResponseEvent(BaseModel):
    type: Literal["response"] = "response"
    text: str


class AudioEvent(BaseModel):
    type: Literal["audio"] = "audio"
    available: bool = True