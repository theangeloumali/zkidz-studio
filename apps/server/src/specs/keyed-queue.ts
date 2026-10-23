// Created by The Angelo Umali.

/** Runs the tasks queued under one key one at a time, in call order; tasks under other keys run freely. */
export function createKeyedQueue() {
  const queues = new Map<string, Promise<unknown>>();
  return function runQueued<Output>(key: string, task: () => Promise<Output>): Promise<Output> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return next;
  };
}
