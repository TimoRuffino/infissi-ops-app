import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Button — handoff spec §3.2.
// Default height 40px (sm 32px), radius 10px, weight 600, focus ring,
// disabled = opacity .5 + cursor not-allowed.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25 aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // Primario
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover hover:shadow-sm",
        // Confirm-modal destructive action (solid). For in-list/menu deletes
        // use `dangerGhost` instead — never expose a solid red in a row.
        destructive:
          "bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger/30",
        // Distruttivo dentro menu/modale: testo danger, sfondo soft su hover
        dangerGhost:
          "text-danger hover:bg-danger-soft",
        // Secondario
        outline:
          "bg-surface border border-border-strong text-text-1 shadow-xs hover:border-primary/45 hover:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent",
        // Ghost / icona
        ghost: "text-text-1 hover:bg-accent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3.5",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-lg px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
