param(
    [int]$Port = 4174,
    [switch]$SkipRynkWasm,
    [switch]$NoInstall,
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

$Root = (git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $Root) {
    throw 'Run this inside the MyKeebStudio git repository.'
}
$Root = $Root.Trim()
Set-Location $Root

$Branch = (git branch --show-current).Trim()
if ($Branch -ne 'feature/rmk-usb') {
    Write-Warning "Current branch is '$Branch'. This preview is intended for feature/rmk-usb."
}

$dirty = @(git status --porcelain=v1 --untracked-files=all)
if ($dirty.Count -gt 0) {
    Write-Host '[info] Working tree has local changes; they will be included in the preview.'
}

if (-not $SkipRynkWasm -and (Test-Path (Join-Path $Root 'scriptsuild-rynk-wasm-via-wsl.ps1'))) {
    Write-Host '[1/3] Building Rynk WASM locally via WSL'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scriptsuild-rynk-wasm-via-wsl.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw "Rynk WASM build failed with exit code $LASTEXITCODE"
    }
} else {
    Write-Host '[1/3] Skipping Rynk WASM build'
}

if (-not $NoInstall) {
    Write-Host '[2/3] Installing dependencies'
    if (Test-Path (Join-Path $Root 'package-lock.json')) {
        & npm.cmd ci
    } else {
        & npm.cmd install --no-package-lock
    }
    if ($LASTEXITCODE -ne 0) { throw 'npm dependency installation failed.' }
} else {
    Write-Host '[2/3] Skipping dependency installation'
}

Write-Host '[3/3] Building production-equivalent dist'
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'npm build failed.' }

$Dist = Join-Path $Root 'dist'
if (-not (Test-Path (Join-Path $Dist 'index.html'))) {
    throw 'dist/index.html was not generated.'
}

if (-not $NoOpen) {
    Start-Process "http://localhost:$Port/"
}

Write-Host ''
Write-Host '========================================'
Write-Host ' MyKeebStudio LOCAL TEST ENVIRONMENT'
Write-Host '========================================'
Write-Host " Branch : $Branch"
Write-Host " URL    : http://localhost:$Port/"
Write-Host ' Build  : production-equivalent Vite dist'
Write-Host ' Stop   : Ctrl+C'
Write-Host '========================================'
Write-Host ''

& npm.cmd run preview -- --host 0.0.0.0 --port $Port
if ($LASTEXITCODE -ne 0) {
    throw "Vite preview failed with exit code $LASTEXITCODE"
}
