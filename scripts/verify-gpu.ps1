# Created by The Angelo Umali.
# pnpm verify:gpu without pnpm on Windows: same refusals and parity run as scripts/verify-gpu.mjs.
$ErrorActionPreference = "Stop"
node (Join-Path $PSScriptRoot "verify-gpu.mjs") @args
exit $LASTEXITCODE
