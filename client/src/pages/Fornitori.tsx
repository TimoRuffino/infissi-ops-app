import { useMemo, useState } from "react";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  Mail,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import AnteprimaFile, { type FileDaVedere } from "@/components/documenti/AnteprimaFile";
import DoveLetto from "@/components/documenti/DoveLetto";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import SearchSelect from "@/components/SearchSelect";
import StatoChip from "@/components/StatoChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selezioneValida } from "@/lib/consegneSelezione";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";
import { componiElencoFornitori, daDecidere } from "@/lib/fornitoriView";
import { useVistaEssenziale } from "@/integrazioni/useVistaEssenziale";

// Fornitori e conferme d'ordine, una pagina sola (07/09/2026, direzione:
// «la pagina fornitori e conferme d'ordine devono essere insieme… deve
// essere utile ANCHE al magazzino, ma da lì devo anche vedere le conferme
// archiviate automaticamente da Tars alle commesse, quelle incerte e quelle
// da collegare a mano… devo sempre poter aprire il file e avere
// un'anteprima»).
//
// Due viste sullo stesso materiale:
//   Conferme  → ogni conferma d'ordine della sede, da qualunque porta sia
//               entrata, raggruppata per quello che serve decidere.
//   In arrivo → il magazzino: cosa deve ancora arrivare, da chi, per quale
//               commessa, e con quanto ritardo.
//
// La pagina non decide niente: mostra quello che la lettura ha capito e
// offre il collegamento. Il costo fornitore e la consegna nascono dal
// fascicolo, lato server (`commesse/costoDaConferma.ts`).

type Gruppo = "da_collegare" | "incerta" | "collegata_tars" | "nel_fascicolo" | "scartata";

type Conferma = {
  chiave: string;
  voceId: number | null;
  documentoId: number | null;
  comunicazioneId: number | null;
  fornitore: string;
  nome: string;
  mimeType: string;
  quando: string;
  mittente: string | null;
  oggetto: string | null;
  gruppo: Gruppo;
  motivo: string | null;
  candidati: Array<{ commessaId: number; codice: string | null; cliente: string | null; prove: string[] }>;
  numeroOrdine: string | null;
  fonteTesto: string | null;
  commessa: { id: number; codice: string | null; cliente: string | null; stato: string } | null;
  costo: { stato: string; importo: number | null };
  merce: {
    consegne: number;
    articoli: number;
    dataConsegna: string | null;
    prontaDal: string | null;
    ricevute: number;
    articoliLetti: Array<{ nome: string; quantita: number }>;
  };
  origine: string | null;
  archiviatoDa: string | null;
  decisaDa: string | null;
  daConfermare: boolean;
  fileUrl: string;
  mailUrl: string | null;
  pagineAnteprima: number;
};

const GRUPPO_COPY: Record<Gruppo, { label: string; chip: string; classi: string }> = {
  da_collegare: {
    label: "Da collegare a mano",
    chip: "Da collegare",
    classi: "bg-warning-soft text-warning",
  },
  incerta: { chip: "Incerta", label: "Incerte", classi: "bg-danger-soft text-danger" },
  collegata_tars: {
    chip: "Collegata da Tars",
    label: "Collegate da Tars",
    classi: "bg-success-soft text-success",
  },
  nel_fascicolo: {
    chip: "Nel fascicolo",
    label: "Nel fascicolo",
    classi: "bg-info-soft text-info",
  },
  scartata: { chip: "Scartata", label: "Scartate", classi: "bg-surface-2 text-text-3" },
};

const ORDINE_GRUPPI: Gruppo[] = [
  "da_collegare",
  "incerta",
  "collegata_tars",
  "nel_fascicolo",
  "scartata",
];

const ORIGINE_LABEL: Record<string, string> = {
  automatico: "Archiviata da Tars",
  smistamento: "Dallo smistamento",
  tars: "Tars su richiesta",
  fornitori: "Dall'archivio fornitori",
  mail: "Dai Messaggi",
  upload: "Caricata a mano",
  fic: "Fatture in Cloud",
};

function dataIt(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d =
    typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso) : iso;
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("it-IT");
}

/** Il costo detto a chi legge: quando non c'è, perché non c'è. */
function costoTesto(costo: { stato: string; importo: number | null }): string {
  if (costo.stato === "registrato" && costo.importo != null) {
    return formatEuroSimbolo(costo.importo);
  }
  switch (costo.stato) {
    case "senza_imponibile":
      return "senza imponibile: da scrivere a mano";
    case "non_leggibile":
      return "PDF non leggibile: da scrivere a mano";
    case "da_ocr":
      return "scansione, in coda di lettura";
    case "rimosso_a_mano":
      return "tolto a mano";
    case "errore":
      return "lettura fallita";
    case "collegato":
      return "collegato a un costo già scritto";
    case "senza_riscontro":
      return "non cita la commessa: da verificare";
    case "duplicato":
      return "copia di una conferma già a registro";
    default:
      return "in attesa di lettura";
  }
}

/** Cosa porta la conferma, in una riga: consegne vere o merce letta. */
function merceTesto(merce: Conferma["merce"]): string | null {
  if (merce.consegne > 0) {
    const pezzi = [
      merce.consegne === 1 ? "1 consegna" : `${merce.consegne} consegne`,
      merce.articoli > 0
        ? `${merce.articoli} ${merce.articoli === 1 ? "articolo" : "articoli"}`
        : null,
      merce.dataConsegna
        ? `consegna ${dataIt(merce.dataConsegna)}`
        : merce.prontaDal
          ? `pronta dal ${dataIt(merce.prontaDal)}`
          : null,
      merce.ricevute > 0 ? `${merce.ricevute} ricevute` : null,
    ].filter(Boolean);
    return pezzi.join(" · ");
  }
  if (merce.articoliLetti.length > 0) {
    const primo = merce.articoliLetti[0];
    const altri = merce.articoliLetti.length - 1;
    return `porta ${primo.nome}${altri > 0 ? ` +${altri}` : ""}${
      merce.dataConsegna ? ` · consegna ${dataIt(merce.dataConsegna)}` : ""
    }`;
  }
  return null;
}

function GruppoChip({ gruppo }: { gruppo: Gruppo }) {
  const copy = GRUPPO_COPY[gruppo];
  return (
    <span
      data-gruppo={gruppo}
      className={`inline-flex shrink-0 items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold ${copy.classi}`}
    >
      {copy.chip}
    </span>
  );
}

export default function Fornitori() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [fornitoreSel, setFornitoreSel] = useState<string | null>(null);
  const [vista, setVista] = useState<"conferme" | "arrivo">("conferme");
  const [gruppo, setGruppo] = useState<Gruppo | "tutte">("da_collegare");
  const [search, setSearch] = useState("");
  const [anteprima, setAnteprima] = useState<FileDaVedere | null>(null);
  // La commessa scelta a mano, per conferma: nessuno stato globale.
  const [sceltaPerRiga, setSceltaPerRiga] = useState<Record<string, string>>({});
  // Le consegne spuntate nella vista magazzino.
  const [segnate, setSegnate] = useState<number[]>([]);
  const [mostraRicevute, setMostraRicevute] = useState(false);

  const elenco = trpc.fornitori.archivio.fornitori.useQuery(undefined, {
    retry: false,
    refetchInterval: 120_000,
  });
  const conferme = trpc.fornitori.archivio.conferme.useQuery(
    {
      fornitore: fornitoreSel ?? undefined,
      gruppo: gruppo === "tutte" ? undefined : gruppo,
    },
    { retry: false, refetchInterval: 120_000, enabled: vista === "conferme" }
  );
  const inArrivo = trpc.fornitori.archivio.inArrivo.useQuery(
    { fornitore: fornitoreSel ?? undefined, includiRicevute: mostraRicevute },
    { retry: false, refetchInterval: 120_000, enabled: vista === "arrivo" }
  );
  const comunicazioni = trpc.fornitori.archivio.comunicazioni.useQuery(
    { fornitore: fornitoreSel ?? "" },
    { enabled: fornitoreSel != null && vista === "conferme", retry: false }
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
          : "costo da scrivere a mano";
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
      toast.success((v as any)?.lettura?.motivo ?? "Riletta.");
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
  // «È di questa commessa»: la conferma è nel fascicolo ma il testo non lo
  // dice; una persona lo conferma e da lì nascono costo e merce.
  const confermaRiscontro = trpc.preventiviContratti.confermaRiscontroConferma.useMutation({
    onSuccess: () => {
      ricarica();
      toast.success("Riscontro confermato: costo e merce ora possono nascere.");
    },
    onError: e => toast.error(e.message ?? "Operazione non riuscita"),
  });
  const segnaRicevute = trpc.magazzino.segnaRicevute.useMutation({
    onSuccess: r => {
      ricarica();
      setSegnate([]);
      toast.success(
        r.segnate === 0
          ? "Nessuna consegna da segnare."
          : r.segnate === 1
            ? "Una consegna segnata come ricevuta."
            : `${r.segnate} consegne segnate come ricevute.`
      );
    },
    onError: e => toast.error(e.message ?? "Operazione non riuscita"),
  });

  const fornitori = elenco.data?.fornitori ?? [];
  const totali = elenco.data?.totali;

  // I fornitori sono dell'azienda (10/09/2026): questa colonna è l'anagrafica
  // più i CANDIDATI — mittenti da cui è arrivata una conferma e che non sono
  // ancora censiti. Un'azienda nuova non batte venticinque nomi: conferma
  // quello che le è già arrivato.
  const anagrafica = trpc.fornitori.list.useQuery(undefined);
  const candidati = trpc.fornitori.candidati.useQuery();
  const daPiattaforma = !useVistaEssenziale();

  const censisci = trpc.fornitori.create.useMutation({
    onSuccess: f => {
      toast.success(`«${f.ragioneSociale}» è ora fra i tuoi fornitori.`);
      void utils.fornitori.list.invalidate();
      void utils.fornitori.candidati.invalidate();
    },
    onError: e => toast.error(e.message ?? "Non è stato possibile censirlo"),
  });

  const importa = trpc.fornitori.importaSeed.useMutation({
    onSuccess: r => {
      toast.success(
        r.creati === 0
          ? "Erano già tutti in elenco."
          : `${r.creati} fornitori aggiunti all'elenco.`
      );
      void utils.fornitori.list.invalidate();
      void utils.fornitori.candidati.invalidate();
    },
    onError: e => toast.error(e.message ?? "Importazione non riuscita"),
  });

  const voci = useMemo(
    () =>
      componiElencoFornitori({
        anagrafica: (anagrafica.data ?? []).map(f => ({
          id: f.id,
          ragioneSociale: f.ragioneSociale,
          attivo: f.attivo,
        })),
        riepilogo: fornitori as any,
        candidati: candidati.data ?? [],
      }),
    [anagrafica.data, candidati.data, fornitori]
  );
  const righe = (conferme.data ?? []) as unknown as Conferma[];
  // Riferimento stabile: un array nuovo a ogni render farebbe ripartire
  // tutto ciò che dipende dall'elenco.
  const consegne = useMemo(() => inArrivo.data ?? [], [inArrivo.data]);

  // I conteggi delle schede: del fornitore scelto, o di tutta la sede.
  const conteggi = useMemo(() => {
    const riga = fornitoreSel ? fornitori.find(f => f.fornitore === fornitoreSel) : null;
    const base = riga ?? totali ?? null;
    if (!base) return null;
    return {
      da_collegare: base.daCollegare ?? 0,
      incerta: base.incerte ?? 0,
      collegata_tars: (base as any).collegateTars ?? 0,
      nel_fascicolo: (base as any).nelFascicolo ?? 0,
      scartata: base.scartate ?? 0,
    } as Record<Gruppo, number>;
  }, [fornitoreSel, fornitori, totali]);

  const filtrate = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return righe;
    return righe.filter(r =>
      [r.nome, r.fornitore, r.mittente, r.oggetto, r.numeroOrdine, r.commessa?.codice, r.commessa?.cliente]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [righe, search]);

  const consegneFiltrate = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return consegne;
    return consegne.filter(c =>
      [c.nome, c.fornitore, c.numeroOrdine, c.commessa?.codice, c.commessa?.cliente]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [consegne, search]);

  // Una consegna che sparisce dall'elenco non resta spuntata: la selezione
  // si DERIVA dall'elenco, non si sincronizza con un effetto (React #185).
  const selezione = useMemo(() => selezioneValida(segnate, consegne), [segnate, consegne]);

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

  const inCorso =
    collega.isPending ||
    scarta.isPending ||
    riapri.isPending ||
    rileggi.isPending ||
    confermaRiscontro.isPending;

  const statoConferme: StatePanelProps | undefined = conferme.isError
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
      ? { kind: "loading", title: "Carico le conferme", description: "Un momento.", rows: 4 }
      : filtrate.length === 0
        ? {
            kind: "empty",
            title:
              gruppo === "da_collegare"
                ? "Nessuna conferma da collegare"
                : "Nessuna conferma in questo gruppo",
            description:
              gruppo === "da_collegare"
                ? "Le conferme dei fornitori entrano qui da sole: quelle la cui commessa è certa vanno dritte nel fascicolo, le altre aspettano te."
                : "Cambia gruppo o fornitore per vedere le altre conferme.",
          }
        : undefined;

  const statoArrivo: StatePanelProps | undefined = inArrivo.isError
    ? {
        kind: "error",
        title: "Consegne non disponibili",
        description: inArrivo.error?.message ?? "Riprova tra poco.",
        action: (
          <Button size="sm" variant="outline" onClick={() => void inArrivo.refetch()}>
            Riprova
          </Button>
        ),
      }
    : inArrivo.isPending
      ? { kind: "loading", title: "Carico le consegne", description: "Un momento.", rows: 4 }
      : consegneFiltrate.length === 0
        ? {
            kind: "empty",
            title: "Niente in arrivo",
            description:
              "Le consegne nascono dalle conferme d'ordine collegate: collega una conferma e la merce compare qui.",
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
            Fornitori e conferme d'ordine
          </span>
        }
        description="Ogni conferma d'ordine arrivata da un fornitore entra qui da sola. Tars la legge e la mette nella commessa quando è certa; quando non lo è, lo dice e la colleghi tu. Dal fascicolo nascono il costo fornitore e la consegna a magazzino."
        busy={elenco.isFetching || conferme.isFetching || inArrivo.isFetching}
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
                <strong className="tabular-nums text-text-1">
                  {(totali?.daCollegare ?? 0) + (totali?.incerte ?? 0)}
                </strong>{" "}
                aspettano te
              </span>
              <span>
                <strong className="tabular-nums text-text-1">{totali?.inArrivo ?? 0}</strong> in
                arrivo
              </span>
              {(totali?.inRitardo ?? 0) > 0 ? (
                <span className="text-danger">
                  <strong className="tabular-nums">{totali?.inRitardo}</strong> in ritardo
                </span>
              ) : null}
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

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,268px)_minmax(0,1fr)]">
        {/* Fornitori: chi ha conferme da collegare e merce in arrivo. */}
        <section className="min-w-0" aria-label="Fornitori">
          <DataSurface density="compact" tone="sunken">
            {/* Su mobile l'elenco non deve spingere le conferme sotto lo
                schermo: scorre dentro di sé. */}
            <ul className="max-h-64 min-w-0 divide-y divide-border-soft overflow-y-auto lg:max-h-none lg:overflow-visible">
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
                    {(totali?.daCollegare ?? 0) + (totali?.incerte ?? 0)}
                  </span>
                </button>
              </li>
              {voci.map(v => {
                const aspettano = daDecidere(v);
                const r = v.riepilogo;
                const candidato = v.tipo === "candidato";
                return (
                  <li key={`${v.tipo}:${v.nome}`}>
                    <button
                      type="button"
                      aria-pressed={fornitoreSel === v.nome}
                      onClick={() => setFornitoreSel(v.nome)}
                      className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                        fornitoreSel === v.nome
                          ? "bg-surface-2 font-semibold text-text-1"
                          : "text-text-2"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`min-w-0 truncate ${
                            v.tipo === "anagrafica" && !v.attivo ? "line-through opacity-60" : ""
                          }`}
                        >
                          {v.nome}
                        </span>
                        {candidato ? (
                          <span
                            title="Non è ancora fra i tuoi fornitori"
                            className="shrink-0 rounded-[var(--radius-pill)] border border-border-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"
                          >
                            da censire
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {aspettano > 0 ? (
                          <span
                            title={`${aspettano} da decidere`}
                            className="rounded-[var(--radius-pill)] bg-warning-soft px-1.5 py-0.5 text-xs font-semibold tabular-nums text-warning"
                          >
                            {aspettano}
                          </span>
                        ) : null}
                        {r && r.inArrivo > 0 ? (
                          <span
                            title={`${r.inArrivo} in arrivo${
                              r.inRitardo > 0 ? `, ${r.inRitardo} in ritardo` : ""
                            }`}
                            className={`inline-flex items-center gap-0.5 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                              r.inRitardo > 0
                                ? "bg-danger-soft text-danger"
                                : "bg-info-soft text-info"
                            }`}
                          >
                            <Truck className="h-3 w-3" aria-hidden="true" />
                            {r.inArrivo}
                          </span>
                        ) : null}
                        {aspettano === 0 && (!r || r.inArrivo === 0) && r ? (
                          <span className="tabular-nums text-xs text-text-3">
                            {r.collegateTars + r.nelFascicolo}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {candidato ? (
                      <div className="px-3 pb-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-full text-xs"
                          disabled={censisci.isPending}
                          onClick={() =>
                            censisci.mutate({
                              ragioneSociale: v.nome,
                              categoria: "altro",
                              // Il dominio senza estensione è la chiave con cui
                              // lo si riconoscerà: `vetreriabianchi.it` →
                              // `vetreriabianchi`.
                              chiavi: v.dominio
                                ? [v.dominio.replace(/\.[a-z]{2,}$/i, "").toLowerCase()]
                                : [],
                            })
                          }
                        >
                          Aggiungilo ai tuoi fornitori
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {voci.length === 0 && !elenco.isPending && !anagrafica.isPending ? (
                <li className="space-y-2 px-3 py-3 text-sm text-text-3">
                  <p>
                    Nessun fornitore in elenco: le conferme che arrivano per mail compaiono
                    qui come candidati, e da lì si censiscono con un click.
                  </p>
                  {daPiattaforma ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 w-full text-xs"
                      disabled={importa.isPending}
                      onClick={() => importa.mutate()}
                    >
                      Importa i 25 fornitori conosciuti
                    </Button>
                  ) : null}
                </li>
              ) : null}
            </ul>
          </DataSurface>
        </section>

        <div className="min-w-0 space-y-4">
          {/* Le due viste: le conferme e il magazzino. */}
          <div
            role="tablist"
            aria-label="Vista"
            className="flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-1"
          >
            <Button
              type="button"
              role="tab"
              aria-selected={vista === "conferme"}
              variant={vista === "conferme" ? "default" : "ghost"}
              className="min-h-11 min-w-0 flex-1"
              onClick={() => setVista("conferme")}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Conferme d'ordine
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={vista === "arrivo"}
              variant={vista === "arrivo" ? "default" : "ghost"}
              className="min-h-11 min-w-0 flex-1"
              onClick={() => setVista("arrivo")}
            >
              <Truck className="h-4 w-4" aria-hidden="true" />
              In arrivo
              {(totali?.inArrivo ?? 0) > 0 ? (
                <span className="ml-1 tabular-nums">({totali?.inArrivo})</span>
              ) : null}
            </Button>
          </div>

          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              aria-hidden="true"
            />
            <Input
              aria-label={vista === "conferme" ? "Cerca conferme" : "Cerca consegne"}
              placeholder={
                vista === "conferme"
                  ? "Cerca file, fornitore, oggetto, commessa…"
                  : "Cerca merce, fornitore, commessa…"
              }
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="min-h-11 pl-9"
            />
          </div>

          {vista === "conferme" ? (
            <>
              {/* I gruppi: prima quello che aspetta una decisione. */}
              <div
                role="group"
                aria-label="Gruppo della conferma"
                className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 pb-1"
              >
                {ORDINE_GRUPPI.map(g => (
                  <Button
                    key={g}
                    type="button"
                    variant={gruppo === g ? "default" : "outline"}
                    size="sm"
                    aria-pressed={gruppo === g}
                    className="min-h-11 shrink-0"
                    onClick={() => setGruppo(g)}
                  >
                    {GRUPPO_COPY[g].label}
                    {conteggi ? (
                      <span className="ml-1 tabular-nums opacity-70">{conteggi[g]}</span>
                    ) : null}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={gruppo === "tutte" ? "default" : "outline"}
                  size="sm"
                  aria-pressed={gruppo === "tutte"}
                  className="min-h-11 shrink-0"
                  onClick={() => setGruppo("tutte")}
                >
                  Tutte
                </Button>
              </div>

              <section className="min-w-0" aria-label="Conferme d'ordine">
                <DataSurface density="compact" tone="sunken" state={statoConferme}>
                  <ul className="min-w-0 divide-y divide-border-soft">
                    {filtrate.map(r => {
                      const scelta = sceltaPerRiga[r.chiave] ?? null;
                      const daDecidere = r.gruppo === "da_collegare" || r.gruppo === "incerta";
                      const merce = merceTesto(r.merce);
                      return (
                        <li key={r.chiave} className="min-w-0 px-3 py-3 sm:px-4">
                          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-text-3">
                                <span className="font-semibold uppercase tracking-wide">
                                  {r.fornitore}
                                </span>
                                <span className="tabular-nums">{dataIt(r.quando)}</span>
                                {r.numeroOrdine ? (
                                  <span className="codice-mono">n. {r.numeroOrdine}</span>
                                ) : null}
                                {r.origine ? (
                                  <span>{ORIGINE_LABEL[r.origine] ?? r.origine}</span>
                                ) : null}
                                {r.archiviatoDa ? <span>da {r.archiviatoDa}</span> : null}
                              </p>
                              <button
                                type="button"
                                className="mt-0.5 flex min-w-0 items-start gap-1.5 text-left text-sm font-semibold text-text-1 underline-offset-2 hover:underline"
                                onClick={() => setAnteprima({
                                  nome: r.nome,
                                  mimeType: r.mimeType,
                                  url: r.fileUrl,
                                  sottotitolo: [
                                    r.fornitore,
                                    dataIt(r.quando),
                                    r.numeroOrdine ? `n. ${r.numeroOrdine}` : null,
                                    r.commessa
                                      ? `${r.commessa.codice ?? ""} ${r.commessa.cliente ?? ""}`.trim()
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · "),
                                  note: merceTesto(r.merce),
                                })}
                                title="Apri l'anteprima"
                              >
                                <FileText
                                  className="mt-0.5 h-4 w-4 shrink-0 text-text-3"
                                  aria-hidden="true"
                                />
                                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                                  {r.nome}
                                </span>
                              </button>
                              {r.oggetto ? (
                                <p className="mt-0.5 min-w-0 truncate text-xs text-text-3">
                                  {[r.mittente, r.oggetto].filter(Boolean).join(" · ")}
                                </p>
                              ) : null}
                            </div>
                            <GruppoChip gruppo={r.gruppo} />
                          </div>

                          {r.commessa ? (
                            <p className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm">
                              <CheckCircle2
                                className="h-4 w-4 shrink-0 text-success"
                                aria-hidden="true"
                              />
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
                          ) : null}

                          {r.motivo ? (
                            <p className="mt-1.5 min-w-0 break-words text-sm text-text-2 [overflow-wrap:anywhere]">
                              {r.motivo}
                            </p>
                          ) : null}

                          {/* Il costo e la merce: quello che la conferma porta. */}
                          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <span className="text-text-3">Costo</span>
                              {costoTesto(r.costo)}
                              {r.documentoId != null && r.costo.stato === "registrato" ? (
                                <DoveLetto
                                  documentoId={r.documentoId}
                                  campo="imponibile"
                                  valoreAttuale={
                                    r.costo.importo != null
                                      ? formatEuroSimbolo(r.costo.importo)
                                      : null
                                  }
                                  etichetta="Dove ho letto l'imponibile"
                                />
                              ) : null}
                            </span>
                            {merce ? (
                              <span className="inline-flex min-w-0 items-center gap-1">
                                <Truck className="h-3.5 w-3.5 text-text-3" aria-hidden="true" />
                                <span className="min-w-0 break-words">{merce}</span>
                              </span>
                            ) : null}
                          </p>

                          {/* Da decidere: i candidati che il testo nomina, poi
                              la ricerca libera. Un click e la conferma entra
                              nel fascicolo, con costo e consegna. */}
                          {daDecidere && r.voceId != null ? (
                            <div className="mt-2 space-y-2">
                              {r.candidati.length > 0 ? (
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="text-xs text-text-3">Il testo nomina:</span>
                                  {r.candidati.map(c => (
                                    <Button
                                      key={c.commessaId}
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="min-h-11"
                                      disabled={inCorso}
                                      title={c.prove.join(", ")}
                                      onClick={() =>
                                        collega.mutate({
                                          voceId: r.voceId!,
                                          commessaId: c.commessaId,
                                        })
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
                                      setSceltaPerRiga(s => ({ ...s, [r.chiave]: value }))
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
                                    collega.mutate({
                                      voceId: r.voceId!,
                                      commessaId: Number(scelta),
                                    })
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
                                  onClick={() => rileggi.mutate({ voceId: r.voceId! })}
                                >
                                  Rileggi
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="min-h-11"
                                  disabled={inCorso}
                                  onClick={() => scarta.mutate({ voceId: r.voceId! })}
                                >
                                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                  Non è da collegare
                                </Button>
                              </div>
                            </div>
                          ) : null}

                          {/* Nel fascicolo ma il testo non cita la commessa:
                              lo conferma una persona, e il costo nasce. */}
                          {r.daConfermare && r.documentoId != null ? (
                            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                              <DoveLetto
                                documentoId={r.documentoId}
                                campo="riscontro"
                                etichetta="Dove ho cercato la commessa"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-h-11"
                                disabled={inCorso}
                                onClick={() =>
                                  confermaRiscontro.mutate({ documentoId: r.documentoId! })
                                }
                              >
                                È di questa commessa
                              </Button>
                            </div>
                          ) : null}

                          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <button
                              type="button"
                              className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                              onClick={() => setAnteprima({
                                  nome: r.nome,
                                  mimeType: r.mimeType,
                                  url: r.fileUrl,
                                  sottotitolo: [
                                    r.fornitore,
                                    dataIt(r.quando),
                                    r.numeroOrdine ? `n. ${r.numeroOrdine}` : null,
                                    r.commessa
                                      ? `${r.commessa.codice ?? ""} ${r.commessa.cliente ?? ""}`.trim()
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · "),
                                  note: merceTesto(r.merce),
                                })}
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              Anteprima
                            </button>
                            <a
                              className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                              href={r.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Apri il file
                            </a>
                            {r.mailUrl ? (
                              <button
                                type="button"
                                className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                                onClick={() => setLocation(r.mailUrl!)}
                              >
                                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                                Apri la mail
                              </button>
                            ) : null}
                            {r.gruppo === "scartata" && r.voceId != null ? (
                              <button
                                type="button"
                                className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                                disabled={inCorso}
                                onClick={() => riapri.mutate({ voceId: r.voceId! })}
                              >
                                Rimettila in coda
                              </button>
                            ) : null}
                            {r.decisaDa ? (
                              <span className="text-text-3">deciso da {r.decisaDa}</span>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Onestà sul tetto: la lista si ferma a 300 righe, il
                      conteggio del gruppo no. */}
                  {righe.length >= 300 && conteggi && gruppo !== "tutte" ? (
                    <p className="border-t border-border-soft px-3 py-2 text-xs text-text-3 sm:px-4">
                      Mostrate le prime {righe.length} di {conteggi[gruppo]}: cerca o scegli un
                      fornitore per restringere.
                    </p>
                  ) : null}
                </DataSurface>
              </section>

              {/* Le comunicazioni del fornitore scelto: il contesto di una
                  conferma, senza andare nei Messaggi. */}
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
            </>
          ) : (
            <>
              {/* Magazzino: si spunta quello che è arrivato e si segna in blocco. */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={selezione.length === 0 || segnaRicevute.isPending}
                  onClick={() => segnaRicevute.mutate({ prodottoIds: selezione })}
                >
                  <PackageCheck className="h-4 w-4" aria-hidden="true" />
                  Segna ricevute{selezione.length > 0 ? ` (${selezione.length})` : ""}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={consegneFiltrate.filter(c => !c.arrivato).length === 0}
                  onClick={() =>
                    setSegnate(
                      selezione.length > 0
                        ? []
                        : consegneFiltrate.filter(c => !c.arrivato).map(c => c.prodottoId)
                    )
                  }
                >
                  {selezione.length > 0 ? "Togli la selezione" : "Seleziona tutte"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  aria-pressed={mostraRicevute}
                  onClick={() => setMostraRicevute(v => !v)}
                >
                  {mostraRicevute ? "Nascondi le ricevute" : "Mostra anche le ricevute"}
                </Button>
              </div>

              <section className="min-w-0" aria-label="Consegne in arrivo">
                <DataSurface density="compact" tone="sunken" state={statoArrivo}>
                  <ul className="min-w-0 divide-y divide-border-soft">
                    {consegneFiltrate.map(c => {
                      const spuntata = selezione.includes(c.prodottoId);
                      return (
                        <li key={c.prodottoId} className="min-w-0 px-3 py-3 sm:px-4">
                          <div className="flex min-w-0 items-start gap-3">
                            {!c.arrivato ? (
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                                checked={spuntata}
                                aria-label={`Segna ricevuta ${c.nome}`}
                                onChange={e =>
                                  setSegnate(s =>
                                    e.target.checked
                                      ? [...s, c.prodottoId]
                                      : s.filter(id => id !== c.prodottoId)
                                  )
                                }
                              />
                            ) : (
                              <PackageCheck
                                className="mt-0.5 h-4 w-4 shrink-0 text-success"
                                aria-hidden="true"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-text-3">
                                <span className="font-semibold uppercase tracking-wide">
                                  {c.fornitore}
                                </span>
                                {c.numeroOrdine ? (
                                  <span className="codice-mono">n. {c.numeroOrdine}</span>
                                ) : null}
                              </p>
                              <p className="mt-0.5 min-w-0 break-words text-sm font-semibold text-text-1 [overflow-wrap:anywhere]">
                                {c.nome}
                                {c.quantita > 1 ? (
                                  <span className="ml-1 text-text-3">×{c.quantita}</span>
                                ) : null}
                              </p>
                              {c.commessa ? (
                                <p className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm">
                                  <button
                                    type="button"
                                    className="min-w-0 truncate rounded-[var(--radius-control)] text-left text-text-1 underline-offset-2 hover:underline"
                                    onClick={() => setLocation(`/commesse/${c.commessa!.id}`)}
                                  >
                                    <span className="codice-mono text-xs text-text-3">
                                      {c.commessa.codice}
                                    </span>{" "}
                                    {c.commessa.cliente}
                                  </button>
                                  <StatoChip stato={c.commessa.stato} />
                                </p>
                              ) : null}
                              {c.articoli.length > 0 ? (
                                <details className="mt-1 min-w-0">
                                  <summary className="min-h-8 cursor-pointer list-none text-xs text-text-2 hover:text-text-1">
                                    {c.articoli.length}{" "}
                                    {c.articoli.length === 1 ? "articolo" : "articoli"} nella
                                    conferma
                                  </summary>
                                  <ul className="mt-1 space-y-0.5 pl-3 text-xs text-text-2">
                                    {c.articoli.map((a, i) => (
                                      <li key={`${a.nome}-${i}`} className="min-w-0 break-words">
                                        {a.nome}
                                        {a.quantita > 1 ? ` ×${a.quantita}` : ""}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              ) : null}
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="inline-flex items-center gap-1 text-xs tabular-nums text-text-2">
                                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                                {c.dataConsegna ? dataIt(c.dataConsegna) : "senza data"}
                              </p>
                              {c.giorniDiRitardo > 0 ? (
                                <p className="mt-0.5 rounded-[var(--radius-pill)] bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
                                  {c.giorniDiRitardo === 1
                                    ? "1 giorno di ritardo"
                                    : `${c.giorniDiRitardo} giorni di ritardo`}
                                </p>
                              ) : c.prontaDal ? (
                                <p className="mt-0.5 text-xs text-text-3">
                                  pronta dal {dataIt(c.prontaDal)}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs">
                            {c.fileUrl ? (
                              <a
                                className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                                href={c.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                                Apri la conferma
                              </a>
                            ) : (
                              <span className="text-text-3">riga scritta a mano</span>
                            )}
                            {!c.arrivato ? (
                              <button
                                type="button"
                                className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                                disabled={segnaRicevute.isPending}
                                onClick={() =>
                                  segnaRicevute.mutate({ prodottoIds: [c.prodottoId] })
                                }
                              >
                                <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                Segna ricevuta
                              </button>
                            ) : (
                              <span className="text-success">ricevuta</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </DataSurface>
              </section>
            </>
          )}
        </div>
      </div>

      <AnteprimaFile file={anteprima} onClose={() => setAnteprima(null)} />
    </div>
  );
}
