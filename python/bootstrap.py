"""Small launcher bundled with portable Python.

The heavy AI runtime is installed once into AppData so the Windows installer can
remain small. It writes the same JSON-lines protocol as the application backend.
"""

from __future__ import annotations

import argparse
from collections import deque
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import NoReturn


TORCH_VERSION = "2.5.1"
DEMUCS_VERSION = "4.1.0"
RUNTIME_VERSION = f"torch-{TORCH_VERSION}_demucs-{DEMUCS_VERSION}"
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


def build_install_command(runtime: Path, requirements: Path, cuda: bool) -> list[str]:
    """Build the deterministic pip command used by the packaged runtime."""
    index = CUDA_INDEX if cuda else CPU_INDEX
    wheel_suffix = "+cu121" if cuda else "+cpu"
    return [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-warn-script-location",
        "--upgrade",
        "--prefer-binary",
        "--only-binary",
        "demucs",
        "--target",
        str(runtime),
        f"torch=={TORCH_VERSION}{wheel_suffix}",
        f"torchaudio=={TORCH_VERSION}{wheel_suffix}",
        "-r",
        str(requirements),
        "--index-url",
        index,
        "--extra-index-url",
        "https://pypi.org/simple",
    ]


def latest_error(lines: deque[str]) -> str | None:
    for line in reversed(lines):
        cleaned = line.strip()
        if cleaned.lower().startswith(("error:", "fatal:")):
            return cleaned[:300]
    return None


def install_runtime(runtime: Path, requirements: Path, log_file: Path) -> None:
    runtime.mkdir(parents=True, exist_ok=True)
    cuda = has_nvidia_gpu()
    emit({
        "type": "runtime_download",
        "state": "started",
        "progress": -1,
        "message": "Downloading the local CUDA engine..." if cuda else "Downloading the local CPU engine...",
    })

    command = build_install_command(runtime, requirements, cuda)
    recent_output: deque[str] = deque(maxlen=30)
    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with log_file.open("a", encoding="utf-8", errors="replace") as log:
            log.write(f"\nInstalling {RUNTIME_VERSION}\n")
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            assert process.stdout is not None
            for line in process.stdout:
                log.write(line)
                log.flush()
                recent_output.append(line)
            return_code = process.wait()
    except OSError as exc:
        fail(f"Could not start the AI runtime installer: {exc}. Log: {log_file}")

    if return_code != 0:
        detail = latest_error(recent_output)
        suffix = f" {detail}" if detail else ""
        fail(
            f"AI runtime installation failed (exit code {return_code}).{suffix} "
            f"Details: {log_file}"
        )
    emit({"type": "runtime_download", "state": "completed", "progress": 100})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-data", required=True, type=Path)
    parser.add_argument("--ffmpeg", required=True, type=Path)
    args = parser.parse_args()

    app_data: Path = args.app_data.resolve()
    backend_dir = Path(__file__).resolve().parent
    runtime = app_data / "runtime" / "site-packages"
    runtime_marker = app_data / "runtime" / "version.txt"
    models = app_data / "models"
    logs = app_data / "logs"
    for folder in (models, app_data / "temp", logs):
        folder.mkdir(parents=True, exist_ok=True)

    installed_version = ""
    if runtime_marker.exists():
        installed_version = runtime_marker.read_text(encoding="utf-8", errors="replace").strip()
    if installed_version != RUNTIME_VERSION and runtime.exists():
        shutil.rmtree(runtime)
    runtime.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(runtime))
    os.environ["TORCH_HOME"] = str(models / "torch")
    os.environ["DEMUCS_CACHE"] = str(models / "demucs")
    os.environ["SPLTR_APP_DATA"] = str(app_data)
    os.environ["SPLTR_FFMPEG"] = str(args.ffmpeg)

    try:
        import torch  # noqa: F401
        import demucs  # noqa: F401
    except ImportError:
        install_runtime(
            runtime,
            backend_dir / "requirements-runtime.txt",
            logs / "runtime-install.log",
        )
        runtime_marker.write_text(RUNTIME_VERSION, encoding="utf-8")
        # Newly installed packages are discoverable because runtime is already on sys.path.

    from spltr_backend.service import run_service

    run_service(app_data=app_data, ffmpeg=args.ffmpeg)


if __name__ == "__main__":
    main()
