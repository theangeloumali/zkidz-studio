// Created by The Angelo Umali.
// suggest_lessons only shows a card; the user's Save click on it is what writes a rule (plan §6.9).
import { implementTool } from "../define-tool.ts";

const suggestLessons = implementTool("suggest_lessons", {
  description: "After the export, offer the user up to 5 short reusable lessons from what they corrected or chose. Never facts about this one video.",
  handler: async ({ lessons }, context) => {
    const requestId = crypto.randomUUID();
    await context.events.publish({ type: "lessons.suggested", projectId: context.projectId, requestId, lessons });
    return { output: { requestId } };
  },
});

export const lessonTools = [suggestLessons];
