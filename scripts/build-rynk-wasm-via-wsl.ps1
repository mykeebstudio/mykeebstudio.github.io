$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $PSScriptRoot 'build-rynk-wasm-wsl.sh'

# Normalize the shell script to LF before handing it to WSL. This avoids
# Windows checkout/editor CRLF conversion breaking `set -euo pipefail`.
$text = [System.IO.File]::ReadAllText($ScriptPath)
$text = $text -replace "`r`n", "`n"
$text = $text -replace "`r", "`n"
[System.IO.File]::WriteAllText($ScriptPath, $text, [System.Text.UTF8Encoding]::new($false))

Push-Location $RepoRoot
try {
    & wsl bash ./scripts/build-rynk-wasm-wsl.sh
    if ($LASTEXITCODE -ne 0) {
        throw "WSL Rynk WASM build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
