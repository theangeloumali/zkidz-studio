// Created by The Angelo Umali.
// shadcn's Button on Base UI, with the ZKidz variants: buttonClass() and ICON_BUTTON_CLASS read these same classes.
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** primary = the one gold action per screen; steel = a confirm inside a dialog; secondary = everything else. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-semibold select-none " +
    "transition-[transform,background-color,border-color,color] duration-(--dur-1) ease-out active:scale-[0.97] " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border border-cta-edge bg-cta text-on-cta hover:bg-cta-strong",
        steel: "bg-accent text-on-accent hover:bg-accent-strong",
        secondary: "border border-line-strong text-copy hover:bg-surface",
        quiet: "text-copy-muted hover:bg-surface hover:text-copy",
      },
      size: {
        default: "min-h-(--target-min) px-5 text-ui",
        sm: "min-h-8 px-3 text-ui-sm",
        /** A square 44 px icon button; its name lives in `aria-label`. */
        icon: "size-(--target-min)",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonPrimitive.Props & ButtonVariantProps) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants, type ButtonVariantProps };
