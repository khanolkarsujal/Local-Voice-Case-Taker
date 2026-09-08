from __future__ import annotations

from abc import ABC, abstractmethod

import httpx


class TTSError(RuntimeError):
    """Base error for local text-to-speech failures."""


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError


class PiperProvider(TTSProvider):
    def __init__(self, base_url: str, voice: str, timeout_seconds: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.voice = voice
        self.client = httpx.AsyncClient(timeout=timeout_seconds)

    async def synthesize(self, text: str) -> bytes:
        try:
            response = await self.client.post(
                f"{self.base_url}/synthesize",
                json={"text": text, "voice": self.voice},
            )
            if response.status_code == 422:
                # Some Piper HTTP wrappers configure the voice server-side.
                response = await self.client.post(
                    f"{self.base_url}/synthesize",
                    json={"text": text},
                )
            response.raise_for_status()
            if not response.content:
                raise TTSError("Piper returned an empty audio response.")
            return response.content
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            raise TTSError(f"Piper returned HTTP {exc.response.status_code}: {detail}") from exc
        except httpx.HTTPError as exc:
            raise TTSError(f"Could not reach Piper at {self.base_url}: {exc}") from exc

    async def is_online(self) -> tuple[bool, str | None]:
        for path in ("/health", "/"):
            try:
                response = await self.client.get(f"{self.base_url}{path}")
                if response.is_success:
                    return True, None
            except httpx.HTTPError as exc:
                last_error = str(exc)
                continue
        return False, locals().get("last_error", "Piper did not respond successfully.")

    async def close(self) -> None:
        await self.client.aclose()