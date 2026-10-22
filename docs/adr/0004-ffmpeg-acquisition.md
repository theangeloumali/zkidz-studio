<!-- Created by The Angelo Umali. -->

# ADR 0004: ffmpeg is downloaded and pinned at setup, never bundled

- Status: Accepted
- Date: 2026-10-22
- Plan: D6, D7, §7.2, §7.5

## Context

Rendering must work on NVIDIA, Apple, Intel, AMD and CPU-only machines. Bundling ffmpeg would make the repo heavy and tie the
licence to one build. A distro ffmpeg varies in what it was built with.

## Decision

- `zks setup` downloads a dated BtbN `gpl` build on Windows and Linux (Homebrew or a probed static build on macOS), records it in
  `tools.lock.json` with its SHA-256, and verifies the hash before the rename.
- The `gpl` variant keeps libx264/libx265 for the CPU fallback.
- A capability probe encodes real frames per backend (nvidia, videotoolbox, qsv, amf, vaapi, cpu) and caches the result per
  ffmpeg hash plus driver version. A name in `-encoders` proves nothing.
- whisper.cpp is the default transcriber; ffmpeg's `whisper` filter is used only when the probe proves it works.

## Consequences

- No binary enters git. A monthly `tools-lock.yml` PR, reviewed by a human, moves the pin.
