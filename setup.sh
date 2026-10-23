#!/usr/bin/env bash
# Created by The Angelo Umali.
# Bootstraps pinned, hash-checked pnpm and uv into ZKS_HOME/tools (no sudo, nothing global), then runs `zks setup`.
set -euo pipefail
cd "$(dirname "$0")"
START=1
for arg in "$@"; do case "$arg" in --no-start) START=0 ;; *) echo "usage: ./setup.sh [--no-start]" >&2 && exit 2 ;; esac; done
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1
PNPM_VERSION=12.15.0
UV_VERSION=0.12.24
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) PNPM_ASSET=pnpm-linux-x64 PNPM_SHA=55b5ed0092bd11176c1669598e231ae52e7cedac59de6efd0d415730f37d0598
    UV_ASSET=uv-x86_64-unknown-linux-gnu UV_SHA=b4dfaef47d491a7296981f8374a4595f55dbf84e8937c8ecd2983574d8bb3da6 ;;
  Linux-aarch64) PNPM_ASSET=pnpm-linux-arm64 PNPM_SHA=d7ce93a2c7d847d3a34bd3f559b60c14f578b1320c17cc352a2c5c5fdf956117
    UV_ASSET=uv-aarch64-unknown-linux-gnu UV_SHA=5231be65f496304623895dacdbf1de8504fec90303684bdf05805aa34414dd21 ;;
  Darwin-arm64) PNPM_ASSET=pnpm-darwin-arm64 PNPM_SHA=6a41a2877773e97f19832067187cc6fc82e186d8a2cf91fec4b4c1a5fbd6ef27
    UV_ASSET=uv-aarch64-apple-darwin UV_SHA=0c4346de7abdb49495b393b9ec809fe387aa43e586be20fecb972216c1e71732 ;;
  *) echo "unsupported platform $(uname -s)-$(uname -m); supported: linux-x64, linux-arm64, mac-arm64" >&2 && exit 1 ;;
esac
if [ "$(uname -s)" = Darwin ]; then DEFAULT_HOME="$HOME/Library/Application Support/zkidz-studio"; else DEFAULT_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/zkidz-studio"; fi
export ZKS_HOME="${ZKS_HOME:-$DEFAULT_HOME}"
TOOLS="$ZKS_HOME/tools"
# uv otherwise puts its managed Python and cache under ~/.local/share/uv and ~/.cache/uv; packages/cli uvEnvironment() applies the same defaults.
export UV_PYTHON_INSTALL_DIR="${UV_PYTHON_INSTALL_DIR:-$ZKS_HOME/tools/python}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$ZKS_HOME/cache/uv}"
mkdir -p "$TOOLS/.downloads" && chmod 700 "$ZKS_HOME"
sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# install_tool <name> <version> <url> <sha256> [tar flags]: .part + resume, verify, then extract beside and rename.
install_tool() {
  local dir="$TOOLS/$1/$2" archive="$TOOLS/.downloads/${3##*/}"
  [ -x "$dir/$1" ] && return 0
  echo "fetching $1 $2"
  curl -fsSL --retry 3 -C - -o "$archive.part" "$3" || { rm -f "$archive.part"; curl -fsSL --retry 3 -o "$archive.part" "$3"; }
  if [ "$(sha256_of "$archive.part")" != "$4" ]; then rm -f "$archive.part" && echo "SHA-256 mismatch for $3" >&2 && exit 1; fi
  rm -rf "$dir.staging" && mkdir -p "$dir.staging"
  tar -xzf "$archive.part" -C "$dir.staging" "${@:5}" && mv "$dir.staging" "$dir" && rm -f "$archive.part"
}

command -v pnpm >/dev/null || {
  install_tool pnpm "$PNPM_VERSION" "https://github.com/pnpm/pnpm/releases/download/v$PNPM_VERSION/$PNPM_ASSET.tar.gz" "$PNPM_SHA"
  export PATH="$TOOLS/pnpm/$PNPM_VERSION:$PATH"
}
command -v uv >/dev/null || {
  install_tool uv "$UV_VERSION" "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$UV_ASSET.tar.gz" "$UV_SHA" --strip-components=1
  export PATH="$TOOLS/uv/$UV_VERSION:$PATH"
}

pnpm install --frozen-lockfile
uv sync --locked --project packages/engine
pnpm exec node packages/cli/src/main.ts setup
if [ "$START" = 1 ]; then exec pnpm start; fi
echo "setup complete. Start with: pnpm start"
