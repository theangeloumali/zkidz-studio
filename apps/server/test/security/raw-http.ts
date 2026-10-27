// Created by The Angelo Umali.
// Raw HTTP over a real socket: fetch and app.request normalise the path, an attacker's client does not.
import { connect } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";

export interface Listener {
  readonly port: number;
  readonly close: () => Promise<void>;
}

export interface RawResponse {
  readonly status: number;
  readonly text: string;
}

/** Listens the way main.ts does: loopback only, with the peer address node reports. */
export function listen(app: Hono, hostname = "127.0.0.1"): Promise<Listener> {
  return new Promise((resolve) => {
    const server: ServerType = serve({ fetch: app.fetch, hostname, port: 0 }, (address) => {
      resolve({ port: address.port, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

/** Sends the request line byte for byte, so `..`, `%2e` and `\` reach the server unnormalised. */
export function rawGet(port: number, rawPath: string, host: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("end", () => {
      const response = Buffer.concat(chunks).toString("latin1");
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(response)?.[1] ?? 0);
      resolve({ status, text: response });
    });
    socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  });
}
