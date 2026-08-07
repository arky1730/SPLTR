from __future__ import annotations

import json
import sys
import threading
from typing import Any, TextIO


class EventWriter:
    """Thread-safe JSON-lines event writer."""

    def __init__(self, stream: TextIO = sys.stdout) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def emit(self, event_type: str, **payload: object) -> None:
        message: dict[str, object] = {"type": event_type, **payload}
        with self._lock:
            self._stream.write(json.dumps(message, ensure_ascii=False) + "\n")
            self._stream.flush()


def parse_command(line: str) -> dict[str, Any]:
    value = json.loads(line)
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise ValueError("Command must be a JSON object with a string type")
    return value

