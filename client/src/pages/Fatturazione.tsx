// Elenco «Fatturazione» (piano 4, Task 3): tutte le commesse della sede in
// aggiornamento contratto o fatture/pagamento senza una fattura, con filtro
// per stato, ricerca libera e una card per commessa (quattro passi, importi
// solo con `economia.read`). Dietro l'interruttore «limiti»: senza il
// computo dei limiti non esiste il percorso a passi su cui questa pagina si
// fonda (v. `server/routers/fatturazioneGuidata.ts`, `procedureConInterruttore`).
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §3 (flusso) e §6 (client).
import { useMemo, useState } from "react";
import { FilterX, ReceiptText, Search } from "lucide-react";

import CardCommessaDaFatturare from "@/components/fatturazione/CardCommessaDaFatturare";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { filtraCommesse } from "@/lib/fatturazioneView";
import { statoLabel } from "@/lib/stato";
import { trpc } from "@/lib/trpc";
import { permessoNegato } from "@/lib/trpcErrors";
import type { StatoDaFatturare } from "@shared/fatturazione/passi";

type FiltroStato = "tutti" | StatoDaFatturare;

export default function Fatturazione() {
  const [filtroStato, setFiltroStato] = useState<FiltroStato>("tutti");
  const [search, setSearch] = useState("");

  // Kill switch: senza i limiti non c'è il computo su cui il percorso a
  // passi si fonda (stesso interruttore letto da CommessaDetail). La UI
  // nasconde la pagina, il server la rifiuterebbe comunque.
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const limitiAttivi = Boolean(interruttori.data?.limiti);

  const daFare = trpc.fatturazioneGuidata.daFare.useQuery(undefined, {
    enabled: limitiAttivi,
    retry: false,
  });

  const elenco = daFare.data ?? [];
  const filtrate = useMemo(
    () => filtraCommesse(elenco, { stato: filtroStato, testo: search }),
    [elenco, filtroStato, search]
  );
  const hasActiveFilters = filtroStato !== "tutti" || search.trim() !== "";
  // Minor 1 (review finale): un FORBIDDEN non è un guasto da ritentare —
  // stesso testo e stessa forma di `permessoNegato` in
  // `FatturazioneCommessa.tsx`, senza «Riprova» (che non potrà mai riuscire).
  const negata = daFare.isError && permessoNegato(daFare.error);

  function azzeraFiltri() {
    setFiltroStato("tutti");
    setSearch("");
  }

  const stato: StatePanelProps | undefined = interruttori.isPending
    ? {
        kind: "loading",
        title: "Verifico la disponibilità",
        description:
          "Controllo se la fatturazione guidata è attiva su questo ambiente.",
      }
    : !limitiAttivi
      ? {
          kind: "unavailable",
          title: "Fatturazione guidata non disponibile",
          description: "Fatturazione guidata non attiva su questo ambiente.",
        }
      : daFare.isPending
        ? {
            kind: "loading",
            title: "Carico le commesse",
            description: "Recupero le commesse da fatturare della sede.",
            rows: 3,
          }
        : daFare.isError
          ? negata
            ? {
                kind: "permission",
                title: "Percorso non disponibile",
                description:
                  "Serve il permesso di leggere i contratti della sede.",
              }
            : {
                kind: "error",
                title: "Elenco non disponibile",
                description: daFare.error?.message ?? "Riprova tra poco.",
                action: (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void daFare.refetch()}
                  >
                    Riprova
                  </Button>
                ),
              }
          : filtrate.length === 0
            ? {
                kind: "empty",
                title: hasActiveFilters
                  ? "Nessuna commessa corrisponde ai filtri"
                  : "Nessuna commessa da fatturare",
                description: hasActiveFilters
                  ? "Cambia stato o ricerca per vedere le altre commesse della sede."
                  : "Quando una commessa entra in aggiornamento contratto o fatture/pagamento senza una fattura la trovi qui.",
                action: hasActiveFilters ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={azzeraFiltri}
                  >
                    <FilterX className="h-4 w-4" aria-hidden="true" />
                    Azzera i filtri
                  </Button>
                ) : undefined,
              }
            : undefined;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Amministrazione"
        title={
          <span className="inline-flex items-center gap-2">
            <ReceiptText className="h-6 w-6 text-primary" aria-hidden="true" />
            Fatturazione
          </span>
        }
        description="Commesse in aggiornamento contratto o fatture/pagamento senza una fattura."
        busy={limitiAttivi && daFare.isFetching}
        metadata={
          !limitiAttivi || daFare.isPending ? undefined : daFare.isError ? (
            <span className="text-sm text-text-3">
              Conteggio non disponibile
            </span>
          ) : (
            <span className="text-sm tabular-nums text-text-2">
              {elenco.length}{" "}
              {elenco.length === 1
                ? "commessa da fatturare"
                : "commesse da fatturare"}
            </span>
          )
        }
      />

      {limitiAttivi ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cerca per cliente o codice"
              className="pl-8"
              aria-label="Cerca commessa"
            />
          </div>

          <Select
            value={filtroStato}
            onValueChange={v => setFiltroStato(v as FiltroStato)}
          >
            <SelectTrigger
              aria-label="Filtra per stato"
              className="min-h-11 w-full sm:w-56"
            >
              <SelectValue placeholder="Stato" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tutti">Tutti gli stati</SelectItem>
              <SelectItem value="aggiornamento_contratto">
                {statoLabel("aggiornamento_contratto")}
              </SelectItem>
              <SelectItem value="fatture_pagamento">
                {statoLabel("fatture_pagamento")}
              </SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={azzeraFiltri}
            >
              <FilterX className="mr-1 h-4 w-4" aria-hidden="true" />
              Azzera
            </Button>
          ) : null}

          <span className="ml-auto whitespace-nowrap text-sm tabular-nums text-text-2">
            {filtrate.length} in elenco
          </span>
        </div>
      ) : null}

      <DataSurface density="compact" tone="sunken" state={stato}>
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtrate.map(commessa => (
            <CardCommessaDaFatturare
              key={commessa.commessaId}
              commessa={commessa}
            />
          ))}
        </div>
      </DataSurface>
    </div>
  );
}
