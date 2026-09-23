#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RMK_DIR="$ROOT/.cache/rmk"
OUT="$ROOT/public/rynk-wasm"
RMK_COMMIT="4ceff5eec277671ce4f62e4d54e25a9b1b12ef04"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required to build rynk-wasm" >&2
  exit 1
fi
if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack is required. Install with: cargo install wasm-pack --locked" >&2
  exit 1
fi

mkdir -p "$(dirname "$RMK_DIR")"
if [ ! -d "$RMK_DIR/.git" ]; then
  git clone https://github.com/rmk-rs/rmk.git "$RMK_DIR"
fi
git -C "$RMK_DIR" fetch --depth 1 origin "$RMK_COMMIT"
git -C "$RMK_DIR" checkout --detach "$RMK_COMMIT"

rm -rf "$OUT"
mkdir -p "$OUT"
wasm-pack build "$RMK_DIR/rynk/rynk-wasm" --target web --out-dir "$OUT"

echo "Rynk wasm ready: $OUT"
