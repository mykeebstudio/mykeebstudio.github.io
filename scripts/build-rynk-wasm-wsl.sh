#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/.cache/rmk-wsl"
TOOLS="$ROOT/.cache/tools"
PUBLIC="$ROOT/public/rynk-wasm"
RMK_REF="f626c6e391821d917934042a988f99f1cc02b6b2"
WASM_PACK_VERSION="0.15.0"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64) WASM_ASSET="wasm-pack-v${WASM_PACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" ;;
  aarch64|arm64) WASM_ASSET="wasm-pack-v${WASM_PACK_VERSION}-aarch64-unknown-linux-musl.tar.gz" ;;
  *) echo "Unsupported WSL architecture: $ARCH" >&2; exit 1 ;;
esac

WASM_DIR="$TOOLS/wasm-pack-v${WASM_PACK_VERSION}"
WASM_BIN="$WASM_DIR/wasm-pack"

command -v git >/dev/null || { echo 'git is required in WSL' >&2; exit 1; }
command -v cargo >/dev/null || { echo 'cargo is required in WSL' >&2; exit 1; }
command -v rustup >/dev/null || { echo 'rustup is required in WSL' >&2; exit 1; }
command -v curl >/dev/null || { echo 'curl is required in WSL' >&2; exit 1; }
command -v tar >/dev/null || { echo 'tar is required in WSL' >&2; exit 1; }

mkdir -p "$TOOLS"
if [[ ! -x "$WASM_BIN" ]]; then
  echo "[setup] downloading official wasm-pack v${WASM_PACK_VERSION} binary for WSL..."
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  URL="https://github.com/wasm-bindgen/wasm-pack/releases/download/v${WASM_PACK_VERSION}/${WASM_ASSET}"
  curl -fL "$URL" -o "$TMP/$WASM_ASSET"
  tar -xzf "$TMP/$WASM_ASSET" -C "$TMP"
  SRC="$TMP/wasm-pack-v${WASM_PACK_VERSION}-${WASM_ASSET#wasm-pack-v${WASM_PACK_VERSION}-}"
  SRC="${SRC%.tar.gz}"
  mkdir -p "$WASM_DIR"
  cp "$SRC/wasm-pack" "$WASM_BIN"
  chmod +x "$WASM_BIN"
fi

if [[ ! -d "$CACHE/.git" ]]; then
  echo '[setup] cloning official RMK source in WSL...'
  git clone https://github.com/rmk-rs/rmk.git "$CACHE"
fi

git -C "$CACHE" fetch --tags origin
git -C "$CACHE" checkout --detach "$RMK_REF"
rustup target add wasm32-unknown-unknown

echo '[build] building official rynk-wasm in WSL...'
(
  cd "$CACHE/rynk/rynk-wasm"
  "$WASM_BIN" build --target web --release
)

rm -rf "$PUBLIC"
mkdir -p "$PUBLIC"
cp -a "$CACHE/rynk/rynk-wasm/pkg/." "$PUBLIC/"

echo "[ok] Rynk WASM copied to $PUBLIC"
