import { useMemo, useState } from "react";
import { ArrowRight, Calculator, Search } from "lucide-react";
import { useLocation } from "wouter";

import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  filtraVociPreventivatore,
  inizialiAzienda,
  vociPreventivatore,
  type VocePreventivatore,
} from "@/lib/preventivatori";

// Il catalogo è statico: si calcola una volta sola, fuori dal componente.
const VOCI = vociPreventivatore();
const VOCI_PRONTE = VOCI.filter(voce => voce.route !== null).length;

export default function Preventivatori() {
  const [, setLocation] = useLocation();
  const [ricerca, setRicerca] = useState("");

  const voci = useMemo(() => filtraVociPreventivatore(VOCI, ricerca), [ricerca]);
  const pronti = voci.filter(voce => voce.route !== null);
  const nonDisponibili = voci.filter(voce => voce.route === null);

  // Una ricerca senza risultati non è "nessun preventivatore": lo stato lo dice.
  const statoCatalogo: StatePanelProps | undefined =
    voci.length === 0
      ? {
          kind: "empty",
          title: "Nessuna corrispondenza",
          description: `Nessuna azienda o prodotto a catalogo corrisponde a «${ricerca.trim()}».`,
        }
      : undefined;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="Commesse"
        title="Preventivatori"
        description="Calcolatori di preventivo per azienda e prodotto. Apri quello pronto: misure, listino, riepilogo e PDF restano dentro Ruffino Flow."
        metadata={
          <>
            <span>
              <strong className="tabular-nums text-text-1">
                {VOCI_PRONTE}
              </strong>{" "}
              calcolatori disponibili su{" "}
              <strong className="tabular-nums text-text-1">
                {VOCI.length}
              </strong>{" "}
              a catalogo
            </span>
            <span>Catalogo definito nel codice, non configurabile da qui</span>
          </>
        }
      />

      <DataSurface density="compact" tone="sunken">
        <div className="min-w-0">
          <Label
            htmlFor="ricerca-preventivatori"
            className="text-xs font-semibold"
          >
            Cerca azienda o prodotto
          </Label>
          <div className="relative mt-1.5 min-w-0 sm:max-w-md">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
            />
            <Input
              id="ricerca-preventivatori"
              value={ricerca}
              onChange={event => setRicerca(event.target.value)}
              placeholder="Es. Fivizzanese, persiane…"
              className="min-h-11 min-w-0 pl-9 text-base md:text-sm"
            />
          </div>
        </div>
      </DataSurface>

      {statoCatalogo ? (
        <DataSurface
          density="comfortable"
          tone="default"
          title="Catalogo preventivatori"
          state={statoCatalogo}
        />
      ) : (
        <>
          {pronti.length > 0 ? (
            <DataSurface
              density="comfortable"
              tone="focal"
              title="Pronti al calcolo"
              description="Aprono il calcolatore dedicato dell'azienda: misure in millimetri, listino applicato e PDF da allegare alla commessa."
            >
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {pronti.map(voce => (
                  <VoceProntaButton
                    key={voce.id}
                    voce={voce}
                    onOpen={route => setLocation(route)}
                  />
                ))}
              </div>
            </DataSurface>
          ) : null}

          {nonDisponibili.length > 0 ? (
            <DataSurface
              density="compact"
              tone="default"
              title="Non disponibili in Ruffino Flow"
              description="Restano a catalogo per memoria del listino cartaceo: senza calcolatore non c'è nulla da aprire."
            >
              <ul className="-mx-3 -mb-3 min-w-0 divide-y divide-border-soft border-t border-border-soft sm:-mx-4 sm:-mb-4">
                {nonDisponibili.map(voce => (
                  <li
                    key={voce.id}
                    className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-3 sm:px-4"
                  >
                    <span className="min-w-0 text-sm font-semibold text-text-1">
                      {voce.aziendaNome}
                    </span>
                    <span className="min-w-0 text-sm text-text-2">
                      {voce.prodottoLabel}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-text-3">
                      Non disponibile in Ruffino Flow
                    </span>
                  </li>
                ))}
              </ul>
            </DataSurface>
          ) : null}
        </>
      )}
    </div>
  );
}

function VoceProntaButton({
  voce,
  onOpen,
}: {
  voce: VocePreventivatore;
  onOpen: (route: string) => void;
}) {
  const route = voce.route;
  if (!route) return null;

  return (
    <button
      type="button"
      onClick={() => onOpen(route)}
      className="group flex min-h-12 min-w-0 items-start gap-3 rounded-[var(--radius-control)] border border-on-focal/25 bg-on-focal/10 p-3 text-left transition-colors hover:bg-on-focal/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-focal sm:p-4"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] border border-on-focal/25 text-xs font-bold tracking-tight text-on-focal"
      >
        {inizialiAzienda(voce.aziendaNome)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-on-focal">
          <Calculator aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">
            {voce.aziendaNome} · {voce.prodottoLabel}
          </span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-on-focal/75">
          {voce.aziendaDescrizione}
        </span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-on-focal/75 transition-transform motion-safe:group-hover:translate-x-0.5"
      />
    </button>
  );
}
