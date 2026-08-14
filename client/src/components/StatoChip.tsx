import { statoChipClass, statoLabel } from "@/lib/stato";

// Commessa state chip (redesign §2.1 / §2). Colour is never the only signal —
// the textual label is always present.
export default function StatoChip({
  stato,
  className = "",
}: {
  stato: string;
  className?: string;
}) {
  return (
    <span
      title={statoLabel(stato)}
      className={`inline-flex max-w-full items-center h-[22px] overflow-hidden text-ellipsis px-2 rounded-[8px] text-xs font-semibold whitespace-nowrap ${statoChipClass(
        stato
      )} ${className}`}
    >
      {statoLabel(stato)}
    </span>
  );
}
