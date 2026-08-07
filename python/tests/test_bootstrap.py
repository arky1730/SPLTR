from collections import deque
from pathlib import Path

import bootstrap


def test_runtime_install_uses_demucs_wheel_and_cpu_torch() -> None:
    command = bootstrap.build_install_command(
        Path("runtime"), Path("requirements-runtime.txt"), cuda=False
    )

    assert "--only-binary" in command
    assert command[command.index("--only-binary") + 1] == "demucs"
    assert f"torch=={bootstrap.TORCH_VERSION}+cpu" in command
    assert bootstrap.CPU_INDEX in command


def test_runtime_install_selects_cuda_wheels() -> None:
    command = bootstrap.build_install_command(
        Path("runtime"), Path("requirements-runtime.txt"), cuda=True
    )

    assert f"torch=={bootstrap.TORCH_VERSION}+cu121" in command
    assert f"torchaudio=={bootstrap.TORCH_VERSION}+cu121" in command
    assert bootstrap.CUDA_INDEX in command


def test_latest_error_returns_last_pip_error() -> None:
    output = deque(["Downloading package\n", "ERROR: first\n", "ERROR: final reason\n"])
    assert bootstrap.latest_error(output) == "ERROR: final reason"
