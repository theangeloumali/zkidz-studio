// Created by The Angelo Umali.
// Reads SSE frames off a streamed Response; the server's `retry:` frame marks the subscription as live.
interface SseFrame {
  readonly id: string | undefined;
  readonly data: unknown;
}

export interface SseReader {
  readonly nextFrames: (count: number) => Promise<SseFrame[]>;
  readonly close: () => Promise<void>;
}

const FRAME_TIMEOUT_MS = 5000;

export async function openSseReader(response: Response): Promise<SseReader> {
  if (response.body === null) throw new Error("SSE response has no body");
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const queuedFrames: SseFrame[] = [];
  let isReady = false;

  const pullChunk = async () => {
    const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE")), FRAME_TIMEOUT_MS));
    const chunk = await Promise.race([reader.read(), timeout]);
    if (chunk.done) throw new Error("SSE stream ended");
    pending += decoder.decode(chunk.value, { stream: true });
    const blocks = pending.split("\n\n");
    pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const lines = block.split("\n");
      if (lines.some((line) => line.startsWith("retry:"))) isReady = true;
      const dataLine = lines.find((line) => line.startsWith("data: "));
      if (dataLine === undefined) continue;
      const idLine = lines.find((line) => line.startsWith("id: "));
      queuedFrames.push({ id: idLine?.slice("id: ".length), data: JSON.parse(dataLine.slice("data: ".length)) });
    }
  };

  while (!isReady) await pullChunk();
  return {
    nextFrames: async (count) => {
      while (queuedFrames.length < count) await pullChunk();
      return queuedFrames.splice(0, count);
    },
    close: () => reader.cancel(),
  };
}
