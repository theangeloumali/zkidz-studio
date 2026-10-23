// Created by The Angelo Umali.
import type { ReactNode } from "react";

/** The slice of any answer mutation the footer reads: /decisions and the cut-candidates route alike. */
interface DecisionState {
  readonly isSuccess: boolean;
  readonly error: Error | null;
}

/** Buttons until the answer is sent, then a plain receipt so a card cannot be answered twice. */
export function DecisionFooter({ decision, children }: { readonly decision: DecisionState; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {decision.isSuccess ? <p className="text-ui font-semibold text-success">Sent.</p> : <div className="flex flex-wrap gap-2">{children}</div>}
      <p role="status" className="text-ui text-danger">
        {decision.error === null ? "" : `Not sent: ${decision.error.message}`}
      </p>
    </div>
  );
}
