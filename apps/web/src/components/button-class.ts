// Created by The Angelo Umali.
import { buttonVariants, type ButtonVariantProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ButtonVariant = NonNullable<ButtonVariantProps["variant"]>;

/** For a native <button> or a link styled as one; new code uses <Button> from components/ui. */
export function buttonClass(variant: ButtonVariant, extra = ""): string {
  return cn(buttonVariants({ variant }), extra);
}

/** A square 44 px icon button; its name lives in `aria-label`. */
export const ICON_BUTTON_CLASS = buttonVariants({ variant: "secondary", size: "icon" });
