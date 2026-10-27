// Created by The Angelo Umali.

/** primary = the one gold action per screen; steel = a confirm inside a dialog; secondary = everything else. */
export type ButtonVariant = "primary" | "steel" | "secondary" | "quiet";

const BASE =
  "inline-flex min-h-(--target-min) shrink-0 items-center justify-center gap-2 rounded-control px-5 text-ui font-semibold select-none " +
  "transition-[transform,background-color,border-color,color] duration-(--dur-1) ease-out active:scale-[0.97] " +
  "disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-cta-edge bg-cta text-on-cta hover:bg-cta-strong",
  steel: "bg-accent text-on-accent hover:bg-accent-strong",
  secondary: "border border-line-strong text-copy hover:bg-surface",
  quiet: "text-copy-muted hover:bg-surface hover:text-copy",
};

export function buttonClass(variant: ButtonVariant, extra = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${extra}`.trim();
}

/** A square 44 px icon button; its name lives in `aria-label`. */
export const ICON_BUTTON_CLASS =
  "grid size-(--target-min) place-items-center rounded-control border border-line-strong text-copy hover:bg-surface active:scale-[0.97] disabled:opacity-50";
