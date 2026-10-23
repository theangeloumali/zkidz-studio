// Created by The Angelo Umali.
// Ports and environment names every package agrees on (plan §3.3).

/** 5173 is Vite's port, so the app takes its own. */
export const APP_PORT = 4317;
/** A separate origin with no API routes serves the sandboxed overlay preview (plan §9.3). */
export const PREVIEW_PORT = 4318;
/** Local Supabase Postgres. Below 49152: Hyper-V reserves shifting 54xxx/55xxx ranges on Windows (spike 03, plan §8). */
export const SUPABASE_DB_PORT = 45322;
export const LOOPBACK_HOST = "127.0.0.1";

export const ENV = {
  home: "ZKS_HOME",
  port: "ZKS_PORT",
  ffmpeg: "ZKS_FFMPEG",
  chrome: "ZKS_CHROME",
  container: "ZKS_CONTAINER",
  /** Unset selects PGlite; a postgres:// or postgresql:// URL selects Postgres (plan §8). */
  databaseUrl: "DATABASE_URL",
} as const;
