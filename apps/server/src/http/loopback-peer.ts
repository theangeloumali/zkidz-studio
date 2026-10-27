// Created by The Angelo Umali.
// Browsing and in-place registration read the host's disk, so only a browser on this computer may use them (plan §9.4).
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { HttpError } from "./http-error.ts";

export function assertLoopbackPeer(c: Context): void {
  if (!isLoopbackAddress(readPeerAddress(c))) throw new HttpError(403, "Only a browser on this computer may read its folders");
}

function readPeerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && (address === "::1" || /^(::ffff:)?127\./.test(address));
}
