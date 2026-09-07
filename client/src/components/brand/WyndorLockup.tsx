import { cn } from "@/lib/utils";
import { WyndorMark } from "./WyndorMark";

type WyndorLockupProps = {
  className?: string;
  /** Lato del segno in pixel. */
  markSize?: number;
  /** Nome accessibile dell'insieme. */
  title?: string;
};

/**
 * Segno più parola, orizzontale. La parola resta testo: selezionabile, che
 * scala con le preferenze dell'utente e leggibile dagli screen reader senza
 * dipendere dal caricamento del font.
 */
export function WyndorLockup({
  className,
  markSize = 20,
  title,
}: WyndorLockupProps) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-2", className)}
      title={title}
    >
      <WyndorMark size={markSize} className="shrink-0 text-brand-mark" />
      <span className="font-display truncate text-[15px] font-semibold tracking-[-0.03em]">
        Wyndor
      </span>
    </span>
  );
}
