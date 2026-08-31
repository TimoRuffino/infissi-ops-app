import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Badge / chip — stato compatto, mai comunicato dal solo colore.
const badgeVariants = cva(
  "inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-[8px] border px-2 text-xs font-semibold transition-colors duration-(--duration-fast) focus-visible:ring-[3px] focus-visible:ring-ring/45 [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary-hover",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-surface-2",
        destructive:
          "border-transparent bg-danger text-on-danger [a&]:hover:bg-danger/90",
        outline: "border-border-strong text-text-1 [a&]:hover:bg-surface-2",
        // Soft semantic chips (colored text on tinted bg)
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        info: "border-transparent bg-info-soft text-info",
        danger: "border-transparent bg-danger-soft text-danger",
        brand: "border-transparent bg-brand-soft text-brand-soft-ink",
        mora: "border-transparent bg-structure-soft text-mora",
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
