// Created by The Angelo Umali.
import { createHash } from "node:crypto";
import { Transform } from "node:stream";

/** A pass-through that hashes and counts what flows through it; read the totals once the pipeline ends. */
export function createHashingStream() {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  return { stream, digest: () => hash.digest("hex"), byteCount: () => bytes };
}
