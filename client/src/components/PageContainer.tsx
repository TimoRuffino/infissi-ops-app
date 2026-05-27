import { motion } from "framer-motion";
import type { ReactNode } from "react";

// Lightweight page transition wrapper.
//
// Every route mounted inside DashboardLayout gets a subtle fade-up on
// entrance. The animation is intentionally short (~280ms) and uses the
// material easing curve so it feels "designed" without ever getting in the
// way of the operator's flow. Pages keep their own internal spacing
// (`space-y-*`) — this wrapper only animates.
export default function PageContainer({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
