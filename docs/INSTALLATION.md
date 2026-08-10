# Installation and usage

## System requirements

- 64-bit Windows 10 or Windows 11
- 8 GB RAM minimum; 16 GB recommended
- Several GB of free storage for the local AI runtime, models, and temporary audio
- NVIDIA GPU with a current driver recommended; CPU processing is supported but slower
- Internet access on first launch and when selecting a model that has not been cached

## Install

Choose one package from the latest GitHub release:

- **Installer:** run `SPLTR_*_x64-setup.exe`. Keep the default per-user install location; administrator access is not required.
- **Portable:** extract all files from `SPLTR_*_x64-portable.zip`, keep the folder together, and run `SPLTR.exe`.

Open SPLTR while connected to the internet. It downloads the appropriate local Torch runtime and selected Demucs model once. After setup, separation works offline with cached models.

Runtime files are stored under `%APPDATA%\app.spltr.desktop`:

- `models` — downloaded Demucs checkpoints
- `runtime` — Torch and Demucs Python packages
- `temp` — transient decoded audio; files are removed after each job
- `logs` — `spltr.log` plus nine rotated backups

## Separate audio

1. Drag files or folders into the drop area. Folder scanning is recursive.
2. Keep **Beside source** or choose a custom output folder.
3. Optionally select a Demucs model or processing device in Settings.
4. Select **Separate**.

When a track completes, select it in the queue to compare **Original**, **Vocals**, and **Instrumental** in the result monitor. Use the folder button on the queue row or **Show in folder** in the monitor to reveal the generated WAV files in File Explorer.

The waveform is generated locally with the bundled FFmpeg. **Wave display** defaults to **Auto**, which raises quiet peaks only on screen; it never changes playback volume or exported audio. Fixed 1×, 2×, 4×, and 8× display gain options are also available.

Drag the **IN** and **OUT** handles to select a clip, or drag the highlighted middle section to move the whole selection. Use **Zoom** to switch between Fit, 2×, 4×, 8×, and 16× views; an enlarged timeline scrolls horizontally and recenters on the selection. Start and end fields and keyboard handle adjustments support 0.01-second precision. The 4–30 second preset slider keeps IN fixed and moves OUT; near the end of a track it shifts the complete selection left to preserve the requested length. **Preview clip** plays only the selected range, and **Full track** resets it.

**Edge finish** can add 0–2 seconds of silence independently before and after the selected audio. Edge fade options range from Off to 250 ms and default to 50 ms to reduce clicks or abrupt cuts. Preview reproduces the leading silence, faded audio, and trailing silence. The displayed output duration includes both silence pads.

The export controls use the currently selected **Original**, **Vocals**, or **Instrumental** track. Choose **WAV** or **MP3**, then select **Export audio**, or select **Black MP4** for an 854×480 H.264/AAC video. Silence and fade settings apply identically to audio and video. Exports follow the configured output destination. Trimmed files use `_clip`; full audio exports use `_export`. Existing files are never overwritten and receive `(1)`, `(2)`, and later suffixes when needed.

For `song.mp3`, SPLTR creates `song_vocals.wav` and `song_instrumental.wav`. Existing output is never overwritten. If either name exists, SPLTR creates the next matched pair, such as `song_vocals (1).wav` and `song_instrumental (1).wav`.

## Troubleshooting

- **GPU unavailable:** update the NVIDIA driver, or use Auto/CPU in Settings.
- **GPU out of memory:** close GPU-heavy apps, use one parallel job, or switch to CPU.
- **Corrupted audio:** try opening or re-exporting the source in an audio editor. The queue continues after a failed file.
- **Download failed:** check the connection and firewall, then select Retry. Partial package downloads can be retried safely.
- **Model cache problem:** when idle, use Settings → Delete cached models and let SPLTR download the model again.
- **Runtime setup failure:** open `%APPDATA%\app.spltr.desktop\logs\runtime-install.log` for the exact package-install error.
- **Debugging:** attach `%APPDATA%\app.spltr.desktop\logs\spltr.log`. Logs contain technical errors and paths but never audio content.
