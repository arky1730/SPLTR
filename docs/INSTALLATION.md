# Installation and usage

## System requirements

- 64-bit Windows 10 or Windows 11
- 8 GB RAM minimum; 16 GB recommended
- Several GB of free storage for the local AI runtime, models, and temporary audio
- NVIDIA GPU with a current driver recommended; CPU processing is supported but slower
- Internet access on first launch and when selecting a model that has not been cached

## Install

1. Run the `SPLTR_*_x64-setup.exe` installer.
2. Keep the default per-user install location. Administrator access is not required.
3. Open SPLTR. It downloads the appropriate local Torch runtime and the selected Demucs model once.
4. After setup, separation works offline with cached models.

Runtime files are stored under `%LOCALAPPDATA%\app.spltr.desktop`:

- `models` — downloaded Demucs checkpoints
- `runtime` — Torch and Demucs Python packages
- `temp` — transient decoded audio; files are removed after each job
- `logs` — `spltr.log` plus nine rotated backups

## Separate audio

1. Drag files or folders into the large drop area. Folder scanning is recursive.
2. Keep **Beside source** or choose a custom output folder.
3. Optionally select a Demucs model or processing device in Settings.
4. Select **Separate**.

For `song.mp3`, SPLTR creates `song_vocals.wav` and `song_instrumental.wav`. Existing output is never overwritten. If either name exists, SPLTR creates the next matched pair, such as `song_vocals (1).wav` and `song_instrumental (1).wav`.

## Troubleshooting

- **GPU unavailable:** update the NVIDIA driver, or use Auto/CPU in Settings.
- **GPU out of memory:** close GPU-heavy apps, use one parallel job, or switch to CPU.
- **Corrupted audio:** try opening or re-exporting the source in an audio editor. The queue continues after a failed file.
- **Download failed:** check the connection and firewall, then select Retry. Partial package downloads can be retried safely.
- **Model cache problem:** when idle, use Settings → Delete cached models and let SPLTR download the model again.
- **Debugging:** attach `%LOCALAPPDATA%\app.spltr.desktop\logs\spltr.log`. Logs contain technical errors and paths but never audio content.

