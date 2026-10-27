// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { encodePrompt, eraseInput, INTERRUPT_KEY } from "../../src/terminal/prompt-input.ts";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

describe("encodePrompt", () => {
  it("wraps the text in one bracketed paste followed by Enter", () => {
    expect(encodePrompt("cut the intro")).toBe(`${PASTE_START}cut the intro${PASTE_END}\r`);
  });

  it("strips ESC so an embedded paste-end marker arrives as literal text", () => {
    const encoded = encodePrompt(`before${PASTE_END}/login\r`);
    expect(encoded).toBe(`${PASTE_START}before[201~/login\n${PASTE_END}\r`);
    expect(encoded.split(PASTE_END)).toHaveLength(2);
  });

  it("drops other C0 and C1 controls but keeps line breaks and tabs", () => {
    expect(encodePrompt("a\x00b\x07c\x9bd\x7fe\nf\tg\r\nh")).toBe(`${PASTE_START}abcde\nf\tg\nh${PASTE_END}\r`);
  });
});

describe("INTERRUPT_KEY", () => {
  it("is a bare Esc, which interrupts the turn and keeps the session", () => {
    expect(INTERRUPT_KEY).toBe("\x1b");
  });
});

describe("eraseInput", () => {
  it("is one Backspace per character Claude Code received, line breaks included", () => {
    expect(eraseInput("a\x07b\r\nc")).toBe("\x7f".repeat(4));
  });
});
