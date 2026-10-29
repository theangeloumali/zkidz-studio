// Created by The Angelo Umali.
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CardShell } from "./card-shell.tsx";
import { DecisionFooter } from "./decision-footer.tsx";
import type { EventOf } from "./feed-notes.ts";
import { useDecision } from "./use-decision.ts";

type Question = EventOf<"question.asked">["questions"][number];

interface Pick {
  readonly labels: readonly string[];
  readonly isOtherPicked: boolean;
  readonly otherText: string;
}

const EMPTY_PICK: Pick = { labels: [], isOtherPicked: false, otherText: "" };
/** A radio value no option label can take, since labels are Claude's free text. */
const OTHER_VALUE = "\u0000other";
const RECOMMENDED = /\(recommended\)/i;
const OPTION_ROW = "flex min-h-(--target-min) cursor-pointer items-start gap-3 text-ui text-copy";

/** The answer Claude Code expects: the picked labels, plus the user's own words, joined like its multi-select answers. */
function answerOf(pick: Pick): string | null {
  const otherText = pick.otherText.trim();
  if (pick.isOtherPicked && otherText === "") return null;
  const parts = [...pick.labels, ...(pick.isOtherPicked ? [otherText] : [])];
  return parts.length === 0 ? null : parts.join(", ");
}

/** The option Claude marked "(Recommended)", else its first, as the terminal dialog puts it first. */
function recommendedLabel(question: Question): string | undefined {
  return (question.options.find((option) => RECOMMENDED.test(option.label)) ?? question.options[0])?.label;
}

function OptionText({ label, description }: Question["options"][number]) {
  return (
    <span className="min-w-0 break-words">
      {label}
      {description ? <span className="block text-ui-sm text-copy-muted">{description}</span> : null}
    </span>
  );
}

function QuestionField({ question, pick, onPick }: { readonly question: Question; readonly pick: Pick; readonly onPick: (next: Pick) => void }) {
  const legendId = useId();
  const otherFieldId = useId();
  const toggleLabel = (label: string, isChecked: boolean) =>
    onPick({ ...pick, labels: isChecked ? [...pick.labels, label] : pick.labels.filter((entry) => entry !== label) });

  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={legendId} className="mb-1 text-ui font-semibold break-words text-copy">
        {question.question}
      </legend>
      {question.multiSelect ? (
        <>
          {question.options.map((option) => (
            <label key={option.label} className={OPTION_ROW}>
              <Checkbox className="mt-1" checked={pick.labels.includes(option.label)} onCheckedChange={(isChecked) => toggleLabel(option.label, isChecked)} />
              <OptionText {...option} />
            </label>
          ))}
          <label className={OPTION_ROW}>
            <Checkbox className="mt-1" checked={pick.isOtherPicked} onCheckedChange={(isChecked) => onPick({ ...pick, isOtherPicked: isChecked })} />
            <span>Other</span>
          </label>
        </>
      ) : (
        <RadioGroup
          aria-labelledby={legendId}
          value={pick.isOtherPicked ? OTHER_VALUE : (pick.labels[0] ?? null)}
          onValueChange={(value) =>
            onPick(value === OTHER_VALUE ? { ...pick, labels: [], isOtherPicked: true } : { ...pick, labels: [String(value)], isOtherPicked: false })
          }
        >
          {question.options.map((option) => (
            <label key={option.label} className={OPTION_ROW}>
              <RadioGroupItem className="mt-1" value={option.label} />
              <OptionText {...option} />
            </label>
          ))}
          <label className={OPTION_ROW}>
            <RadioGroupItem className="mt-1" value={OTHER_VALUE} />
            <span>Other</span>
          </label>
        </RadioGroup>
      )}
      {pick.isOtherPicked && (
        <div className="flex flex-col gap-1 pl-7">
          <label htmlFor={otherFieldId} className="text-ui-sm text-copy-muted">
            Your answer
          </label>
          <Input
            id={otherFieldId}
            className="min-h-(--target-min) text-ui"
            value={pick.otherText}
            onChange={(event) => onPick({ ...pick, otherText: event.currentTarget.value })}
          />
        </div>
      )}
    </fieldset>
  );
}

export function QuestionCard({ projectId, event }: { readonly projectId: string; readonly event: EventOf<"question.asked"> }) {
  const decision = useDecision(projectId);
  const [picks, setPicks] = useState<Readonly<Record<string, Pick>>>({});
  const answerPairs = event.questions.map((question) => [question.question, answerOf(picks[question.question] ?? EMPTY_PICK)] as const);
  const isComplete = answerPairs.every(([, answer]) => answer !== null);
  const recommendedPairs = event.questions.map((question) => [question.question, recommendedLabel(question)] as const);
  const hasRecommendations = recommendedPairs.every(([, label]) => label !== undefined);
  const send = (pairs: readonly (readonly [string, string | null | undefined])[]) =>
    decision.mutate({ kind: "question", requestId: event.requestId, answers: Object.fromEntries(pairs.map(([question, answer]) => [question, answer ?? ""])) });

  return (
    <CardShell eyebrow="Claude asks" title={event.questions[0]?.header ?? "A question for you"}>
      {event.questions.map((question) => (
        <QuestionField
          key={question.question}
          question={question}
          pick={picks[question.question] ?? EMPTY_PICK}
          onPick={(next) => setPicks((current) => ({ ...current, [question.question]: next }))}
        />
      ))}
      <DecisionFooter decision={decision}>
        <Button variant="primary" disabled={!isComplete || decision.isPending} onClick={() => send(answerPairs)}>
          Send answer
        </Button>
        {hasRecommendations && (
          <Button variant="secondary" disabled={decision.isPending} onClick={() => send(recommendedPairs)}>
            Use Claude&apos;s picks
          </Button>
        )}
      </DecisionFooter>
    </CardShell>
  );
}
