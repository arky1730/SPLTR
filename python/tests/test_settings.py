from pathlib import Path

import pytest

from spltr_backend.settings import Settings


def test_updates_valid_settings() -> None:
    settings = Settings().update({
        "model": "mdx_extra", "deviceMode": "cpu", "outputMode": "custom",
        "outputFolder": "C:/Output", "concurrentJobs": 2,
    })
    assert settings.model == "mdx_extra"
    assert settings.device_mode == "cpu"
    assert settings.output_folder == Path("C:/Output")
    assert settings.concurrent_jobs == 2


def test_custom_output_requires_folder() -> None:
    with pytest.raises(ValueError, match="custom output"):
        Settings().update({"outputMode": "custom", "outputFolder": None})


def test_rejects_unknown_model() -> None:
    with pytest.raises(ValueError, match="Unknown model"):
        Settings().update({"model": "mystery-model"})

