// Created by The Angelo Umali.
import { useId, useState } from "react";
import { buttonClass } from "../components/button-class.ts";
import { FIELD_CLASS } from "../components/field-class.ts";

interface ComposerProps {
  readonly isFirstPrompt: boolean;
  readonly isSending: boolean;
  /** Resolves true once the prompt is delivered, so the field clears only then. */
  readonly onSend: (text: string) => Promise<boolean>;
}

export function Composer({ isFirstPrompt, isSending, onSend }: ComposerProps) {
  const fieldId = useId();
  const hintId = useId();
  const [text, setText] = useState("");
  const trimmed = text.trim();

  async function send(): Promise<void> {
    if (trimmed === "" || isSending) return;
    if (await onSend(trimmed)) setText("");
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label htmlFor={fieldId} className="text-label font-semibold text-copy">
        Prompt
      </label>
      <textarea
        id={fieldId}
        rows={3}
        value={text}
        aria-describedby={hintId}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          }
        }}
        className={`${FIELD_CLASS} resize-y py-2`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={hintId} className="text-ui-sm text-copy-muted">
          Ctrl + Enter to send
        </p>
        <button type="submit" className={buttonClass("primary")} disabled={trimmed === "" || isSending}>
          {isFirstPrompt ? "Start editing" : "Send"}
        </button>
      </div>
    </form>
  );
}
