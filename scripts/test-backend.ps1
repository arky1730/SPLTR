$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = $env:SPLTR_TEST_PYTHON
if (-not $python) {
    $command = Get-Command python -ErrorAction SilentlyContinue
    if ($command) { $python = $command.Source }
}
if (-not $python) {
    $bundled = Join-Path $repoRoot "src-tauri\resources\python\python.exe"
    if (Test-Path -LiteralPath $bundled) { $python = $bundled }
}
if (-not $python) { throw "Python 3.12+ was not found. Set SPLTR_TEST_PYTHON or run npm run prepare:windows." }

Push-Location (Join-Path $repoRoot "python")
try {
    $testTempParent = Join-Path $repoRoot "build"
    New-Item -ItemType Directory -Force -Path $testTempParent | Out-Null
    & $python -m pytest --basetemp (Join-Path $testTempParent "pytest-temp")
    if ($LASTEXITCODE -ne 0) { throw "Backend tests failed." }
} finally {
    Pop-Location
}
