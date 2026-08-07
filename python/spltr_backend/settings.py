from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Literal


ModelName = Literal["htdemucs", "htdemucs_ft", "mdx_extra"]
DeviceMode = Literal["auto", "cuda", "cpu"]


@dataclass(frozen=True, slots=True)
class Settings:
    output_folder: Path | None = None
    output_mode: Literal["source", "custom"] = "source"
    model: ModelName = "htdemucs"
    device_mode: DeviceMode = "auto"
    concurrent_jobs: Literal[1, 2] = 1

    def update(self, raw: dict[str, Any]) -> "Settings":
        model = raw.get("model", self.model)
        device = raw.get("deviceMode", self.device_mode)
        output_mode = raw.get("outputMode", self.output_mode)
        jobs = raw.get("concurrentJobs", self.concurrent_jobs)
        if model not in {"htdemucs", "htdemucs_ft", "mdx_extra"}:
            raise ValueError(f"Unknown model: {model}")
        if device not in {"auto", "cuda", "cpu"}:
            raise ValueError(f"Unknown device mode: {device}")
        if output_mode not in {"source", "custom"}:
            raise ValueError(f"Unknown output mode: {output_mode}")
        if jobs not in {1, 2}:
            raise ValueError("Concurrent jobs must be 1 or 2")
        folder_raw = raw.get("outputFolder")
        folder = Path(folder_raw) if isinstance(folder_raw, str) and folder_raw else None
        if output_mode == "custom" and folder is None:
            raise ValueError("A custom output folder is required")
        return replace(
            self,
            output_folder=folder,
            output_mode=output_mode,
            model=model,
            device_mode=device,
            concurrent_jobs=jobs,
        )

