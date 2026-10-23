// Created by The Angelo Umali.
import { useId, useState } from "react";
import { connectApiKey, type Connection } from "../api/agent-client.ts";
import { buttonClass } from "../components/button-class.ts";
import { FIELD_CLASS } from "../components/field-class.ts";
import { StatusLine, errorText, isErrorCode, type StatusTone } from "./status-line.tsx";
import { useConnect } from "./use-connect.ts";

function keyStatus(connection: Connection, check: ReturnType<typeof useConnect<string>>, isEmpty: boolean): [string, StatusTone] {
  if (isEmpty) return ["Paste a key first.", "danger"];
  if (check.isPending) return ["Checking key…", "neutral"];
  if (isErrorCode(check.error, "key_rejected")) {
    return ["Anthropic rejected this key. Copy it again from the Claude Console and paste it here.", "danger"];
  }
  if (check.isError) return [errorText(check.error, "The key could not be checked"), "danger"];
  if (connection.mode === "api_key" && connection.keyLast4) return [`Key works · ending in ${connection.keyLast4}`, "success"];
  return ["", "neutral"];
}

/** The browser only checks the field is filled; whether the key works is the server's call (plan §6.5). */
export function ApiKeyControls({ connection }: { readonly connection: Connection }) {
  const fieldId = useId();
  const helpId = useId();
  const [apiKey, setApiKey] = useState("");
  const [isEmpty, setIsEmpty] = useState(false);
  const check = useConnect(connectApiKey);
  const [statusText, statusTone] = keyStatus(connection, check, isEmpty);

  function submit(): void {
    const trimmed = apiKey.trim();
    setIsEmpty(trimmed === "");
    if (trimmed !== "") check.mutate(trimmed);
  }

  return (
    <>
      <label htmlFor={fieldId} className="text-label font-semibold text-copy">
        API key
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={fieldId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your key"
          aria-describedby={helpId}
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          className={`${FIELD_CLASS} font-mono`}
        />
        <button type="button" className={buttonClass("secondary")} onClick={submit} disabled={check.isPending}>
          Check key
        </button>
      </div>
      <p id={helpId} className="max-w-[65ch] text-ui-sm text-copy-muted">
        The studio asks Anthropic whether the key works (a model list request that costs no tokens). Stored in your OS keychain; the browser only ever sees the
        last 4 characters.
      </p>
      <StatusLine text={statusText} tone={statusTone} />
    </>
  );
}
