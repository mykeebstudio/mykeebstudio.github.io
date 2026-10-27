#!/usr/bin/env bash
set -euo pipefail

# Build BOTH the production site and a preview site, and publish them together
# to the gh-pages branch:
#
#   /           production  (PROD_BRANCH,    default: feature/rmk-trackball-v8)
#   /preview/   preview     (PREVIEW_BRANCH, default: feature/pg1kb-zmk-parity-battery-history)
#
# Unlike deploy-pages.sh, this script never switches the branch of your main
# checkout. Each source branch is built in its own git worktree under .cache/,
# so the two builds cannot clobber each other.
#
# NOTE: The preview build relies on src/rmkRynkWasm.ts resolving the Rynk WASM
# runtime through import.meta.env.BASE_URL. With Vite's --base=/preview/ the
# preview loads /preview/rynk-wasm/, the production build (base /) keeps
# loading /rynk-wasm/, so both copies must be published (this script does).
#
# WARNING: Publishing with the older deploy-pages.sh afterwards removes
# /preview/ again, because that script replaces the whole gh-pages tree with
# the production build only. Re-run this script to bring the preview back.

PROD_BRANCH="${PROD_BRANCH:-feature/rmk-trackball-v8}"
PREVIEW_BRANCH="${PREVIEW_BRANCH:-feature/pg1kb-zmk-parity-battery-history}"
PREVIEW_PATH="${PREVIEW_PATH:-preview}"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"
REMOTE="${REMOTE:-origin}"
SKIP_RYNK_WASM=0
ALLOW_DIRTY=0
NO_PULL=0

usage() {
  cat <<'EOF'
Usage: bash deploy-pages-with-preview.sh [options]

Build the production branch and a preview branch side by side and publish
both to the gh-pages branch (production at /, preview at /<PREVIEW_PATH>/).

Options:
  --skip-rynk-wasm  Skip building Rynk WASM (reuse public/rynk-wasm as-is;
                    it must already contain rynk_wasm.js).
  --allow-dirty     Allow deployment with local uncommitted/untracked changes.
  --no-pull         Do not fetch the latest source branches first.
  -h, --help        Show this help.

Environment overrides:
  PROD_BRANCH       Production source branch (default: feature/rmk-trackball-v8)
  PREVIEW_BRANCH    Preview source branch (default: feature/pg1kb-zmk-parity-battery-history)
  PREVIEW_PATH      Sub-path for the preview (default: preview)
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

case "$PREVIEW_PATH" in
  ""|.*|*/*|*\\*|*..*)
    echo "[error] PREVIEW_PATH must be a single path segment (got: $PREVIEW_PATH)" >&2
    exit 2
    ;;
esac

command -v git >/dev/null || { echo "[error] git is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "[error] npm is required." >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "[error] Run this inside the MyKeebStudio git repository." >&2
  exit 1
}
cd "$ROOT"

if [[ "$ALLOW_DIRTY" -eq 0 ]]; then
  DIRTY_STATUS="$(git status --porcelain=v1 --untracked-files=all)"
  if [[ -n "$DIRTY_STATUS" ]]; then
    echo "[error] Working tree is not clean."
    printf '%s\n' "$DIRTY_STATUS"
    echo "        Commit/stash your changes, or rerun with --allow-dirty."
    exit 1
  fi
fi

CACHE_DIR="$ROOT/.cache/preview-deploy"
PROD_DIR="$CACHE_DIR/prod-src"
PREVIEW_DIR="$CACHE_DIR/preview-src"
PUBLISH_DIR="$ROOT/.cache/gh-pages-worktree"

remove_worktree() {
  local dir="$1"
  git worktree remove --force "$dir" >/dev/null 2>&1 || true
  rm -rf "$dir"
}

cleanup() {
  cd "$ROOT" 2>/dev/null || true
  remove_worktree "$PROD_DIR"
  remove_worktree "$PREVIEW_DIR"
  remove_worktree "$PUBLISH_DIR"
  git worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[1/7] Fetching source branches"
if [[ "$NO_PULL" -eq 0 ]]; then
  git fetch "$REMOTE" "$PROD_BRANCH" "$PREVIEW_BRANCH" "$PAGES_BRANCH" || \
    git fetch "$REMOTE" "$PROD_BRANCH" "$PREVIEW_BRANCH"
fi
for branch in "$PROD_BRANCH" "$PREVIEW_BRANCH"; do
  if ! git rev-parse --verify --quiet "$REMOTE/$branch" >/dev/null; then
    echo "[error] Remote branch not found: $REMOTE/$branch" >&2
    exit 1
  fi
done

echo "[2/7] Preparing source worktrees"
mkdir -p "$CACHE_DIR"
remove_worktree "$PROD_DIR"
remove_worktree "$PREVIEW_DIR"
git worktree prune
git worktree add --detach "$PROD_DIR" "$REMOTE/$PROD_BRANCH"
git worktree add --detach "$PREVIEW_DIR" "$REMOTE/$PREVIEW_BRANCH"

echo "[3/7] Preparing Rynk WASM"
RYNK_PUBLIC="$ROOT/public/rynk-wasm"
if [[ "$SKIP_RYNK_WASM" -eq 1 ]]; then
  echo "[skip] Rynk WASM build skipped."
else
  if [[ -f "$RYNK_PUBLIC/rynk_wasm.js" ]]; then
    echo "[ok] Reusing existing public/rynk-wasm (delete it to force a rebuild)."
  elif [[ -f "$ROOT/scripts/build-rynk-wasm-wsl.sh" ]]; then
    bash "$ROOT/scripts/build-rynk-wasm-wsl.sh"
  else
    echo "[warn] No Rynk WASM build script found; continuing without a rebuild."
  fi
fi
if [[ ! -f "$RYNK_PUBLIC/rynk_wasm.js" ]]; then
  echo "[error] $RYNK_PUBLIC/rynk_wasm.js is missing." >&2
  echo "        Build it first (npm run build:rynk-wasm) or check out a public/rynk-wasm copy." >&2
  exit 1
fi
for dir in "$PROD_DIR" "$PREVIEW_DIR"; do
  rm -rf "$dir/public/rynk-wasm"
  mkdir -p "$dir/public/rynk-wasm"
  cp -a "$RYNK_PUBLIC/." "$dir/public/rynk-wasm/"
done

install_deps() {
  local dir="$1"
  (
    cd "$dir"
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install --no-package-lock
    fi
  )
}

echo "[4/7] Building production site ($PROD_BRANCH -> /)"
install_deps "$PROD_DIR"
(
  cd "$PROD_DIR"
  npm run build
)
[[ -f "$PROD_DIR/dist/index.html" ]] || { echo "[error] Production dist/index.html was not generated." >&2; exit 1; }
[[ -f "$PROD_DIR/dist/rynk-wasm/rynk_wasm.js" ]] || { echo "[error] Production dist/rynk-wasm/rynk_wasm.js is missing." >&2; exit 1; }

echo "[5/7] Building preview site ($PREVIEW_BRANCH -> /$PREVIEW_PATH/)"
install_deps "$PREVIEW_DIR"
(
  cd "$PREVIEW_DIR"
  ./node_modules/.bin/tsc --noEmit
  ./node_modules/.bin/vite build --base="/$PREVIEW_PATH/"
)
[[ -f "$PREVIEW_DIR/dist/index.html" ]] || { echo "[error] Preview dist/index.html was not generated." >&2; exit 1; }
if ! grep -q "/$PREVIEW_PATH/assets/" "$PREVIEW_DIR/dist/index.html"; then
  echo "[error] Preview index.html does not reference /$PREVIEW_PATH/assets/ -- base path was not applied." >&2
  exit 1
fi
[[ -f "$PREVIEW_DIR/dist/rynk-wasm/rynk_wasm.js" ]] || { echo "[error] Preview dist/rynk-wasm/rynk_wasm.js is missing." >&2; exit 1; }

echo "[6/7] Preparing $PAGES_BRANCH worktree"
remove_worktree "$PUBLISH_DIR"
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
cp -a "$PROD_DIR/dist/." "$PUBLISH_DIR/"
mkdir -p "$PUBLISH_DIR/$PREVIEW_PATH"
cp -a "$PREVIEW_DIR/dist/." "$PUBLISH_DIR/$PREVIEW_PATH/"
touch "$PUBLISH_DIR/.nojekyll"

# The generated rynk-wasm package ships a .gitignore containing "*", which
# would make git add skip every file of the (new) preview copy. The copies
# already tracked on gh-pages survive, new ones do not -- remove the inner
# .gitignore files from the published tree so both copies are committed.
rm -f "$PUBLISH_DIR/rynk-wasm/.gitignore" "$PUBLISH_DIR/$PREVIEW_PATH/rynk-wasm/.gitignore"

echo "[7/7] Publishing to $REMOTE/$PAGES_BRANCH"
(
  cd "$PUBLISH_DIR"
  git add -A

  # Guard against silently publishing an incomplete tree (see above).
  for required in "index.html" "rynk-wasm/rynk_wasm.js" \
                  "$PREVIEW_PATH/index.html" "$PREVIEW_PATH/rynk-wasm/rynk_wasm.js"; do
    if ! git ls-files --cached | grep -qx "$required"; then
      echo "[error] Publish tree is missing: $required" >&2
      exit 1
    fi
  done

  if git diff --cached --quiet; then
    echo "[ok] No site changes to publish."
    exit 0
  fi

  git commit -m "Deploy MyKeebStudio + preview $(date '+%Y-%m-%d %H:%M:%S %z')"
  git push "$REMOTE" "$PAGES_BRANCH"
)

echo
echo "[ok] MyKeebStudio published to branch: $PAGES_BRANCH"
echo "     Production: https://mykeebstudio.github.io/"
echo "     Preview:    https://mykeebstudio.github.io/$PREVIEW_PATH/"
echo
echo "GitHub Pages must be configured once as:"
echo "  Settings -> Pages -> Deploy from a branch -> gh-pages -> /(root)"
