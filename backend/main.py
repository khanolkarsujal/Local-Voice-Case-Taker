from __future__ import annotations

import base64
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .case_taking import (
    DEMO_STEPS,
    MEDICAL_GREETING,
    InterviewStore,
    build_medical_messages,
    missing_case_fields,
)
from .config import settings
from .conversation import ConversationStore
from .health import get_health
from .llm import LLMError, OllamaProvider
from .models import (
    AudioEvent,
    CaseEditRequest,
    InterviewDecision,
    InterviewSession,
    InterviewTurnResponse,
    PatientCase,
    ResponseEvent,
    StateEvent,
    TextTurnRequest,
    TranscriptEvent,
    TurnResponse,
)
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
interview_store = InterviewStore()
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


def _safe_filename(session_id: str) -> str:
    return "".join(char if char.isalnum() or char in "-_" else "-" for char in session_id)


def _fallback_question(session: InterviewSession) -> str:
    candidates = {
        "chief complaint": "In your own words, what is the main problem you would like the clinician to know about?",
        "history of present illness": "Could you tell me a little more about what has been happening?",
        "onset": "When did this first begin?",
        "duration": "How long has this been going on?",
        "location": "Where do you feel the symptoms?",
        "severity": "How severe is it on a scale from zero to ten?",
        "character or quality": "How would you describe the symptom?",
        "aggravating factors": "Is there anything that makes it better or worse?",
        "relieving factors": "Is there anything that helps?",
        "associated symptoms": "Have you noticed any other symptoms?",
        "past medical history": "Do you have any ongoing medical conditions or previous health problems?",
        "current medications": "What medications or supplements are you currently taking?",
        "allergies": "Do you have any medication or other allergies?",
        "family history": "Is there any relevant family health history you would like the clinician to know about?",
        "personal and social history": "Is there anything about your work, home, or daily habits that may be relevant?",
        "other relevant information": "Is there anything else you would like the clinician to know?",
    }
    for label in missing_case_fields(session.case):
        if label in candidates:
            return candidates[label]
    return "Is there anything else you would like the clinician to know?"


async def _interview_payload(
    session: InterviewSession,
    response_text: str,
    transcript: str = "",
    use_audio: bool = True,
) -> InterviewTurnResponse:
    audio = b""
    audio_error: str | None = None
    if use_audio and not session.is_demo:
        try:
            audio = await piper_provider.synthesize(response_text)
        except TTSError as exc:
            audio_error = str(exc)
            await connections.send(session.session_id, StateEvent(state="error").model_dump())

    await connections.send(session.session_id, ResponseEvent(text=response_text).model_dump())
    await connections.send(
        session.session_id,
        StateEvent(state="completed" if session.status == "completed" else "speaking").model_dump(),
    )
    if audio:
        await connections.send(session.session_id, AudioEvent().model_dump())
    return InterviewTurnResponse(
        session_id=session.session_id,
        transcript=transcript,
        response=response_text,
        audio_base64=base64.b64encode(audio).decode("ascii"),
        audio_error=audio_error,
        case=session.case,
        conversation=session.transcript,
        interview_complete=session.status == "completed",
        status=session.status,
        current_section=session.current_section,
        is_demo=session.is_demo,
    )


async def _advance_medical_interview(session_id: str, patient_text: str) -> InterviewTurnResponse:
    session = interview_store.ensure(session_id)
    session = interview_store.record_patient(session_id, patient_text)
    await connections.send(session_id, TranscriptEvent(text=patient_text).model_dump())
    await connections.send(session_id, StateEvent(state="processing").model_dump())

    try:
        decision = await ollama_provider.structured(
            build_medical_messages(session, patient_text),
            InterviewDecision,
        )
    except LLMError as exc:
        await connections.send(session_id, StateEvent(state="error").model_dump())
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    question = decision.next_question.strip()
    asked = {item.casefold() for item in session.asked_questions}
    if not decision.interview_complete and (not question or question.casefold() in asked):
        question = _fallback_question(session)
        decision.current_section = "follow_up"

    if decision.interview_complete and not decision.information_not_obtained:
        decision.information_not_obtained = missing_case_fields(session.case)

    updated = interview_store.apply_decision(session_id, decision, question)
    if updated.status == "completed":
        response_text = (
            "Thank you. I have finished collecting the information for this interview. "
            "A qualified clinician should review the case summary and original conversation."
        )
    else:
        response_text = question
    return await _interview_payload(updated, response_text, transcript=patient_text)


@app.post("/api/interview/start", response_model=InterviewTurnResponse)
async def start_medical_interview(
    session_id: str = Query(default="default", min_length=1, max_length=120),
):
    session = interview_store.start(session_id)
    await connections.send(session_id, StateEvent(state="speaking").model_dump())
    return await _interview_payload(session, MEDICAL_GREETING)


@app.post("/api/interview/turn", response_model=InterviewTurnResponse)
async def medical_voice_turn(
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
    return await _advance_medical_interview(session_id, transcript)


@app.post("/api/interview/text-turn", response_model=InterviewTurnResponse)
async def medical_text_turn(request: TextTurnRequest):
    transcript = request.text.strip()
    if not transcript:
        raise HTTPException(status_code=422, detail="Text cannot be empty.")
    return await _advance_medical_interview(request.session_id, transcript)


@app.get("/api/interview/session", response_model=InterviewSession)
async def get_interview_session(
    session_id: str = Query(default="default", min_length=1, max_length=120),
):
    session = interview_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    return session


@app.put("/api/interview/case", response_model=InterviewSession)
async def update_interview_case(request: CaseEditRequest):
    if not interview_store.get(request.session_id):
        raise HTTPException(status_code=404, detail="Interview session not found.")
    return interview_store.set_case(request.session_id, request.case)


@app.post("/api/interview/clear")
async def clear_medical_interview(
    session_id: str = Query(default="default", min_length=1, max_length=120),
):
    interview_store.clear(session_id)
    await connections.send(session_id, StateEvent(state="idle").model_dump())
    return {"ok": True}


@app.post("/api/interview/demo/start", response_model=InterviewTurnResponse)
async def start_demo_interview(
    session_id: str = Query(default="default", min_length=1, max_length=120),
):
    session = interview_store.start(session_id, is_demo=True)
    await connections.send(session_id, StateEvent(state="speaking").model_dump())
    return await _interview_payload(session, MEDICAL_GREETING, use_audio=False)


@app.post("/api/interview/demo/step", response_model=InterviewTurnResponse)
async def demo_step(
    session_id: str = Query(default="default", min_length=1, max_length=120),
):
    session = interview_store.get(session_id)
    if not session or not session.is_demo:
        raise HTTPException(status_code=404, detail="Start Demo Mode before taking a demo step.")
    if session.status == "completed":
        return await _interview_payload(
            session,
            "This fictional interview is complete. Open the clinician review to see the case.",
            use_audio=False,
        )

    index = interview_store.increment_demo_step(session_id)
    step = DEMO_STEPS[min(index, len(DEMO_STEPS) - 1)]
    interview_store.record_patient(session_id, step["patient"])
    decision = InterviewDecision(
        next_question=step["question"],
        case_updates=step["updates"],
        interview_complete=bool(step.get("complete", False)),
        current_section=step["section"],
        information_not_obtained=step.get("not_obtained", []),
    )
    updated = interview_store.apply_decision(session_id, decision, step["question"])
    response_text = (
        "Thank you. I have finished collecting the information for this fictional demo. "
        "Open the clinician review to inspect the structured case and transcript."
        if updated.status == "completed"
        else step["question"]
    )
    await connections.send(session_id, TranscriptEvent(text=step["patient"]).model_dump())
    return await _interview_payload(updated, response_text, transcript=step["patient"], use_audio=False)


def _case_text(session: InterviewSession) -> str:
    labels = {
        "chief_complaint": "Patient Complaint",
        "history_of_present_illness": "History of Present Illness",
        "onset": "Onset",
        "duration": "Duration",
        "location": "Location",
        "severity": "Severity",
        "character": "Character / Quality",
        "aggravating_factors": "Aggravating Factors",
        "relieving_factors": "Relieving Factors",
        "associated_symptoms": "Associated Symptoms",
        "past_medical_history": "Past Medical History",
        "medications": "Medications",
        "allergies": "Allergies",
        "family_history": "Family History",
        "social_history": "Social History",
        "other_information": "Other Relevant Information",
        "information_not_obtained": "Information Not Obtained",
    }
    lines = ["PATIENT CASE SUMMARY", "AI case-taking assistant — not a diagnostic or treatment system.", ""]
    values = session.case.model_dump()
    for field, label in labels.items():
        value = values[field]
        rendered = "\n".join(f"- {item}" for item in value) if isinstance(value, list) else value
        lines.extend([label.upper(), rendered or "Not recorded", ""])
    lines.extend(["ORIGINAL CONVERSATION TRANSCRIPT", ""])
    for entry in session.transcript:
        speaker = "ASSISTANT" if entry.speaker == "assistant" else "PATIENT"
        lines.append(f"{speaker}: {entry.text}")
    lines.extend(["", "Information should be reviewed by a qualified clinician."])
    return "\n".join(lines)


@app.get("/api/interview/export.json")
async def export_case_json(
    session_id: str = Query(default="default", min_length=1, max_length=120),
):
    session = interview_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    content = json.dumps(session.model_dump(), indent=2, ensure_ascii=False)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="patient-case-{_safe_filename(session_id)}.json"'},
    )


@app.get("/api/interview/export.txt")
async def export_case_txt(
    session_id: str = Query(default="default", min_length=1, max_length=120),
):
    session = interview_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    return Response(
        content=_case_text(session),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="patient-case-{_safe_filename(session_id)}.txt"'},
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