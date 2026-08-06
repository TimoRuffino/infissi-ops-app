// L'avatar di Tars — la sua identità visiva in tutta l'app. Ovunque
// compaia un suo consiglio, compare questa faccia: ambra, riconoscibile
// a colpo d'occhio in mezzo alle card neutre del gestionale.

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: "h-6 w-6", icon: "h-3.5 w-3.5" },
  md: { box: "h-8 w-8", icon: "h-4.5 w-4.5" },
  lg: { box: "h-10 w-10", icon: "h-5 w-5" },
} as const;

export default function TarsAvatar({
  size = "md",
  className,
  pulse = false,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  // Animazione quando Tars sta lavorando.
  pulse?: boolean;
}) {
  const s = SIZES[size];
  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br from-amber-400 to-orange-600 text-white",
        "flex items-center justify-center shrink-0 shadow-sm",
        pulse && "animate-pulse",
        s.box,
        className
      )}
      aria-label="Tars"
      title="Tars"
    >
      <Bot className={s.icon} />
    </div>
  );
}
