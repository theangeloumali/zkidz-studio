// Created by The Angelo Umali.
// The server's stop order: anything that still writes must finish before the database closes, or PGlite hangs.

export interface ShutdownSteps {
  /** Kills terminals and SDK sessions; resolves once their exit work (job cancels, exit events) is done. */
  readonly stopAgents: () => Promise<void>;
  readonly closeServers: () => readonly Promise<void>[];
  readonly drainJobs: () => Promise<void>;
  readonly stopEditRecorder: () => Promise<void>;
  readonly closeDatabase: () => Promise<void>;
}

export async function shutDownInOrder(steps: ShutdownSteps): Promise<void> {
  // Settled, not all: a server that fails to close must not skip draining the jobs and closing the database.
  await Promise.allSettled([steps.stopAgents(), ...steps.closeServers()]);
  await steps.drainJobs();
  await steps.stopEditRecorder();
  await steps.closeDatabase();
}
