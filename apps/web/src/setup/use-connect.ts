// Created by The Angelo Umali.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Connection } from "../api/agent-client.ts";
import { queryKeys } from "../api/queries.ts";

/** Every connect call answers with the new Connection, so the cache takes it as-is. */
export function useConnect<Input>(connect: (input: Input) => Promise<Connection>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: connect, onSuccess: (connection) => queryClient.setQueryData(queryKeys.connection, connection) });
}
