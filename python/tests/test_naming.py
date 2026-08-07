from pathlib import Path

from spltr_backend.naming import available_stem_paths


def test_uses_plain_names_when_available(tmp_path: Path) -> None:
    vocals, instrumental = available_stem_paths(Path("Great Song.mp3"), tmp_path)
    assert vocals.name == "Great Song_vocals.wav"
    assert instrumental.name == "Great Song_instrumental.wav"


def test_increments_pair_when_either_output_exists(tmp_path: Path) -> None:
    (tmp_path / "song_vocals.wav").touch()
    (tmp_path / "song_instrumental (1).wav").touch()
    vocals, instrumental = available_stem_paths(Path("song.flac"), tmp_path)
    assert vocals.name == "song_vocals (2).wav"
    assert instrumental.name == "song_instrumental (2).wav"

