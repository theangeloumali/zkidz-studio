// Created by The Angelo Umali.
/** User-facing Claude copy that legal or Anthropic review may change; one place to edit it (plan §6.5). */
export const CLAUDE_LINKS = {
  install: "https://code.claude.com/docs/en/setup",
  billing: "https://console.anthropic.com/settings/billing",
  legal: "https://code.claude.com/docs/en/legal-and-compliance",
  sdkOverview: "https://code.claude.com/docs/en/agent-sdk/overview",
  planHelp: "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan",
} as const;

export const MIN_CLAUDE_VERSION = "2.1.295";

export const TERMINAL_DISCLOSURE =
  "Terminal mode runs the Claude Code you installed, unmodified, in a terminal inside ZKidz Studio. You sign in there with Claude Code's own /login. ZKidz Studio never sees or stores your credentials. Usage counts against your Claude plan's limits.";

export const TERMINAL_PENDING_LABEL = "Pending Anthropic approval";

export const TERMINAL_TRUST_HINT =
  "Claude Code asks whether you trust this project folder. Choose 'Yes, I trust this folder'; the highlighted default exits. Then sign in with /login if asked.";

export const COST_DISCLAIMER = "Estimate from Claude's own report, not billing data. Actual billing is in your Claude Console.";
