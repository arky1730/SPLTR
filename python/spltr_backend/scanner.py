from __future__ import annotations

from pathlib import Path
from collections.abc import Iterable


AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".aiff", ".aif", ".ogg"}


def is_audio(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS


def scan_paths(raw_paths: Iterable[str]) -> tuple[list[str], list[str]]:
    found: dict[str, Path] = {}
    rejected: list[str] = []
    for raw in raw_paths:
        path = Path(raw)
        if path.is_dir():
            try:
                candidates = path.rglob("*")
                for candidate in candidates:
                    if is_audio(candidate):
                        found.setdefault(str(candidate.resolve()).casefold(), candidate.resolve())
            except OSError:
                rejected.append(str(path))
        elif is_audio(path):
            resolved = path.resolve()
            found.setdefault(str(resolved).casefold(), resolved)
        else:
            rejected.append(str(path))
    return [str(path) for path in found.values()], rejected

