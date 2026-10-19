#!/bin/sh
# Install lumpscode from GitHub releases.
# Usage: curl -fsSL https://raw.githubusercontent.com/rsyyd/lumpscode/main/install.sh | sh
set -eu

REPO="${LUMPSCODE_REPO:-rsyyd/lumpscode}"
BASE_URL="${LUMPSCODE_INSTALL_BASE:-https://github.com/${REPO}/releases/latest/download}"
INSTALL_DIR="${LUMPSCODE_INSTALL_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *)
    echo "lumpscode: unsupported operating system: $os" >&2
    exit 1
    ;;
esac

arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *)
    echo "lumpscode: unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

asset="lumpscode-${os}-${arch}"
url="${BASE_URL}/${asset}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "lumpscode: downloading ${url}"
if ! curl -fsSL "$url" -o "$tmp/lumpscode"; then
  echo "lumpscode: download failed (check network access to ${BASE_URL})" >&2
  exit 1
fi

if [ -n "${LUMPSCODE_SHA256:-}" ]; then
  actual="$(sha256sum "$tmp/lumpscode" | cut -d' ' -f1)"
  if [ "$actual" != "$LUMPSCODE_SHA256" ]; then
    echo "lumpscode: checksum mismatch (expected ${LUMPSCODE_SHA256}, got ${actual})" >&2
    exit 1
  fi
fi

chmod +x "$tmp/lumpscode"
if ! "$tmp/lumpscode" --version >/dev/null 2>&1; then
  echo "lumpscode: downloaded binary failed to run" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
mv "$tmp/lumpscode" "$INSTALL_DIR/lumpscode"

echo "lumpscode: installed to ${INSTALL_DIR}/lumpscode"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "lumpscode: add ${INSTALL_DIR} to your PATH, then run: lumpscode setup" ;;
esac
