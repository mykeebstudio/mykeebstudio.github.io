$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $PSScriptRoot 'build-rynk-wasm-wsl.sh'
$LogDir = Join-Path $RepoRoot '.cache\logs'
$LogPath = Join-Path $LogDir 'rynk-wasm-wsl.log'

# Normalize the shell script to LF before handing it to WSL. This avoids
# Windows checkout/editor CRLF conversion breaking `set -euo pipefail`.
$text = [System.IO.File]::ReadAllText($ScriptPath)
$text = $text -replace "`r`n", "`n"
$text = $text -replace "`r", "`n"
[System.IO.File]::WriteAllText($ScriptPath, $text, [System.Text.UTF8Encoding]::new($false))

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Push-Location $RepoRoot
try {
    Write-Host "[run] WSL Rynk WASM build"
    Write-Host "[log] $LogPath"

    & wsl bash -x ./scripts/build-rynk-wasm-wsl.sh 2>&1 | Tee-Object -FilePath $LogPath
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        Write-Host ""
        Write-Host "=== RYNK WASM BUILD LOG TAIL ==="
        Get-Content $LogPath -Tail 100
        throw "WSL Rynk WASM build failed with exit code $exitCode. Full log: $LogPath"
    }
}
finally {
    Pop-Location
}
