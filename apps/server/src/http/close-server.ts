// Created by The Angelo Umali.
import type { ServerType } from "@hono/node-server";
import type { WebSocketServer } from "ws";

/** Stops accepting, then ends open connections: an open tab's event stream would otherwise hold close() forever. A
 * terminal pane's upgraded socket belongs to the WebSocketServer, which closeAllConnections() never reaches. */
export function closeServer(server: ServerType, websocketServer?: WebSocketServer): Promise<void> {
  for (const client of websocketServer?.clients ?? []) client.terminate();
  websocketServer?.close();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    if ("closeAllConnections" in server) server.closeAllConnections();
  });
}
