from __future__ import annotations

from array import array
import math
import os
from pathlib import Path
import subprocess
import sys
from typing import Literal

from .naming import available_audio_export_path, available_video_path


class MediaToolError(RuntimeError):
    """A recoverable FFmpeg utility failure."""


def _creation_flags() -> int:
    return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def waveform_peaks_from_pcm(pcm: bytes, bucket_count: int = 240) -> list[float]:
    """Reduce little-endian mono float32 PCM into normalized peak buckets."""
    if bucket_count < 1:
        raise ValueError("bucket_count must be positive")
    usable_bytes = len(pcm) - (len(pcm) % 4)
    samples = array("f")
    samples.frombytes(pcm[:usable_bytes])
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        return []

    bucket_size = max(1, math.ceil(len(samples) / bucket_count))
    peaks = [
        max(abs(value) for value in samples[offset:offset + bucket_size])
        for offset in range(0, len(samples), bucket_size)
    ]
    ceiling = max(peaks, default=0.0)
    if ceiling <= 0:
        return [0.0 for _ in peaks]
    return [round(min(1.0, peak / ceiling), 4) for peak in peaks]


def extract_waveform(ffmpeg: Path, source: Path, bucket_count: int = 240) -> list[float]:
    if not source.exists():
        raise MediaToolError("The preview file no longer exists.")
    command = [
        str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error",
        "-i", str(source), "-vn", "-ac", "1", "-ar", "200", "-f", "f32le", "pipe:1",
    ]
    try:
        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=_creation_flags(),
        )
    except OSError as exc:
        raise MediaToolError("The bundled FFmpeg component could not be started.") from exc
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise MediaToolError(detail or "FFmpeg could not read this audio file.")
    return waveform_peaks_from_pcm(result.stdout, bucket_count)


def build_black_video_command(
    ffmpeg: Path,
    source: Path,
    output: Path,
    start_seconds: float,
    end_seconds: float | None,
) -> list[str]:
    command = [
        str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=854x480:r=30",
    ]
    if start_seconds > 0:
        command.extend(["-ss", f"{start_seconds:.3f}"])
    command.extend(["-i", str(source)])
    if end_seconds is not None:
        command.extend(["-t", f"{end_seconds - start_seconds:.3f}"])
    command.extend([
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart", str(output),
    ])
    return command


def export_black_video(
    ffmpeg: Path,
    source: Path,
    start_seconds: float = 0,
    end_seconds: float | None = None,
    output_dir: Path | None = None,
) -> Path:
    if not source.exists():
        raise MediaToolError("The selected audio file no longer exists.")
    if not math.isfinite(start_seconds) or start_seconds < 0:
        raise MediaToolError("Start time must be zero or greater.")
    if end_seconds is not None and (not math.isfinite(end_seconds) or end_seconds <= start_seconds):
        raise MediaToolError("End time must be greater than start time.")

    clipped = start_seconds > 0 or end_seconds is not None
    directory = output_dir or source.parent
    directory.mkdir(parents=True, exist_ok=True)
    output = available_video_path(source, clipped=clipped, output_dir=directory)
    command = build_black_video_command(ffmpeg, source, output, start_seconds, end_seconds)
    try:
        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=_creation_flags(),
        )
    except OSError as exc:
        raise MediaToolError("The bundled FFmpeg component could not be started.") from exc
    if result.returncode != 0:
        output.unlink(missing_ok=True)
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise MediaToolError(detail or "FFmpeg could not create the MP4 file.")
    return output


def build_audio_export_command(
    ffmpeg: Path,
    source: Path,
    output: Path,
    audio_format: Literal["wav", "mp3"],
    start_seconds: float,
    end_seconds: float | None,
) -> list[str]:
    command = [str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    if start_seconds > 0:
        command.extend(["-ss", f"{start_seconds:.3f}"])
    command.extend(["-i", str(source)])
    if end_seconds is not None:
        command.extend(["-t", f"{end_seconds - start_seconds:.3f}"])
    command.extend(["-map", "0:a:0", "-vn"])
    if audio_format == "wav":
        command.extend(["-c:a", "pcm_s24le"])
    else:
        command.extend(["-c:a", "libmp3lame", "-b:a", "320k"])
    command.append(str(output))
    return command


def export_audio_clip(
    ffmpeg: Path,
    source: Path,
    output_dir: Path,
    audio_format: Literal["wav", "mp3"],
    start_seconds: float = 0,
    end_seconds: float | None = None,
) -> Path:
    if not source.exists():
        raise MediaToolError("The selected audio file no longer exists.")
    if audio_format not in {"wav", "mp3"}:
        raise MediaToolError("Audio export format must be WAV or MP3.")
    if not math.isfinite(start_seconds) or start_seconds < 0:
        raise MediaToolError("Start time must be zero or greater.")
    if end_seconds is not None and (not math.isfinite(end_seconds) or end_seconds <= start_seconds):
        raise MediaToolError("End time must be greater than start time.")

    output_dir.mkdir(parents=True, exist_ok=True)
    clipped = start_seconds > 0 or end_seconds is not None
    output = available_audio_export_path(source, output_dir, audio_format, clipped)
    command = build_audio_export_command(
        ffmpeg, source, output, audio_format, start_seconds, end_seconds
    )
    try:
        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=_creation_flags(),
        )
    except OSError as exc:
        raise MediaToolError("The bundled FFmpeg component could not be started.") from exc
    if result.returncode != 0:
        output.unlink(missing_ok=True)
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise MediaToolError(detail or "FFmpeg could not create the audio export.")
    return output
