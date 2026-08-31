import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Button — controlli finiti del sistema Modular Control.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-semibold outline-none transition-[background-color,background-image,border-color,color,box-shadow,opacity,transform] duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/55 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:scale-[0.98]",
        // Confirm-modal destructive action (solid). For in-list/menu deletes
        // use `dangerGhost` instead — never expose a solid red in a row.
        destructive:
          "bg-danger text-on-danger hover:bg-danger/90 focus-visible:ring-danger/40",
        // Distruttivo dentro menu/modale: testo danger, sfondo soft su hover
        dangerGhost: "text-danger hover:bg-danger-soft",
        brand:
          "bg-brand text-on-brand shadow-xs hover:brightness-[0.96] active:scale-[0.98]",
        // Firma gradiente opt-in: una sola area focale per viewport.
        focal:
          "bg-focal text-on-focal shadow-sm hover:brightness-[1.06] active:scale-[0.98]",
        // Secondario
        outline:
          "bg-surface border border-border-strong text-text-1 shadow-xs hover:border-primary/45 hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        quiet: "bg-transparent text-text-1 hover:bg-surface-2",
        toolbar:
          "border border-border-strong bg-surface-2 text-text-1 shadow-xs hover:bg-accent",
        ghost: "text-text-1 hover:bg-accent",
        link: "text-accent-text underline-offset-4 hover:underline",
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
