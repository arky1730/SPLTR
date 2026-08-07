from collections import deque
from pathlib import Path
import sys

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


def test_embeddable_python_paths_include_bundled_backend() -> None:
    original = sys.path.copy()
    try:
        bootstrap.configure_python_paths(Path("runtime"), Path("backend"))
        assert sys.path[:2] == ["runtime", "backend"]
    finally:
        sys.path[:] = original


def test_runtime_requirements_include_numpy() -> None:
    requirements = Path(bootstrap.__file__).with_name("requirements-runtime.txt").read_text(
        encoding="utf-8"
    )
    assert f"numpy=={bootstrap.NUMPY_VERSION}" in requirements
