<!-- Created by The Angelo Umali. -->

# Spike 4: pinned BtbN ffmpeg and whisper

**Status: FAIL** for in-ffmpeg whisper: the BtbN builds are configured with `--disable-whisper`. **PASS** for the pin
itself: SHA-256 verification, NVENC, CUDA/OpenCL filters and libplacebo all work.

## Goal

Plan D6 / §7.4: `tools.lock.json` pins one ffmpeg build per platform by URL and SHA-256. Does a pinned BtbN build verify,
does it carry the `whisper` filter, and does it have the GPU pieces the engine uses?

## Commands

```bash
bash docs/spikes/04-ffmpeg-pin/verify.sh <scratch download dir>
```

The script downloads `checksums.sha256` and the archive for tag `autobuild-2026-09-30-13-08` into the directory you give
it. It verifies the archive against both the release checksum file and the pinned value, extracts it, then queries
`-buildconf`, `-filters` and `-encoders` and runs two GPU smoke encodes. Full output: `results/verify.log`.

## Output excerpts

```text
ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-8.1.tar.xz: OK        # release checksums.sha256
ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-8.1.tar.xz: OK        # pinned 97ce9789...00dbb79
150360944 bytes
ffmpeg version n8.1.3-9-g29e619e767-20260930
    --disable-whisper
no whisper filter (grep exit 1)
av1_nvenc h264_nvenc hevc_nvenc libplacebo overlay_opencl overlay_cuda scale_cuda
hevc_nvenc exit 0          # 60 frames, 3840x2160
scale_cuda exit 0
```

The system ffmpeg 8.0.1 on this machine has no whisper filter either.

Retention: the releases page keeps daily `autobuild-*` tags for about 14 days. Month-end tags are kept long term (they go
back to 2024-11-30).

## Decision for the plan

1. **D6 holds: whisper.cpp is the default transcriber,** not ffmpeg's `whisper` filter. No pinnable BtbN build has it.
2. **Pin month-end tags only** in `tools.lock.json`; a daily tag 404s within about two weeks. Keep URL, size and SHA-256
   per platform, and verify against the pinned hash, never against a checksum file fetched at the same time.
3. The linux64 GPL build covers the engine's GPU path (NVENC, `overlay_cuda`, `scale_cuda`, OpenCL, libplacebo). The win64
   and macOS builds were not exercised here.
