// Created by The Angelo Umali.
// Shared valid samples; each test mutates one field to prove a rejection.
export const ASSET_ID = "6f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f";
export const PROJECT_ID = "0b6c1d2e-3f40-4a51-9b62-7c8d9e0f1a2b";
export const JOB_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
export const EVENT_AT = "2026-10-22T12:00:00.000Z";

export const validCutSpec = {
  schemaVersion: 1,
  sourceAssetId: ASSET_ID,
  durationS: 578.244333,
  fps: { num: 30000, den: 1001 },
  removals: [
    { at: 19.95, end: 21.95, reason: "filler" },
    { at: 135.3, end: 152.6, reason: "camera move", pin: true },
  ],
  trimPauses: { thresholdDb: -32, minS: 0.5, keepS: 0.2, exclude: [] },
  faceCamRanges: [{ at: 0, end: 135.3 }],
  cutaways: [{ at: 109.15, end: 110.4, title: "Cloud roles", sub: "Hardcore roles", style: "wipe" }],
  bleeps: [{ at: 169.32, end: 169.62, x: 540, y: 430 }],
  blurBoxes: [{ at: 180.95, end: 188.5, x: 600, y: 1000, w: 480, h: 400, reason: "third-party names" }],
  zooms: [{ at: 21.4, end: 23.7, preset: "snap" }],
  portals: [
    {
      at: 251.9,
      end: 253,
      corners: [
        { x: 260, y: 420 },
        { x: 830, y: 420 },
        { x: 830, y: 1230 },
        { x: 260, y: 1230 },
      ],
    },
  ],
  matteRanges: [{ at: 0.4, end: 4.8 }],
};
