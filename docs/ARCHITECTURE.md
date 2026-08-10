# Architecture

## Overview

SPLTR has three isolated layers:

```mermaid
flowchart LR
  UI["React + TypeScript UI"] <-->|"Tauri commands/events"| Host["Rust desktop host"]
  Host <-->|"JSON Lines over stdin/stdout"| Engine["Python processing service"]
  Engine --> FF["Bundled FFmpeg"]
  Engine --> Model["Demucs model adapter"]
  Model --> Torch["Torch CUDA or CPU"]
  Engine --> Disk["Local inputs / AppData / outputs"]
```

The React layer owns interaction and presentation state. Rust owns the application window, per-user paths, dialog access, and the child-process lifetime. Python owns scanning, queue execution, decode, inference, output naming, and logs.

## IPC contract

The host starts `python.exe -u bootstrap.py`, writes one JSON command per line to stdin, and forwards each JSON event from stdout to a Tauri `backend-event`. Human-readable diagnostics go to stderr so they cannot corrupt IPC.

Commands include `configure`, `scan`, `ensure_model`, `start_queue`, `cancel_queue`, `delete_models`, `waveform`, `export_audio`, `export_video`, and `shutdown`. Events include `ready`, device changes, scan results, queue items, download state, waveform/export state, completion, and recoverable/fatal errors. Shared TypeScript types are in `src/types.ts`; backend parsing is deliberately tolerant so protocol fields can be added later.

Completed queue items expose their original path and paired stem output paths to the React result monitor. Tauri's scoped asset protocol lets the webview play these local files directly, while the `reveal_in_folder` command opens File Explorer with the selected output highlighted.

Waveforms are reduced to a compact high-density peak array by asking bundled FFmpeg for low-rate mono float PCM; full audio is never loaded into the React process. Display gain and timeline zoom are React-only transforms over this peak array and never touch audio samples. Audio export uses FFmpeg to create 24-bit WAV or 320 kbps MP3 clips. Video export combines the selected track with an 854×480 black color source. Both exporters accept an optional start/end range, apply short fades followed by finite leading/trailing silence filters, follow the configured destination, use collision-safe names, and run on a background thread.

## First launch and installer size

CUDA Torch cannot fit in a 120 MB installer. SPLTR bundles the official Windows embeddable Python distribution and FFmpeg, then installs Torch, Torchaudio, and Demucs into AppData at first launch. GPU presence is checked with `nvidia-smi`: CUDA 12.1 wheels are selected for NVIDIA systems and CPU wheels otherwise. Models remain separate and are downloaded by Demucs into the AppData model cache.

This preserves the no-manual-Python requirement and keeps the installer small. It also means first launch needs enough disk space and can take several minutes.

## Processing flow

1. Scan dropped files and directories recursively using an extension allowlist.
2. Create collision-safe paired output paths.
3. Decode compressed/container formats to a temporary float WAV through bundled FFmpeg; WAV/FLAC can be read directly.
4. Normalize audio as expected by Demucs, run chunked inference, and select the vocals source.
5. Sum all non-vocal sources into the instrumental stem.
6. Write float WAV output, clear CUDA cache, and delete temporary audio.

The queue defaults to one model instance and sequential items to limit memory. Two-job mode uses separate model instances because Torch modules are not mutated across worker threads.

## Extensibility

`SeparationModel` is the stable backend interface. A future adapter can expose other stem layouts, noise removal, or enhancement without changing queue orchestration. Protocol additions should be backward-compatible. Six-stem output will require replacing the fixed `StemOutputs` pair with a named stem mapping; that is intentionally confined to the model/output boundary.

## Failure boundaries

Every file is an independent failure boundary. Known decode, missing-file, CUDA OOM, and output errors become safe queue messages. Unknown exceptions are logged and mark only that item failed. Model/runtime downloads have retryable overlay states. The Rust process terminates the Python child when the app window is destroyed.
