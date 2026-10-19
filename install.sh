#!/bin/sh
# Install larecode from GitHub releases.
# Usage: curl -fsSL https://raw.githubusercontent.com/rsyyd/lare/main/install.sh | sh
set -eu

REPO="${LARECODE_REPO:-rsyyd/lare}"
BASE_URL="${LARECODE_INSTALL_BASE:-https://github.com/${REPO}/releases/latest/download}"
INSTALL_DIR="${LARECODE_INSTALL_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *)
    echo "larecode: unsupported operating system: $os" >&2
    exit 1
    ;;
esac

arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *)
    echo "larecode: unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

asset="larecode-${os}-${arch}"
url="${BASE_URL}/${asset}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "larecode: downloading ${url}"
if ! curl -fsSL "$url" -o "$tmp/larecode"; then
  echo "larecode: download failed (check network access to ${BASE_URL})" >&2
  exit 1
fi

if [ -n "${LARECODE_SHA256:-}" ]; then
  actual="$(sha256sum "$tmp/larecode" | cut -d' ' -f1)"
  if [ "$actual" != "$LARECODE_SHA256" ]; then
    echo "larecode: checksum mismatch (expected ${LARECODE_SHA256}, got ${actual})" >&2
    exit 1
  fi
fi

chmod +x "$tmp/larecode"
if ! "$tmp/larecode" --version >/dev/null 2>&1; then
  echo "larecode: downloaded binary failed to run" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
mv "$tmp/larecode" "$INSTALL_DIR/larecode"

echo "larecode: installed to ${INSTALL_DIR}/larecode"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "larecode: add ${INSTALL_DIR} to your PATH, then run: larecode setup" ;;
esac
