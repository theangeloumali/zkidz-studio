// Created by The Angelo Umali.
import { AbortError, type CanUseTool, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { createFakeAgent, readTranscript } from "./fake-agent.ts";

const PROMPT: SDKUserMessage = { type: "user", message: { role: "user", content: "Cut the pauses." }, parent_tool_use_id: null };

function promptStream(...messages: SDKUserMessage[]): AsyncIterable<SDKUserMessage> {
  return ReadableStream.from(messages);
}

async function collect(stream: AsyncIterable<SDKMessage>): Promise<SDKMessage[]> {
  const received: SDKMessage[] = [];
  for await (const message of stream) received.push(message);
  return received;
}

function optionsWith(canUseTool?: CanUseTool, abortController?: AbortController): Options {
  return { model: "haiku", ...(canUseTool === undefined ? {} : { canUseTool }), ...(abortController === undefined ? {} : { abortController }) };
}

describe("FakeAgent replays recorded SDK transcripts", () => {
  it("yields every recorded message of a transcript in order", async () => {
    const agent = createFakeAgent("init-text-result");

    const received = await collect(agent.query({ prompt: promptStream(PROMPT), options: optionsWith() }));

    expect(received).toEqual(readTranscript("init-text-result"));
    expect(received.map((message) => message.type)).toEqual(["system", "assistant", "result"]);
  });

  it("replays the next transcript on each call and refuses a call it has no transcript for", async () => {
    const agent = createFakeAgent("init-text-result", "rate-limit");

    await collect(agent.query({ prompt: promptStream(PROMPT), options: optionsWith() }));
    const second = await collect(agent.query({ prompt: promptStream(PROMPT), options: optionsWith() }));

    expect(second).toEqual(readTranscript("rate-limit"));
    expect(() => agent.query({ prompt: promptStream(PROMPT), options: optionsWith() })).toThrow(/no transcript left for call 3/);
  });

  it("records the options and the prompt each call received", async () => {
    const agent = createFakeAgent("init-text-result");
    const options = optionsWith();

    await collect(agent.query({ prompt: promptStream(PROMPT), options }));

    expect(agent.calls).toEqual([{ options, prompts: [PROMPT] }]);
  });

  it("waits for the first prompt message before the init, as the SDK does with streaming input", async () => {
    const agent = createFakeAgent("init-text-result");
    let releasePrompt = (): void => undefined;
    const promptArrives = new Promise<void>((resolve) => (releasePrompt = resolve));
    async function* latePrompt(): AsyncIterable<SDKUserMessage> {
      await promptArrives;
      yield PROMPT;
    }
    const iterator = agent.query({ prompt: latePrompt(), options: optionsWith() })[Symbol.asyncIterator]();

    const first = iterator.next();
    const settledEarly = await Promise.race([first.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 20))]);
    releasePrompt();

    expect(settledEarly).toBe(false);
    expect((await first).value).toMatchObject({ type: "system", subtype: "init" });
  });
});

describe("FakeAgent asks canUseTool at a recorded permission request", () => {
  it("passes the tool name, input and tool use id, then plays the allow branch", async () => {
    const canUseTool = vi.fn<CanUseTool>().mockResolvedValue({ behavior: "allow" });
    const agent = createFakeAgent("permission-gate");

    const received = await collect(agent.query({ prompt: promptStream(PROMPT), options: optionsWith(canUseTool) }));

    const [toolName, input, context] = canUseTool.mock.calls[0] ?? [];
    expect([toolName, input]).toEqual(["mcp__studio__render_master", { target: "full", quality: "4k" }]);
    expect(context).toMatchObject({ toolUseID: "toolu_0000000000000000000gate", requestId: "req_toolu_0000000000000000000gate" });
    expect(context?.signal).toBeInstanceOf(AbortSignal);
    expect(received.at(-1)).toMatchObject({ type: "result", subtype: "success", is_error: false, permission_denials: [] });
  });

  it("plays the deny branch when canUseTool denies", async () => {
    const canUseTool = vi.fn<CanUseTool>().mockResolvedValue({ behavior: "deny", message: "Not now." });
    const agent = createFakeAgent("permission-gate");

    const received = await collect(agent.query({ prompt: promptStream(PROMPT), options: optionsWith(canUseTool) }));

    const toolResult = received.find((message) => message.type === "user");
    expect(toolResult).toMatchObject({ message: { content: [{ type: "tool_result", is_error: true }] } });
    expect(received.at(-1)).toMatchObject({ type: "result", permission_denials: [{ tool_name: "mcp__studio__render_master" }] });
  });

  it("fails loudly when the transcript needs a decision and the options carry no canUseTool", async () => {
    const agent = createFakeAgent("permission-gate");

    await expect(collect(agent.query({ prompt: promptStream(PROMPT), options: optionsWith() }))).rejects.toThrow(/canUseTool/);
  });
});

describe("FakeAgent honours the abort controller", () => {
  it("stops the replay with an AbortError once aborted", async () => {
    const abortController = new AbortController();
    const agent = createFakeAgent("studio-tools");
    const received: SDKMessage[] = [];

    const replay = (async () => {
      for await (const message of agent.query({ prompt: promptStream(PROMPT), options: optionsWith(undefined, abortController) })) {
        received.push(message);
        if (received.length === 2) abortController.abort();
      }
    })();

    await expect(replay).rejects.toBeInstanceOf(AbortError);
    expect(received).toHaveLength(2);
  });
});
