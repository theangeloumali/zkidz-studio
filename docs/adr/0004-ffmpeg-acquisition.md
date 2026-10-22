<!-- Created by The Angelo Umali. -->

# ADR 0004: ffmpeg is downloaded and pinned at setup, never bundled

- Status: Accepted
- Date: 2026-10-22
- Plan: D6, D7, §7.2, §7.5

## Context

Rendering must work on NVIDIA, Apple, Intel, AMD and CPU-only machines. Bundling ffmpeg would make the repo heavy and tie the
licence to one build. A distro ffmpeg varies in what it was built with.

## Decision

- `zks setup` downloads a BtbN `gpl` build from a month-end `autobuild-*` tag on Windows and Linux (Homebrew or a probed static
  build on macOS), records it in `tools.lock.json` with its SHA-256, and verifies the hash before the rename. Spike 04: daily tags
  disappear after about 14 days, month-end tags stay. The hash check uses the committed value, never a checksum file fetched in the
  same run.
- The `gpl` variant keeps libx264/libx265 for the CPU fallback.
- A capability probe encodes real frames per backend (nvidia, videotoolbox, qsv, amf, vaapi, cpu) and caches the result per
  ffmpeg hash plus driver version. A name in `-encoders` proves nothing.
- whisper.cpp is the default transcriber; ffmpeg's `whisper` filter is used only when the probe proves it works. Spike 04 found
  the BtbN builds configured with `--disable-whisper`, so in practice every install uses whisper.cpp.

## Consequences

- No binary enters git. A monthly `tools-lock.yml` PR, reviewed by a human, moves the pin.
