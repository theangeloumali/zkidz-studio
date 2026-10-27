// Created by The Angelo Umali.
// Threat: LAN exposure (plan §11). main.ts refuses a non-loopback bind before it listens, binds both listeners to the
// checked host, and the routes that read the host's disk also refuse a non-loopback peer.
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { API_ROUTES } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listen, type Listener } from "./raw-http.ts";
import { createGuardedServer, sameOriginWriteHeaders, sendRequest, type GuardedServer } from "./threat-harness.ts";

const MAIN_SOURCE = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address !== undefined && address.family === "IPv4" && !address.internal)
  .map((address) => address?.address ?? "");

let guarded: GuardedServer;
let listener: Listener;
beforeAll(async () => {
  guarded = await createGuardedServer();
  listener = await listen(guarded.server.app);
});
afterAll(async () => {
  await listener.close();
  await guarded.server.close();
});

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 2000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe("main.ts wires the loopback bind", () => {
  it("checks the bind host before either listener starts, and both listen on that host", async () => {
    const source = await readFile(MAIN_SOURCE, "utf8");
    const checkAt = source.indexOf("security.assertLoopbackBind(bindHost)");
    const serveCalls = [...source.matchAll(/serve\(\{[^}]*\}/g)].map((match) => ({ at: match.index, call: match[0] }));
    expect(checkAt).toBeGreaterThan(0);
    expect(source).toMatch(/const bindHost = config\.isContainer \? CONTAINER_BIND_HOST : LOOPBACK_HOST;/);
    expect(serveCalls).toHaveLength(2);
    for (const { at, call } of serveCalls) {
      expect(at).toBeGreaterThan(checkAt);
      expect(call).toContain("hostname: bindHost");
    }
  });
});

describe("a loopback listener", () => {
  it("answers on 127.0.0.1", async () => {
    expect(await canConnect("127.0.0.1", listener.port)).toBe(true);
  });

  it.skipIf(lanAddresses.length === 0).each(lanAddresses)("is unreachable on the LAN address %s", async (address) => {
    expect(await canConnect(address, listener.port)).toBe(false);
  });
});

describe("disk-reading routes refuse a non-loopback peer, even behind the container's port mapping", () => {
  it.each(["192.168.1.20", "10.0.0.5", "172.17.0.1", "::ffff:192.168.1.20", "fe80::1"])("refuses the folder picker to %s", async (peer) => {
    const response = await sendRequest(guarded, `${API_ROUTES.listFolder.path}?path=%2F`, { peer });
    expect(response.status).toBe(403);
  });

  it("refuses in-place registration to a LAN peer", async () => {
    const headers = sameOriginWriteHeaders(guarded.csrfToken, false);
    const body = JSON.stringify({ path: "/etc/hostname", title: "x" });
    const response = await sendRequest(guarded, API_ROUTES.createProjectInPlace.path, { method: "POST", headers, body, peer: "192.168.1.20" });
    expect(response.status).toBe(403);
  });

  it("serves the folder picker to a loopback peer", async () => {
    expect((await sendRequest(guarded, `${API_ROUTES.listFolder.path}?path=%2F`, { peer: "127.0.0.1" })).status).toBe(200);
  });
});
