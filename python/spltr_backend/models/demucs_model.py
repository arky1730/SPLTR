from __future__ import annotations

from pathlib import Path

import torch
from demucs.apply import apply_model
from demucs.audio import AudioFile, save_audio
from demucs.pretrained import get_model

from ..errors import ProcessingError
from .base import ProgressCallback, SeparationModel, StemOutputs


class DemucsModel(SeparationModel):
    def __init__(self, name: str) -> None:
        self.name = name
        self._model: object | None = None

    def _load(self) -> object:
        if self._model is None:
            self._model = get_model(self.name)
        return self._model

    def ensure_available(self) -> None:
        self._load()

    def separate(self, source: Path, outputs: StemOutputs, device: str, progress: ProgressCallback) -> None:
        progress(8)
        try:
            model = self._load()
            # Demucs models expose these runtime attributes; typing is unavailable upstream.
            model.to(device)  # type: ignore[attr-defined]
            model.eval()  # type: ignore[attr-defined]
            progress(14)
            wav = AudioFile(str(source)).read(
                streams=0,
                samplerate=model.samplerate,  # type: ignore[attr-defined]
                channels=model.audio_channels,  # type: ignore[attr-defined]
            )
            reference = wav.mean(0)
            mean = reference.mean()
            std = reference.std().clamp_min(1e-8)
            normalized = (wav - mean) / std
            progress(20)
            with torch.inference_mode():
                separated = apply_model(
                    model,
                    normalized[None],
                    device=device,
                    shifts=1,
                    split=True,
                    overlap=0.25,
                    progress=False,
                )[0]
            separated = separated * std + mean
            sources: list[str] = model.sources  # type: ignore[attr-defined]
            vocals_index = sources.index("vocals")
            vocals = separated[vocals_index]
            instrumental = separated[[i for i in range(len(sources)) if i != vocals_index]].sum(0)
            progress(94)
            save_audio(vocals.cpu(), outputs.vocals, model.samplerate, clip="rescale", as_float=True)  # type: ignore[attr-defined]
            save_audio(instrumental.cpu(), outputs.instrumental, model.samplerate, clip="rescale", as_float=True)  # type: ignore[attr-defined]
            progress(100)
        except RuntimeError as exc:
            if "out of memory" in str(exc).lower():
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                raise ProcessingError(
                    "out_of_memory",
                    "GPU memory ran out. Close other GPU apps, choose one parallel job, or switch to CPU.",
                ) from exc
            raise ProcessingError("processing_failed", f"The AI model could not process this file: {exc}") from exc
        except (ValueError, OSError) as exc:
            raise ProcessingError("corrupt_audio", f"This audio file could not be decoded: {exc}") from exc

