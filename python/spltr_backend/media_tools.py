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


def waveform_peaks_from_pcm(pcm: bytes, bucket_count: int = 960) -> list[float]:
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


def extract_waveform(ffmpeg: Path, source: Path, bucket_count: int = 960) -> list[float]:
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
    content_duration_seconds: float | None = None,
    silence_before_seconds: float = 0,
    silence_after_seconds: float = 0,
    output_duration_seconds: float | None = None,
    fade_in_seconds: float = 0,
    fade_out_seconds: float = 0,
) -> list[str]:
    command = [
        str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=854x480:r=30",
    ]
    if start_seconds > 0:
        command.extend(["-ss", f"{start_seconds:.3f}"])
    input_duration = end_seconds - start_seconds if end_seconds is not None else content_duration_seconds
    if input_duration is not None:
        command.extend(["-t", f"{input_duration:.3f}"])
    command.extend(["-i", str(source)])
    command.extend([
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
    ])
    audio_filter = build_export_audio_filter(
        input_duration, silence_before_seconds, silence_after_seconds,
        output_duration_seconds, fade_in_seconds, fade_out_seconds,
    )
    if audio_filter:
        command.extend(["-af", audio_filter])
    command.extend(["-shortest", "-movflags", "+faststart", str(output)])
    return command


def export_black_video(
    ffmpeg: Path,
    source: Path,
    start_seconds: float = 0,
    end_seconds: float | None = None,
    output_dir: Path | None = None,
    content_duration_seconds: float | None = None,
    silence_before_seconds: float = 0,
    silence_after_seconds: float = 0,
    output_duration_seconds: float | None = None,
    fade_in_seconds: float = 0,
    fade_out_seconds: float = 0,
) -> Path:
    if not source.exists():
        raise MediaToolError("The selected audio file no longer exists.")
    if not math.isfinite(start_seconds) or start_seconds < 0:
        raise MediaToolError("Start time must be zero or greater.")
    if end_seconds is not None and (not math.isfinite(end_seconds) or end_seconds <= start_seconds):
        raise MediaToolError("End time must be greater than start time.")
    _validate_export_effects(
        content_duration_seconds, silence_before_seconds, silence_after_seconds,
        output_duration_seconds, fade_in_seconds, fade_out_seconds,
    )

    clipped = start_seconds > 0 or end_seconds is not None
    directory = output_dir or source.parent
    directory.mkdir(parents=True, exist_ok=True)
    output = available_video_path(source, clipped=clipped, output_dir=directory)
    command = build_black_video_command(
        ffmpeg, source, output, start_seconds, end_seconds, content_duration_seconds,
        silence_before_seconds, silence_after_seconds, output_duration_seconds,
        fade_in_seconds, fade_out_seconds,
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
        raise MediaToolError(detail or "FFmpeg could not create the MP4 file.")
    return output


def build_audio_export_command(
    ffmpeg: Path,
    source: Path,
    output: Path,
    audio_format: Literal["wav", "mp3"],
    start_seconds: float,
    end_seconds: float | None,
    content_duration_seconds: float | None = None,
    silence_before_seconds: float = 0,
    silence_after_seconds: float = 0,
    output_duration_seconds: float | None = None,
    fade_in_seconds: float = 0,
    fade_out_seconds: float = 0,
) -> list[str]:
    command = [str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    if start_seconds > 0:
        command.extend(["-ss", f"{start_seconds:.3f}"])
    input_duration = end_seconds - start_seconds if end_seconds is not None else content_duration_seconds
    if input_duration is not None:
        command.extend(["-t", f"{input_duration:.3f}"])
    command.extend(["-i", str(source)])
    command.extend(["-map", "0:a:0", "-vn"])
    audio_filter = build_export_audio_filter(
        input_duration, silence_before_seconds, silence_after_seconds,
        output_duration_seconds, fade_in_seconds, fade_out_seconds,
    )
    if audio_filter:
        command.extend(["-af", audio_filter])
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
    content_duration_seconds: float | None = None,
    silence_before_seconds: float = 0,
    silence_after_seconds: float = 0,
    output_duration_seconds: float | None = None,
    fade_in_seconds: float = 0,
    fade_out_seconds: float = 0,
) -> Path:
    if not source.exists():
        raise MediaToolError("The selected audio file no longer exists.")
    if audio_format not in {"wav", "mp3"}:
        raise MediaToolError("Audio export format must be WAV or MP3.")
    if not math.isfinite(start_seconds) or start_seconds < 0:
        raise MediaToolError("Start time must be zero or greater.")
    if end_seconds is not None and (not math.isfinite(end_seconds) or end_seconds <= start_seconds):
        raise MediaToolError("End time must be greater than start time.")
    _validate_export_effects(
        content_duration_seconds, silence_before_seconds, silence_after_seconds,
        output_duration_seconds, fade_in_seconds, fade_out_seconds,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    clipped = start_seconds > 0 or end_seconds is not None
    output = available_audio_export_path(source, output_dir, audio_format, clipped)
    command = build_audio_export_command(
        ffmpeg, source, output, audio_format, start_seconds, end_seconds,
        content_duration_seconds, silence_before_seconds, silence_after_seconds,
        output_duration_seconds, fade_in_seconds, fade_out_seconds,
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


def build_export_audio_filter(
    content_duration_seconds: float | None,
    silence_before_seconds: float,
    silence_after_seconds: float,
    output_duration_seconds: float | None,
    fade_in_seconds: float,
    fade_out_seconds: float,
) -> str:
    filters: list[str] = []
    if content_duration_seconds is not None:
        effective_fade_in = min(fade_in_seconds, content_duration_seconds / 2)
        effective_fade_out = min(fade_out_seconds, content_duration_seconds / 2)
        if effective_fade_in > 0:
            filters.append(f"afade=t=in:st=0:d={effective_fade_in:.3f}")
        if effective_fade_out > 0:
            fade_out_start = max(0, content_duration_seconds - effective_fade_out)
            filters.append(f"afade=t=out:st={fade_out_start:.3f}:d={effective_fade_out:.3f}")
    if silence_before_seconds > 0:
        filters.append(f"adelay={round(silence_before_seconds * 1000)}:all=1")
    if output_duration_seconds is not None:
        filters.extend([
            f"apad=whole_dur={output_duration_seconds:.3f}",
            f"atrim=duration={output_duration_seconds:.3f}",
        ])
    elif silence_after_seconds > 0:
        filters.append(f"apad=pad_dur={silence_after_seconds:.3f}")
    return ",".join(filters)


def _validate_export_effects(
    content_duration_seconds: float | None,
    silence_before_seconds: float,
    silence_after_seconds: float,
    output_duration_seconds: float | None,
    fade_in_seconds: float,
    fade_out_seconds: float,
) -> None:
    values = [silence_before_seconds, silence_after_seconds, fade_in_seconds, fade_out_seconds]
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise MediaToolError("Silence and fade durations must be zero or greater.")
    if content_duration_seconds is not None and (
        not math.isfinite(content_duration_seconds) or content_duration_seconds <= 0
    ):
        raise MediaToolError("Clip duration must be greater than zero.")
    if output_duration_seconds is not None:
        if not math.isfinite(output_duration_seconds) or output_duration_seconds <= 0:
            raise MediaToolError("Output duration must be greater than zero.")
        if content_duration_seconds is not None:
            composed_duration = content_duration_seconds + silence_before_seconds + silence_after_seconds
            if abs(composed_duration - output_duration_seconds) > 0.03:
                raise MediaToolError("Audio and silence must exactly fill the fixed output duration.")
