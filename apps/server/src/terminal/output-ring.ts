// Created by The Angelo Umali.
// Recent PTY output, capped in bytes, so a reloaded tab reattaches with its scrollback (plan §6.3).

/** Per-PTY scrollback kept for a reconnect. */
export const OUTPUT_RING_BYTES = 1024 * 1024;

export interface OutputRing {
  readonly append: (output: string) => void;
  readonly snapshot: () => string;
}

export function createOutputRing(capacityBytes: number): OutputRing {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  const trimToCapacity = () => {
    while (totalBytes > capacityBytes) {
      const oldestChunk = chunks[0];
      if (oldestChunk === undefined) return;
      const excessBytes = totalBytes - capacityBytes;
      if (oldestChunk.length <= excessBytes) {
        chunks.shift();
        totalBytes -= oldestChunk.length;
        continue;
      }
      const keptChunk = skipContinuationBytes(oldestChunk.subarray(excessBytes));
      totalBytes -= oldestChunk.length - keptChunk.length;
      chunks[0] = keptChunk;
    }
  };

  return {
    append(output) {
      const chunk = Buffer.from(output, "utf8");
      chunks.push(chunk);
      totalBytes += chunk.length;
      trimToCapacity();
    },
    snapshot: () => Buffer.concat(chunks).toString("utf8"),
  };
}

// A cut inside a multi-byte character would decode as U+FFFD; start at the next whole character instead.
function skipContinuationBytes(chunk: Buffer): Buffer {
  let startIndex = 0;
  while (startIndex < chunk.length && ((chunk[startIndex] ?? 0) & 0xc0) === 0x80) startIndex += 1;
  return chunk.subarray(startIndex);
}
