// Created by The Angelo Umali.
// @vitest-environment node
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { findFreePorts } from "../e2e/support/free-ports.ts";

describe("findFreePorts", () => {
  it("returns distinct ports that are free once it resolves", async () => {
    const ports = await findFreePorts(4);
    expect(new Set(ports).size).toBe(4);
    for (const port of ports) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
