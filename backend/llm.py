from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError


class LLMError(RuntimeError):
    """Base error for local language-model failures."""


StructuredModel = TypeVar("StructuredModel", bound=BaseModel)


class LLMProvider(ABC):
    @abstractmethod
    async def chat(self, messages: list[dict[str, str]]) -> str:
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError


def _remove_reasoning(text: str) -> str:
    """Remove Qwen-style internal reasoning blocks before text reaches the UI."""
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.IGNORECASE | re.DOTALL)
    return cleaned.strip()


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str, timeout_seconds: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.client = httpx.AsyncClient(timeout=timeout_seconds)

    async def chat(self, messages: list[dict[str, str]]) -> str:
        try:
            response = await self.client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                    "options": {"temperature": 0.7},
                },
            )
            response.raise_for_status()
            payload: dict[str, Any] = response.json()
            content = payload.get("message", {}).get("content")
            if not isinstance(content, str) or not content.strip():
                raise LLMError("Ollama returned an empty response.")
            return _remove_reasoning(content)
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            raise LLMError(f"Ollama returned HTTP {exc.response.status_code}: {detail}") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"Could not reach Ollama at {self.base_url}: {exc}") from exc
        except ValueError as exc:
            raise LLMError("Ollama returned invalid JSON.") from exc

    async def structured(
        self,
        messages: list[dict[str, str]],
        response_model: type[StructuredModel],
    ) -> StructuredModel:
        """Ask Ollama for JSON and validate it before it reaches the case store."""
        try:
            response = await self.client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0.2},
                },
            )
            response.raise_for_status()
            payload: dict[str, Any] = response.json()
            content = payload.get("message", {}).get("content")
            if not isinstance(content, str) or not content.strip():
                raise LLMError("Ollama returned an empty structured response.")
            cleaned = _remove_reasoning(content)
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned.strip(), flags=re.IGNORECASE)
            return response_model.model_validate_json(cleaned)
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            raise LLMError(f"Ollama returned HTTP {exc.response.status_code}: {detail}") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"Could not reach Ollama at {self.base_url}: {exc}") from exc
        except (ValueError, ValidationError) as exc:
            raise LLMError("Ollama returned JSON that did not match the medical case schema.") from exc

    async def is_online(self) -> tuple[bool, str | None]:
        try:
            response = await self.client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            models = response.json().get("models", [])
            names = {model.get("name") for model in models if isinstance(model, dict)}
            if self.model not in names:
                return False, f"Model {self.model} is not listed in Ollama."
            return True, None
        except Exception as exc:
            return False, str(exc)

    async def close(self) -> None:
        await self.client.aclose()