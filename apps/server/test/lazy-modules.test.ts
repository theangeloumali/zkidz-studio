// Created by The Angelo Umali.
// node-pty, the keyring and the agent SDK load on first use (plan §9.5); a missing one must fail that use by name.
import { afterEach, describe, expect, it, vi } from "vitest";

// Transforming the whole services graph takes several seconds on a loaded machine.
const GRAPH_IMPORT_TIMEOUT_MS = 60_000;

const missing = (name: string) => () => {
  throw new Error(`Cannot find module '${name}'`);
};

afterEach(() => {
  vi.doUnmock("node-pty");
  vi.doUnmock("@napi-rs/keyring");
  vi.doUnmock("@anthropic-ai/claude-agent-sdk");
  vi.resetModules();
});

describe("lazily loaded modules", () => {
  it("imports the server graph without loading node-pty, the keyring or the SDK", { timeout: GRAPH_IMPORT_TIMEOUT_MS }, async () => {
    vi.resetModules();
    vi.doMock("node-pty", missing("node-pty"));
    vi.doMock("@napi-rs/keyring", missing("@napi-rs/keyring"));
    vi.doMock("@anthropic-ai/claude-agent-sdk", missing("@anthropic-ai/claude-agent-sdk"));
    await expect(import("../src/agent-services.ts")).resolves.toBeDefined();
    await expect(import("../src/auth/secret-store.ts")).resolves.toBeDefined();
    await expect(import("../src/agent/sdk-loader.ts")).resolves.toBeDefined();
  });

  it("fails a terminal launch by name when node-pty is missing", async () => {
    vi.resetModules();
    vi.doMock("node-pty", missing("node-pty"));
    const { createPtyHost } = await import("../src/terminal/pty-host.ts");
    const host = createPtyHost({ claudePath: "/usr/local/bin/claude" });
    await expect(host.launch("s1", { argv: ["/usr/local/bin/claude"], cwd: "/", env: {} })).rejects.toThrow(/node-pty failed to load/);
  });

  it("fails a keyring read by name when @napi-rs/keyring is missing, instead of falling back to the file", async () => {
    vi.resetModules();
    vi.doMock("@napi-rs/keyring", missing("@napi-rs/keyring"));
    const { createOsKeyringEntry, createSecretStore } = await import("../src/auth/secret-store.ts");
    const store = createSecretStore({ studioHome: "/nonexistent", platform: "linux", keyring: createOsKeyringEntry() });
    await expect(store.readApiKey()).rejects.toThrow(/@napi-rs\/keyring failed to load/);
  });

  it("fails an SDK session by name when the agent SDK is missing", async () => {
    vi.resetModules();
    vi.doMock("@anthropic-ai/claude-agent-sdk", missing("@anthropic-ai/claude-agent-sdk"));
    const { lazySdkQuery } = await import("../src/agent/sdk-loader.ts");
    const handle = lazySdkQuery({ prompt: (async function* () {})(), projectId: "p1", options: {} });
    await expect(handle[Symbol.asyncIterator]().next()).rejects.toThrow(/Claude Agent SDK failed to load/);
  });
});
