"""Run 8 instrumented interview turns against local Whisper, Ollama, and Piper."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.case_taking import (  # noqa: E402
    MEDICAL_GREETING,
    InterviewStore,
    build_medical_messages,
    missing_case_fields,
)
from backend.config import settings  # noqa: E402
from backend.llm import OllamaProvider  # noqa: E402
from backend.models import InterviewDecision  # noqa: E402
from backend.stt import LocalWhisperProvider  # noqa: E402
from backend.tts import PiperProvider  # noqa: E402
from backend.latency import elapsed_ms, log_event, now_ms  # noqa: E402


FALLBACK = {
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

ANSWERS = [
    "I've had a dry cough for about three weeks and it is getting more noticeable.",
    "It started gradually around three weeks ago.",
    "There isn't much pain. The cough is mild most of the time but worse at night.",
    "Warm tea helps a little. Cold air makes it worse.",
    "No fever or chest pain. I have a little runny nose but no shortness of breath.",
    "I have seasonal allergies, but no other ongoing conditions.",
    "I take an over-the-counter antihistamine when my allergies flare up.",
    "No, that is everything I can think of.",
]


def fallback_question(session) -> str:
    from backend.case_taking import missing_case_fields as missing

    for label in missing(session.case):
        if label in FALLBACK:
            return FALLBACK[label]
    return "Is there anything else you would like the clinician to know?"


async def run() -> None:
    session_id = "latency-bench"
    store = InterviewStore()
    whisper = LocalWhisperProvider(settings.whisper_model, settings.whisper_device, settings.whisper_compute_type)
    ollama = OllamaProvider(settings.ollama_url, settings.ollama_model, settings.request_timeout_seconds)
    piper = PiperProvider(settings.piper_url, settings.piper_voice, settings.request_timeout_seconds)

    online = await ollama.is_online()
    piper_online = await piper.is_online()
    log_event("bench_start", ollama_online=online[0], ollama_detail=online[1], piper_online=piper_online[0])
    if not online[0]:
        raise SystemExit(f"Ollama unavailable: {online[1]}")
    if not piper_online[0]:
        raise SystemExit(f"Piper unavailable: {piper_online[1]}")

    store.start(session_id)
    greet_started = now_ms()
    greeting_audio = await piper.synthesize(MEDICAL_GREETING)
    log_event("greeting_tts", ms=elapsed_ms(greet_started), audio_bytes=len(greeting_audio))

    for index, answer in enumerate(ANSWERS, start=1):
        turn_started = now_ms()
        spoken = await piper.synthesize(answer)
        log_event("stt_fixture_tts", turn=index, ms=elapsed_ms(now_ms()), audio_bytes=len(spoken))
        stt_started = now_ms()
        transcript = await whisper.transcribe(spoken, suffix=".wav")
        stt_ms = elapsed_ms(stt_started)

        other_started = now_ms()
        session = store.record_patient(session_id, transcript)
        messages = build_medical_messages(session, transcript)
        prompt_chars = sum(len(item.get("content", "")) for item in messages)
        other_before_llm_ms = elapsed_ms(other_started)
        llm_started = now_ms()
        decision = await ollama.structured(messages, InterviewDecision)
        llm_ms = elapsed_ms(llm_started)

        question = decision.next_question.strip()
        asked = {item.casefold() for item in session.asked_questions}
        if not decision.interview_complete and (not question or question.casefold() in asked):
            question = fallback_question(session)
            decision.current_section = "follow_up"
        if decision.interview_complete and not decision.information_not_obtained:
            decision.information_not_obtained = missing_case_fields(session.case)
        updated = store.apply_decision(session_id, decision, question)
        response_text = (
            "Thank you. I have finished collecting the information for this interview."
            if updated.status == "completed"
            else question
        )
        tts_started = now_ms()
        question_audio = await piper.synthesize(response_text)
        tts_ms = elapsed_ms(tts_started)
        other_ms = other_before_llm_ms + elapsed_ms(post_started) if False else 0.0
        log_event(
            "turn",
            session_id=session_id,
            turn=index,
            stt_ms=round(stt_ms, 1),
            llm_ms=round(llm_ms, 1),
            tts_ms=round(tts_ms, 1),
            other_ms=round(max(0.0, other_ms), 1),
            total_ms=elapsed_ms(turn_started),
            prompt_chars=prompt_chars,
            transcript_entries=len(updated.transcript),
            asked_questions=len(updated.asked_questions),
            stt_transcript=transcript,
            question=response_text,
            llm_calls=1,
            extra_piper_for_stt_fixture_bytes=len(spoken),
            question_audio_bytes=len(question_audio),
            interview_complete=updated.status == "completed",
        )
        print(
            f"turn {index}: STT={stt_ms:.0f}ms LLM={llm_ms:.0f}ms TTS={tts_ms:.0f}ms "
            f"other={other_ms:.0f}ms total={elapsed_ms(turn_started):.0f}ms",
            flush=True,
        )
        if updated.status == "completed":
            break

    await ollama.close()
    await piper.close()
    print(f"logged to {ROOT / 'logs' / 'latency.jsonl'}", flush=True)


if __name__ == "__main__":
    asyncio.run(run())
