from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable


ProgressCallback = Callable[[float], None]


@dataclass(frozen=True, slots=True)
class StemOutputs:
    vocals: Path
    instrumental: Path


class SeparationModel(ABC):
    """Extension point for future stem separators and enhancement models."""

    @abstractmethod
    def ensure_available(self) -> None: ...

    @abstractmethod
    def separate(
        self,
        source: Path,
        outputs: StemOutputs,
        device: str,
        progress: ProgressCallback,
    ) -> None: ...

