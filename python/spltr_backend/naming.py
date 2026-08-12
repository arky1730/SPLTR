from __future__ import annotations

from pathlib import Path


def available_stem_paths(source: Path, output_dir: Path) -> tuple[Path, Path]:
    """Return a non-colliding vocals/instrumental pair without creating files."""
    base = source.stem
    suffix = 0
    while True:
        marker = "" if suffix == 0 else f" ({suffix})"
        vocals = output_dir / f"{base}_vocals{marker}.wav"
        instrumental = output_dir / f"{base}_instrumental{marker}.wav"
        if not vocals.exists() and not instrumental.exists():
            return vocals, instrumental
        suffix += 1


def available_video_path(source: Path, clipped: bool, output_dir: Path | None = None) -> Path:
    """Return a non-colliding MP4 path in the configured export directory."""
    base = f"{source.stem}{'_clip' if clipped else ''}"
    directory = output_dir or source.parent
    suffix = 0
    while True:
        marker = "" if suffix == 0 else f" ({suffix})"
        output = directory / f"{base}{marker}.mp4"
        if not output.exists():
            return output
        suffix += 1


def available_audio_export_path(
    source: Path,
    output_dir: Path,
    audio_format: str,
    clipped: bool,
) -> Path:
    """Return a non-colliding WAV or MP3 export path."""
    if audio_format not in {"wav", "mp3"}:
        raise ValueError(f"Unsupported audio export format: {audio_format}")
    base = f"{source.stem}{'_clip' if clipped else '_export'}"
    suffix = 0
    while True:
        marker = "" if suffix == 0 else f" ({suffix})"
        output = output_dir / f"{base}{marker}.{audio_format}"
        if not output.exists():
            return output
        suffix += 1


def available_extracted_audio_path(source: Path, output_dir: Path, audio_format: str) -> Path:
    """Return a non-colliding audio path for a video extraction."""
    if audio_format not in {"wav", "mp3"}:
        raise ValueError(f"Unsupported extracted audio format: {audio_format}")
    suffix = 0
    while True:
        marker = "" if suffix == 0 else f" ({suffix})"
        output = output_dir / f"{source.stem}_audio{marker}.{audio_format}"
        if not output.exists():
            return output
        suffix += 1
