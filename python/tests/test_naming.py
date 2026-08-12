from pathlib import Path

from spltr_backend.naming import (
    available_audio_export_path,
    available_extracted_audio_path,
    available_stem_paths,
    available_video_path,
)


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


def test_video_path_uses_clip_suffix_and_never_overwrites(tmp_path: Path) -> None:
    vocals = tmp_path / "song_vocals.wav"
    (tmp_path / "song_vocals_clip.mp4").touch()
    assert available_video_path(vocals, clipped=True).name == "song_vocals_clip (1).mp4"
    assert available_video_path(vocals, clipped=False).name == "song_vocals.mp4"


def test_video_path_can_use_custom_output_directory(tmp_path: Path) -> None:
    source = Path("C:/Music/song_vocals.wav")
    assert available_video_path(source, clipped=True, output_dir=tmp_path) == tmp_path / "song_vocals_clip.mp4"


def test_audio_export_uses_format_suffix_and_never_overwrites(tmp_path: Path) -> None:
    source = Path("C:/Music/song_vocals.wav")
    (tmp_path / "song_vocals_clip.mp3").touch()
    assert available_audio_export_path(source, tmp_path, "mp3", clipped=True).name == "song_vocals_clip (1).mp3"
    assert available_audio_export_path(source, tmp_path, "wav", clipped=False).name == "song_vocals_export.wav"


def test_extracted_audio_uses_clear_suffix_and_never_overwrites(tmp_path: Path) -> None:
    source = Path("C:/Video/demo.mp4")
    (tmp_path / "demo_audio.wav").touch()
    assert available_extracted_audio_path(source, tmp_path, "wav").name == "demo_audio (1).wav"
