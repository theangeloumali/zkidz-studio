// Created by The Angelo Umali.
// Wraps fs functions so a test can see every path the server opened, statted or listed.

/** A copy of `fsModule` whose `names` push their first argument, as a string, onto `touched`. */
export function recordingFs<T extends object>(fsModule: T, names: readonly string[], touched: string[]): T {
  const copy = Object.fromEntries<unknown>(Object.entries(fsModule));
  for (const name of names) {
    const original = copy[name];
    if (typeof original !== "function") continue;
    copy[name] = (...args: unknown[]): unknown => {
      touched.push(pathText(args[0]));
      const result: unknown = Reflect.apply(original, fsModule, args);
      return result;
    };
  }
  return copy as T;
}

function pathText(pathLike: unknown): string {
  if (pathLike instanceof URL) return pathLike.pathname;
  if (typeof pathLike === "string" || Buffer.isBuffer(pathLike)) return pathLike.toString();
  return "";
}
