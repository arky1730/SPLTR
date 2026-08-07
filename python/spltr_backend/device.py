from __future__ import annotations

from dataclasses import asdict, dataclass

import torch

from .settings import DeviceMode


@dataclass(frozen=True, slots=True)
class DeviceInfo:
    type: str
    name: str
    cuda_available: bool
    memory_gb: float | None = None

    def to_protocol(self) -> dict[str, object]:
        payload = asdict(self)
        payload["cudaAvailable"] = payload.pop("cuda_available")
        payload["memoryGb"] = payload.pop("memory_gb")
        return payload


def detect_device(mode: DeviceMode = "auto") -> DeviceInfo:
    cuda = bool(torch.cuda.is_available())
    if mode == "cuda" and not cuda:
        raise RuntimeError("CUDA was requested, but no compatible NVIDIA GPU is available.")
    if cuda and mode != "cpu":
        properties = torch.cuda.get_device_properties(0)
        return DeviceInfo("cuda", properties.name, True, round(properties.total_memory / 1024**3, 1))
    return DeviceInfo("cpu", "CPU", cuda)

