// Created by The Angelo Umali.
// Whether a TCP port answers on any of this machine's non-loopback addresses (plan §8: Postgres stays on 127.0.0.1).
import { connect } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

// A filtered port never refuses, so the probe needs a ceiling; a LAN connect answers far inside it.
const PROBE_TIMEOUT_MS = 1_000;

export function nonLoopbackAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  return Object.entries(interfaces).flatMap(([interfaceName, entries = []]) =>
    entries
      .filter((entry) => !entry.internal)
      .map((entry) => {
        if (entry.family !== "IPv6" || !entry.address.startsWith("fe80:")) return entry.address;
        // libuv resolves the zone with if_nametoindex off Windows and as a number on it.
        return `${entry.address}%${platform === "win32" ? entry.scopeid : interfaceName}`;
      }),
  );
}

export async function findAnsweringAddresses(port: number, addresses: readonly string[]): Promise<string[]> {
  const answers = await Promise.all(addresses.map((address) => acceptsConnection(address, port)));
  return addresses.filter((_address, index) => answers[index]);
}

/** The non-loopback addresses of this machine on which `port` accepts a TCP connection. */
export function findExposedAddresses(port: number): Promise<string[]> {
  return findAnsweringAddresses(port, nonLoopbackAddresses());
}

function acceptsConnection(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: PROBE_TIMEOUT_MS });
    const settle = (isAnswered: boolean): void => {
      socket.destroy();
      resolve(isAnswered);
    };
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}
