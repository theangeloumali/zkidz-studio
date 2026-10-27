// Created by The Angelo Umali.
// Host-side checks behind the compose file (plan §8, spike 03): Windows port reservations, and whether a port answers off loopback (via @zks/shared/node).
import { spawnSync } from "node:child_process";
import { findExposedAddresses } from "@zks/shared/node";

export interface PortRange {
  readonly start: number;
  readonly end: number;
}

/** What db:supabase:start asks of the host; injected so the start/stop decisions test without a network. */
export interface HostNetwork {
  /** The ports among `ports` that Windows reserves; empty where there is no reservation list. */
  findReservedPorts(ports: readonly number[]): number[];
  /** The non-loopback addresses of this machine on which `port` accepts a TCP connection. */
  findExposedAddresses(port: number): Promise<string[]>;
}

const EXCLUDED_PORT_RANGE_ARGS = ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"];
const PORT_RANGE_ROW = /^\s*(\d+)\s+(\d+)\b/;

export function parseExcludedPortRanges(netshOutput: string): PortRange[] {
  return netshOutput.split(/\r?\n/).flatMap((line) => {
    const match = PORT_RANGE_ROW.exec(line);
    return match ? [{ start: Number(match[1]), end: Number(match[2]) }] : [];
  });
}

export function findReservedPorts(ranges: readonly PortRange[], ports: readonly number[]): number[] {
  return ports.filter((port) => ranges.some((range) => port >= range.start && port <= range.end));
}

/** Docker Desktop publishes on the Windows host, so its reservations apply under WSL too. */
export function excludedPortRangeCommand(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>): string | null {
  if (platform === "win32") return "netsh";
  if (platform === "linux" && env.WSL_DISTRO_NAME) return "netsh.exe";
  return null;
}

function readExcludedPortRanges(): PortRange[] {
  const command = excludedPortRangeCommand(process.platform, process.env);
  if (command === null) return [];
  const result = spawnSync(command, EXCLUDED_PORT_RANGE_ARGS, { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`Could not read Windows' reserved ports with ${command} ${EXCLUDED_PORT_RANGE_ARGS.join(" ")}.`);
  return parseExcludedPortRanges(result.stdout);
}

export const hostNetwork: HostNetwork = {
  findReservedPorts: (ports) => findReservedPorts(readExcludedPortRanges(), ports),
  findExposedAddresses,
};
