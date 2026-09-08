from __future__ import annotations

import asyncio
import logging
import tempfile
import threading
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


class STTError(RuntimeError):
    """Base error for speech-to-text failures."""


class WhisperUnavailableError(STTError):
    pass


class NoSpeechDetectedError(STTError):
    pass


class STTProvider(ABC):
    @abstractmethod
    def is_ready(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def transcribe(self, audio: bytes, suffix: str = ".webm") -> str:
        raise NotImplementedError


class LocalWhisperProvider(STTProvider):
    """Real faster-whisper provider with one-time, lazy model loading."""

    def __init__(self, model_name: str, device: str, compute_type: str) -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self._model: Any | None = None
        self._startup_error: str | None = None
        self._load_attempted = False
        self._load_lock = threading.Lock()

    def load(self) -> bool:
        """Load faster-whisper at most once, without providing a fake fallback."""
        if self._model is not None:
            return True

        with self._load_lock:
            if self._model is not None:
                return True
            if self._load_attempted:
                return False

            self._load_attempted = True
            logger.info(
                "Loading Whisper model: %s (%s/%s)",
                self.model_name,
                self.device,
                self.compute_type,
            )
            try:
                from faster_whisper import WhisperModel

                self._model = WhisperModel(
                    self.model_name,
                    device=self.device,
                    compute_type=self.compute_type,
                )
                self._startup_error = None
                logger.info("Whisper model loaded successfully")
                return True
            except Exception as exc:
                self._model = None
                self._startup_error = (
                    f"Could not load faster-whisper model '{self.model_name}' "
                    f"with device={self.device}, compute_type={self.compute_type}: {exc}"
                )
                logger.exception("Whisper model failed to load")
                return False

    def is_ready(self) -> bool:
        return self._model is not None

    @property
    def load_attempted(self) -> bool:
        return self._load_attempted

    @property
    def startup_error(self) -> str | None:
        return self._startup_error

    async def transcribe(self, audio: bytes, suffix: str = ".webm") -> str:
        if self._model is None:
            await asyncio.to_thread(self.load)
        if not self._model:
            detail = self._startup_error or "The faster-whisper model is not loaded."
            raise WhisperUnavailableError(detail)
        if not audio:
            raise NoSpeechDetectedError("The browser sent an empty audio recording.")

        return await asyncio.to_thread(self._transcribe_sync, audio, suffix)

    def _transcribe_sync(self, audio: bytes, suffix: str) -> str:
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                prefix="local-voice-",
                suffix=suffix if suffix.startswith(".") else ".webm",
                delete=False,
            ) as temp_file:
                temp_file.write(audio)
                temporary_path = Path(temp_file.name)

            segments, _info = self._model.transcribe(
                str(temporary_path),
                beam_size=5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
            )
            text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
            if not text:
                raise NoSpeechDetectedError(
                    "No speech was detected. Try moving closer to the microphone and speaking again."
                )
            return text
        except NoSpeechDetectedError:
            raise
        except Exception as exc:
            raise STTError(f"Speech transcription failed: {exc}") from exc
        finally:
            if temporary_path:
                temporary_path.unlink(missing_ok=True)