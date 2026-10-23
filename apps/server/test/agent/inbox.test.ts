// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { PromptInbox } from "../../src/agent/inbox.ts";

describe("PromptInbox", () => {
  it("yields pushed prompts as SDK user messages in order, then ends on close", async () => {
    const inbox = new PromptInbox();
    inbox.push("first");
    const received: string[] = [];
    const reading = (async () => {
      for await (const message of inbox) received.push(typeof message.message.content === "string" ? message.message.content : "");
    })();
    inbox.push("second");
    inbox.close();
    await reading;
    expect(received).toEqual(["first", "second"]);
  });

  it("ignores pushes after close", async () => {
    const inbox = new PromptInbox();
    inbox.close();
    inbox.push("late");
    const received: unknown[] = [];
    for await (const message of inbox) received.push(message);
    expect(received).toEqual([]);
  });
});
