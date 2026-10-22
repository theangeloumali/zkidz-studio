// Created by The Angelo Umali.
import { LOOPBACK_HOST } from "@zks/shared";

// Literal addresses only: "localhost" depends on the hosts file, which can point it at a LAN address.
const LOOPBACK_BIND_HOSTS: ReadonlySet<string> = new Set([LOOPBACK_HOST, "::1", "[::1]"]);

export class NonLoopbackBindError extends Error {
  override readonly name = "NonLoopbackBindError";

  constructor(host: string) {
    super(`Refusing to listen on ${JSON.stringify(host)}: the server binds loopback only (ZKS_CONTAINER=1 is for the Docker image alone).`);
  }
}

export function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_BIND_HOSTS.has(host)) throw new NonLoopbackBindError(host);
}
