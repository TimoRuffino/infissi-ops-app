import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mail,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import SearchSelect from "@/components/SearchSelect";
import StatoChip from "@/components/StatoChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";

// Archivio fornitori (07/09/2026, direzione: «per ogni fornitore vengono
// archiviate tutte le conf. ordine e le comunicazioni in automatico da Tars;
// da lì analizza la conf. ordine e capisce di quale commessa è, e se non lo
// capisce deve dirlo e va collegata a mano»).
//
// La pagina non decide niente: mostra quello che la lettura ha capito e
// offre il collegamento. Chi decide la commessa è il server, che poi fa
// nascere costo fornitore e consegna a magazzino (regola del fascicolo).

type Stato = "da_collegare" | "collegata" | "scartata";

const STATO_CLASSI: Record<Stato, string> = {
  da_collegare: "bg-warning-soft text-warning",
  collegata: "bg-success-soft text-success",
  scartata: "bg-surface-2 text-text-3",
};

const STATO_COPY: Record<Stato, string> = {
  da_collegare: "Da collegare",
  collegata: "Nel fascicolo",
  scartata: "Scartata",
};

const FILTRI: Array<{ id: "da_collegare" | "tutte" | "collegata" | "scartata"; label: string }> = [
  { id: "da_collegare", label: "Da collegare" },
  { id: "collegata", label: "Nel fascicolo" },
  { id: "scartata", label: "Scartate" },
  { id: "tutte", label: "Tutte" },
];

function StatoVoceChip({ stato }: { stato: Stato }) {
  return (
    <span
      data-stato={stato}
      className={`inline-flex shrink-0 items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold ${STATO_CLASSI[stato]}`}
    >
      {STATO_COPY[stato]}
    </span>
  );
}

function dataIt(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("it-IT");
}

/** Cosa ha capito la lettura, detto a chi legge. */
function letturaCopy(lettura: any): string {
  if (!lettura) return "Non ancora letta: la lettura arriva col prossimo giro.";
  switch (lettura.esito) {
    case "unica":
      return lettura.motivo;
    case "ambigua":
      return lettura.motivo;
    case "nessuna":
      return "Il testo non cita nessuna commessa viva: dimmi tu di quale è.";
    case "non_leggibile":
      return `Il file non si legge: ${lettura.motivo}`;
    default:
      return lettura.motivo ?? "Lettura in attesa.";
  }
}

export default function Fornitori() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [fornitoreSel, setFornitoreSel] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<(typeof FILTRI)[number]["id"]>("da_collegare");
  const [search, setSearch] = useState("");
  // La commessa scelta a mano, per voce: nessuno stato globale.
  const [sceltaPerVoce, setSceltaPerVoce] = useState<Record<number, string>>({});

  const elenco = trpc.fornitori.archivio.fornitori.useQuery(undefined, {
    retry: false,
    refetchInterval: 120_000,
  });
  const conferme = trpc.fornitori.archivio.conferme.useQuery(
    {
      fornitore: fornitoreSel ?? undefined,
      stato: filtro === "tutte" ? undefined : filtro,
    },
    { retry: false, refetchInterval: 120_000 }
  );
  const comunicazioni = trpc.fornitori.archivio.comunicazioni.useQuery(
    { fornitore: fornitoreSel ?? "" },
    { enabled: fornitoreSel != null, retry: false }
  );
  const commesse = trpc.commesse.list.useQuery({});

  const ricarica = () => {
    void utils.fornitori.archivio.invalidate();
    void utils.commesse.invalidate();
    void utils.magazzino.invalidate();
  };

  const collega = trpc.fornitori.archivio.collega.useMutation({
    onSuccess: r => {
      ricarica();
      const costo =
        r.costo?.stato === "registrato" && r.costo.importo != null
          ? `costo ${formatEuroSimbolo(r.costo.importo)}`
          : "costo da registrare a mano";
      toast.success(
        `Conferma nel fascicolo: ${costo}${r.consegne > 0 ? ", consegna a magazzino" : ""}.`
      );
    },
    onError: e => toast.error(e.message ?? "Collegamento non riuscito"),
  });
  const scarta = trpc.fornitori.archivio.scarta.useMutation({
    onSuccess: () => {
      ricarica();
      toast.success("Scartata: resta a registro.");
    },
    onError: e => toast.error(e.message ?? "Operazione non riuscita"),
  });
  const riapri = trpc.fornitori.archivio.riapri.useMutation({
    onSuccess: () => ricarica(),
    onError: e => toast.error(e.message ?? "Operazione non riuscita"),
  });
  const rileggi = trpc.fornitori.archivio.rileggi.useMutation({
    onSuccess: v => {
      ricarica();
      toast.success(letturaCopy((v as any).lettura));
    },
    onError: e => toast.error(e.message ?? "Rilettura non riuscita"),
  });
  const aggiorna = trpc.fornitori.archivio.aggiorna.useMutation({
    onSuccess: r => {
      ricarica();
      toast.success(
        r.nuove === 0 && r.lette === 0
          ? "Archivio già aggiornato."
          : `${r.nuove} conferme nuove, ${r.lette} lette, ${r.collegateDaSole} collegate da sole.`
      );
    },
    onError: e => toast.error(e.message ?? "Aggiornamento non riuscito"),
  });

  const fornitori = elenco.data?.fornitori ?? [];
  const totali = elenco.data?.totali;
  const righe = conferme.data ?? [];

  const filtrate = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return righe;
    return righe.filter(r =>
      [r.nomeFile, r.fornitore, r.mittente, r.oggetto, r.commessa?.codice, r.commessa?.cliente]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [righe, search]);

  const opzioniCommesse = useMemo(
    () =>
      (commesse.data ?? [])
        .filter((c: any) => !c.archivedAt && c.stato !== "archiviata")
        .map((c: any) => ({
          value: String(c.id),
          label: `${c.codice ?? `#${c.id}`} — ${c.cliente ?? ""}`.trim(),
          keywords: [c.codice, c.cliente, c.citta].filter(Boolean).join(" "),
        })),
    [commesse.data]
  );

  const inCorso = collega.isPending || scarta.isPending || riapri.isPending || rileggi.isPending;

  const statoElenco: StatePanelProps | undefined = conferme.isError
    ? {
        kind: "error",
        title: "Archivio non disponibile",
        description: conferme.error?.message ?? "Riprova tra poco.",
        action: (
          <Button size="sm" variant="outline" onClick={() => void conferme.refetch()}>
            Riprova
          </Button>
        ),
      }
    : conferme.isPending
      ? { kind: "loading", title: "Carico l'archivio", description: "Un momento.", rows: 4 }
      : filtrate.length === 0
        ? {
            kind: "empty",
            title:
              filtro === "da_collegare"
                ? "Nessuna conferma da collegare"
                : "Nessuna conferma con questo filtro",
            description:
              filtro === "da_collegare"
                ? "Le conferme dei fornitori entrano qui da sole: quelle la cui commessa è certa vanno dritte nel fascicolo, le altre aspettano te."
                : "Cambia filtro o fornitore per vedere le altre conferme.",
          }
        : undefined;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Operatività"
        title={
          <span className="inline-flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" aria-hidden="true" />
            Fornitori
          </span>
        }
        description="Ogni conferma d'ordine arrivata da un fornitore entra qui da sola. Tars la legge e la mette nella commessa quando è certa; quando non lo è, lo dice e la colleghi tu. Dal fascicolo nascono il costo fornitore e la consegna a magazzino."
        busy={elenco.isFetching || conferme.isFetching}
        metadata={
          elenco.isPending ? (
            <span>Archivio in caricamento…</span>
          ) : elenco.isError ? (
            <span>Conteggi non disponibili</span>
          ) : (
            <>
              <span>
                <strong className="tabular-nums text-text-1">{totali?.fornitori ?? 0}</strong>{" "}
                fornitori
              </span>
              <span>
                <strong className="tabular-nums text-text-1">{totali?.daCollegare ?? 0}</strong>{" "}
                da collegare
              </span>
              <span>
                <strong className="tabular-nums text-text-1">{totali?.collegate ?? 0}</strong>{" "}
                nel fascicolo
              </span>
            </>
          )
        }
        primaryAction={
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={aggiorna.isPending}
            onClick={() => aggiorna.mutate()}
          >
            <RefreshCw
              className={`h-4 w-4 ${aggiorna.isPending ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
            Aggiorna archivio
          </Button>
        }
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        {/* Fornitori: chi ha conferme da collegare in cima. */}
        <section className="min-w-0" aria-label="Fornitori">
          <DataSurface density="compact" tone="sunken">
            <ul className="min-w-0 divide-y divide-border-soft">
              <li>
                <button
                  type="button"
                  aria-pressed={fornitoreSel == null}
                  onClick={() => setFornitoreSel(null)}
                  className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                    fornitoreSel == null ? "bg-surface-2 font-semibold text-text-1" : "text-text-2"
                  }`}
                >
                  <span className="min-w-0 truncate">Tutti i fornitori</span>
                  <span className="tabular-nums text-xs text-text-3">
                    {totali?.daCollegare ?? 0}
                  </span>
                </button>
              </li>
              {fornitori.map(f => (
                <li key={f.fornitore}>
                  <button
                    type="button"
                    aria-pressed={fornitoreSel === f.fornitore}
                    onClick={() => setFornitoreSel(f.fornitore)}
                    className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                      fornitoreSel === f.fornitore
                        ? "bg-surface-2 font-semibold text-text-1"
                        : "text-text-2"
                    }`}
                  >
                    <span className="min-w-0 truncate">{f.fornitore}</span>
                    {f.daCollegare > 0 ? (
                      <span className="shrink-0 rounded-[var(--radius-pill)] bg-warning-soft px-1.5 py-0.5 text-xs font-semibold tabular-nums text-warning">
                        {f.daCollegare}
                      </span>
                    ) : (
                      <span className="tabular-nums text-xs text-text-3">{f.collegate}</span>
                    )}
                  </button>
                </li>
              ))}
              {fornitori.length === 0 && !elenco.isPending ? (
                <li className="px-3 py-3 text-sm text-text-3">
                  Nessun fornitore in archivio: le conferme entrano qui appena arrivano per mail.
                </li>
              ) : null}
            </ul>
          </DataSurface>
        </section>

        <div className="min-w-0 space-y-4">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                aria-hidden="true"
              />
              <Input
                aria-label="Cerca conferme"
                placeholder="Cerca file, fornitore, oggetto, commessa…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="min-h-11 pl-9"
              />
            </div>
            <div
              role="group"
              aria-label="Stato della conferma"
              className="flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-1"
            >
              {FILTRI.map(f => (
                <Button
                  key={f.id}
                  type="button"
                  variant={filtro === f.id ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={filtro === f.id}
                  className="min-h-11 min-w-0 flex-1 px-2 lg:flex-none"
                  onClick={() => setFiltro(f.id)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          <section className="min-w-0" aria-label="Conferme d'ordine in archivio">
            <DataSurface density="compact" tone="sunken" state={statoElenco}>
              <ul className="min-w-0 divide-y divide-border-soft">
                {filtrate.map(r => {
                  const scelta = sceltaPerVoce[r.id] ?? null;
                  const stato = r.stato as Stato;
                  return (
                    <li key={r.id} className="min-w-0 px-3 py-3 sm:px-4">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-text-3">
                            <span className="font-semibold uppercase tracking-wide">
                              {r.fornitore}
                            </span>
                            <span className="tabular-nums">{dataIt(r.ricevutaIl)}</span>
                            {r.lettura?.numeroOrdine ? (
                              <span className="codice-mono">n. {r.lettura.numeroOrdine}</span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 flex min-w-0 items-start gap-1.5 text-sm font-semibold text-text-1">
                            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-3" aria-hidden="true" />
                            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                              {r.nomeFile}
                            </span>
                          </p>
                          {r.oggetto ? (
                            <p className="mt-0.5 min-w-0 truncate text-xs text-text-3">
                              {r.mittente} · {r.oggetto}
                            </p>
                          ) : null}
                        </div>
                        <StatoVoceChip stato={stato} />
                      </div>

                      {stato === "collegata" && r.commessa ? (
                        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                          <button
                            type="button"
                            className="min-w-0 truncate rounded-[var(--radius-control)] text-left text-text-1 underline-offset-2 hover:underline"
                            onClick={() => setLocation(`/commesse/${r.commessa!.id}`)}
                          >
                            <span className="codice-mono text-xs text-text-3">
                              {r.commessa.codice}
                            </span>{" "}
                            {r.commessa.cliente}
                          </button>
                          <StatoChip stato={r.commessa.stato} />
                        </p>
                      ) : (
                        <p className="mt-2 min-w-0 text-sm text-text-2 break-words [overflow-wrap:anywhere]">
                          {letturaCopy(r.lettura)}
                        </p>
                      )}

                      {r.motivoDecisione && stato !== "da_collegare" ? (
                        <p className="mt-1 min-w-0 text-xs text-text-3 break-words">
                          {r.motivoDecisione}
                        </p>
                      ) : null}

                      {/* Da collegare: i candidati che il testo nomina, poi
                          la ricerca libera. Un click e la conferma entra nel
                          fascicolo, con costo e consegna. */}
                      {stato === "da_collegare" ? (
                        <div className="mt-2 space-y-2">
                          {(r.lettura?.candidati ?? []).length > 0 ? (
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="text-xs text-text-3">Il testo nomina:</span>
                              {(r.lettura?.candidati ?? []).map(c => (
                                <Button
                                  key={c.commessaId}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="min-h-11"
                                  disabled={inCorso}
                                  title={c.prove.join(", ")}
                                  onClick={() =>
                                    collega.mutate({ voceId: r.id, commessaId: c.commessaId })
                                  }
                                >
                                  {c.codice ?? `#${c.commessaId}`}
                                  {c.cliente ? ` — ${c.cliente}` : ""}
                                </Button>
                              ))}
                            </div>
                          ) : null}
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <div className="min-w-[220px] flex-1">
                              <SearchSelect
                                options={opzioniCommesse}
                                value={scelta}
                                onChange={value =>
                                  setSceltaPerVoce(s => ({ ...s, [r.id]: value }))
                                }
                                placeholder="Scegli la commessa…"
                                searchPlaceholder="Cerca codice o cliente…"
                                className="min-h-11"
                              />
                            </div>
                            <Button
                              type="button"
                              className="min-h-11"
                              disabled={!scelta || inCorso}
                              onClick={() =>
                                scelta &&
                                collega.mutate({ voceId: r.id, commessaId: Number(scelta) })
                              }
                            >
                              Collega
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="min-h-11"
                              disabled={inCorso}
                              onClick={() => rileggi.mutate({ voceId: r.id })}
                            >
                              Rileggi
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="min-h-11"
                              disabled={inCorso}
                              onClick={() => scarta.mutate({ voceId: r.id })}
                            >
                              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              Non è da collegare
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <button
                          type="button"
                          className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                          onClick={() => setLocation(r.link)}
                        >
                          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                          Apri la mail
                        </button>
                        {r.fileLink ? (
                          <a
                            className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                            href={r.fileLink}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            Apri il file
                          </a>
                        ) : null}
                        {stato === "scartata" ? (
                          <button
                            type="button"
                            className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                            disabled={inCorso}
                            onClick={() => riapri.mutate({ voceId: r.id })}
                          >
                            Rimettila in coda
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </DataSurface>
          </section>

          {/* Le comunicazioni del fornitore selezionato: il resto della sua
              corrispondenza, per capire il contesto di una conferma. */}
          {fornitoreSel ? (
            <section className="min-w-0" aria-label={`Comunicazioni di ${fornitoreSel}`}>
              <h2 className="mb-2 text-sm font-semibold text-text-1">
                Comunicazioni di {fornitoreSel}
              </h2>
              <DataSurface
                density="compact"
                tone="sunken"
                state={
                  comunicazioni.isPending
                    ? {
                        kind: "loading",
                        title: "Carico le comunicazioni",
                        description: "Le mail di questo fornitore.",
                        rows: 3,
                      }
                    : (comunicazioni.data ?? []).length === 0
                      ? {
                          kind: "empty",
                          title: "Nessuna comunicazione trovata",
                          description:
                            "Le mail di questo fornitore compaiono qui quando il mittente è riconoscibile.",
                        }
                      : undefined
                }
              >
                <ul className="min-w-0 divide-y divide-border-soft">
                  {(comunicazioni.data ?? []).map(c => (
                    <li key={c.id} className="min-w-0 px-3 py-2.5 sm:px-4">
                      <div className="flex min-w-0 items-baseline justify-between gap-2">
                        <p className="min-w-0 truncate text-sm text-text-1">
                          {c.oggetto || "(senza oggetto)"}
                        </p>
                        <span className="shrink-0 tabular-nums text-xs text-text-3">
                          {dataIt(c.ricevutaIl)}
                        </span>
                      </div>
                      <p className="mt-0.5 min-w-0 truncate text-xs text-text-3">
                        {c.mittente}
                        {c.allegati.length > 0 ? ` · ${c.allegati.length} allegati` : ""}
                        {c.commessaId ? " · collegata a una commessa" : ""}
                      </p>
                      <button
                        type="button"
                        className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs text-text-2 hover:text-text-1"
                        onClick={() => setLocation(c.link)}
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        Apri
                      </button>
                    </li>
                  ))}
                </ul>
              </DataSurface>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
