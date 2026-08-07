$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resources = Join-Path $repoRoot "src-tauri\resources"
$pythonDir = Join-Path $resources "python"
$ffmpegDir = Join-Path $resources "ffmpeg"
$downloadDir = Join-Path $repoRoot "build\downloads"
$pythonVersion = "3.12.10"
$pythonZip = Join-Path $downloadDir "python-$pythonVersion-embed-amd64.zip"
$ffmpegZip = Join-Path $downloadDir "ffmpeg-release-essentials.zip"

function Assert-ChildPath([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the repository: $full"
    }
}

function Get-File([string]$Url, [string]$Destination) {
    if (Test-Path -LiteralPath $Destination) { return }
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

New-Item -ItemType Directory -Force -Path $downloadDir, $resources | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $pythonDir "python.exe"))) {
    Assert-ChildPath $pythonDir
    if (Test-Path -LiteralPath $pythonDir) { Remove-Item -LiteralPath $pythonDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null
    Get-File "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" $pythonZip
    Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonDir -Force

    $pthFile = Get-ChildItem -LiteralPath $pythonDir -Filter "python*._pth" | Select-Object -First 1
    if (-not $pthFile) { throw "Python embedded path configuration was not found." }
    $pth = Get-Content -LiteralPath $pthFile.FullName
    $pth = $pth | ForEach-Object { if ($_ -eq "#import site") { "import site" } else { $_ } }
    Set-Content -LiteralPath $pthFile.FullName -Value $pth -Encoding ascii

    $getPip = Join-Path $downloadDir "get-pip.py"
    Get-File "https://bootstrap.pypa.io/get-pip.py" $getPip
    & (Join-Path $pythonDir "python.exe") $getPip --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw "pip bootstrap failed." }
}

if (-not (Test-Path -LiteralPath (Join-Path $ffmpegDir "ffmpeg.exe"))) {
    Assert-ChildPath $ffmpegDir
    if (Test-Path -LiteralPath $ffmpegDir) { Remove-Item -LiteralPath $ffmpegDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
    Get-File "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" $ffmpegZip
    $extractDir = Join-Path $downloadDir "ffmpeg-extracted"
    Assert-ChildPath $extractDir
    if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }
    Expand-Archive -LiteralPath $ffmpegZip -DestinationPath $extractDir -Force
    $ffmpegExe = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    if (-not $ffmpegExe) { throw "ffmpeg.exe was not found in the downloaded archive." }
    Copy-Item -LiteralPath $ffmpegExe.FullName -Destination (Join-Path $ffmpegDir "ffmpeg.exe")
    Remove-Item -LiteralPath $extractDir -Recurse -Force
}

Write-Host "Windows resources are ready."
