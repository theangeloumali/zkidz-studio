// Created by The Angelo Umali.
// work/edl/<videoId>.json, the EDL the engine's preview build maps cues through, derived from the current cut spec.
import { join } from "node:path";
import { keptSpansOf, type CutSpec } from "@zks/shared";
import { writeFileAtomically } from "../specs/spec-files.ts";

// dry-new: zks_engine/edl.py writes this file for renders, but it reads the films cut format, not CutSpec. This is the
// player EDL's kept-span derivation in edl.py's frame format, without its pause trim and punch-ins.
interface EngineEdl {
  readonly fps_num: number;
  readonly fps_den: number;
  /** Edited length in frames. */
  readonly frames: number;
  readonly reel: boolean;
  readonly segments: readonly EngineEdlSegment[];
  readonly bleeps: NonNullable<CutSpec["bleeps"]>;
  readonly cutaways: NonNullable<CutSpec["cutaways"]>;
}

interface EngineEdlSegment {
  readonly in: number;
  readonly out: number;
  readonly target: number;
}

function engineEdlOf(cuts: CutSpec): EngineEdl {
  const fps = cuts.fps.num / cuts.fps.den;
  const segments: EngineEdlSegment[] = [];
  let editedFrames = 0;
  for (const keptSpan of keptSpansOf(cuts)) {
    const inFrame = Math.round(keptSpan.at * fps);
    const outFrame = Math.round(keptSpan.end * fps);
    if (outFrame <= inFrame) continue;
    segments.push({ in: inFrame, out: outFrame, target: editedFrames });
    editedFrames += outFrame - inFrame;
  }
  const { num: fps_num, den: fps_den } = cuts.fps;
  return { fps_num, fps_den, frames: editedFrames, reel: cuts.isReel === true, segments, bleeps: cuts.bleeps ?? [], cutaways: cuts.cutaways ?? [] };
}

export function writePreviewEdl(projectRoot: string, videoId: string, cuts: CutSpec): Promise<void> {
  return writeFileAtomically(join(projectRoot, "work", "edl", `${videoId}.json`), `${JSON.stringify(engineEdlOf(cuts))}\n`);
}
