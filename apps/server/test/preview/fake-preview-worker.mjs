// Created by The Angelo Umali.
// Stands in for hf/preview/worker.js: logs its pid once at start, answers each build, and exits on video "crash".
import { appendFileSync } from "node:fs";

appendFileSync(process.env.FAKE_WORKER_PID_LOG ?? "", `${process.pid}\n`);
process.on("message", ({ id, video }) => {
  if (video === "crash") process.exit(3);
  process.send?.(video === "bad" ? { id, ok: false, error: "no cues for bad" } : { id, ok: true });
});
