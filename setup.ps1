# Created by The Angelo Umali.
# Bootstraps pinned, hash-checked pnpm and uv into ZKS_HOME\tools (no admin, nothing global), then runs `zks setup`.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
foreach ($arg in $args) { if ($arg -ne '--no-start') { Write-Error 'usage: setup.cmd [--no-start]'; exit 2 } }
$StartServer = -not ($args -contains '--no-start')
Set-Location $PSScriptRoot
$env:HYPERFRAMES_NO_TELEMETRY = '1'
$env:DO_NOT_TRACK = '1'
$PnpmVersion = '12.15.0'
$UvVersion = '0.12.24'
switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' {
    $PnpmAsset = 'pnpm-win32-x64'; $PnpmSha = '84cf69db1be19e95bb4e5bef329291a046f2821b390d87e00f5690809d8a2ed7'
    $UvAsset = 'uv-x86_64-pc-windows-msvc'; $UvSha = '7c38608c8a18ee137d748a1773053b07ec8f3a30fab49aebaa6f4e4efeceb019'
  }
  'ARM64' {
    $PnpmAsset = 'pnpm-win32-arm64'; $PnpmSha = 'b4ad6a5141491911e9d0c8d61ab64eac4abf4cc56a24f6c126ac9de139a86d54'
    $UvAsset = 'uv-aarch64-pc-windows-msvc'; $UvSha = '4b783bda5cc44bbae0651a837223873a7acee31152381aef5fc86ef6bef25997'
  }
  default { Write-Error "unsupported architecture $env:PROCESSOR_ARCHITECTURE; supported: win-x64, win-arm64"; exit 1 }
}
if (-not $env:ZKS_HOME) { $env:ZKS_HOME = Join-Path $env:LOCALAPPDATA 'zkidz-studio' }
$Tools = Join-Path $env:ZKS_HOME 'tools'
# uv otherwise puts its managed Python and cache under %APPDATA%\uv and %LOCALAPPDATA%\uv; packages/cli uvEnvironment() applies the same defaults.
if (-not $env:UV_PYTHON_INSTALL_DIR) { $env:UV_PYTHON_INSTALL_DIR = Join-Path $env:ZKS_HOME 'tools\python' }
if (-not $env:UV_CACHE_DIR) { $env:UV_CACHE_DIR = Join-Path $env:ZKS_HOME 'cache\uv' }
New-Item -ItemType Directory -Force -Path (Join-Path $Tools '.downloads') | Out-Null

# .part + curl resume, verify, then extract beside the target and rename so a broken run never looks installed.
function Install-Tool([string]$Name, [string]$Version, [string]$Url, [string]$Sha) {
  $dir = Join-Path $Tools "$Name\$Version"
  if (Test-Path (Join-Path $dir "$Name.exe")) { return $dir }
  Write-Host "fetching $Name $Version"
  $part = Join-Path $Tools ".downloads\$Name-$Version.part"
  curl.exe -fsSL --retry 3 -C - -o $part $Url
  if ($LASTEXITCODE -ne 0) { Remove-Item -Force $part -ErrorAction SilentlyContinue; curl.exe -fsSL --retry 3 -o $part $Url }
  if ((Get-FileHash -Algorithm SHA256 $part).Hash.ToLower() -ne $Sha) { Remove-Item -Force $part; throw "SHA-256 mismatch for $Url" }
  $zip = [IO.Path]::ChangeExtension($part, '.zip')
  Move-Item -Force $part $zip
  $staging = "$dir.staging"
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
  Expand-Archive -Path $zip -DestinationPath $staging
  $exe = Get-ChildItem -Path $staging -Recurse -Filter "$Name.exe" | Select-Object -First 1
  Move-Item $exe.DirectoryName $dir
  Remove-Item -Recurse -Force $staging, $zip -ErrorAction SilentlyContinue
  return $dir
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  $env:PATH = (Install-Tool 'pnpm' $PnpmVersion "https://github.com/pnpm/pnpm/releases/download/v$PnpmVersion/$PnpmAsset.zip" $PnpmSha) + ";$env:PATH"
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  $env:PATH = (Install-Tool 'uv' $UvVersion "https://github.com/astral-sh/uv/releases/download/$UvVersion/$UvAsset.zip" $UvSha) + ";$env:PATH"
}

pnpm install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
uv sync --locked --project packages/engine; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm exec node packages/cli/src/main.ts setup; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($StartServer) { pnpm start; exit $LASTEXITCODE }
Write-Host 'setup complete. Start with: pnpm start'
