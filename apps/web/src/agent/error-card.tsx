// Created by The Angelo Umali.
import { CircleX } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ExternalLink } from "../components/external-link.tsx";
import { INLINE_LINK_CLASS } from "../components/link-class.ts";
import { CLAUDE_LINKS } from "../copy/claude.ts";
import type { EventOf } from "./feed-notes.ts";

type ErrorKind = EventOf<"session.error">["kind"];

const SETUP_LINK = (
  <Link to="/setup" className={INLINE_LINK_CLASS}>
    Re-enter key
  </Link>
);
const INSTALL_LINK = <ExternalLink href={CLAUDE_LINKS.install}>Install Claude Code</ExternalLink>;

/** One-line fix per failure (plan §6.14); the server's own message is shown under it, as text. */
const ERROR_VIEW: Record<ErrorKind, { title: string; fix: ReactNode }> = {
  claude_missing: { title: "Claude Code is not installed", fix: INSTALL_LINK },
  sdk_binary_missing: { title: "The studio's Claude runtime is missing", fix: INSTALL_LINK },
  auth_failed: { title: "Your API key was rejected", fix: SETUP_LINK },
  billing_error: { title: "Your Anthropic account needs credit", fix: <ExternalLink href={CLAUDE_LINKS.billing}>Open billing</ExternalLink> },
  rate_limited: { title: "Plan limit reached", fix: "Wait for the limit to reset, then send the prompt again." },
  model_not_found: { title: "This model is not available to your account", fix: "Pick another model in Settings." },
  max_turns: { title: "Claude used every step this turn allows", fix: "Send a follow-up prompt to keep going." },
  max_budget: { title: "This turn hit its spending cap", fix: "Raise the cap in Settings or send a smaller request." },
  credential_mismatch: {
    title: "Claude is signed in differently from your setup",
    fix: (
      <Link to="/setup" className={INLINE_LINK_CLASS}>
        Check your connection
      </Link>
    ),
  },
  terminal_exited: { title: "Claude Code exited", fix: "Send a prompt to start it again." },
  unknown: { title: "Claude stopped with an error", fix: "Send the prompt again. If it keeps failing, run the checks in Setup." },
};

export function ErrorCard({ event }: { readonly event: EventOf<"session.error"> }) {
  const view = ERROR_VIEW[event.kind];
  return (
    <div role="alert" className="flex gap-3 rounded-card border border-danger bg-bg-elevated p-4">
      <CircleX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-ui-lg font-semibold text-copy">{view.title}</p>
        <p className="text-ui text-copy">{view.fix}</p>
        <p className="font-mono text-ui-sm break-words text-copy-muted">{event.action ? `${event.message} · ${event.action}` : event.message}</p>
      </div>
    </div>
  );
}
