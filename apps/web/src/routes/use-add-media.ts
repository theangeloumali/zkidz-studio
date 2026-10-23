// Created by The Angelo Umali.
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@zks/shared";
import { useCallback, useState } from "react";
import { createProjectInPlace } from "../api/client.ts";
import { queryKeys } from "../api/queries.ts";
import { createProjectWithMedia, uploadFile } from "../api/upload.ts";
import type { UploadItem, UploadState } from "../components/upload-list.tsx";

export interface AddMediaResult {
  readonly project: Project;
  readonly addedCount: number;
}

function titleFrom(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base === "" ? fileName : base;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** One project per drop; files upload one at a time so a single large file never starves the rest of bandwidth. */
export function useAddMedia() {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<readonly UploadItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddMediaResult | null>(null);

  const setUploadState = useCallback((key: string, state: UploadState) => {
    setUploads((items) => items.map((item) => (item.key === key ? { ...item, state } : item)));
  }, []);

  const run = useCallback(
    async (work: () => Promise<AddMediaResult | null>) => {
      setIsBusy(true);
      setError(null);
      setResult(null);
      try {
        setResult(await work());
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        setIsBusy(false);
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      }
    },
    [queryClient],
  );

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const items = files.map((file, index) => ({
        key: `${Date.now()}-${index}`,
        name: file.name,
        bytes: file.size,
        state: { kind: "uploading", fraction: 0 } as const,
      }));
      setUploads(items);
      void run(async () => {
        // The project is born with its first accepted file, so an all-rejected drop creates nothing.
        let project: Project | null = null;
        let addedCount = 0;
        for (const [index, file] of files.entries()) {
          const key = items[index]?.key ?? "";
          const onProgress = (fraction: number) => setUploadState(key, { kind: "uploading", fraction });
          try {
            if (project) await uploadFile({ projectId: project.id, file, onProgress });
            else project = (await createProjectWithMedia({ title: titleFrom(file.name), file, onProgress })).project;
            setUploadState(key, { kind: "done" });
            addedCount += 1;
          } catch (caught) {
            setUploadState(key, { kind: "failed", reason: errorText(caught) });
          }
        }
        return project ? { project, addedCount } : null;
      });
    },
    [run, setUploadState],
  );

  const addInPlace = useCallback(
    (path: string) => {
      setUploads([]);
      const name = path.split(/[\\/]/).pop() ?? path;
      void run(async () => {
        const { project } = await createProjectInPlace(path, titleFrom(name));
        return { project, addedCount: 1 };
      });
    },
    [run],
  );

  return { uploads, isBusy, error, result, addFiles, addInPlace };
}
