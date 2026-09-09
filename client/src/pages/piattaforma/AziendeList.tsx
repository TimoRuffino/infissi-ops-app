// `/piattaforma` — tutte le aziende di Wyndoor in una pagina (spec WS6 §8).
// È il pannello di chi possiede la piattaforma: stato, abbonamento, spazio,
// Tars, worker fermi, ultimo backup e comandi in attesa. Nessun dato di
// business (clienti, commesse, messaggi): da qui non si entra in un'azienda,
// si amministra.
//
// L'elenco si rinfresca da solo ogni 30 secondi come il giro dei comandi:
// un ricalcolo accodato da un'altra scheda deve comparire senza ricaricare.
import type { inferRouterOutputs } from "@trpc/server";
import { Building2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import type { AppRouter } from "../../../../server/routers";

import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import { etichettaStato, etichettaTipo, tonoStato } from "@/components/abbonamento/testi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TENANT_PIATTAFORMA_ID } from "@/lib/piattaforma";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

import NuovaAziendaDialog from "./NuovaAziendaDialog";
import {
  TESTO_SOLA_LETTURA_FLAG_SPENTO,
  etichettaBlocco,
  etichettaStatoAzienda,
  riassuntoBackup,
  riassuntoSpazio,
  riassuntoTars,
  tonoStatoAzienda,
} from "./testi";

/** La riga dell'elenco, come la restituisce `piattaforma.aziende`. */
type Riga = inferRouterOutputs<AppRouter>["piattaforma"]["aziende"][number];

const VARIANTE_ABBONAMENTO = {
  quieto: "secondary",
  attenzione: "warning",
  errore: "danger",
} as const;

const COLONNE = [
  "Azienda",
  "Stato",
  "Abbonamento",
  "Spazio",
  "Tars",
  "Worker",
  "Backup",
  "Comandi",
] as const;

function cerca(righe: Riga[], termine: string): Riga[] {
  const q = termine.trim().toLowerCase();
  if (!q) return righe;
  return righe.filter(
    r => r.nome.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)
  );
}

function StatoAzienda({ riga }: { riga: Riga }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Badge
        variant={tonoStatoAzienda(riga.stato)}
        title={riga.motivoStato ?? undefined}
      >
        {etichettaStatoAzienda(riga.stato)}
      </Badge>
      {riga.id === TENANT_PIATTAFORMA_ID ? (
        <Badge variant="brand">piattaforma</Badge>
      ) : null}
    </span>
  );
}

function Abbonamento({ riga }: { riga: Riga }) {
  if (!riga.abbonamento) {
    return <span className="text-text-3">Nessun abbonamento</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Badge variant={VARIANTE_ABBONAMENTO[tonoStato(riga.abbonamento.stato)]}>
        {etichettaStato(riga.abbonamento.stato)}
      </Badge>
      <span className="min-w-0 truncate text-text-2">
        {etichettaTipo(riga.abbonamento.tipo)}
      </span>
    </span>
  );
}

function Spazio({ riga, adesso }: { riga: Riga; adesso: Date }) {
  const blocco = etichettaBlocco(riga.storage?.bloccoDal ?? null, adesso);
  return (
    <span className="block min-w-0">
      <span className="block truncate tabular-nums">
        {riassuntoSpazio(riga.storage)}
      </span>
      {blocco ? (
        <span className="block truncate text-xs text-warning">{blocco}</span>
      ) : null}
    </span>
  );
}

function Tars({ riga, adesso }: { riga: Riga; adesso: Date }) {
  const blocco = etichettaBlocco(riga.tars.bloccoDal, adesso);
  return (
    <span className="block min-w-0">
      <span className="block truncate tabular-nums">
        {riassuntoTars(riga.tars)}
      </span>
      {blocco ? (
        <span className="block truncate text-xs text-warning">{blocco}</span>
      ) : null}
    </span>
  );
}

function Worker({ riga }: { riga: Riga }) {
  if (riga.workerSospesi.length === 0) {
    return <span className="text-text-3">—</span>;
  }
  return (
    <Badge
      variant="warning"
      title={riga.workerSospesi.map(w => `${w.etichetta}: ${w.errore}`).join("\n")}
    >
      {riga.workerSospesi.length}{" "}
      {riga.workerSospesi.length === 1 ? "fermo" : "fermi"}
    </Badge>
  );
}

export default function AziendeList() {
  const [, setLocation] = useLocation();
  const [termine, setTermine] = useState("");
  const [nuovaAperta, setNuovaAperta] = useState(false);

  const aziende = trpc.piattaforma.aziende.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const mio = trpc.tenants.mio.useQuery();
  const solaLettura = mio.data?.multiAzienda === false;

  // Un istante solo per tutta la tabella: due righe non devono raccontare
  // due «adesso» diversi.
  const adesso = useMemo(() => new Date(), [aziende.dataUpdatedAt]);
  const righe = useMemo(() => cerca(aziende.data ?? [], termine), [aziende.data, termine]);

  const stato = aziende.isLoading
    ? ({
        kind: "loading",
        title: "Caricamento aziende",
        description: "Sto leggendo il control plane di Wyndoor.",
        rows: 4,
      } as const)
    : aziende.error
      ? ({
          kind: "error",
          title: "Elenco non disponibile",
          description: aziende.error.message,
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void aziende.refetch()}
            >
              Riprova
            </Button>
          ),
        } as const)
      : righe.length === 0
        ? ({
            kind: "empty",
            title: termine ? "Nessuna azienda trovata" : "Nessuna azienda",
            description: termine
              ? `Nessuna azienda con «${termine}» nel nome o nello slug.`
              : "Appena crei la prima azienda compare qui, con il suo stato e il suo abbonamento.",
          } as const)
        : undefined;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1200px] space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Wyndoor"
        title="Piattaforma"
        description="Tutte le aziende di Wyndoor: stato, abbonamento, spazio e Tars"
        metadata={
          aziende.data ? (
            <span>
              {aziende.data.length}{" "}
              {aziende.data.length === 1 ? "azienda" : "aziende"}
            </span>
          ) : null
        }
        warning={solaLettura ? TESTO_SOLA_LETTURA_FLAG_SPENTO : undefined}
        primaryAction={
          <Button
            type="button"
            className="min-h-11"
            disabled={solaLettura}
            onClick={() => setNuovaAperta(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            Nuova azienda
          </Button>
        }
      />

      <div className="min-w-0">
        <label htmlFor="cerca-azienda" className="sr-only">
          Cerca per nome o slug
        </label>
        <div className="relative min-w-0 max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3"
            aria-hidden="true"
          />
          <Input
            id="cerca-azienda"
            type="search"
            value={termine}
            onChange={event => setTermine(event.target.value)}
            placeholder="Cerca per nome o slug"
            className="h-11 pl-9"
          />
        </div>
      </div>

      <DataSurface
        density="compact"
        tone="default"
        state={stato}
        clip={false}
      >
        {stato ? null : (
          <>
            {/* Sotto i 768 px la tabella diventa un blocco per azienda: otto
                colonne non stanno in 390 px senza spingere fuori la pagina. */}
            <ul className="min-w-0 divide-y divide-border-soft md:hidden">
              {righe.map(riga => (
                <li key={riga.id} className="min-w-0 py-3 first:pt-0 last:pb-0">
                  <Link
                    href={`/piattaforma/${riga.slug}`}
                    className="block min-w-0 rounded-[var(--radius-control)] focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)]"
                  >
                    <span className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-text-1">
                          {riga.nome}
                        </span>
                        <span className="block truncate font-mono text-xs text-text-3">
                          {riga.slug}
                        </span>
                      </span>
                      <StatoAzienda riga={riga} />
                    </span>
                  </Link>
                  <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="min-w-0">
                      <dt className="text-text-3">Abbonamento</dt>
                      <dd className="mt-0.5 min-w-0">
                        <Abbonamento riga={riga} />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-text-3">Spazio</dt>
                      <dd className="mt-0.5 min-w-0 text-text-1">
                        <Spazio riga={riga} adesso={adesso} />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-text-3">Tars</dt>
                      <dd className="mt-0.5 min-w-0 text-text-1">
                        <Tars riga={riga} adesso={adesso} />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-text-3">Backup</dt>
                      <dd className="mt-0.5 min-w-0 truncate text-text-1">
                        {riassuntoBackup(riga.ultimoBackup)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-text-3">Worker</dt>
                      <dd className="mt-0.5 min-w-0 text-text-1">
                        <Worker riga={riga} />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-text-3">Comandi in attesa</dt>
                      <dd className="mt-0.5 min-w-0 tabular-nums text-text-1">
                        {riga.comandiInAttesa || "—"}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            <div
              className="hidden min-w-0 overflow-x-auto md:block"
              tabIndex={0}
              role="region"
              aria-label="Aziende di Wyndoor"
            >
              <table className="w-full min-w-[900px] text-sm">
                <caption className="sr-only">
                  Stato, abbonamento, spazio, Tars, worker, backup e comandi in
                  attesa di ogni azienda
                </caption>
                <thead className="text-xs text-text-3">
                  <tr>
                    {COLONNE.map(colonna => (
                      <th
                        key={colonna}
                        scope="col"
                        className={cn(
                          "px-2 py-2 text-left font-semibold",
                          colonna === "Comandi" && "text-right"
                        )}
                      >
                        {colonna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {righe.map(riga => (
                    <tr
                      key={riga.id}
                      onClick={() => setLocation(`/piattaforma/${riga.slug}`)}
                      className="cursor-pointer border-t border-border-soft align-top transition-colors hover:bg-surface-2"
                    >
                      <td className="min-w-0 px-2 py-2.5">
                        {/* Il link è l'ancora accessibile della riga: la riga
                            cliccabile è una comodità del mouse, non l'unico
                            modo per arrivare alla scheda. */}
                        <Link
                          href={`/piattaforma/${riga.slug}`}
                          onClick={event => event.stopPropagation()}
                          className="block min-w-0 rounded-[var(--radius-control)] font-semibold text-text-1 hover:text-accent-text focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)]"
                        >
                          {riga.nome}
                        </Link>
                        <span className="block truncate font-mono text-xs text-text-3">
                          {riga.slug}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <StatoAzienda riga={riga} />
                      </td>
                      <td className="min-w-0 px-2 py-2.5">
                        <Abbonamento riga={riga} />
                      </td>
                      <td className="min-w-0 px-2 py-2.5">
                        <Spazio riga={riga} adesso={adesso} />
                      </td>
                      <td className="min-w-0 px-2 py-2.5">
                        <Tars riga={riga} adesso={adesso} />
                      </td>
                      <td className="px-2 py-2.5">
                        <Worker riga={riga} />
                      </td>
                      <td className="min-w-0 px-2 py-2.5 text-text-2">
                        {riassuntoBackup(riga.ultimoBackup)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {riga.comandiInAttesa || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DataSurface>

      <p className="flex min-w-0 items-start gap-2 text-xs leading-5 text-text-3">
        <Building2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          Il pannello amministra le aziende: da qui non si entra nei loro
          clienti, commesse o messaggi. Ogni scrittura resta registrata come
          comando con il tuo nome.
        </span>
      </p>

      <NuovaAziendaDialog
        open={nuovaAperta}
        onOpenChange={setNuovaAperta}
        solaLettura={solaLettura}
      />
    </div>
  );
}
