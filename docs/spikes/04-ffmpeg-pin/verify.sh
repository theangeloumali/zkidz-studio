#!/usr/bin/env bash
# Created by The Angelo Umali.
# Spike 4: fetch a pinned BtbN build into a scratch dir, verify its SHA-256, and list what it can do.
# Usage: verify.sh <empty-or-existing download dir>
set -euo pipefail
download_dir="$1"
tag="autobuild-2026-09-30-13-08"
asset="ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-8.1.tar.xz"
expected_sha256="97ce978979194b5cf7e06a5e68020dbdaa7a4f3294c5452b6a1bc347100dbb79"
base="https://github.com/BtbN/FFmpeg-Builds/releases/download/$tag"

mkdir -p "$download_dir/archive" "$download_dir/extracted"
cd "$download_dir/archive"
[[ -f checksums.sha256 ]] || curl -fsSLO "$base/checksums.sha256"
[[ -f "$asset" ]] || curl -fsSLO "$base/$asset"
echo "--- release checksums.sha256 entry"
sha256sum -c --ignore-missing checksums.sha256
echo "--- pinned value (tools.lock.json candidate)"
echo "$expected_sha256  $asset" | sha256sum -c -
stat -c '%s bytes' "$asset"

tar -xJf "$asset" -C "$download_dir/extracted" --strip-components=1
ffmpeg_bin="$download_dir/extracted/bin/ffmpeg"
"$ffmpeg_bin" -hide_banner -version | head -1
echo "--- whisper in configuration / filters"
"$ffmpeg_bin" -hide_banner -buildconf | grep -i whisper || true
"$ffmpeg_bin" -hide_banner -filters | grep -i whisper || echo "no whisper filter (grep exit $?)"
echo "--- GPU pieces the engine needs"
"$ffmpeg_bin" -hide_banner -encoders | grep -E " (hevc|h264|av1)_nvenc " | awk '{print $2}'
"$ffmpeg_bin" -hide_banner -filters | grep -E " (overlay_cuda|scale_cuda|libplacebo|overlay_opencl) " | awk '{print $2}'
echo "--- 4K hevc_nvenc smoke"
"$ffmpeg_bin" -hide_banner -loglevel error -f lavfi -i testsrc2=size=3840x2160:rate=30 -frames:v 60 -c:v hevc_nvenc -f null - && echo "hevc_nvenc exit 0"
"$ffmpeg_bin" -hide_banner -loglevel error -init_hw_device cuda -f lavfi -i testsrc2=size=1920x1080:rate=30 -frames:v 30 \
  -vf "hwupload_cuda,scale_cuda=3840:2160" -c:v hevc_nvenc -f null - && echo "scale_cuda exit 0"
