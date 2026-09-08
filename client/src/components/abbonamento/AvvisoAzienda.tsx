// La riga dell'azienda nella shell (spec WS4 §8): compare sotto la barra di
// contesto quando c'è un fatto che vale la pena leggere prima di lavorare —
// la prova che finisce, l'insoluto, la sola lettura, lo spazio o Tars vicini
// al limite o già fermi.
//
// Tre regole:
//  1. Vive solo nel multi-azienda (`tenants.mio`): a interruttore spento un
//     CRM di una sola ditta non deve vedere parole di abbonamento.
//  2. Non decide niente: le frasi le scrive `testi.ts` (puro e testato), i
//     numeri li dà il server. Qui c'è solo il disegno della riga.
//  3. Si chiude per sessione, non per sempre: `sessionStorage` ricorda la
//     CHIAVE del fatto, quindi un fatto nuovo (un giorno in meno, una
//     percentuale diversa) torna a farsi vedere.
import { AlertTriangle, Ban, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { hasRuolo, isDirezione } from "@/lib/roles";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

import { frasiAvviso } from "./testi";

/** Dove la scheda «Abbonamento e consumi» si apre già scrollata. */
const DETTAGLI = "/integrazioni?scheda=abbonamento";

const CHIAVE_SESSIONE = "abbonamento.avvisi-chiusi";

/**
 * Lo storage del browser può essere bloccato (finestra privata, criterio
 * aziendale): un avviso non deve mai far cadere la shell per questo. Nel
 * dubbio si mostra — meglio una riga di troppo che una sola lettura
 * silenziosa.
 */
function leggiChiuse(): string[] {
  try {
    const grezzo = window.sessionStorage.getItem(CHIAVE_SESSIONE);
    const lette: unknown = grezzo ? JSON.parse(grezzo) : [];
    return Array.isArray(lette) ? lette.filter(v => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function scriviChiuse(chiavi: string[]): void {
  try {
    window.sessionStorage.setItem(CHIAVE_SESSIONE, JSON.stringify(chiavi));
  } catch {
    // La riga resta chiusa per questa pagina: basta e avanza.
  }
}

export default function AvvisoAzienda() {
  const { user } = useAuth();
  const autenticato = Boolean(user);
  // `tenants.mio` è una `sessionProcedure`: risponde anche a porta chiusa,
  // che è esattamente quando la riga «sola lettura» deve comparire.
  const mio = trpc.tenants.mio.useQuery(undefined, {
    enabled: autenticato,
    staleTime: 60_000,
    retry: false,
  });
  const abilitato = autenticato && mio.data?.multiAzienda === true;
  const abbonamento = trpc.tenants.abbonamento.useQuery(undefined, {
    enabled: abilitato,
    staleTime: 60_000,
    retry: false,
  });
  const consumi = trpc.tenants.consumi.useQuery(undefined, {
    enabled: abilitato,
    staleTime: 60_000,
    retry: false,
  });
  const [chiuse, setChiuse] = useState<string[]>(leggiChiuse);
  // La scheda dei dettagli è di proprietario e direzione: a chi non la vede
  // non si offre un link che porta a una pagina dove quella scheda non c'è.
  // La frase, da sola, dice già il fatto e cosa fare.
  const vedeLaScheda = isDirezione(user) || hasRuolo(user, "proprietario");

  const frasi = useMemo(
    () => (abilitato ? frasiAvviso(abbonamento.data, consumi.data, new Date()) : []),
    [abilitato, abbonamento.data, consumi.data]
  );

  // Tutti gli hook sopra il primo `return`: una riga che compare a metà
  // sessione non deve cambiare l'ordine degli hook della shell.
  const visibili = frasi.filter(frase => !chiuse.includes(frase.chiave));
  if (visibili.length === 0) return null;

  const chiudi = (chiave: string) => {
    const prossime = chiuse.includes(chiave) ? chiuse : [...chiuse, chiave];
    setChiuse(prossime);
    scriviChiuse(prossime);
  };

  return (
    <div className="mb-3 flex min-w-0 shrink-0 flex-col gap-2">
      {visibili.map(frase => {
        const errore = frase.tono === "errore";
        const Icona = errore ? Ban : AlertTriangle;
        return (
          <div
            key={frase.chiave}
            role="status"
            className={cn(
              "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm text-text-1",
              errore
                ? "border-danger/30 bg-danger-soft"
                : "border-warning/30 bg-warning-soft"
            )}
          >
            <Icona
              className={cn(
                "size-4 shrink-0",
                errore ? "text-danger" : "text-warning"
              )}
              aria-hidden="true"
            />
            {/* `min-w-0` + `basis-40`: il testo va a capo dentro la riga
                invece di allargarla e portarsi dietro lo scroll orizzontale. */}
            <p className="min-w-0 flex-1 basis-40 py-1 leading-5">{frase.testo}</p>
            <div className="flex shrink-0 items-center gap-1">
              {vedeLaScheda ? (
                <Button asChild variant="quiet" size="sm" className="min-h-11 sm:min-h-9">
                  <Link href={DETTAGLI}>Dettagli</Link>
                </Button>
              ) : null}
              <Button
                variant="quiet"
                size="icon"
                className="size-11 sm:size-9"
                aria-label="Chiudi avviso"
                onClick={() => chiudi(frase.chiave)}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
