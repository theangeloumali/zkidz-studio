// Created by The Angelo Umali.
// Prompt bytes for the PTY (plan §6.3): one bracketed paste, then Enter.

export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";
const ENTER = "\r";

/** Esc interrupts the running turn and leaves the session open. */
export const INTERRUPT_KEY = "\x1b";

// Without ESC the text cannot end the paste early; \n and \t stay so a multi-line prompt keeps its shape.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

const BACKSPACE = "\x7f";

function pastedText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(UNSAFE_CONTROLS, "");
}

export function encodePrompt(text: string): string {
  return `${PASTE_START}${pastedText(text)}${PASTE_END}${ENTER}`;
}

/** Deletes a prompt Claude Code put back in its input after an interrupt; extra Backspaces on an empty input do nothing. */
export function eraseInput(text: string): string {
  return BACKSPACE.repeat(pastedText(text).length);
}
