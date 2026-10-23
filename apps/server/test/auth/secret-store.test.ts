// Created by The Angelo Umali.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSecretStore, isOnDrvFs, SecretStorageError, type KeyringEntry } from "../../src/auth/secret-store.ts";
import { memoryKeyring } from "./memory-keyring.ts";

const brokenKeyring: KeyringEntry = {
  read: () => {
    throw new Error("no secret service");
  },
  write: () => {
    throw new Error("no secret service");
  },
  remove: () => {
    throw new Error("no secret service");
  },
};

const NO_DRVFS_MOUNTS = () => Promise.resolve("rootfs / ext4 rw 0 0\n");

describe("createSecretStore", () => {
  let studioHome = "";
  beforeEach(async () => {
    studioHome = await mkdtemp(join(tmpdir(), "zks-secrets-"));
  });
  afterEach(async () => {
    await rm(studioHome, { recursive: true, force: true });
  });

  it("stores the key in the OS keyring when it works", async () => {
    const keyring = memoryKeyring();
    const store = createSecretStore({ studioHome, platform: "linux", keyring, readMounts: NO_DRVFS_MOUNTS });

    await store.writeApiKey("test-key-0000abcd");

    expect(keyring.stored).toBe("test-key-0000abcd");
    expect(await store.readApiKey()).toBe("test-key-0000abcd");
    await expect(stat(join(studioHome, "secrets.env"))).rejects.toThrow();
  });

  it("uses Credential Manager only on Windows: a keyring failure is an error, never a file", async () => {
    const store = createSecretStore({ studioHome, platform: "win32", keyring: brokenKeyring, readMounts: NO_DRVFS_MOUNTS });
    await expect(store.writeApiKey("test-key-0000abcd")).rejects.toThrow(SecretStorageError);
    await expect(stat(join(studioHome, "secrets.env"))).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")("falls back to an owner-only secrets.env on Linux", async () => {
    const store = createSecretStore({ studioHome, platform: "linux", keyring: brokenKeyring, readMounts: NO_DRVFS_MOUNTS });

    await store.writeApiKey("test-key-0000abcd");

    const secretsPath = join(studioHome, "secrets.env");
    expect((await stat(secretsPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(secretsPath, "utf8")).toBe("ANTHROPIC_API_KEY=test-key-0000abcd\n");
    expect(await store.readApiKey()).toBe("test-key-0000abcd");
    await store.deleteApiKey();
    expect(await store.readApiKey()).toBeNull();
  });

  it("refuses the file fallback when ZKS_HOME sits on DrvFs", async () => {
    const drvfsMounts = () => Promise.resolve(`C:\\ ${studioHome} 9p rw,noatime,aname=drvfs;path=C:\\;uid=1000 0 0\n`);
    const store = createSecretStore({ studioHome, platform: "linux", keyring: brokenKeyring, readMounts: drvfsMounts });
    await expect(store.writeApiKey("test-key-0000abcd")).rejects.toThrow(/DrvFs/);
    await expect(stat(join(studioHome, "secrets.env"))).rejects.toThrow();
  });
});

describe("isOnDrvFs", () => {
  it("matches drvfs and 9p-drvfs mounts by the longest mount prefix", async () => {
    const mounts = "rootfs / ext4 rw 0 0\nC:\\134 /mnt/c 9p rw,aname=drvfs;path=C:\\ 0 0\nD: /mnt/d drvfs rw 0 0\n";
    expect(await isOnDrvFs("/mnt/c/Users/x/zks", () => Promise.resolve(mounts))).toBe(true);
    expect(await isOnDrvFs("/mnt/d/zks", () => Promise.resolve(mounts))).toBe(true);
    expect(await isOnDrvFs("/mnt/cache/zks", () => Promise.resolve(mounts))).toBe(false);
    expect(await isOnDrvFs("/home/x/.local/share/zkidz-studio", () => Promise.resolve(mounts))).toBe(false);
  });

  it("decodes escaped spaces in mount points", async () => {
    expect(await isOnDrvFs("/mnt/my drive/zks", () => Promise.resolve("X: /mnt/my\\040drive drvfs rw 0 0\n"))).toBe(true);
  });

  it("treats a /mnt/<letter> path as DrvFs when the mount table cannot be read", async () => {
    const unreadable = () => Promise.reject(new Error("ENOENT"));
    expect(await isOnDrvFs("/mnt/c/zks", unreadable)).toBe(true);
    expect(await isOnDrvFs("/srv/zks", unreadable)).toBe(false);
  });
});
