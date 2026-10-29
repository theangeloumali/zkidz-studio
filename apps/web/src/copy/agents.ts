// Created by The Angelo Umali.
/** User-facing Codex and OpenCode copy that legal review may change; one place to edit it. */
export type TerminalAgent = "codex" | "opencode";

export interface TerminalAgentCopy {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly disclosure: string;
  readonly consent: string;
  readonly installUrl: string;
  readonly links: readonly { readonly label: string; readonly href: string }[];
}

export const AGENT_COPY: Readonly<Record<TerminalAgent, TerminalAgentCopy>> = {
  codex: {
    name: "Codex",
    title: "Use Codex in a terminal",
    description: "Uses the Codex CLI you installed and your own ChatGPT or OpenAI sign-in.",
    disclosure:
      "Codex mode runs the Codex CLI you installed in a terminal inside ZKidz Studio. You sign in there with Codex's own login. ZKidz Studio never sees or stores your credentials. Codex starts read-only, with its shell, web search and your own MCP servers turned off, so it edits only through the studio's tools. Usage counts against your OpenAI plan or API account.",
    consent: "I understand, and I want to use my own Codex sign-in.",
    installUrl: "https://developers.openai.com/codex/cli",
    links: [
      { label: "Codex sign-in options", href: "https://developers.openai.com/codex/auth" },
      { label: "OpenAI terms of use", href: "https://openai.com/policies/terms-of-use/" },
    ],
  },
  opencode: {
    name: "OpenCode",
    title: "Use OpenCode in a terminal",
    description: "Uses the OpenCode you installed and the model providers you signed in to there.",
    disclosure:
      "OpenCode mode runs the OpenCode you installed in a terminal inside ZKidz Studio, with the providers you signed in to in OpenCode. ZKidz Studio never sees or stores your credentials. Every OpenCode tool is denied except reading project files and the studio's own tools. ZKidz Studio never offers a Claude Pro or Max sign-in in OpenCode, because Anthropic does not allow a Claude plan to be used through it. Pick another provider in OpenCode.",
    consent: "I understand, and I want to use my own OpenCode sign-in.",
    installUrl: "https://opencode.ai/docs",
    links: [{ label: "OpenCode providers", href: "https://opencode.ai/docs/providers/" }],
  },
};
