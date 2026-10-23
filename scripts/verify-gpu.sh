#!/usr/bin/env bash
# Created by The Angelo Umali.
# pnpm verify:gpu without pnpm: same refusals and parity run as scripts/verify-gpu.mjs.
set -euo pipefail
exec node "$(dirname "$0")/verify-gpu.mjs" "$@"
