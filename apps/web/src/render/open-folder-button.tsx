// Created by The Angelo Umali.
import { useMutation } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { buttonClass, type ButtonVariant } from "../components/button-class.ts";
import { revealDeliverables } from "./render-api.ts";

interface OpenFolderButtonProps {
  readonly projectId: string;
  readonly variant: ButtonVariant;
}

export function OpenFolderButton({ projectId, variant }: OpenFolderButtonProps) {
  const reveal = useMutation({ mutationFn: () => revealDeliverables(projectId) });
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className={buttonClass(variant)} disabled={reveal.isPending} onClick={() => reveal.mutate()}>
        <FolderOpen aria-hidden="true" className="size-4" />
        Open folder
      </button>
      {reveal.error && (
        <p role="alert" className="text-ui text-danger">
          {reveal.error.message}
        </p>
      )}
    </div>
  );
}
