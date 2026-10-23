// Created by The Angelo Umali.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RULE_TEXT_MAX_CHARS, type Rule } from "@zks/shared";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { buttonClass } from "../components/button-class.ts";
import { FIELD_CLASS } from "../components/field-class.ts";
import { addRule, removeRule, rulesQuery, rulesQueryKey } from "./rules-client.ts";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Rules come only from this form's click; nothing the agent says is saved here on its own (plan §6.9). */
export function RulesRoute() {
  const [notice, setNotice] = useState("");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">Rules</h1>
        <p className="text-lede text-copy-muted">Standing instructions for your edits. Applies from the next session.</p>
      </header>
      <NewRuleForm onAdded={() => setNotice("Rule added. Applies from the next session.")} />
      <p role="status" className="text-ui text-copy-muted empty:hidden">
        {notice}
      </p>
      <RuleList onDeleted={() => setNotice("Rule deleted.")} />
    </div>
  );
}

function NewRuleForm({ onAdded }: { readonly onAdded: () => void }) {
  const queryClient = useQueryClient();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const create = useMutation({
    mutationFn: addRule,
    onSuccess: () => {
      setText("");
      onAdded();
      return queryClient.invalidateQueries({ queryKey: rulesQueryKey });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "") {
      fieldRef.current?.focus();
      return;
    }
    create.mutate(trimmed);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-card border border-line bg-bg-elevated p-5">
      <label htmlFor="rule-text" className="text-label font-semibold">
        New rule
      </label>
      <textarea
        ref={fieldRef}
        id="rule-text"
        rows={3}
        maxLength={RULE_TEXT_MAX_CHARS}
        aria-describedby="rule-count"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={`${FIELD_CLASS} resize-y py-2`}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id="rule-count" className="font-mono text-ui-sm text-copy-muted tabular-nums">
          {text.length} / {RULE_TEXT_MAX_CHARS}
        </span>
        <button type="submit" className={buttonClass("steel")} disabled={create.isPending}>
          <Plus aria-hidden="true" className="size-4" />
          Add rule
        </button>
      </div>
      {create.isError && (
        <p role="alert" className="text-ui-sm text-danger">
          {errorText(create.error)}
        </p>
      )}
    </form>
  );
}

function RuleList({ onDeleted }: { readonly onDeleted: () => void }) {
  const rules = useQuery(rulesQuery());

  if (rules.isPending) return <p className="text-ui text-copy-muted">Loading rules…</p>;
  if (rules.isError) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-danger px-4 py-3 text-ui">
        <p className="text-danger">{errorText(rules.error)}</p>
        <button type="button" className={buttonClass("secondary")} onClick={() => void rules.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (rules.data.length === 0) {
    return (
      <div className="flex flex-col gap-1 rounded-card border border-dashed border-line-strong px-5 py-8 text-center">
        <p className="font-semibold">No rules yet</p>
        <p className="text-ui-sm text-copy-muted">Add one above, like &ldquo;Keep every hook title under six words.&rdquo;</p>
      </div>
    );
  }
  return (
    <ol aria-label="Your rules" className="flex flex-col divide-y divide-line rounded-card border border-line bg-bg-elevated">
      {rules.data.map((rule, index) => (
        <RuleRow key={rule.id} rule={rule} position={index + 1} onDeleted={onDeleted} />
      ))}
    </ol>
  );
}

interface RuleRowProps {
  readonly rule: Rule;
  readonly position: number;
  readonly onDeleted: () => void;
}

function RuleRow({ rule, position, onDeleted }: RuleRowProps) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeRule(rule.id),
    onSuccess: () => {
      onDeleted();
      return queryClient.invalidateQueries({ queryKey: rulesQueryKey });
    },
  });

  return (
    <li className="flex items-start gap-4 px-5 py-3">
      <span className="w-6 shrink-0 pt-2.5 font-mono text-ui-sm text-copy-muted tabular-nums">{position}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
        <p className="text-ui break-words">{rule.text}</p>
        {remove.isError && <p className="text-ui-sm text-danger">{errorText(remove.error)}</p>}
      </div>
      <button
        type="button"
        aria-label={`Delete rule ${position}`}
        className={buttonClass("quiet", "px-3")}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}
