// Created by The Angelo Umali.
import type { KeyringEntry } from "../../src/auth/secret-store.ts";

export function memoryKeyring(stored: string | null = null): KeyringEntry & { stored: string | null } {
  return {
    stored,
    read() {
      return Promise.resolve(this.stored);
    },
    write(secret: string) {
      this.stored = secret;
      return Promise.resolve();
    },
    remove() {
      this.stored = null;
      return Promise.resolve();
    },
  };
}
