// Created by The Angelo Umali.
// Structured JSON lines; every line passes the redactor, so a caller cannot leak a key by logging an error.
import { redactSecrets } from "./redact.ts";

type LogLevel = "info" | "warn" | "error";
type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly info: (message: string, fields?: LogFields) => void;
  readonly warn: (message: string, fields?: LogFields) => void;
  readonly error: (message: string, fields?: LogFields) => void;
}

export function createLogger(writeLine: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): Logger {
  const log = (level: LogLevel, message: string, fields: LogFields = {}) => {
    const entry = { ...fields, level, msg: message, at: new Date().toISOString() };
    writeLine(redactSecrets(JSON.stringify(entry, errorReplacer)));
  };
  return {
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
  };
}

/** Errors serialise to their message only; stacks stay out of the log stream. */
function errorReplacer(_key: string, value: unknown): unknown {
  return value instanceof Error ? { name: value.name, message: value.message } : value;
}
