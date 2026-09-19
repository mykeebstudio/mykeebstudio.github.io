param(
    [switch]$SkipRynkWasm,
    [switch]$AllowDirty,
    [switch]$NoPull
)

$ErrorActionPreference = 'Stop'

$SourceBranch = if ($env:SOURCE_BRANCH) { $env:SOURCE_BRANCH } else { 'feature/rmk-trackball-v8' }
$PagesBranch  = if ($env:PAGES_BRANCH)  { $env:PAGES_BRANCH }  else { 'gh-pages' }
$Remote       = if ($env:REMOTE)        { $env:REMOTE }        else { 'origin' }

function Invoke-Native {
    param(
        [Parameter(Mandatory=$true)][string]$File,
        [Parameter(ValueFromRemainingArguments=$true)][string[]]$Args
    )
    & $File @Args
    if ($LASTEXITCODE -ne 0) {
        throw "$File failed with exit code $LASTEXITCODE"
    }
}

$Root = (git rev-parse --show-toplevel 2>$null)
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

Write-Host "[1/6] Preparing source branch: $SourceBranch"
$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -ne $SourceBranch) {
    git show-ref --verify --quiet "refs/heads/$SourceBranch"
    if ($LASTEXITCODE -eq 0) {
        Invoke-Native git switch $SourceBranch
    }
    else {
        Invoke-Native git fetch $Remote $SourceBranch
        Invoke-Native git switch --track -c $SourceBranch "$Remote/$SourceBranch"
    }
}

if (-not $NoPull) {
    Invoke-Native git fetch $Remote $SourceBranch
    Invoke-Native git merge --ff-only "$Remote/$SourceBranch"
}

Write-Host '[2/6] Preparing Rynk WASM'
if ($SkipRynkWasm) {
    Write-Host '[skip] Rynk WASM build skipped.'
}
elseif (Test-Path (Join-Path $Root 'scripts\build-rynk-wasm-via-wsl.ps1')) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\build-rynk-wasm-via-wsl.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw "Rynk WASM build failed with exit code $LASTEXITCODE"
    }
}
else {
    Write-Warning 'scripts/build-rynk-wasm-via-wsl.ps1 not found; continuing without Rynk WASM.'
}

Write-Host '[3/6] Installing dependencies'
if (Test-Path (Join-Path $Root 'package-lock.json')) {
    Invoke-Native npm ci
}
else {
    Invoke-Native npm install --no-package-lock
}

Write-Host '[4/6] Building site'
Invoke-Native npm run build

$Dist = Join-Path $Root 'dist'
if (-not (Test-Path (Join-Path $Dist 'index.html'))) {
    throw 'dist/index.html was not generated.'
}

$PublishDir = Join-Path $Root '.cache\gh-pages-worktree'

function Remove-PublishWorktree {
    Set-Location $Root
    git worktree remove --force $PublishDir 2>$null | Out-Null
    git worktree prune 2>$null | Out-Null
}

try {
    Write-Host "[5/6] Preparing $PagesBranch worktree"
    Remove-PublishWorktree
    if (Test-Path $PublishDir) {
        Remove-Item -Recurse -Force $PublishDir
    }

    git ls-remote --exit-code --heads $Remote $PagesBranch *> $null
    $remotePagesExists = ($LASTEXITCODE -eq 0)

    if ($remotePagesExists) {
        Invoke-Native git fetch $Remote $PagesBranch
        Invoke-Native git worktree add -B $PagesBranch $PublishDir "$Remote/$PagesBranch"
    }
    else {
        Invoke-Native git worktree add --detach $PublishDir HEAD
        Push-Location $PublishDir
        try {
            Invoke-Native git switch --orphan $PagesBranch
        }
        finally {
            Pop-Location
        }
    }

    Get-ChildItem -LiteralPath $PublishDir -Force |
        Where-Object { $_.Name -ne '.git' } |
        Remove-Item -Recurse -Force

    Copy-Item -Path (Join-Path $Dist '*') -Destination $PublishDir -Recurse -Force
    New-Item -ItemType File -Force -Path (Join-Path $PublishDir '.nojekyll') | Out-Null

    Write-Host "[6/6] Publishing to $Remote/$PagesBranch"
    Push-Location $PublishDir
    try {
        Invoke-Native git add -A
        git diff --cached --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-Host '[ok] No site changes to publish.'
        }
        else {
            $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss K'
            Invoke-Native git commit -m "Deploy MyKeebStudio $stamp"
            Invoke-Native git push $Remote $PagesBranch
            Write-Host ''
            Write-Host "[ok] MyKeebStudio published to branch: $PagesBranch"
            Write-Host '     Site: https://mykeebstudio.github.io/'
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-PublishWorktree
}

Write-Host ''
Write-Host 'GitHub Pages must be configured once as:'
Write-Host '  Settings -> Pages -> Deploy from a branch -> gh-pages -> /(root)'
