# Developer setup

## Prerequisites

- Windows 10/11
- Node.js 22 or newer
- Rust stable with the MSVC target
- Visual Studio 2022 Build Tools with **Desktop development with C++**
- WebView2 (included with current Windows 10/11)
- Python 3.12+ for backend unit tests

## Setup

```powershell
npm install
python -m pip install -r python/requirements-dev.txt
npm run prepare:windows
```

`prepare:windows` downloads official embeddable Python, bootstraps pip, and extracts FFmpeg into ignored resource directories. It is idempotent and retains downloads in `build/downloads`.

## Run

Browser-only UI with a simulated backend:

```powershell
npm run dev
```

Full desktop app with bundled resources:

```powershell
npm run tauri:dev
```

For backend development without preparing embedded Python, set `SPLTR_DEV_PYTHON` to a Python executable before `tauri:dev`. Set `SPLTR_FFMPEG` when FFmpeg is not on PATH.

## Tests and quality

```powershell
npm run test:frontend
$env:SPLTR_TEST_PYTHON = "C:\path\to\python.exe"
npm run test:backend
python -m ruff check python
python -m mypy python/spltr_backend
```

Backend utility tests intentionally do not import Torch or Demucs. This keeps the normal test loop quick. A release smoke test should process short WAV, MP3, FLAC, M4A, AIFF, and OGG fixtures on both CUDA and CPU machines.

## Key directories

- `src` — strict React/TypeScript frontend
- `src-tauri` — Rust process host and NSIS configuration
- `python/spltr_backend` — typed processing service
- `python/tests` — utility unit tests
- `scripts` — resource preparation, test, and packaging scripts
- `.github/workflows` — Windows CI build

