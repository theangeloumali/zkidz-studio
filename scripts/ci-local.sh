#!/usr/bin/env bash
# Created by The Angelo Umali.
# Local CI, run before every merge: the Linux jobs the GitHub workflows ran, against the pinned tools. The workflows are
# manual-only because per-push runs emailed every failure. Linux x64 only (the pinned scanners are Linux builds).
# The lint, scan and install run in turn; then every check that shares nothing runs side by side, the engine suite split
# over ZKS_CI_JOBS workers. Every step runs even after one fails, and the exit code is 1 when any step failed.
set -uo pipefail

USAGE="usage: scripts/ci-local.sh [--release] [--list] [--list-jobs] [--list-lanes]   (--release adds a fresh setup.sh and the doctor, for develop -> main)"
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/zks-ci"
ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
ENGINE_JOBS="${ZKS_CI_JOBS:-6}"

release=0
list=0
list_lanes=0
for arg in "$@"; do
  case "$arg" in
    --release) release=1 ;;
    --list) list=1 ;;
    --list-jobs) echo "$ENGINE_JOBS" && exit 0 ;;
    --list-lanes) list_lanes=1 ;;
    *) echo "$USAGE" >&2 && exit 2 ;;
  esac
done

serial_steps=(actionlint gitleaks install)
# Heaviest first, so with fewer lanes the long steps never wait behind the short ones. The server suite keeps its own
# lane: each of its files boots a PGlite, and beside the other suites that ran out of memory.
parallel_steps=(engine lint test-server typecheck test-other format)

# Every lane at once on an idle machine; on one already busier than its cores, two, or vitest cannot start its workers.
lane_count() {
  local load="${ZKS_CI_LOAD:-$(cut -d' ' -f1 /proc/loadavg)}" cores="${ZKS_CI_CORES:-$(nproc)}"
  if [[ -n "${ZKS_CI_LANES:-}" ]]; then
    echo "$ZKS_CI_LANES"
  elif awk -v busy="$load" -v cpus="$cores" 'BEGIN { exit !(busy > cpus) }'; then
    echo 2
  else
    echo "${#parallel_steps[@]}"
  fi
}
if ((list_lanes)); then
  lane_count
  exit 0
fi
if ((list)); then
  printf '%s\n' "${serial_steps[@]}" "parallel: ${parallel_steps[*]}"
  ((release)) && echo "setup-doctor"
  exit 0
fi

cd "$REPO_ROOT" || exit 1
merge_target=origin/develop
((release)) && merge_target=origin/main
log_dir="${TMPDIR:-/tmp}/zks-ci-local-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$log_dir"

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

# pnpm verify's parts, run as separate lanes.
step_format() { node scripts/check-attribution.mjs && pnpm exec prettier --check .; }
step_lint() { pnpm -r lint; }
step_typecheck() { pnpm -r typecheck; }
step_test-server() { pnpm -F @zks/server test; }
step_test-other() { pnpm -r --filter '!@zks/server' test; }

# The engine and golden frames with the pinned ffmpeg and Chrome, the overlay renderer tests forbidden to skip, one
# process per test module. Each process gets its own scratch ZKS_HOME from tests/support.py.
step_engine() {
  local ffmpeg chrome results
  pnpm -s zks setup &&
    ffmpeg=$(pnpm -s zks tools path ffmpeg) &&
    chrome=$(pnpm -s zks tools path chrome-headless-shell) &&
    uv sync --project packages/engine --locked || return 1
  results=$(mktemp -d)
  # shellcheck disable=SC2016 # the module, results dir and python reach bash -c as $1, $2 and $3
  (cd packages/engine/tests && ls test_*.py parity/test_*.py) | sed 's#/#.#; s#\.py$##' |
    ZKS_FFMPEG="$ffmpeg" ZKS_CHROME="$chrome" ZKS_REQUIRE_HF=1 xargs -P "$ENGINE_JOBS" -I{} \
      bash -c 'cd packages/engine/tests && "$3" -m unittest "$1" >"$2/$1.log" 2>&1 || touch "$2/$1.failed"' _ {} "$results" "$REPO_ROOT/packages/engine/.venv/bin/python"
  grep -h -E '^Ran [0-9]+ tests? in ' "$results"/*.log | awk '{tests += $2} END {print "Ran " tests " engine tests"}'
  local failed=("$results"/*.failed)
  if [[ -e "${failed[0]}" ]]; then
    for marker in "${failed[@]}"; do tail -n 40 "${marker%.failed}.log"; done
    echo "engine modules failed: $(basename -s .failed "${failed[@]}" | tr '\n' ' ')"
    rm -rf "$results"
    return 1
  fi
  rm -rf "$results"
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
report() {
  local step=$1 status=$2 seconds=$3
  if ((status == 0)); then
    printf 'PASS  %-12s %4ss\n' "$step" "$seconds"
  else
    printf 'FAIL  %-12s %4ss  (%s)\n' "$step" "$seconds" "$log_dir/$step.log"
    failed+=("$step")
  fi
}

run_started=$SECONDS
for step in "${serial_steps[@]}"; do
  started=$SECONDS
  "step_$step" >"$log_dir/$step.log" 2>&1
  report "$step" $? "$((SECONDS - started))"
done

declare -A step_of_pid
lanes=$(lane_count)
lane_started=$SECONDS
reap_one() {
  local finished_pid status
  wait -n -p finished_pid "${!step_of_pid[@]}"
  status=$?
  report "${step_of_pid[$finished_pid]}" "$status" "$((SECONDS - lane_started))"
  unset "step_of_pid[$finished_pid]"
}
echo "lanes: $lanes"
for step in "${parallel_steps[@]}"; do
  while ((${#step_of_pid[@]} >= lanes)); do reap_one; done
  "step_$step" >"$log_dir/$step.log" 2>&1 &
  step_of_pid[$!]=$step
done
while ((${#step_of_pid[@]})); do reap_one; done

if ((release)); then
  started=$SECONDS
  step_setup-doctor >"$log_dir/setup-doctor.log" 2>&1
  report setup-doctor $? "$((SECONDS - started))"
fi

echo "logs: $log_dir   total: $((SECONDS - run_started))s"
if ((${#failed[@]})); then
  echo "ci-local FAILED: ${failed[*]}"
  exit 1
fi
echo "ci-local passed"
