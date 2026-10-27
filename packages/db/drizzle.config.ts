// Created by The Angelo Umali.
// `generate` only: `push` is never run against user data (plan §8).
import { defineConfig } from "drizzle-kit";

export default defineConfig({ dialect: "postgresql", schema: "./schema.ts", out: "./migrations" });
