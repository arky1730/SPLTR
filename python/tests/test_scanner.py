from pathlib import Path

from spltr_backend.scanner import scan_paths


def test_scans_folders_recursively_and_filters_extensions(tmp_path: Path) -> None:
    nested = tmp_path / "album" / "disc"
    nested.mkdir(parents=True)
    (nested / "track.MP3").touch()
    (nested / "notes.txt").touch()
    files, rejected = scan_paths([str(tmp_path / "album")])
    assert len(files) == 1
    assert files[0].endswith("track.MP3")
    assert rejected == []


def test_rejects_missing_and_unsupported_paths(tmp_path: Path) -> None:
    text = tmp_path / "readme.txt"
    text.touch()
    files, rejected = scan_paths([str(text), str(tmp_path / "missing.wav")])
    assert files == []
    assert len(rejected) == 2

