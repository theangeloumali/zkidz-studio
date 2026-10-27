// Created by The Angelo Umali.
import { createServer, type Server } from "node:net";

const LOOPBACK = "127.0.0.1";

function listenOnFreePort(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const probe = createServer().once("error", reject);
    probe.listen(0, LOOPBACK, () => resolve(probe));
  });
}

/** Distinct free loopback ports. Every probe stays open until all are picked; closing one first lets the OS hand it out again. */
export async function findFreePorts(count: number): Promise<number[]> {
  const probes: Server[] = [];
  try {
    for (let index = 0; index < count; index += 1) probes.push(await listenOnFreePort());
    return probes.map((probe) => {
      const address = probe.address();
      if (typeof address !== "object" || address === null) throw new Error("a port probe has no address");
      return address.port;
    });
  } finally {
    await Promise.all(probes.map((probe) => new Promise((resolve) => probe.close(resolve))));
  }
}
