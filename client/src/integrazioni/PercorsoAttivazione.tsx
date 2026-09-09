import { useState } from "react";
import { MinusCircle } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import DataSurface from "@/components/patterns/DataSurface";
import { etichettaDi } from "./etichette";
import { SchedaIntegrazione, type StatoIntegrazione } from "./SchedaIntegrazione";
import { useIntegrazioni } from "./useIntegrazioni";

/**
 * Gli stessi passi della pagina Impostazioni, in ordine. Non è una seconda
 * schermata: è la stessa, ordinata — e infatti ogni passo è la STESSA
 * striscia, con le stesse azioni. Un percorso che sapesse solo saltare
 * sarebbe un elenco di cose non fatte.
 *
 * «Salta» è disponibile su ogni passo, sempre. La spec madre §9 dice che il
 * CRM si usa prima di aver collegato tutto: chi si attiva di venerdì sera
 * deve poter entrare senza aver collegato niente.
 */
export function PercorsoAttivazione({ onFine }: { onFine: () => void }) {
  const [, vaiA] = useLocation();
  const passi = trpc.integrazioni.attivazione.useQuery();
  const { stati, collega: avviaCollegamento, verifica } = useIntegrazioni();
  const salta = trpc.integrazioni.salta.useMutation({
    onSuccess: () => void passi.refetch(),
  });
  const [prove, setProve] = useState<Record<string, unknown>>({});
  const [inProva, setInProva] = useState<string | null>(null);

  const elenco = passi.data ?? [];
  const fatti = elenco.filter(p => p.esito !== "da_fare").length;

  const collega = async (chiave: string) => {
    const esito = await avviaCollegamento(chiave);
    // Il modulo della posta e il QR di WhatsApp vivono dentro il loro
    // pannello: da qui si arriva lì, alla scheda giusta, non in cima a una
    // pagina lunga.
    if (esito && (esito.tipo === "modulo" || esito.tipo === "popup")) {
      vaiA(`/integrazioni?scheda=${chiave}`);
    }
  };

  const prova = async (chiave: string) => {
    setInProva(chiave);
    try {
      const esito = await verifica.mutateAsync({ chiave: chiave as never });
      setProve(p => ({ ...p, [chiave]: esito }));
    } catch {
      // Il messaggio l'ha già mostrato l'hook.
    } finally {
      setInProva(null);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4">
      <DataSurface
        density="compact"
        tone="sunken"
        title="Collega le tue integrazioni"
        description={
          elenco.length === 0
            ? "Un momento…"
            : `${fatti} di ${elenco.length}. Puoi saltarne quante vuoi e tornarci dopo: il CRM funziona lo stesso.`
        }
      >
        <ul className="grid min-w-0 gap-2">
          {elenco.map(p => {
            const { titolo, descrizione } = etichettaDi(p.chiave);
            const stato = stati.find(s => s.chiave === p.chiave) as
              | StatoIntegrazione
              | undefined;

            return (
              <li
                key={p.chiave}
                className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3"
              >
                {stato ? (
                  <SchedaIntegrazione
                    stato={stato}
                    titolo={titolo}
                    descrizione={descrizione}
                    onCollega={
                      p.chiave === "agente"
                        ? undefined
                        : () => void collega(p.chiave)
                    }
                    onAzione={a => {
                      if (a === "ricollega") void collega(p.chiave);
                      else if (a === "riprova") void prova(p.chiave);
                      else if (a === "scegli")
                        vaiA(`/integrazioni?scheda=${p.chiave}`);
                    }}
                    onProva={() => void prova(p.chiave)}
                    provaInCorso={inProva === p.chiave}
                    esitoProva={prove[p.chiave] as never}
                  />
                ) : (
                  <p className="text-sm font-semibold text-text-1">{titolo}</p>
                )}

                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 px-1">
                  {p.esito === "saltata" && (
                    <span className="flex items-center gap-1 text-xs text-text-3">
                      <MinusCircle className="size-3.5" aria-hidden="true" />
                      saltato — ci si può tornare quando vuoi
                    </span>
                  )}
                  {p.esito === "da_fare" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 shrink-0"
                      disabled={salta.isPending}
                      onClick={() => salta.mutate({ chiave: p.chiave })}
                    >
                      Salta
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </DataSurface>

      <Button variant="outline" className="min-h-11" onClick={onFine}>
        Entra nel CRM
      </Button>
    </div>
  );
}
