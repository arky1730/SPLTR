from __future__ import annotations

from contextlib import contextmanager
from collections.abc import Iterator
from pathlib import Path
import subprocess
import tempfile

from .errors import ProcessingError


@contextmanager
def decodable_audio(source: Path, temp_dir: Path, ffmpeg: Path) -> Iterator[Path]:
    """Convert compressed/container formats to a streamable float WAV when needed."""
    if source.suffix.lower() in {".wav", ".flac"}:
        yield source
        return
    temp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="spltr-", suffix=".wav", dir=temp_dir, delete=False) as handle:
        converted = Path(handle.name)
    try:
        process = subprocess.run(
            [
                str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(source), "-vn", "-c:a", "pcm_f32le", str(converted),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            check=False,
        )
        if process.returncode != 0:
            detail = process.stderr.strip().splitlines()[-1] if process.stderr.strip() else "Unknown decoder error"
            raise ProcessingError("corrupt_audio", f"FFmpeg could not decode this audio: {detail}")
        yield converted
    except OSError as exc:
        raise ProcessingError("ffmpeg_missing", "The bundled FFmpeg component could not be started.") from exc
    finally:
        converted.unlink(missing_ok=True)

