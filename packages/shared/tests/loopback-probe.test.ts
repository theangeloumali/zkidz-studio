// Created by The Angelo Umali.
// A TCP probe of every non-loopback address: the shared check behind db:supabase:start and the doctor's database row.
import { createServer, type Server } from "node:net";
import type { NetworkInterfaceInfo } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { findAnsweringAddresses, findExposedAddresses, nonLoopbackAddresses } from "../src/loopback-probe.ts";

function ipv4Entry(address: string, internal: boolean): NetworkInterfaceInfo {
  return { address, netmask: "", mac: "00:00:00:00:00:00", internal, cidr: null, family: "IPv4" };
}

function ipv6Entry(address: string, internal: boolean, scopeid = 0): NetworkInterfaceInfo {
  return { address, netmask: "", mac: "00:00:00:00:00:00", internal, cidr: null, family: "IPv6", scopeid };
}

describe("nonLoopbackAddresses", () => {
  const interfaces = {
    lo: [ipv4Entry("127.0.0.1", true), ipv6Entry("::1", true)],
    eth0: [ipv4Entry("192.0.2.10", false), ipv6Entry("fe80::1", false, 7), ipv6Entry("2001:db8::10", false)],
  };

  it("skips internal addresses and zones link-local IPv6 by interface name off Windows", () => {
    expect(nonLoopbackAddresses(interfaces, "linux")).toEqual(["192.0.2.10", "fe80::1%eth0", "2001:db8::10"]);
  });

  it("zones link-local IPv6 by scope id on Windows", () => {
    expect(nonLoopbackAddresses(interfaces, "win32")).toContain("fe80::1%7");
  });
});

describe("findAnsweringAddresses", () => {
  // tcpmux: nothing listens there on a developer machine or a CI runner.
  const UNUSED_PRIVILEGED_PORT = 1;
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function listen(host: string): Promise<number> {
    const server = createServer((socket) => socket.destroy());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP address");
    return address.port;
  }

  it("reports an address that accepts the connection and not one that refuses it", async () => {
    const port = await listen("127.0.0.1");

    expect(await findAnsweringAddresses(port, ["127.0.0.1"])).toEqual(["127.0.0.1"]);
    // Not a just-closed port: WSL's mirrored networking keeps answering on one for a few milliseconds.
    expect(await findAnsweringAddresses(UNUSED_PRIVILEGED_PORT, ["127.0.0.1"])).toEqual([]);
  });

  it("does not flag a loopback-only listener on this machine's other addresses", async () => {
    const port = await listen("127.0.0.1");

    expect(await findExposedAddresses(port)).toEqual([]);
  });

  const ipv4Addresses = nonLoopbackAddresses().filter((address) => !address.includes(":"));
  it.skipIf(ipv4Addresses.length === 0)("flags a wildcard listener on a non-loopback address", async () => {
    const port = await listen("0.0.0.0");

    expect(await findAnsweringAddresses(port, ipv4Addresses)).toEqual(ipv4Addresses);
  });
});
