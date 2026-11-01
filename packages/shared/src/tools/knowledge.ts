// Created by The Angelo Umali.
// Knowledge tools: lessons the user may save as rules (slice E), and the edit skills for agents without a plugin system (slice F).
import { z } from "zod";
import { LessonTextSchema, MAX_SUGGESTED_LESSONS } from "../events.ts";
import { defineTool } from "./define.ts";

/** Publishes a card only: a lesson becomes a rule when the user clicks Save, never from agent output (plan §6.9). */
export const suggestLessons = defineTool({
  input: z.strictObject({ lessons: z.array(LessonTextSchema).min(1).max(MAX_SUGGESTED_LESSONS) }),
  output: z.strictObject({ requestId: z.string().min(1) }),
  approval: "auto",
  isReadOnly: true,
});

const SkillNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

/** A skill body, or one of its references/ files, from plugin/skills: the single source every agent reads. */
export const readSkill = defineTool({
  input: z.strictObject({
    name: SkillNameSchema,
    reference: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*\.md$/)
      .optional(),
  }),
  output: z.strictObject({ text: z.string() }),
  approval: "auto",
  isReadOnly: true,
});
