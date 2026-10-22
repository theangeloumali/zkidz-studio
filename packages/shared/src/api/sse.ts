// Created by The Angelo Umali.
// SSE + POST event bus (plan D3, §8). A reconnect replays from Last-Event-ID; past the cap it gets `resync`.
import { z } from "zod";
import { IdSchema } from "../primitives.ts";

export const SSE_REPLAY_LIMIT = 500;
export const LAST_EVENT_ID_HEADER = "last-event-id";

/** `/api/events?project=a&project=b`: one EventSource per tab covers every open project. */
export const EventsQuerySchema = z.strictObject({ project: z.array(IdSchema).min(1) });

export const LastEventIdSchema = z
  .string()
  .regex(/^[0-9]+$/, "Last-Event-ID is an event id")
  .transform(Number)
  .pipe(z.int().positive());
