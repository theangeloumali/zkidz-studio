// Created by The Angelo Umali.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The brand's type scale (app.css @theme) is unknown to tailwind-merge, which would otherwise drop text-ui when a text-copy follows.
const mergeClasses = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display", "h2", "h3", "lede", "label", "body", "ui-sm", "ui", "ui-lg", "panel-title"] }] } },
});

/** shadcn's class joiner: later utilities win over earlier ones of the same group. */
export function cn(...inputs: ClassValue[]): string {
  return mergeClasses(clsx(inputs));
}
