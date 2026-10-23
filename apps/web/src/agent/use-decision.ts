// Created by The Angelo Umali.
import { useMutation } from "@tanstack/react-query";
import { decide, type DecisionRequest } from "../api/agent-client.ts";

export function useDecision(projectId: string) {
  return useMutation({ mutationFn: (decision: DecisionRequest) => decide(projectId, decision) });
}
