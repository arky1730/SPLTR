from array import array
from pathlib import Path

import pytest

from spltr_backend.media_tools import (
    build_audio_export_command,
    build_black_video_command,
    build_export_audio_filter,
    waveform_peaks_from_pcm,
)


def test_waveform_reduces_and_normalizes_pcm() -> None:
    pcm = array("f", [0.0, 0.5, -1.0, 0.25]).tobytes()
    assert waveform_peaks_from_pcm(pcm, bucket_count=2) == [0.5, 1.0]


def test_waveform_rejects_invalid_bucket_count() -> None:
    with pytest.raises(ValueError):
        waveform_peaks_from_pcm(b"", bucket_count=0)


def test_black_video_command_is_480p_and_clipped() -> None:
    command = build_black_video_command(
        Path("ffmpeg.exe"), Path("song_vocals.wav"), Path("song_vocals_clip.mp4"), 12.5, 42.0
    )
    assert "color=c=black:s=854x480:r=30" in command
    assert command[command.index("-ss") + 1] == "12.500"
    assert command[command.index("-t") + 1] == "29.500"
    assert command[-1] == "song_vocals_clip.mp4"


@pytest.mark.parametrize(
    ("audio_format", "codec"),
    [("wav", "pcm_s24le"), ("mp3", "libmp3lame")],
)
def test_audio_export_command_is_clipped_and_uses_expected_codec(
    audio_format: str, codec: str
) -> None:
    output = Path(f"song_vocals_clip.{audio_format}")
    command = build_audio_export_command(
        Path("ffmpeg.exe"), Path("song_vocals.wav"), output, audio_format, 4.0, 19.0  # type: ignore[arg-type]
    )
    assert command[command.index("-ss") + 1] == "4.000"
    assert command[command.index("-t") + 1] == "15.000"
    assert command[command.index("-c:a") + 1] == codec
    assert command[-1] == str(output)


def test_export_filter_adds_fades_and_silence_padding() -> None:
    audio_filter = build_export_audio_filter(15.0, 0.25, 0.5, 0.05)
    assert "afade=t=in:st=0:d=0.050" in audio_filter
    assert "afade=t=out:st=14.950:d=0.050" in audio_filter
    assert "adelay=250:all=1" in audio_filter
    assert "apad=pad_dur=0.500" in audio_filter


def test_black_video_applies_audio_finish_filter() -> None:
    command = build_black_video_command(
        Path("ffmpeg.exe"), Path("song_vocals.wav"), Path("song_vocals_clip.mp4"),
        2.0, 12.0, 10.0, 0.1, 0.25, 0.05,
    )
    assert "-af" in command
    audio_filter = command[command.index("-af") + 1]
    assert "adelay=100:all=1" in audio_filter
    assert "apad=pad_dur=0.250" in audio_filter
