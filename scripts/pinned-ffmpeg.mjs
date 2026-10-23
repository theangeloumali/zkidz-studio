// Created by The Angelo Umali.
// Prints the pinned ffmpeg `zks setup` installed, for CI to hand the engine as ZKS_FFMPEG; exits 1 when it is missing.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pinnedFfmpeg } from "./verify-gpu.mjs";

const ffmpeg = pinnedFfmpeg(process.env, homedir(), existsSync);
if (ffmpeg) {
  console.log(ffmpeg);
} else {
  console.error("the pinned ffmpeg is not installed. Run: pnpm zks setup");
  process.exitCode = 1;
}
