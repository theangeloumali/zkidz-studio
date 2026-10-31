// Created by The Angelo Umali.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { addRule, rulesQueryKey } from "../rules/rules-client.ts";
import { CardShell } from "./card-shell.tsx";
import type { EventOf } from "./feed-notes.ts";

const LESSON_SOURCE = "Suggested after an edit";

/** Saving is the user's click, never the agent's: a saved lesson becomes a rule every later edit reads (plan §6.9). */
function LessonRow({ lesson }: { readonly lesson: string }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => addRule(lesson, LESSON_SOURCE),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rulesQueryKey }),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <p className="min-w-0 flex-1 text-ui break-words text-copy">{lesson}</p>
      {save.isSuccess ? (
        <p className="text-ui-sm font-semibold text-success">Saved as a rule</p>
      ) : (
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      )}
      {save.isError && (
        <p role="alert" className="w-full text-ui-sm text-danger">
          Not saved: {save.error.message}
        </p>
      )}
    </li>
  );
}

export function LessonsCard({ event }: { readonly event: EventOf<"lessons.suggested"> }) {
  return (
    <CardShell eyebrow="Learned from this edit" title="Save what should carry over to your next edits">
      <ul className="flex flex-col gap-3">
        {/* The list never reorders, so the position keeps two suggestions with the same text apart. */}
        {event.lessons.map((lesson, index) => (
          <LessonRow key={`${index}:${lesson}`} lesson={lesson} />
        ))}
      </ul>
    </CardShell>
  );
}
