#!/usr/bin/env bash
# Created by The Angelo Umali.
# Scans the checked-out branch's full history. Usage: gitleaks-scan.sh [base-sha]
# With a base commit (ci-local passes the merge-base with develop), the rules and the ignore list come from that commit,
# so a branch cannot loosen the scan that judges it. Inline gitleaks:allow markers are never honoured.
set -euo pipefail

base_sha="${1:-}"
# HEAD only: worktrees share one repository, and gitleaks would otherwise scan every branch in it.
scan_args=(git --no-banner --redact --verbose --ignore-gitleaks-allow --log-opts=HEAD)

if [[ -n "$base_sha" ]]; then
  trusted_dir="$(mktemp -d)"
  # gitleaks always reads ./.gitleaksignore as well as --gitleaks-ignore-path, so the base's copy goes in place for the
  # scan and the working tree's own copy comes back afterwards.
  if [[ -e .gitleaksignore ]]; then cp .gitleaksignore "$trusted_dir/own-ignore"; fi
  trap 'if [[ -e "$trusted_dir/own-ignore" ]]; then cp "$trusted_dir/own-ignore" .gitleaksignore; else rm -f .gitleaksignore; fi; rm -rf "$trusted_dir"' EXIT
  # A base without a config (the branch that adds it) gets the upstream defaults, never the branch's own file.
  git show "$base_sha:.gitleaks.toml" >"$trusted_dir/gitleaks.toml" 2>/dev/null ||
    printf '[extend]\nuseDefault = true\n' >"$trusted_dir/gitleaks.toml"
  git show "$base_sha:.gitleaksignore" >.gitleaksignore 2>/dev/null || rm -f .gitleaksignore
  scan_args+=(--config "$trusted_dir/gitleaks.toml")
fi

gitleaks "${scan_args[@]}" .
