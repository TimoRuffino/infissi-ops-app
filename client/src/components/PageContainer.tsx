import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Lightweight page transition wrapper.
//
// Every route mounted inside DashboardLayout gets a subtle fade-up on
// entrance. The animation is intentionally short (~280ms) and uses the
// material easing curve so it feels "designed" without ever getting in the
// way of the operator's flow. Pages keep their own internal spacing
// (`space-y-*`) — this wrapper only animates.
export default function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      data-page-transition
      className={cn("min-w-0", className)}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -2 }}
      transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
    >
      {children}
    </motion.div>
  );
}
