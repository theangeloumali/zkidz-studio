#!/usr/bin/env bash
# Created by The Angelo Umali.
# Scans the full git history of the current directory. Usage: gitleaks-scan.sh [base-sha]
# With a base commit (pull requests), the rules and the ignore list come from that commit, so a PR
# cannot loosen the scan that judges it. Inline gitleaks:allow markers are never honoured.
set -euo pipefail

base_sha="${1:-}"
scan_args=(git --no-banner --redact --verbose --ignore-gitleaks-allow)

if [[ -n "$base_sha" ]]; then
  trusted_dir="$(mktemp -d)"
  trap 'rm -rf "$trusted_dir"' EXIT
  # A base without a config (the PR that adds it) gets the upstream defaults, never the PR's own file.
  git show "$base_sha:.gitleaks.toml" >"$trusted_dir/gitleaks.toml" 2>/dev/null ||
    printf '[extend]\nuseDefault = true\n' >"$trusted_dir/gitleaks.toml"
  # gitleaks always reads ./.gitleaksignore as well as --gitleaks-ignore-path, so replace the PR's copy in place.
  git show "$base_sha:.gitleaksignore" >.gitleaksignore 2>/dev/null || rm -f .gitleaksignore
  scan_args+=(--config "$trusted_dir/gitleaks.toml")
fi

gitleaks "${scan_args[@]}" .
