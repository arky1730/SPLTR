$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust is required to build the installer. Install it from https://rustup.rs and restart the terminal."
}
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
    throw "MSVC link.exe was not found. Install Visual Studio 2022 Build Tools with 'Desktop development with C++', then run this script from a Developer PowerShell."
}

& (Join-Path $PSScriptRoot "prepare-windows-resources.ps1")
npm.cmd run test
if ($LASTEXITCODE -ne 0) { throw "Tests failed." }
npm.cmd run tauri build
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed." }

$installer = Get-ChildItem -Path (Join-Path $repoRoot "src-tauri\target\release\bundle\nsis") -Filter "*.exe" | Select-Object -First 1
if (-not $installer) { throw "NSIS installer was not produced." }
$sizeMb = [math]::Round($installer.Length / 1MB, 1)
Write-Host "Installer: $($installer.FullName) ($sizeMb MB)"
if ($sizeMb -gt 120) { Write-Warning "Installer exceeds the 120 MB target." }
