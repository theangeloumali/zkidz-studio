// Created by The Angelo Umali.
// Native and heavy modules load on first use, off the start path (plan §9.5 start budget).

export class ModuleLoadError extends Error {
  override readonly name = "ModuleLoadError";
}

/** Memoizes a dynamic import. A failure names the module, and the next use retries. */
export function lazyImport<Module>(label: string, load: () => Promise<Module>): () => Promise<Module> {
  let pending: Promise<Module> | undefined;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw new ModuleLoadError(`${label} failed to load: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    });
    return pending;
  };
}
