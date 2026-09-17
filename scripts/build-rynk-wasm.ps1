$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CacheRoot = Join-Path $RepoRoot '.cache\rmk'
$PublicRoot = Join-Path $RepoRoot 'public\rynk-wasm'
$RmkRef = 'f626c6e391821d917934042a988f99f1cc02b6b2'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required' }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Rust/cargo is required' }
if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
    Write-Host '[setup] wasm-pack not found; installing it with cargo...'
    cargo install wasm-pack
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CacheRoot) | Out-Null
if (-not (Test-Path (Join-Path $CacheRoot '.git'))) {
    Write-Host '[setup] cloning official RMK source...'
    git clone https://github.com/rmk-rs/rmk.git $CacheRoot
}

Push-Location $CacheRoot
try {
    git fetch --tags origin
    git checkout --detach $RmkRef
    rustup target add wasm32-unknown-unknown | Out-Host

    $WasmDir = Join-Path $CacheRoot 'rynk\rynk-wasm'
    Push-Location $WasmDir
    try {
        Write-Host '[build] building official rynk-wasm...'
        wasm-pack build --target web --release
    }
    finally {
        Pop-Location
    }

    if (Test-Path $PublicRoot) { Remove-Item -Recurse -Force $PublicRoot }
    New-Item -ItemType Directory -Force -Path $PublicRoot | Out-Null
    Copy-Item -Recurse -Force (Join-Path $WasmDir 'pkg\*') $PublicRoot
    Write-Host "[ok] Rynk WASM copied to $PublicRoot"
}
finally {
    Pop-Location
}
