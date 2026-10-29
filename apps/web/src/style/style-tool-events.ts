// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";

const STYLE_TOOL = "set_project_style";

/** The tool_use id of the newest finished style change, so a new id means the saved look moved. */
export function latestFinishedStyleToolId(events: readonly StudioEvent[]): string | null {
  const styleCalls = new Set<string>();
  let latest: string | null = null;
  for (const event of events) {
    if (event.type === "tool.called" && event.name.endsWith(STYLE_TOOL)) styleCalls.add(event.toolUseId);
    else if (event.type === "tool.finished" && styleCalls.has(event.toolUseId)) latest = event.toolUseId;
  }
  return latest;
}
