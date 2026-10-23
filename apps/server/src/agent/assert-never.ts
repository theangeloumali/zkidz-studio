// Created by The Angelo Umali.
/** Exhaustiveness guard for switches over a union. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
