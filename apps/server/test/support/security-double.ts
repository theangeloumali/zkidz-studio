// Created by The Angelo Umali.
// Route tests exercise behaviour behind the guard; app.test.ts mounts the real one.
import type { MiddlewareHandler } from "hono";

const passthroughMiddleware: MiddlewareHandler = async (_c, next) => {
  await next();
};

export const passthroughSecurity = { middleware: passthroughMiddleware };
