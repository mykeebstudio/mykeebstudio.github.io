param(
    [switch]$SkipRynkWasm,
    [switch]$AllowDirty,
    [switch]$NoPull
)

# Build BOTH the production site and a preview site, and publish them together
# to the gh-pages branch:
#
#   /           production  (PROD_BRANCH,    default: feature/rmk-trackball-v8)
#   /preview/   preview     (PREVIEW_BRANCH, default: feature/pg1kb-zmk-parity-battery-history)
#
# Unlike deploy-pages.ps1, this script never switches the branch of your main
# checkout. Each source branch is built in its own git worktree under .cache\,
# so the two builds cannot clobber each other.
#
# NOTE: The preview build relies on src/rmkRynkWasm.ts resolving the Rynk WASM
# runtime through import.meta.env.BASE_URL. With Vite's --base=/preview/ the
# preview loads /preview/rynk-wasm/, the production build (base /) keeps
# loading /rynk-wasm/, so both copies must be published (this script does).
#
# WARNING: Publishing with the older deploy-pages.ps1 afterwards removes
# /preview/ again, because that script replaces the whole gh-pages tree with
# the production build only. Re-run this script to bring the preview back.

$ErrorActionPreference = 'Stop'

$ProdBranch    = if ($env:PROD_BRANCH)    { $env:PROD_BRANCH }    else { 'feature/rmk-trackball-v8' }
$PreviewBranch = if ($env:PREVIEW_BRANCH) { $env:PREVIEW_BRANCH } else { 'feature/pg1kb-zmk-parity-battery-history' }
$PreviewPath   = if ($env:PREVIEW_PATH)   { $env:PREVIEW_PATH }   else { 'preview' }
$PagesBranch   = if ($env:PAGES_BRANCH)   { $env:PAGES_BRANCH }   else { 'gh-pages' }
$Remote        = if ($env:REMOTE)        { $env:REMOTE }         else { 'origin' }

if ($PreviewPath -match '^[.]|[/\\]|\.\.') {
    throw "PREVIEW_PATH must be a single path segment (got: $PreviewPath)"
}

function Invoke-Native {
    param(
        [Parameter(Mandatory=$true)][string]$File,
        [string[]]$ArgumentList = @()
    )
    & $File @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$File failed with exit code $LASTEXITCODE"
    }
}

function Remove-Worktree {
    param([Parameter(Mandatory=$true)][string]$Dir)
    if (Test-Path $Dir) {
        git worktree remove --force $Dir | Out-Null
        if (Test-Path $Dir) { Remove-Item -LiteralPath $Dir -Recurse -Force }
    }
}

function Install-Deps {
    param([Parameter(Mandatory=$true)][string]$Dir)
    Push-Location $Dir
    try {
        if (Test-Path (Join-Path $Dir 'package-lock.json')) {
            Invoke-Native -File 'npm.cmd' -ArgumentList @('ci')
        } else {
            Invoke-Native -File 'npm.cmd' -ArgumentList @('install', '--no-package-lock')
        }
    } finally {
        Pop-Location
    }
}

function Assert-RynkDist {
    param([Parameter(Mandatory=$true)][string]$DistDir)
    $rynkJs = Join-Path $DistDir 'rynk-wasm\rynk_wasm.js'
    if (-not (Test-Path $rynkJs)) {
        throw "Rynk WASM runtime is missing after build: $rynkJs"
    }
    $wasmFiles = @(Get-ChildItem -LiteralPath (Join-Path $DistDir 'rynk-wasm') -Filter '*.wasm' -File)
    if ($wasmFiles.Count -eq 0) {
        throw "No .wasm file was found in $(Join-Path $DistDir 'rynk-wasm')"
    }
}

$Root = (git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0 -or -not $Root) {
    throw 'Run this inside the MyKeebStudio git repository.'
}
$Root = $Root.Trim()
Set-Location $Root

if (-not $AllowDirty) {
    $dirty = @(git status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
    if ($dirty.Count -gt 0) {
        Write-Host '[error] Working tree is not clean.'
        $dirty | ForEach-Object { Write-Host $_ }
        throw 'Commit/stash your changes, or rerun with -AllowDirty.'
    }
}

$CacheDir   = Join-Path $Root '.cache\preview-deploy'
$ProdDir    = Join-Path $CacheDir 'prod-src'
$PreviewDir = Join-Path $CacheDir 'preview-src'
$PublishDir = Join-Path $Root '.cache\gh-pages-worktree'

try {
    Write-Host '[1/7] Fetching source branches'
    if (-not $NoPull) {
        # Do not redirect stderr of native commands in this script:
        # with $ErrorActionPreference = 'Stop', Windows PowerShell 5.1 turns
        # the first redirected stderr line (e.g. git fetch's "From https://...")
        # into a terminating NativeCommandError even when the command succeeds.
        git fetch $Remote $ProdBranch $PreviewBranch $PagesBranch
        if ($LASTEXITCODE -ne 0) {
            Invoke-Native -File 'git' -ArgumentList @('fetch', $Remote, $ProdBranch, $PreviewBranch)
        }
    }
    foreach ($branch in @($ProdBranch, $PreviewBranch)) {
        git rev-parse --verify --quiet "refs/remotes/$Remote/$branch" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Remote branch not found: $Remote/$branch" }
    }

    Write-Host '[2/7] Preparing source worktrees'
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
    Remove-Worktree $ProdDir
    Remove-Worktree $PreviewDir
    git worktree prune
    Invoke-Native -File 'git' -ArgumentList @('worktree', 'add', '--detach', $ProdDir, "$Remote/$ProdBranch")
    Invoke-Native -File 'git' -ArgumentList @('worktree', 'add', '--detach', $PreviewDir, "$Remote/$PreviewBranch")

    Write-Host '[3/7] Preparing Rynk WASM'
    $RynkPublic = Join-Path $Root 'public\rynk-wasm'
    $RynkJs = Join-Path $RynkPublic 'rynk_wasm.js'
    if ($SkipRynkWasm) {
        Write-Host '[skip] Rynk WASM build skipped.'
    } elseif (Test-Path $RynkJs) {
        Write-Host '[ok] Reusing existing public\rynk-wasm (delete it to force a rebuild).'
    } elseif (Test-Path (Join-Path $Root 'scripts\build-rynk-wasm-via-wsl.ps1')) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\build-rynk-wasm-via-wsl.ps1')
        if ($LASTEXITCODE -ne 0) {
            throw "Rynk WASM build failed with exit code $LASTEXITCODE"
        }
    } else {
        Write-Warning 'scripts\build-rynk-wasm-via-wsl.ps1 not found; continuing without a rebuild.'
    }
    if (-not (Test-Path $RynkJs)) {
        throw "Rynk WASM is not built: $RynkJs is missing. Run: npm run build:rynk-wasm"
    }
    foreach ($dir in @($ProdDir, $PreviewDir)) {
        $target = Join-Path $dir 'public\rynk-wasm'
        if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Copy-Item -Path (Join-Path $RynkPublic '*') -Destination $target -Recurse -Force
    }

    Write-Host "[4/7] Building production site ($ProdBranch -> /)"
    Install-Deps $ProdDir
    Push-Location $ProdDir
    try {
        Invoke-Native -File 'npm.cmd' -ArgumentList @('run', 'build')
    } finally {
        Pop-Location
    }
    $ProdDist = Join-Path $ProdDir 'dist'
    if (-not (Test-Path (Join-Path $ProdDist 'index.html'))) {
        throw 'Production dist\index.html was not generated.'
    }
    Assert-RynkDist $ProdDist

    Write-Host "[5/7] Building preview site ($PreviewBranch -> /$PreviewPath/)"
    Install-Deps $PreviewDir
    $tscCmd  = Join-Path $PreviewDir 'node_modules\.bin\tsc.cmd'
    $viteCmd = Join-Path $PreviewDir 'node_modules\.bin\vite.cmd'
    Push-Location $PreviewDir
    try {
        Invoke-Native -File $tscCmd  -ArgumentList @('--noEmit')
        Invoke-Native -File $viteCmd -ArgumentList @('build', "--base=/$PreviewPath/")
    } finally {
        Pop-Location
    }
    $PreviewDist = Join-Path $PreviewDir 'dist'
    $PreviewIndex = Join-Path $PreviewDist 'index.html'
    if (-not (Test-Path $PreviewIndex)) {
        throw 'Preview dist\index.html was not generated.'
    }
    if (-not (Select-String -Path $PreviewIndex -Pattern "/$PreviewPath/assets/" -Quiet)) {
        throw "Preview index.html does not reference /$PreviewPath/assets/ -- base path was not applied."
    }
    Assert-RynkDist $PreviewDist

    Write-Host "[6/7] Preparing $PagesBranch worktree"
    Remove-Worktree $PublishDir
    git worktree prune
    git ls-remote --exit-code --heads $Remote $PagesBranch | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Invoke-Native -File 'git' -ArgumentList @('fetch', $Remote, $PagesBranch)
        Invoke-Native -File 'git' -ArgumentList @('worktree', 'add', '-B', $PagesBranch, $PublishDir, "$Remote/$PagesBranch")
    } else {
        Invoke-Native -File 'git' -ArgumentList @('worktree', 'add', '--detach', $PublishDir, 'HEAD')
        Push-Location $PublishDir
        try {
            Invoke-Native -File 'git' -ArgumentList @('switch', '--orphan', $PagesBranch)
        } finally {
            Pop-Location
        }
    }

    Get-ChildItem -LiteralPath $PublishDir -Force |
        Where-Object { $_.Name -ne '.git' } |
        Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $ProdDist '*') -Destination $PublishDir -Recurse -Force
    $PreviewPublishDir = Join-Path $PublishDir $PreviewPath
    New-Item -ItemType Directory -Force -Path $PreviewPublishDir | Out-Null
    Copy-Item -Path (Join-Path $PreviewDist '*') -Destination $PreviewPublishDir -Recurse -Force
    New-Item -ItemType File -Force -Path (Join-Path $PublishDir '.nojekyll') | Out-Null

    # The generated rynk-wasm package ships a .gitignore containing "*",
    # which would make git add skip every file of the (new) preview copy.
    # The copies already tracked on gh-pages survive, new ones do not --
    # remove the inner .gitignore files from the published tree so both
    # copies are committed.
    foreach ($innerIgnore in @(
        (Join-Path $PublishDir 'rynk-wasm\.gitignore'),
        (Join-Path $PreviewPublishDir 'rynk-wasm\.gitignore')
    )) {
        if (Test-Path $innerIgnore) { Remove-Item -LiteralPath $innerIgnore -Force }
    }

    Write-Host "[7/7] Publishing to $Remote/$PagesBranch"
    Push-Location $PublishDir
    try {
        Invoke-Native -File 'git' -ArgumentList @('add', '-A')
        # Guard against silently publishing an incomplete tree (see above).
        $stagedFiles = @(git ls-files --cached)
        foreach ($required in @('index.html', 'rynk-wasm/rynk_wasm.js',
                                "$PreviewPath/index.html", "$PreviewPath/rynk-wasm/rynk_wasm.js")) {
            if ($stagedFiles -notcontains $required) {
                throw "Publish tree is missing: $required"
            }
        }
        git diff --cached --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-Host '[ok] No site changes to publish.'
        } else {
            $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
            Invoke-Native -File 'git' -ArgumentList @('commit', '-m', "Deploy MyKeebStudio + preview $stamp")
            Invoke-Native -File 'git' -ArgumentList @('push', $Remote, $PagesBranch)
        }
    } finally {
        Pop-Location
    }

    Write-Host ''
    Write-Host "[ok] MyKeebStudio published to branch: $PagesBranch"
    Write-Host '     Production: https://mykeebstudio.github.io/'
    Write-Host "     Preview:    https://mykeebstudio.github.io/$PreviewPath/"
    Write-Host ''
    Write-Host 'GitHub Pages must be configured once as:'
    Write-Host '  Settings -> Pages -> Deploy from a branch -> gh-pages -> /(root)'
}
finally {
    Set-Location $Root
    Remove-Worktree $ProdDir
    Remove-Worktree $PreviewDir
    Remove-Worktree $PublishDir
    git worktree prune | Out-Null
}
