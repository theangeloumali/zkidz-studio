// Created by The Angelo Umali.
import { useId, useState } from "react";
import { buttonClass } from "../components/button-class.ts";
import { CardShell } from "./card-shell.tsx";
import { DecisionFooter } from "./decision-footer.tsx";
import type { EventOf } from "./feed-notes.ts";
import { useDecision } from "./use-decision.ts";

type Question = EventOf<"question.asked">["questions"][number];

function QuestionField({
  question,
  picked,
  onPick,
}: {
  readonly question: Question;
  readonly picked: readonly string[];
  readonly onPick: (labels: string[]) => void;
}) {
  const name = useId();
  const toggle = (label: string, isChecked: boolean) => {
    if (!question.multiSelect) onPick([label]);
    else onPick(isChecked ? [...picked, label] : picked.filter((entry) => entry !== label));
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-ui font-semibold break-words text-copy">{question.question}</legend>
      {question.options.map((option) => (
        <label key={option.label} className="flex min-h-(--target-min) cursor-pointer items-start gap-3 text-ui text-copy">
          <input
            type={question.multiSelect ? "checkbox" : "radio"}
            name={name}
            checked={picked.includes(option.label)}
            onChange={(event) => toggle(option.label, event.currentTarget.checked)}
            className="mt-1 size-5 shrink-0 accent-accent"
          />
          <span className="min-w-0 break-words">
            {option.label}
            {option.description ? <span className="block text-ui-sm text-copy-muted">{option.description}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function QuestionCard({ projectId, event }: { readonly projectId: string; readonly event: EventOf<"question.asked"> }) {
  const decision = useDecision(projectId);
  const [picks, setPicks] = useState<Readonly<Record<string, string[]>>>({});
  const isComplete = event.questions.every((question) => (picks[question.question] ?? []).length > 0);
  const answers = Object.fromEntries(event.questions.map((question) => [question.question, (picks[question.question] ?? []).join(", ")]));

  return (
    <CardShell eyebrow="Claude asks" title={event.questions[0]?.header ?? "A question for you"}>
      {event.questions.map((question) => (
        <QuestionField
          key={question.question}
          question={question}
          picked={picks[question.question] ?? []}
          onPick={(labels) => setPicks((current) => ({ ...current, [question.question]: labels }))}
        />
      ))}
      <DecisionFooter decision={decision}>
        <button
          type="button"
          className={buttonClass("primary")}
          disabled={!isComplete || decision.isPending}
          onClick={() => decision.mutate({ kind: "question", requestId: event.requestId, answers })}
        >
          Send answer
        </button>
      </DecisionFooter>
    </CardShell>
  );
}
