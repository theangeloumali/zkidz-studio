// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { createOutputRing } from "../../src/terminal/output-ring.ts";

describe("createOutputRing", () => {
  it("replays everything written while under capacity", () => {
    const ring = createOutputRing(16);
    ring.append("hello ");
    ring.append("world");
    expect(ring.snapshot()).toBe("hello world");
  });

  it("keeps exactly the newest bytes once the capacity is exceeded", () => {
    const ring = createOutputRing(10);
    ring.append("aaaa");
    ring.append("bbbb");
    ring.append("cccc");
    expect(ring.snapshot()).toBe("aabbbbcccc");
  });

  it("keeps the tail of a single chunk larger than the capacity", () => {
    const ring = createOutputRing(4);
    ring.append("0123456789");
    expect(ring.snapshot()).toBe("6789");
  });

  it("counts bytes, not characters, so multi-byte output cannot overrun the cap", () => {
    const ring = createOutputRing(6);
    ring.append("ééé");
    ring.append("ü");
    expect(Buffer.byteLength(ring.snapshot())).toBeLessThanOrEqual(6);
    expect(ring.snapshot().endsWith("ü")).toBe(true);
  });
});
