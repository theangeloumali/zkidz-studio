// Created by The Angelo Umali.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { queryKeys } from "../api/queries.ts";
import { uploadFile } from "../api/upload.ts";
import type { UploadItem } from "../components/upload-list.tsx";

/** The newest reference only: a second upload replaces the first in the slot, as it does for the agent. */
export function useReferenceUpload(projectId: string) {
  const queryClient = useQueryClient();
  const [upload, setUpload] = useState<UploadItem | null>(null);

  const uploadReference = useCallback(
    async (file: File) => {
      const key = `${Date.now()}-${file.name}`;
      const show = (state: UploadItem["state"]) => setUpload({ key, name: file.name, bytes: file.size, state });
      show({ kind: "uploading", fraction: 0 });
      try {
        const asset = await uploadFile({ projectId, file, kind: "reference", onProgress: (fraction) => show({ kind: "uploading", fraction }) });
        setUpload({ key, name: asset.name, bytes: asset.bytes, state: { kind: "done" } });
        void queryClient.invalidateQueries({ queryKey: queryKeys.media(projectId) });
      } catch (caught) {
        show({ kind: "failed", reason: caught instanceof Error ? caught.message : "Something went wrong." });
      }
    },
    [projectId, queryClient],
  );

  return { upload, uploadReference };
}
