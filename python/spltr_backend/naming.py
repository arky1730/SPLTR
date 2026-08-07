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


def available_video_path(vocals: Path, clipped: bool) -> Path:
    """Return a non-colliding MP4 path beside a vocal stem."""
    base = f"{vocals.stem}{'_clip' if clipped else ''}"
    suffix = 0
    while True:
        marker = "" if suffix == 0 else f" ({suffix})"
        output = vocals.parent / f"{base}{marker}.mp4"
        if not output.exists():
            return output
        suffix += 1
