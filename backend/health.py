from __future__ import annotations

from .llm import OllamaProvider
from .models import HealthResponse
from .stt import LocalWhisperProvider
from .tts import PiperProvider


async def get_health(
    ollama: OllamaProvider,
    piper: PiperProvider,
    whisper: LocalWhisperProvider,
) -> HealthResponse:
    ollama_online, ollama_detail = await ollama.is_online()
    piper_online, piper_detail = await piper.is_online()
    whisper_ready = whisper.is_ready()

    details: dict[str, str] = {}
    if ollama_detail:
        details["ollama"] = ollama_detail
    if piper_detail:
        details["piper"] = piper_detail
    if whisper.startup_error:
        details["whisper"] = whisper.startup_error
    elif not whisper.load_attempted:
        details["whisper"] = "Whisper has not loaded yet; it will load on the first transcription request."

    all_ready = ollama_online and piper_online and whisper_ready
    return HealthResponse(
        status="ok" if all_ready else "degraded",
        ollama="online" if ollama_online else "offline",
        piper="online" if piper_online else "offline",
        whisper="ready" if whisper_ready else ("failed" if whisper.startup_error else "not_loaded"),
        details=details,
    )