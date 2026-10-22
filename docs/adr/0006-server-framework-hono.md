<!-- Created by The Angelo Umali. -->

# ADR 0006: Hono on Node for the local server, SSE for events

- Status: Accepted
- Date: 2026-10-22
- Plan: D3, D10, §5.2, §11

## Context

The server is local, loopback-only and single-user. It needs typed routes, a server-sent event stream with replay, one WebSocket
for the mode T terminal, and strict request guards.

## Decision

- Hono on `@hono/node-server`, SSE through `streamSSE` from `hono/streaming`, the terminal WebSocket through `@hono/node-ws`.
- App events go over SSE + POST: durable events carry `events.id` as the SSE `id`, a reconnect sends `Last-Event-ID`, and replay
  stops at 500 events with a `resync` event. The route table is `API_ROUTES` in `@zks/shared`.
- Port 4317 for the app and 4318 for the sandboxed preview origin. The server refuses any non-loopback bind, except
  `ZKS_CONTAINER=1` inside the Docker image.
- Writes need a matching `Origin`, the per-launch `x-zks-csrf` header and `Content-Type: application/json`; reads reject
  cross-site `Sec-Fetch-Site`; every request passes a `Host` allowlist.

## Consequences

- No custom protocol code and no WebSocket library for app events. The terminal is the only WebSocket, guarded by a single-use
  ticket valid 30 seconds.
