#!/usr/bin/env bash
# Created by The Angelo Umali.
# Runs inside a fresh node:24 container: does pnpm fetch the pinned Node runtime and pnpm itself?
set -euo pipefail
echo "container node: $(node --version)"
cp -r /spike/fixture /work && cd /work
# Bootstrap pnpm without Corepack (plan D2); devEngines.packageManager then decides the real version.
npm install --global --silent pnpm@11.24.0
echo "bootstrap pnpm: $(pnpm --version)"
pnpm install 2>&1 | tail -15
echo "pnpm after install: $(pnpm --version)"
echo "--- lockfile runtime entries:"
grep -n -B1 -A6 "node@runtime" pnpm-lock.yaml | head -30
echo "--- pnpm itself:"; grep -n -A3 "^  pnpm@\|packageManagerDependencies" pnpm-lock.yaml | head -12
pnpm run which-node
echo "bare node in project: $(node --version)"
