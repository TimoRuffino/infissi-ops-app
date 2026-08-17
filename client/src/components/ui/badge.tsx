import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Badge / chip — handoff spec §3.3.
// Height 22px, padx 8, radius 8, font 12/600. Sentence case at call sites.
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-[8px] border h-[22px] px-2 text-xs font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:ring-primary/30 focus-visible:ring-[3px] transition-colors duration-150 overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary [background-image:var(--gradient-primary)] text-primary-foreground [a&]:hover:[background-image:var(--gradient-primary-hover)]",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-surface-2",
        destructive:
          "border-transparent bg-danger text-white [a&]:hover:bg-danger/90",
        outline:
          "border-border-strong text-text-1 [a&]:hover:bg-surface-2",
        // Soft semantic chips (colored text on tinted bg)
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        info: "border-transparent bg-info-soft text-info",
        danger: "border-transparent bg-danger-soft text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
