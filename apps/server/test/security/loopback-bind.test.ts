// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { createSecurity, NonLoopbackBindError } from "../../src/security/index.ts";

function securityFor(container: boolean) {
  return createSecurity({ appPort: 4317, previewPort: 4318, container });
}

describe("assertLoopbackBind", () => {
  it.each(["127.0.0.1", "::1", "[::1]"])("allows the loopback address %s", (host) => {
    expect(() => securityFor(false).assertLoopbackBind(host)).not.toThrow();
  });

  it.each(["0.0.0.0", "::", "", "192.168.1.10", "10.0.0.5", "localhost", "127.0.0.1.evil.example", "::ffff:0.0.0.0", "example.com"])(
    "refuses to bind %j outside a container",
    (host) => {
      expect(() => securityFor(false).assertLoopbackBind(host)).toThrow(NonLoopbackBindError);
    },
  );

  it("allows a wildcard bind inside the container image, where the port mapping provides isolation", () => {
    expect(() => securityFor(true).assertLoopbackBind("0.0.0.0")).not.toThrow();
  });
});
