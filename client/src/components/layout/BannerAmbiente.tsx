// Fascia d'ambiente: compare SOLO quando il server dichiara staging
// (system.ambiente). Non è chiudibile: chi guarda staging deve saperlo
// sempre. Modello: AvvisoAzienda (stessa posizione, stessi token).
import { trpc } from "@/lib/trpc";

export default function BannerAmbiente() {
  // Tutti gli hook sopra il primo `return`: stessa regola di AvvisoAzienda.
  const ambiente = trpc.system.ambiente.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });

  if (!ambiente.data?.staging) return null;

  return (
    <div
      role="status"
      className="mb-3 flex min-w-0 shrink-0 items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft px-3 py-1.5 text-sm text-text-1"
    >
      <p className="min-w-0 flex-1 basis-40 py-1 leading-5">
        Ambiente di prova — i dati sono dimostrativi e possono essere azzerati
        in ogni momento.
      </p>
    </div>
  );
}
