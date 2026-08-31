import { statoChipClass, statoLabel } from "@/lib/stato";

// Commessa state chip (redesign §2.1 / §2). Colour is never the only signal —
// the textual label is always present.
export default function StatoChip({
  stato,
  className = "",
  size = "sm",
}: {
  stato: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const label = statoLabel(stato);

  return (
    <span
      data-state={stato}
      aria-label={`Stato: ${label}`}
      title={label}
      className={`inline-flex max-w-full items-center gap-1.5 overflow-hidden text-ellipsis rounded-[var(--radius-pill)] font-semibold whitespace-nowrap ${
        size === "md" ? "h-7 px-2.5 text-sm" : "h-[22px] px-2 text-xs"
      } ${statoChipClass(stato)} ${className}`}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}
