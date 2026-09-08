from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any


logger = logging.getLogger("voicecase.latency")
LOG_PATH = Path(__file__).resolve().parent.parent / "logs" / "latency.jsonl"


def _write(record: dict[str, Any]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False)
    logger.info("LATENCY %s", line)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def now_ms() -> float:
    return time.perf_counter() * 1000


def elapsed_ms(started: float) -> float:
    return round(time.perf_counter() * 1000 - started, 1)


def log_event(event: str, **fields: Any) -> None:
    record = {"event": event, **fields}
    _write(record)
