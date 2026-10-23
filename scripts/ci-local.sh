#!/usr/bin/env bash
# Created by The Angelo Umali.
# Local CI, run before every merge: the Linux jobs the GitHub workflows ran, against the pinned tools. The workflows are
# manual-only because per-push runs emailed every failure. Linux x64 only (the pinned scanners are Linux builds).
# Every step runs even after one fails, so one pass shows everything; the exit code is 1 when any step failed.
set -uo pipefail

USAGE="usage: scripts/ci-local.sh [--release] [--list]   (--release adds a fresh setup.sh and the doctor, for develop -> main)"
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/zks-ci"
ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8

release=0
list=0
for arg in "$@"; do
  case "$arg" in
    --release) release=1 ;;
    --list) list=1 ;;
    *) echo "$USAGE" >&2 && exit 2 ;;
  esac
done

steps=(actionlint gitleaks install format verify engine)
((release)) && steps+=(setup-doctor)
if ((list)); then
  printf '%s\n' "${steps[@]}"
  exit 0
fi

cd "$REPO_ROOT" || exit 1
merge_target=origin/develop
((release)) && merge_target=origin/main
log="${TMPDIR:-/tmp}/zks-ci-local-$(date +%Y%m%d-%H%M%S).log"

# A release tarball fetched once into CACHE_DIR and checked against its pin; prints the binary's path.
pinned_binary() {
  local name=$1 version=$2 sha256=$3 url=$4
  local dir="$CACHE_DIR/$name-$version"
  if [[ ! -x "$dir/$name" ]]; then
    mkdir -p "$dir" &&
      curl -fsSL -o "$dir/archive.tar.gz" "$url" &&
      echo "$sha256  $dir/archive.tar.gz" | sha256sum -c - >/dev/null &&
      tar -xzf "$dir/archive.tar.gz" -C "$dir" "$name" &&
      rm "$dir/archive.tar.gz" || return 1
  fi
  echo "$dir/$name"
}

workflow_pin() { sed -n "s/^ *$1: *//p" .github/workflows/gitleaks.yml | head -1; }

step_actionlint() {
  local bin
  bin=$(pinned_binary actionlint "$ACTIONLINT_VERSION" "$ACTIONLINT_SHA256" \
    "https://github.com/rhysd/actionlint/releases/download/v$ACTIONLINT_VERSION/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz") &&
    "$bin" -no-color
}

# The same pinned gitleaks and scan script as gitleaks.yml. The rules and ignore list come from where this branch
# merges into, so a branch cannot loosen its own scan.
step_gitleaks() {
  local version sha256 bin base
  version=$(workflow_pin GITLEAKS_VERSION) && sha256=$(workflow_pin GITLEAKS_SHA256) &&
    bin=$(pinned_binary gitleaks "$version" "$sha256" \
      "https://github.com/gitleaks/gitleaks/releases/download/v$version/gitleaks_${version}_linux_x64.tar.gz") &&
    base=$(git merge-base HEAD "$merge_target") &&
    PATH="$(dirname "$bin"):$PATH" bash .github/scripts/gitleaks-scan.sh "$base"
}

step_install() { pnpm install --frozen-lockfile; }
step_format() { pnpm format:check; }
step_verify() { pnpm verify; }

# The engine and golden frames with the pinned ffmpeg and Chrome, and the overlay renderer tests forbidden to skip.
step_engine() {
  local ffmpeg chrome
  pnpm -s zks setup &&
    ffmpeg=$(pnpm -s zks tools path ffmpeg) &&
    chrome=$(pnpm -s zks tools path chrome-headless-shell) &&
    uv sync --project packages/engine --locked &&
    ZKS_FFMPEG="$ffmpeg" ZKS_CHROME="$chrome" ZKS_REQUIRE_HF=1 \
      uv run --project packages/engine python -m unittest discover -s packages/engine/tests
}

# A first install on a clean machine: the single setup command into a throwaway ZKS_HOME, then the doctor.
step_setup-doctor() {
  local home status
  home=$(mktemp -d)
  ZKS_HOME="$home" ./setup.sh --no-start && ZKS_HOME="$home" pnpm zks doctor --json
  status=$?
  rm -rf "$home"
  return "$status"
}

failed=()
for step in "${steps[@]}"; do
  started=$SECONDS
  echo "=== $step" >>"$log"
  if "step_$step" >>"$log" 2>&1; then
    printf 'PASS  %-13s %4ss\n' "$step" "$((SECONDS - started))"
  else
    printf 'FAIL  %-13s %4ss\n' "$step" "$((SECONDS - started))"
    failed+=("$step")
  fi
done

echo "log: $log"
if ((${#failed[@]})); then
  echo "ci-local FAILED: ${failed[*]}"
  exit 1
fi
echo "ci-local passed"
