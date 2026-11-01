// Created by The Angelo Umali.
// A loopback stand-in for the studio's hook bridge and MCP endpoint, so live agent tests see what the relays send.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { LOOPBACK_HOST } from "@zks/shared";

export interface BridgeRequest {
  readonly path: string;
  readonly body: unknown;
}

export interface LiveBridge {
  readonly url: string;
  readonly port: number;
  readonly requests: BridgeRequest[];
  close(): Promise<void>;
}

/** Records every request that carries one of the bearer tokens; the rest get a 401, as the real bridge does. */
export async function startLiveBridge(bearerTokens: readonly string[]): Promise<LiveBridge> {
  const requests: BridgeRequest[] = [];
  const authorized = new Set(bearerTokens.map((token) => `Bearer ${token}`));
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      if (!authorized.has(request.headers.authorization ?? "")) {
        response.writeHead(401).end();
        return;
      }
      requests.push({ path: request.url ?? "", body: body === "" ? undefined : JSON.parse(body) });
      response.writeHead(200, { "content-type": "application/json" }).end(request.url?.endsWith("/tools") ? '{"tools":[]}' : "{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK_HOST, resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://${LOOPBACK_HOST}:${port}`, port, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
