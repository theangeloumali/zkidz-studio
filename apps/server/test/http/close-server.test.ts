// Created by The Angelo Umali.
import { serve, upgradeWebSocket, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { closeServer } from "../../src/http/close-server.ts";

const CLOSE_LIMIT_MS = 3000;

function listen(app: Hono, websocketServer?: WebSocketServer): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve) => {
    const websocket = websocketServer === undefined ? {} : { websocket: { server: websocketServer } };
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0, ...websocket }, (address) => resolve({ server, port: address.port }));
  });
}

function closesInTime(closing: Promise<void>): Promise<"closed" | "timed out"> {
  const timedOut = new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), CLOSE_LIMIT_MS).unref());
  return Promise.race([closing.then(() => "closed" as const), timedOut]);
}

describe("closeServer", () => {
  // An open Studio tab keeps its event stream open for as long as the tab lives; Ctrl+C must not wait for it.
  it("resolves while a client still holds an event stream open", async () => {
    const app = new Hono().get("/events", (context) =>
      streamSSE(context, async (stream) => {
        await stream.writeSSE({ data: "hello" });
        await new Promise<never>(() => undefined);
      }),
    );
    const { server, port } = await listen(app);
    const response = await fetch(`http://127.0.0.1:${port}/events`);
    const reader = response.body?.getReader();
    await reader?.read();

    expect(await closesInTime(closeServer(server))).toBe("closed");
    await reader?.cancel().catch(() => undefined);
  });

  // An open terminal pane holds an upgraded socket, which closeAllConnections() does not reach (review, Maya).
  it("resolves while a client still holds a terminal WebSocket open", async () => {
    const websocketServer = new WebSocketServer({ noServer: true });
    const app = new Hono().get(
      "/ws",
      upgradeWebSocket(() => ({})),
    );
    const { server, port } = await listen(app, websocketServer);
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => client.once("open", resolve));

    expect(await closesInTime(closeServer(server, websocketServer))).toBe("closed");
  });
});
