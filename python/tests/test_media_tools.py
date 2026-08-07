from array import array
from pathlib import Path

import pytest

from spltr_backend.media_tools import build_black_video_command, waveform_peaks_from_pcm


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
