#!/usr/bin/env bash
set -euo pipefail

SOURCE_BRANCH="${SOURCE_BRANCH:-feature/rmk-trackball-v8}"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"
REMOTE="${REMOTE:-origin}"
SKIP_RYNK_WASM=0
ALLOW_DIRTY=0
NO_PULL=0

usage() {
  cat <<'EOF'
Usage: bash deploy-pages.sh [options]

Build MyKeebStudio locally and publish dist/ to the gh-pages branch.

Options:
  --skip-rynk-wasm  Skip building Rynk WASM before the Vite build.
  --allow-dirty     Allow deployment with local uncommitted/untracked changes.
  --no-pull         Do not fast-forward from the remote source branch first.
  -h, --help        Show this help.

Environment overrides:
  SOURCE_BRANCH     Source branch to publish (default: feature/rmk-trackball-v8)
  PAGES_BRANCH      Pages branch (default: gh-pages)
  REMOTE            Git remote (default: origin)
EOF
}

while (($#)); do
  case "$1" in
    --skip-rynk-wasm) SKIP_RYNK_WASM=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --no-pull) NO_PULL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[error] Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

command -v git >/dev/null || { echo "[error] git is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "[error] npm is required." >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "[error] Run this inside the MyKeebStudio git repository." >&2
  exit 1
}
cd "$ROOT"

if [[ "$ALLOW_DIRTY" -eq 0 ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    echo "[error] Working tree is not clean."
    echo "        Commit/stash your changes, or rerun with --allow-dirty."
    exit 1
  fi
fi

echo "[1/6] Preparing source branch: $SOURCE_BRANCH"
if [[ "$(git branch --show-current)" != "$SOURCE_BRANCH" ]]; then
  if git show-ref --verify --quiet "refs/heads/$SOURCE_BRANCH"; then
    git switch "$SOURCE_BRANCH"
  else
    git fetch "$REMOTE" "$SOURCE_BRANCH"
    git switch --track -c "$SOURCE_BRANCH" "$REMOTE/$SOURCE_BRANCH"
  fi
fi

if [[ "$NO_PULL" -eq 0 ]]; then
  git fetch "$REMOTE" "$SOURCE_BRANCH"
  git merge --ff-only "$REMOTE/$SOURCE_BRANCH"
fi

echo "[2/6] Preparing Rynk WASM"
if [[ "$SKIP_RYNK_WASM" -eq 1 ]]; then
  echo "[skip] Rynk WASM build skipped."
else
  if [[ -f scripts/build-rynk-wasm-wsl.sh ]]; then
    bash scripts/build-rynk-wasm-wsl.sh
  else
    echo "[warn] scripts/build-rynk-wasm-wsl.sh not found; continuing without Rynk WASM."
  fi
fi

echo "[3/6] Installing dependencies"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install --no-package-lock
fi

echo "[4/6] Building site"
npm run build

if [[ ! -f dist/index.html ]]; then
  echo "[error] dist/index.html was not generated." >&2
  exit 1
fi

PUBLISH_DIR="$ROOT/.cache/gh-pages-worktree"

cleanup() {
  cd "$ROOT" 2>/dev/null || true
  git worktree remove --force "$PUBLISH_DIR" >/dev/null 2>&1 || true
  git worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[5/6] Preparing $PAGES_BRANCH worktree"
git worktree remove --force "$PUBLISH_DIR" >/dev/null 2>&1 || true
rm -rf "$PUBLISH_DIR"
git worktree prune

if git ls-remote --exit-code --heads "$REMOTE" "$PAGES_BRANCH" >/dev/null 2>&1; then
  git fetch "$REMOTE" "$PAGES_BRANCH"
  git worktree add -B "$PAGES_BRANCH" "$PUBLISH_DIR" "$REMOTE/$PAGES_BRANCH"
else
  git worktree add --detach "$PUBLISH_DIR" HEAD
  (
    cd "$PUBLISH_DIR"
    git switch --orphan "$PAGES_BRANCH"
  )
fi

find "$PUBLISH_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$ROOT/dist/." "$PUBLISH_DIR/"
touch "$PUBLISH_DIR/.nojekyll"

echo "[6/6] Publishing to $REMOTE/$PAGES_BRANCH"
(
  cd "$PUBLISH_DIR"
  git add -A

  if git diff --cached --quiet; then
    echo "[ok] No site changes to publish."
    exit 0
  fi

  git commit -m "Deploy MyKeebStudio $(date '+%Y-%m-%d %H:%M:%S %z')"
  git push "$REMOTE" "$PAGES_BRANCH"
)

echo
echo "[ok] MyKeebStudio published to branch: $PAGES_BRANCH"
echo "     Site: https://mykeebstudio.github.io/"
echo
echo "GitHub Pages must be configured once as:"
echo "  Settings -> Pages -> Deploy from a branch -> gh-pages -> /(root)"
