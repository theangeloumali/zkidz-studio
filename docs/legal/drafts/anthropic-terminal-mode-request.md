<!-- Created by The Angelo Umali. -->

# DRAFT, NOT SENT: terminal-mode approval request to Anthropic

> **Status: DRAFT, NOT SENT.** Angelo reviews, edits and sends this himself through the contact link on
> https://code.claude.com/docs/en/legal-and-compliance. When Anthropic replies, the reply (verbatim quote and date) goes in
> `docs/legal/anthropic-reply.md` (plan §3.3, §6.4). Nothing in this file is a statement Anthropic has made.

- To: Anthropic, via the contact link on the Claude Code legal and compliance page
- From: Angelo Umali, maintainer of ZKidz Studio
- Subject: Request for written approval: an open-source local app that runs the user's own Claude Code in a terminal pane

---

Hello,

I maintain ZKidz Studio (https://github.com/theangeloumali/zkidz-studio), an open-source, Apache-2.0 video editor that runs only on
the user's own computer. A creator drops in footage, types a prompt, and watches Claude cut, caption and render a short vertical
video. There is no hosted service, no shared account and no telemetry. The server binds to 127.0.0.1 and refuses any other address.

I am writing to ask for written approval of one optional way of connecting Claude, which we call terminal mode. Your Agent SDK
overview says that "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate
limits for their products". I believe terminal mode does not offer a login, but I would rather ask than assume.

## How users connect Claude

1. **Their own API key (the default).** The user pastes a Claude Console API key. The app checks it against `/v1/models`, stores it
   in the operating system's keychain and passes it to the Agent SDK. This is the recommended option.
2. **Their own cloud provider.** Bedrock, Vertex AI, Foundry or Claude Platform on AWS, using the user's own cloud credentials.
3. **Terminal mode (opt-in, the subject of this request).** Described below.

Options 1 and 2 ship regardless of your answer.

## What terminal mode does

- The user turns it on after reading a disclosure: it runs the Claude Code they installed, unmodified; they sign in with Claude
  Code's own `/login`; ZKidz Studio never sees or stores the sign-in; usage counts against their own Claude plan's limits. The
  disclosure links to your legal page, the Agent SDK overview and the help center article on using the SDK with a Claude plan.
  [Angelo: true only once the mode T card links all three pages; today it links the Consumer Terms only. See
  `docs/release/policy-check.md`, F1.]
- The app finds the `claude` binary the user installed and starts it in a pseudo-terminal on their machine, shown in a terminal pane
  in the browser tab. It passes the binary an argument list directly, with no shell.
- The binary is never modified, patched or wrapped. It is never bundled or redistributed; release downloads do not include it.
- The user signs in inside that pane using Claude Code's own sign-in screen or `/login`. Every built-in authentication method stays
  available. The app offers no "Sign in with Claude" button, implements no OAuth, and has no setup-token paste.
- The app never reads, stores, copies or forwards credentials or session tokens. It does not open files under `~/.claude`, does not
  read the keychain entry, and does not call `claude auth status`. The terminal's environment carries no credential variable.
- The app talks to the session in two ways only: an MCP server with editing tools (for example "set the cut list" or "queue a render"),
  and hooks that report tool calls and apply a policy (for example, no shell and no file writes). Both are local and protected by a
  per-session random token.
- It runs Claude only for the person at the keyboard of that machine. Requests to the terminal from any other web origin are refused.
  There is no LAN mode, no remote access and no shared account.
- It does not use the Agent SDK at all. The SDK is used only with an API key or a cloud provider (options 1 and 2).
- The product name is "ZKidz Studio". The UI names Claude and Claude Code only in plain text that describes what runs, for example
  "The studio runs Claude on this computer" and "Use Claude Code in a terminal (your own sign-in)". It uses
  no Claude or Anthropic logos and no Claude Code artwork.

This is the same pattern as Orca (https://github.com/stablyai/orca), which runs the user's own Claude Code in its terminals.

## Why I think it fits your terms

- Your legal page says the restrictions do not "prevent an end user from signing in to the unmodified Claude Code binary with their
  own Claude subscription". Terminal mode is exactly that: the user's own binary, their own sign-in, on their own machine.
- The app never collects, stores or intermediates Claude.ai credentials, and sign-in always completes through Anthropic's own flow.
- Your help center article updated on October 7, 2026 says users "can still use the Claude Agent SDK, `claude -p`, and third-party
  apps with your subscription limits".

The part I am unsure about is the phrase "offer … rate limits for their products". Terminal mode lets a user spend their own plan's
limits inside our app, so I would like your written view before treating it as settled.

## What I am asking

1. Written approval to offer terminal mode as described, as an opt-in, or
2. if you would not approve it as described, what we would need to change.

Until I hear back, terminal mode stays off by default and is clearly marked as optional. If your answer is no, we will remove it
before our next release. I am happy to share the source for the parts involved or to walk through a build.

[Angelo: keep this paragraph only once it is true.] As the publisher, I have accepted the Commercial Terms of Service through my
Console organization, as your terms require for running Claude Code in a product.

Thank you for your time.

Angelo Umali
Maintainer, ZKidz Studio
https://github.com/theangeloumali/zkidz-studio
