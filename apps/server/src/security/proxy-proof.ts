// Created by The Angelo Umali.
// Remote mode: the proxy sits on a shared docker network, so a peer must prove it is the proxy (or be loopback).
import type { Context } from "hono";
import type { RemoteOrigins } from "./remote-origins.ts";
import { tokensMatch } from "./token.ts";

export const PROXY_SECRET_HEADER = "x-zks-proxy-secret";
const LOOPBACK_PEERS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

interface IncomingBinding {
  readonly incoming?: { readonly socket?: { readonly remoteAddress?: string } };
}

/** The TCP peer behind this request; undefined (a test, an odd runtime) counts as not loopback. */
export function peerAddressOf(c: Context): string | undefined {
  return (c.env as IncomingBinding | undefined)?.incoming?.socket?.remoteAddress;
}

/** True for the in-container healthcheck (loopback peer) or a request carrying the proxy's secret. */
export function hasProxyProof(peerAddress: string | undefined, presentedSecret: string | null | undefined, remote: RemoteOrigins | undefined): boolean {
  if (remote === undefined) return true;
  if (peerAddress !== undefined && LOOPBACK_PEERS.has(peerAddress)) return true;
  return tokensMatch(remote.proxySecret, presentedSecret ?? undefined);
}
