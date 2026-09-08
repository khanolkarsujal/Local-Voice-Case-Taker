from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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


class PatientCase(BaseModel):
    """Editable structured history; the original transcript is stored separately."""

    chief_complaint: str = ""
    history_of_present_illness: str = ""
    onset: str = ""
    duration: str = ""
    location: str = ""
    severity: str = ""
    character: str = ""
    aggravating_factors: list[str] = Field(default_factory=list)
    relieving_factors: list[str] = Field(default_factory=list)
    associated_symptoms: list[str] = Field(default_factory=list)
    past_medical_history: list[str] = Field(default_factory=list)
    medications: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    family_history: list[str] = Field(default_factory=list)
    social_history: list[str] = Field(default_factory=list)
    other_information: list[str] = Field(default_factory=list)
    information_not_obtained: list[str] = Field(default_factory=list)


class CaseUpdates(BaseModel):
    """Partial case payload returned by the local LLM after each answer."""

    model_config = ConfigDict(extra="ignore")

    chief_complaint: str | None = None
    history_of_present_illness: str | None = None
    onset: str | None = None
    duration: str | None = None
    location: str | None = None
    severity: str | None = None
    character: str | None = None
    aggravating_factors: list[str] | None = None
    relieving_factors: list[str] | None = None
    associated_symptoms: list[str] | None = None
    past_medical_history: list[str] | None = None
    medications: list[str] | None = None
    allergies: list[str] | None = None
    family_history: list[str] | None = None
    social_history: list[str] | None = None
    other_information: list[str] | None = None
    information_not_obtained: list[str] | None = None


class InterviewDecision(BaseModel):
    """Strict structured response expected from Ollama."""

    model_config = ConfigDict(extra="ignore")

    next_question: str = ""
    case_updates: CaseUpdates = Field(default_factory=CaseUpdates)
    interview_complete: bool = False
    current_section: str = "chief_complaint"
    information_not_obtained: list[str] = Field(default_factory=list)


class TranscriptEntry(BaseModel):
    speaker: Literal["assistant", "patient"]
    text: str
    timestamp: str


class InterviewSession(BaseModel):
    session_id: str
    status: Literal["not_started", "in_progress", "completed"] = "not_started"
    current_section: str = "chief_complaint"
    case: PatientCase = Field(default_factory=PatientCase)
    transcript: list[TranscriptEntry] = Field(default_factory=list)
    asked_questions: list[str] = Field(default_factory=list)
    is_demo: bool = False
    demo_step: int = 0


class InterviewTurnResponse(BaseModel):
    session_id: str
    transcript: str = ""
    response: str
    audio_base64: str = ""
    audio_mime: str = "audio/wav"
    audio_error: str | None = None
    case: PatientCase
    conversation: list[TranscriptEntry]
    interview_complete: bool = False
    status: Literal["not_started", "in_progress", "completed"] = "in_progress"
    current_section: str = "chief_complaint"
    is_demo: bool = False


class CaseEditRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=120)
    case: PatientCase