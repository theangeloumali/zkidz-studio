// Created by The Angelo Umali.
import type { IngestMode } from "@zks/shared";

/** `clips` files become the edit's source in order; the `insert` file plays as the showcase panel. */
export type SlotRole = "clips" | "insert";

export interface FileSlot {
  readonly id: string;
  readonly label: string;
  readonly role: SlotRole;
  readonly isMultiple: boolean;
  readonly missingMessage: string;
}

export interface IngestForm {
  readonly label: string;
  /** Upload order: the first slot's first file creates the project. */
  readonly slots: readonly FileSlot[];
}

/** The template text comes from the server; only the footage form per ingest mode lives here. */
export const INGEST_FORMS: Readonly<Record<IngestMode, IngestForm>> = {
  single: { label: "single clip", slots: [{ id: "clip", label: "Clip", role: "clips", isMultiple: false, missingMessage: "Add a clip." }] },
  join: { label: "join clips in order", slots: [{ id: "clips", label: "Clips, in order", role: "clips", isMultiple: true, missingMessage: "Add the clips." }] },
  showcase: {
    label: "showcase",
    slots: [
      { id: "camera", label: "Camera clip", role: "clips", isMultiple: false, missingMessage: "Add a camera clip." },
      { id: "screen", label: "Screen recording", role: "insert", isMultiple: false, missingMessage: "Add a screen recording." },
    ],
  },
};
