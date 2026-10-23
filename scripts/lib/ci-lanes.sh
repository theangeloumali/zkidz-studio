#!/usr/bin/env bash
# Created by The Angelo Umali.
# Runs step_<name> for each name, at most <lanes> at a time, logging each to <log_dir>/<name>.log, and calls
# report <name> <status> <seconds> as each finishes.
run_lanes() {
  local lanes=$1 log_dir=$2 step started=$SECONDS
  shift 2
  # The "=()" matters: under set -u an empty associative array without it is unbound, and the loops below then skipped
  # every step while the run still passed.
  local -A step_of_pid=()
  reap_one() {
    local finished_pid status
    wait -n -p finished_pid "${!step_of_pid[@]}"
    status=$?
    report "${step_of_pid[$finished_pid]}" "$status" "$((SECONDS - started))"
    unset "step_of_pid[$finished_pid]"
  }
  for step in "$@"; do
    while ((${#step_of_pid[@]} >= lanes)); do reap_one; done
    "step_$step" >"$log_dir/$step.log" 2>&1 &
    step_of_pid[$!]=$step
  done
  while ((${#step_of_pid[@]})); do reap_one; done
}
