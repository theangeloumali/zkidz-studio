// Created by The Angelo Umali.
// Plain constants, so the harness can share them without loading the Playwright fixtures into the studio server.

// Ingest, transcribe, a 4K master (1080 off NVIDIA) and its QC re-transcription of a 2 s clip; the agent waits on each job.
export const RENDER_TIMEOUT_MS = 5 * 60_000;
