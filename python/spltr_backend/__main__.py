from __future__ import annotations

import os
from pathlib import Path

from .service import run_service


if __name__ == "__main__":
    data = Path(os.environ.get("SPLTR_APP_DATA", Path.cwd() / ".spltr-data"))
    ffmpeg = Path(os.environ.get("SPLTR_FFMPEG", "ffmpeg"))
    run_service(data, ffmpeg)

