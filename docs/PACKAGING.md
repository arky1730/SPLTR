# Windows packaging

## Local release build

Install Rust stable and Visual Studio C++ Build Tools, then run:

```powershell
npm ci
npm run build:windows
```

The script prepares portable resources, runs frontend/backend tests, builds the optimized Tauri app, and reports installer size. Output is written to:

`src-tauri\target\release\bundle\nsis\`

The NSIS configuration uses `currentUser`, so the installer does not request administrator privileges. Models and the heavy AI runtime are excluded from the installer.

## CI

`.github/workflows/windows-build.yml` installs Node, Rust, and Python; runs tests; prepares resources; builds NSIS; and uploads the installer artifact. Pushes to `main`/`master`, pull requests, and manual dispatch trigger the workflow.

## Signing

The included workflow produces an unsigned installer. For distribution, add a code-signing certificate through protected GitHub secrets and sign both the application executable and NSIS installer. Never commit PFX files or passwords. Windows SmartScreen may warn about an unsigned or low-reputation build.

## Release checklist

1. Update versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run all tests and a CPU/GPU format smoke matrix.
3. Build and confirm the installer remains below 120 MB.
4. Install as a standard user on clean Windows 10 and 11 VMs.
5. Verify first-run runtime/model retry, offline cached use, cache deletion, output collision handling, and uninstall.
6. Sign binaries, publish checksums, and retain third-party license notices.

