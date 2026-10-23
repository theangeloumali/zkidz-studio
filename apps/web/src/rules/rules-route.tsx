// Created by The Angelo Umali.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RULE_TEXT_MAX_CHARS, type Rule } from "@zks/shared";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { buttonClass } from "../components/button-class.ts";
import { FIELD_CLASS } from "../components/field-class.ts";
import { addRule, removeRule, rulesQuery, rulesQueryKey, setRuleEnabled } from "./rules-client.ts";

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
      <RuleList onDeleted={() => setNotice("Rule deleted.")} onToggled={setNotice} />
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

interface RuleListProps {
  readonly onDeleted: () => void;
  readonly onToggled: (notice: string) => void;
}

function RuleList({ onDeleted, onToggled }: RuleListProps) {
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
        <RuleRow key={rule.id} rule={rule} position={index + 1} onDeleted={onDeleted} onToggled={onToggled} />
      ))}
    </ol>
  );
}

interface RuleRowProps {
  readonly rule: Rule;
  readonly position: number;
  readonly onDeleted: () => void;
  readonly onToggled: (notice: string) => void;
}

function RuleRow({ rule, position, onDeleted, onToggled }: RuleRowProps) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeRule(rule.id),
    onSuccess: () => {
      onDeleted();
      return queryClient.invalidateQueries({ queryKey: rulesQueryKey });
    },
  });
  const toggle = useMutation({
    mutationFn: (isEnabled: boolean) => setRuleEnabled(rule.id, isEnabled),
    onSuccess: (updated) => {
      onToggled(`Rule ${position} turned ${updated.isEnabled ? "on" : "off"}.`);
      return queryClient.invalidateQueries({ queryKey: rulesQueryKey });
    },
  });
  const error = remove.error ?? toggle.error;

  return (
    <li className="flex items-start gap-2 px-5 py-3 sm:gap-4">
      <span className="w-6 shrink-0 pt-2.5 font-mono text-ui-sm text-copy-muted tabular-nums">{position}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
        <p className={`text-ui break-words ${rule.isEnabled ? "" : "text-copy-muted line-through decoration-copy-dim"}`}>{rule.text}</p>
        {error && <p className="text-ui-sm text-danger">{errorText(error)}</p>}
      </div>
      <RuleSwitch position={position} isEnabled={rule.isEnabled} isBusy={toggle.isPending} onToggle={() => toggle.mutate(!rule.isEnabled)} />
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

interface RuleSwitchProps {
  readonly position: number;
  readonly isEnabled: boolean;
  readonly isBusy: boolean;
  readonly onToggle: () => void;
}

/** The On/Off word sits outside the button so its name stays "Use rule N" (WCAG 2.5.3) and state is not colour-only. */
function RuleSwitch({ position, isEnabled, isBusy, onToggle }: RuleSwitchProps) {
  return (
    <span className="flex shrink-0 items-center">
      <button
        type="button"
        role="switch"
        aria-checked={isEnabled}
        aria-label={`Use rule ${position}`}
        className={buttonClass("quiet", "px-3")}
        disabled={isBusy}
        onClick={onToggle}
      >
        <span
          aria-hidden="true"
          className={`flex h-5 w-9 items-center rounded-pill border p-0.5 transition-colors duration-(--dur-1) ${isEnabled ? "border-accent bg-accent" : "border-line-strong bg-surface"}`}
        >
          <span
            className={`size-3.5 rounded-pill transition-transform duration-(--dur-1) ease-out ${isEnabled ? "translate-x-4 bg-on-accent" : "bg-copy-dim"}`}
          />
        </span>
      </button>
      <span aria-hidden="true" className="w-7 text-ui-sm font-semibold text-copy-muted">
        {isEnabled ? "On" : "Off"}
      </span>
    </span>
  );
}
