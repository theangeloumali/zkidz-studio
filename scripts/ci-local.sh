#!/usr/bin/env bash
# Created by The Angelo Umali.
# Local CI, run before every merge: the Linux jobs the GitHub workflows ran, against the pinned tools. The workflows are
# manual-only because per-push runs emailed every failure. Linux x64 only (the pinned scanners are Linux builds).
# The lint, scan and install run in turn; then every check that shares nothing runs side by side, each test lane capped
# at ZKS_CI_JOBS workers (at most four). Every step runs even after one fails, and the exit code is 1 when any step failed.
set -uo pipefail

USAGE="usage: scripts/ci-local.sh [--release] [--list] [--list-jobs] [--list-lanes] [--list-test-env]   (--release adds a fresh setup.sh and the doctor, for develop -> main)"
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=scripts/lib/ci-lanes.sh
source "$REPO_ROOT/scripts/lib/ci-lanes.sh"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/zks-ci"
ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
LANE_WORKERS="${ZKS_CI_JOBS:-6}"
# Machine-wide, so worktrees running ci:local at once queue instead of starving each other's vitest workers.
LOCK_FILE="${ZKS_CI_LOCK:-$CACHE_DIR/ci-local.lock}"
LOCK_WAIT_S="${ZKS_CI_LOCK_WAIT_S:-3600}"
# A zero or non-numeric count would leave the lane loop waiting forever.
for count_var in ZKS_CI_JOBS ZKS_CI_LANES; do
  if [[ -n "${!count_var:-}" && ! "${!count_var}" =~ ^[1-9][0-9]*$ ]]; then
    echo "ci-local: $count_var must be a positive whole number, got '${!count_var}'" >&2
    exit 2
  fi
done
# Beside the engine pool's CPU renders, six forks per test lane missed vitest's 60 s worker-start timeout; four start.
VITEST_WORKERS_MAX=4
VITEST_WORKERS=$((LANE_WORKERS < VITEST_WORKERS_MAX ? LANE_WORKERS : VITEST_WORKERS_MAX))

release=0
list=0
list_lanes=0
for arg in "$@"; do
  case "$arg" in
    --release) release=1 ;;
    --list) list=1 ;;
    --list-jobs) echo "$LANE_WORKERS" && exit 0 ;;
    --list-lanes) list_lanes=1 ;;
    --list-test-env) echo "VITEST_MAX_WORKERS=$VITEST_WORKERS workspace-concurrency=1" && exit 0 ;;
    *) echo "$USAGE" >&2 && exit 2 ;;
  esac
done

serial_steps=(actionlint gitleaks install)
# Heaviest first, so with fewer lanes the long steps never wait behind the short ones. The server suite keeps its own
# lane: each of its files boots a PGlite, and beside the other suites that ran out of memory.
parallel_steps=(engine lint test-server typecheck test-other format)

# Every lane at once on an idle machine; on one already busier than its cores, two, or vitest cannot start its workers.
# A checkout on WSL's /mnt drives runs two whatever the CPU: there the file reads run out first.
lane_count() {
  local load="${ZKS_CI_LOAD:-$(cut -d' ' -f1 /proc/loadavg)}" cores="${ZKS_CI_CORES:-$(nproc)}"
  local slow_fs="${ZKS_CI_SLOW_FS:-$([[ "$REPO_ROOT" == /mnt/[a-z]/* ]] && echo 1 || echo 0)}"
  if [[ -n "${ZKS_CI_LANES:-}" ]]; then
    echo "$ZKS_CI_LANES"
  elif [[ "$slow_fs" == 1 ]] || awk -v busy="$load" -v cpus="$cores" 'BEGIN { exit !(busy > cpus) }'; then
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

# zks setup runs here, before the lanes, because both the engine and the server suite read the pinned tools.
step_install() { pnpm install --frozen-lockfile && pnpm -s zks setup; }

# The pinned ffmpeg and Chrome for this step's subshell; one on PATH would make renders machine-dependent.
export_pinned_tools() {
  ZKS_FFMPEG=$(pnpm -s zks tools path ffmpeg) && ZKS_CHROME=$(pnpm -s zks tools path chrome-headless-shell) &&
    export ZKS_FFMPEG ZKS_CHROME
}

# pnpm verify's parts, run as separate lanes. Vitest defaults to a worker per core in every lane, which oversubscribed
# the machine beside the engine pool: forks failed to start and PGlite hooks timed out.
step_format() { node scripts/check-attribution.mjs && pnpm exec prettier --check .; }
step_lint() { pnpm -r lint; }
step_typecheck() { pnpm -r typecheck; }
step_test-server() { export_pinned_tools && VITEST_MAX_WORKERS="$VITEST_WORKERS" pnpm -F @zks/server test; }
step_test-other() { VITEST_MAX_WORKERS="$VITEST_WORKERS" pnpm -r --workspace-concurrency=1 --filter '!@zks/server' test; }

# The engine and golden frames with the pinned ffmpeg and Chrome, the overlay renderer tests forbidden to skip, one
# process per test module. Each process gets its own scratch ZKS_HOME from tests/support.py.
step_engine() {
  local results
  export_pinned_tools && uv sync --project packages/engine --locked || return 1
  results=$(mktemp -d)
  # shellcheck disable=SC2016 # the module, results dir and python reach bash -c as $1, $2 and $3
  (cd packages/engine/tests && ls test_*.py parity/test_*.py) | sed 's#/#.#; s#\.py$##' |
    ZKS_REQUIRE_HF=1 xargs -P "$LANE_WORKERS" -I{} \
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
  # The demo project renders a master through every engine step, so it shares the engine's venv and pinned tools.
  "$REPO_ROOT/packages/engine/.venv/bin/python" -m unittest discover -s examples/demo
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

# Sourced (by the tests), it only defines the steps.
[[ "${BASH_SOURCE[0]}" != "$0" ]] && return 0

# One run at a time per machine: overlapping runs from parallel sessions pushed vitest past its worker-start timeout.
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "ci-local: waiting for another ci-local run on this machine to finish (up to ${LOCK_WAIT_S}s)" >&2
  flock -w "$LOCK_WAIT_S" 9 || { echo "ci-local: another ci-local run holds $LOCK_FILE" >&2 && exit 1; }
fi

log_dir="${TMPDIR:-/tmp}/zks-ci-local-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$log_dir"
# Every step's temp files go under one folder that is removed even when a run is killed: killed test workers never
# reach their cleanup, and their leftovers once filled /tmp.
run_tmp="$log_dir/tmp"
mkdir -p "$run_tmp"
export TMPDIR="$run_tmp"
trap 'rm -rf "$run_tmp"' EXIT
failed=()
reported=()
report() {
  local step=$1 status=$2 seconds=$3
  reported+=("$step")
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

lanes=$(lane_count)
echo "lanes: $lanes"
run_lanes "$lanes" "$log_dir" "${parallel_steps[@]}"
# Every step must have reported; a scheduler fault that skips one must never read as a pass.
if ((${#reported[@]} != ${#serial_steps[@]} + ${#parallel_steps[@]})); then
  echo "ci-local: only ${#reported[@]} of $((${#serial_steps[@]} + ${#parallel_steps[@]})) steps reported" >&2
  failed+=(scheduler)
fi

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
