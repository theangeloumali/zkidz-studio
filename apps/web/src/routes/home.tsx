// Created by The Angelo Umali.
import { useState } from "react";
import { Link } from "react-router";
import { DropZone } from "../components/drop-zone.tsx";
import { InPlacePicker } from "../components/in-place-picker.tsx";
import { RecentProjects } from "../components/recent-projects.tsx";
import { UploadList } from "../components/upload-list.tsx";
import { editorPath } from "../lib/routes.ts";
import { useAddMedia, type AddMediaResult } from "./use-add-media.ts";

export function HomeRoute() {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const { uploads, isBusy, error, result, addFiles, addInPlace } = useAddMedia();

  return (
    <div className="flex flex-col gap-10">
      <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">Start an edit</h1>
      <div className="flex flex-col gap-4">
        <DropZone onFiles={addFiles} onPickInPlace={() => setIsPickerOpen(true)} isBusy={isBusy} />
        <UploadList items={uploads} />
        <div aria-live="polite" className="empty:hidden">
          {error && <p className="rounded-card border border-danger px-4 py-3 text-ui text-danger">{error}</p>}
          {result && <AddedNotice result={result} />}
        </div>
      </div>
      <RecentProjects />
      <InPlacePicker
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onPick={(path) => {
          setIsPickerOpen(false);
          addInPlace(path);
        }}
      />
    </div>
  );
}

function AddedNotice({ result }: { readonly result: AddMediaResult }) {
  const { addedCount, project } = result;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-strong bg-surface px-4 py-3 text-ui">
      <p>{addedCount === 1 ? "1 file added to the project." : `${addedCount} files added to the project.`}</p>
      <Link to={editorPath(project.id)} className="font-semibold text-accent underline-offset-4 hover:underline">
        Open {project.title}
      </Link>
    </div>
  );
}
