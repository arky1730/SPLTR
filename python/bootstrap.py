"""Small launcher bundled with portable Python.

The heavy AI runtime is installed once into AppData so the Windows installer can
remain small. It writes the same JSON-lines protocol as the application backend.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import NoReturn


TORCH_VERSION = "2.5.1"
CUDA_INDEX = "https://download.pytorch.org/whl/cu121"
CPU_INDEX = "https://download.pytorch.org/whl/cpu"


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def fail(message: str) -> NoReturn:
    emit({"type": "runtime_download", "state": "failed", "progress": -1, "message": message})
    raise SystemExit(2)


def has_nvidia_gpu() -> bool:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return False
    try:
        return subprocess.run(
            [executable, "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            timeout=8,
            check=False,
        ).returncode == 0
    except OSError:
        return False


def install_runtime(runtime: Path, requirements: Path) -> None:
    runtime.mkdir(parents=True, exist_ok=True)
    emit({
        "type": "runtime_download",
        "state": "started",
        "progress": -1,
        "message": "Downloading the local CUDA engine…" if has_nvidia_gpu() else "Downloading the local CPU engine…",
    })
    index = CUDA_INDEX if has_nvidia_gpu() else CPU_INDEX
    wheel_suffix = "+cu121" if index == CUDA_INDEX else "+cpu"
    torch_spec = f"torch=={TORCH_VERSION}{wheel_suffix}"
    audio_spec = f"torchaudio=={TORCH_VERSION}{wheel_suffix}"
    base = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location", "--target", str(runtime)]
    try:
        subprocess.run(
            [
                *base, torch_spec, audio_spec, "-r", str(requirements),
                "--index-url", index, "--extra-index-url", "https://pypi.org/simple",
            ],
            stdout=sys.stderr,
            stderr=sys.stderr,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        fail(f"AI runtime installation failed (exit code {exc.returncode}). Check your connection and retry.")
    emit({"type": "runtime_download", "state": "completed", "progress": 100})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-data", required=True, type=Path)
    parser.add_argument("--ffmpeg", required=True, type=Path)
    args = parser.parse_args()

    app_data: Path = args.app_data.resolve()
    backend_dir = Path(__file__).resolve().parent
    runtime = app_data / "runtime" / "site-packages"
    models = app_data / "models"
    for folder in (runtime, models, app_data / "temp", app_data / "logs"):
        folder.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(runtime))
    os.environ["TORCH_HOME"] = str(models / "torch")
    os.environ["DEMUCS_CACHE"] = str(models / "demucs")
    os.environ["SPLTR_APP_DATA"] = str(app_data)
    os.environ["SPLTR_FFMPEG"] = str(args.ffmpeg)

    try:
        import torch  # noqa: F401
        import demucs  # noqa: F401
    except ImportError:
        install_runtime(runtime, backend_dir / "requirements-runtime.txt")
        # Newly installed packages are discoverable because runtime is already on sys.path.

    from spltr_backend.service import run_service

    run_service(app_data=app_data, ffmpeg=args.ffmpeg)


if __name__ == "__main__":
    main()
