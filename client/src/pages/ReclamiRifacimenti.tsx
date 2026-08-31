// /reclami — Post-vendita: ticket, reclami e rifacimenti.
//
// Tre code separate sotto lo stesso tetto, non tre dashboard: il tab dice
// quante voci ci sono, la riga dice a chi appartengono, a che punto sono e
// qual è il passo successivo. Gli stati sono quelli del router
// (`reclamiRifacimenti.*`): la UI li avanza di uno alla volta e non ne
// inventa. Nessuna percentuale di avanzamento — questi flussi non la espongono.

import { trpc } from "@/lib/trpc";
import { formatEuroSimbolo, parseEuroNonNegativo } from "@/lib/euro";
import {
  nextReclamoAdvance,
  nextRifacimentoAdvance,
} from "@/lib/supportQueue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ConfirmDialog";
import TicketList from "./TicketList";

type DeleteTarget = {
  type: "reclamo" | "rifacimento";
  id: number;
  label: string;
} | null;

type Tab = "ticket" | "reclami" | "rifacimenti";

const statoReclamoLabel: Record<string, string> = {
  aperto: "Aperto",
  in_gestione: "In gestione",
  chiuso: "Chiuso",
};

const statoReclamoTono: Record<string, string> = {
  aperto: "border-danger/25 bg-danger-soft text-danger",
  in_gestione: "border-warning/25 bg-warning-soft text-warning",
  // risolto ritirato: il server piega i vecchi record su chiuso
  chiuso: "border-success/25 bg-success-soft text-success",
};

const statoRifacimentoLabel: Record<string, string> = {
  aperto: "Aperto",
  in_gestione: "In gestione",
  in_produzione: "In produzione",
  completato: "Completato",
  chiuso: "Chiuso",
};

const statoRifacimentoTono: Record<string, string> = {
  aperto: "border-danger/25 bg-danger-soft text-danger",
  in_gestione: "border-warning/25 bg-warning-soft text-warning",
  in_produzione: "border-st-produzione/25 bg-st-produzione-soft text-st-produzione",
  completato: "border-success/25 bg-success-soft text-success",
  chiuso: "border-border-soft bg-surface-2 text-text-2",
};

const RESPONSABILITA_LABEL: Record<string, string> = {
  interna: "Responsabilità interna",
  esterna: "Responsabilità esterna",
};

function dataItaliana(valore: string | null | undefined): string | null {
  if (!valore) return null;
  const data = new Date(`${valore}T12:00:00`);
  if (Number.isNaN(data.getTime())) return valore;
  return data.toLocaleDateString("it-IT");
}

/** Etichetta del record nella conferma di eliminazione: chi, e per cosa. */
function etichettaRecord(r: any): string {
  const descrizione = String(r.descrizione ?? "").trim();
  const breve =
    descrizione.length > 60 ? `${descrizione.slice(0, 60)}…` : descrizione;
  return [r.clienteNome, breve].filter(Boolean).join(" — ");
}

function ChipStato({
  label,
  tono,
}: {
  label: string;
  tono: string | undefined;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold",
        tono ?? "border-border-soft bg-surface-2 text-text-2"
      )}
    >
      {label}
    </span>
  );
}

export default function ReclamiRifacimenti() {
  const [tab, setTab] = useState<Tab>("ticket");
  const [reclamoDialogOpen, setReclamoDialogOpen] = useState(false);
  const [rifacimentoDialogOpen, setRifacimentoDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [reclamoErrori, setReclamoErrori] = useState<Record<string, string>>({});
  const [rifacimentoErrori, setRifacimentoErrori] = useState<
    Record<string, string>
  >({});

  const reclami = trpc.reclamiRifacimenti.reclami.list.useQuery({});
  const rifacimenti = trpc.reclamiRifacimenti.rifacimenti.list.useQuery({});
  const reclamiStats = trpc.reclamiRifacimenti.reclami.stats.useQuery();
  const rifacimentiStats = trpc.reclamiRifacimenti.rifacimenti.stats.useQuery();
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  const [reclamoForm, setReclamoForm] = useState({
    commessaId: "",
    clienteNome: "",
    descrizione: "",
    responsabile: "",
  });
  const [rifacimentoForm, setRifacimentoForm] = useState({
    commessaId: "",
    clienteNome: "",
    descrizione: "",
    elemento: "",
    fornitoreCoinvolto: "",
    costoStimato: "",
    responsabilita: "interna" as string,
    responsabile: "",
  });

  const createReclamo = trpc.reclamiRifacimenti.reclami.create.useMutation({
    onSuccess: () => {
      utils.reclamiRifacimenti.reclami.invalidate();
      setReclamoDialogOpen(false);
      // Il form si svuota solo dopo la conferma del server: un rifiuto non
      // deve far perdere quello che era stato scritto.
      setReclamoForm({
        commessaId: "",
        clienteNome: "",
        descrizione: "",
        responsabile: "",
      });
      setReclamoErrori({});
    },
  });
  const updateReclamo = trpc.reclamiRifacimenti.reclami.update.useMutation({
    onSuccess: () => utils.reclamiRifacimenti.invalidate(),
    onError: e => toast.error(e.message ?? "Aggiornamento non riuscito"),
  });
  const deleteReclamo = trpc.reclamiRifacimenti.reclami.delete.useMutation({
    onSuccess: () => {
      utils.reclamiRifacimenti.reclami.invalidate();
      setDeleteTarget(null);
      toast.success("Reclamo eliminato");
    },
    // Un rifiuto del server (sede, proprietà della commessa) va detto: prima
    // il dialog si chiudeva e non succedeva nulla.
    onError: e => {
      setDeleteTarget(null);
      toast.error(e.message ?? "Eliminazione non riuscita");
    },
  });

  const createRifacimento =
    trpc.reclamiRifacimenti.rifacimenti.create.useMutation({
      onSuccess: () => {
        utils.reclamiRifacimenti.rifacimenti.invalidate();
        setRifacimentoDialogOpen(false);
        setRifacimentoForm({
          commessaId: "",
          clienteNome: "",
          descrizione: "",
          elemento: "",
          fornitoreCoinvolto: "",
          costoStimato: "",
          responsabilita: "interna",
          responsabile: "",
        });
        setRifacimentoErrori({});
      },
    });
  const updateRifacimento =
    trpc.reclamiRifacimenti.rifacimenti.update.useMutation({
      onSuccess: () => utils.reclamiRifacimenti.invalidate(),
      onError: e => toast.error(e.message ?? "Aggiornamento non riuscito"),
    });
  const deleteRifacimento =
    trpc.reclamiRifacimenti.rifacimenti.delete.useMutation({
      onSuccess: () => {
        utils.reclamiRifacimenti.rifacimenti.invalidate();
        setDeleteTarget(null);
        toast.success("Rifacimento eliminato");
      },
      onError: e => {
        setDeleteTarget(null);
        toast.error(e.message ?? "Eliminazione non riuscita");
      },
    });

  const commessaItems = commesse.data ?? [];
  const commessaById = useMemo(() => {
    const m = new Map<number, any>();
    for (const c of commessaItems) m.set(c.id, c);
    return m;
  }, [commesse.data]);

  // Il codice commessa quando lo conosciamo; altrimenti si dice che manca,
  // senza fingere che il record non ne abbia una.
  const etichettaCommessa = (commessaId: number | null | undefined): string => {
    if (commessaId == null) return "Senza commessa";
    const commessa = commessaById.get(commessaId);
    if (commessa?.codice) return commessa.codice;
    if (commesse.isPending) return "Commessa in caricamento…";
    return `Commessa #${commessaId}`;
  };

  function submitReclamo() {
    const errori: Record<string, string> = {};
    if (!reclamoForm.commessaId)
      errori.commessaId = "Scegli la commessa a cui si riferisce il reclamo.";
    if (!reclamoForm.descrizione.trim())
      errori.descrizione = "Descrivi cosa ha segnalato il cliente.";
    setReclamoErrori(errori);
    if (Object.keys(errori).length > 0) return;
    createReclamo.mutate({
      commessaId: parseInt(reclamoForm.commessaId),
      clienteNome: reclamoForm.clienteNome,
      descrizione: reclamoForm.descrizione,
      responsabile: reclamoForm.responsabile || undefined,
    });
  }

  function submitRifacimento() {
    const errori: Record<string, string> = {};
    if (!rifacimentoForm.commessaId)
      errori.commessaId = "Scegli la commessa del rifacimento.";
    if (!rifacimentoForm.descrizione.trim())
      errori.descrizione = "Descrivi cosa va rifatto e perché.";
    if (!rifacimentoForm.elemento.trim())
      errori.elemento = "Indica l'elemento da rifare.";
    const costo = rifacimentoForm.costoStimato.trim()
      ? parseEuroNonNegativo(rifacimentoForm.costoStimato)
      : null;
    if (rifacimentoForm.costoStimato.trim() && costo == null)
      errori.costoStimato = "Importo non valido: usa per esempio 1.250,00.";
    setRifacimentoErrori(errori);
    if (Object.keys(errori).length > 0) return;
    createRifacimento.mutate({
      commessaId: parseInt(rifacimentoForm.commessaId),
      clienteNome: rifacimentoForm.clienteNome,
      descrizione: rifacimentoForm.descrizione,
      elemento: rifacimentoForm.elemento,
      fornitoreCoinvolto: rifacimentoForm.fornitoreCoinvolto || undefined,
      costoStimato: costo ?? undefined,
      responsabilita: rifacimentoForm.responsabilita as any,
      responsabile: rifacimentoForm.responsabile || undefined,
    });
  }

  // Quattro stati per coda: caricamento, errore con retry, sede vuota e —
  // qui non ci sono filtri — nient'altro da inventare.
  const statoReclami: StatePanelProps | undefined = reclami.isPending
    ? {
        kind: "loading",
        title: "Carico i reclami",
        description: "Recupero le segnalazioni della sede attiva.",
        rows: 4,
      }
    : reclami.isError
      ? {
          kind: "error",
          title: "Reclami non caricati",
          description:
            "Non è stato possibile leggere i reclami della sede. Nessun record è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => reclami.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : (reclami.data?.length ?? 0) === 0
        ? {
            kind: "empty",
            title: "Nessun reclamo aperto",
            description:
              "Quando un cliente contesta una lavorazione, registralo qui: resta agganciato alla commessa.",
            action: (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setReclamoDialogOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo reclamo
              </Button>
            ),
          }
        : undefined;

  const statoRifacimenti: StatePanelProps | undefined = rifacimenti.isPending
    ? {
        kind: "loading",
        title: "Carico i rifacimenti",
        description: "Recupero gli elementi da rifare della sede attiva.",
        rows: 4,
      }
    : rifacimenti.isError
      ? {
          kind: "error",
          title: "Rifacimenti non caricati",
          description:
            "Non è stato possibile leggere i rifacimenti della sede. Nessun record è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => rifacimenti.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : (rifacimenti.data?.length ?? 0) === 0
        ? {
            kind: "empty",
            title: "Nessun rifacimento in corso",
            description:
              "Qui finiscono gli elementi da rifare, con responsabilità e costo stimato.",
            action: (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setRifacimentoDialogOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo
                rifacimento
              </Button>
            ),
          }
        : undefined;

  const contatore = (
    query: { isPending: boolean; isError: boolean },
    valore: number | undefined
  ) => (query.isPending || query.isError ? null : (valore ?? 0));

  const reclamiCount = contatore(reclami, reclami.data?.length);
  const rifacimentiCount = contatore(rifacimenti, rifacimenti.data?.length);

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Post-vendita"
        title="Post-vendita"
        description="Ticket, reclami e rifacimenti della sede: tre code distinte, con lo stesso cliente e la stessa commessa dietro."
        metadata={
          <>
            {reclamiStats.isPending ? (
              <span>Conteggio reclami in caricamento…</span>
            ) : reclamiStats.isError ? (
              <span>Conteggio reclami non disponibile</span>
            ) : (
              <span>
                <strong className="tabular-nums text-text-1">
                  {(reclamiStats.data?.aperti ?? 0) +
                    (reclamiStats.data?.inGestione ?? 0)}
                </strong>{" "}
                reclami da chiudere
              </span>
            )}
            {rifacimentiStats.isPending ? (
              <span>Conteggio rifacimenti in caricamento…</span>
            ) : rifacimentiStats.isError ? (
              <span>Conteggio rifacimenti non disponibile</span>
            ) : (
              <>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {(rifacimentiStats.data?.aperti ?? 0) +
                      (rifacimentiStats.data?.inGestione ?? 0) +
                      (rifacimentiStats.data?.inProduzione ?? 0)}
                  </strong>{" "}
                  rifacimenti in lavorazione
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {formatEuroSimbolo(
                      rifacimentiStats.data?.costoTotaleStimato ?? 0
                    )}
                  </strong>{" "}
                  di costo stimato
                </span>
              </>
            )}
          </>
        }
        primaryAction={
          tab === "reclami" ? (
            <Button
              type="button"
              className="min-h-11"
              onClick={() => setReclamoDialogOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo reclamo
            </Button>
          ) : tab === "rifacimenti" ? (
            <Button
              type="button"
              className="min-h-11"
              onClick={() => setRifacimentoDialogOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo rifacimento
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={v => setTab(v as Tab)}>
        <TabsList
          aria-label="Code post-vendita"
          className="grid w-full grid-cols-3 sm:w-auto"
        >
          <TabsTrigger value="ticket" className="min-h-11">
            Ticket
          </TabsTrigger>
          <TabsTrigger value="reclami" className="min-h-11">
            Reclami
            {reclamiCount != null && (
              <span className="ml-1.5 tabular-nums">{reclamiCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="rifacimenti" className="min-h-11">
            Rifacimenti
            {rifacimentiCount != null && (
              <span className="ml-1.5 tabular-nums">{rifacimentiCount}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ticket" className="mt-4">
          <TicketList embedded />
        </TabsContent>

        {/* ── Reclami ────────────────────────────────────────────── */}
        <TabsContent value="reclami" className="mt-4">
          <DataSurface
            density="compact"
            tone="default"
            title="Reclami"
            description="Una riga per segnalazione: cliente, fase reale e passo successivo."
            state={statoReclami}
          >
            <div className="-mx-3 -mb-3 min-w-0 border-t border-border-soft sm:-mx-4 sm:-mb-4">
              {(reclami.data ?? []).map((r: any) => {
                const avanzamento = nextReclamoAdvance(r.stato);
                const apertura = dataItaliana(r.dataApertura);
                const risoluzione = dataItaliana(r.dataRisoluzione);
                return (
                  <article
                    key={r.id}
                    aria-label={`Reclamo di ${r.clienteNome}`}
                    className="grid min-w-0 gap-3 border-b border-border-soft px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,1.4fr)_auto]"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold leading-tight text-text-1">
                        {r.clienteNome}
                      </h3>
                      <p className="codice-mono mt-1 text-xs text-text-3">
                        {etichettaCommessa(r.commessaId)}
                      </p>
                      <p className="mt-1.5 text-xs text-text-2">
                        {apertura ? `Aperto il ${apertura}` : "Data di apertura non registrata"}
                        {risoluzione ? ` · chiuso il ${risoluzione}` : ""}
                      </p>
                      {r.responsabile && (
                        <p className="mt-1 truncate text-xs text-text-2">
                          Responsabile: {r.responsabile}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm leading-snug text-text-1">
                        {r.descrizione}
                      </p>
                      <p className="mt-1 text-xs text-text-2">
                        <span className="text-text-3">Prossima azione:</span>{" "}
                        {avanzamento
                          ? avanzamento.prossimaAzione
                          : "Chiuso: nessuna azione in coda"}
                      </p>
                      {r.soluzione && (
                        <p className="mt-2 rounded-[var(--radius-control)] bg-success-soft px-2 py-1 text-xs text-success">
                          Soluzione: {r.soluzione}
                        </p>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                      <ChipStato
                        label={statoReclamoLabel[r.stato] ?? r.stato}
                        tono={statoReclamoTono[r.stato]}
                      />
                      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                        {avanzamento && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11 text-xs lg:min-h-9"
                            disabled={updateReclamo.isPending}
                            onClick={() =>
                              updateReclamo.mutate({
                                id: r.id,
                                stato: avanzamento.stato as any,
                              })
                            }
                          >
                            {avanzamento.label}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="dangerGhost"
                          size="icon"
                          className="h-11 w-11 lg:h-9 lg:w-9"
                          aria-label={`Elimina il reclamo di ${r.clienteNome}`}
                          title="Elimina reclamo"
                          onClick={() =>
                            setDeleteTarget({
                              type: "reclamo",
                              id: r.id,
                              label: etichettaRecord(r),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </DataSurface>
        </TabsContent>

        {/* ── Rifacimenti ────────────────────────────────────────── */}
        <TabsContent value="rifacimenti" className="mt-4">
          <DataSurface
            density="compact"
            tone="default"
            title="Rifacimenti"
            description="Cosa va rifatto, di chi è la responsabilità e a che punto è la produzione."
            state={statoRifacimenti}
          >
            <div className="-mx-3 -mb-3 min-w-0 border-t border-border-soft sm:-mx-4 sm:-mb-4">
              {(rifacimenti.data ?? []).map((r: any) => {
                const avanzamento = nextRifacimentoAdvance(r.stato);
                const apertura = dataItaliana(r.dataApertura);
                const chiusura = dataItaliana(r.dataChiusura);
                return (
                  <article
                    key={r.id}
                    aria-label={`Rifacimento per ${r.clienteNome}`}
                    className="grid min-w-0 gap-3 border-b border-border-soft px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,1.4fr)_auto]"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold leading-tight text-text-1">
                        {r.clienteNome}
                      </h3>
                      <p className="codice-mono mt-1 text-xs text-text-3">
                        {etichettaCommessa(r.commessaId)}
                      </p>
                      <p className="mt-1.5 text-xs text-text-2">
                        {apertura
                          ? `Aperto il ${apertura}`
                          : "Data di apertura non registrata"}
                        {chiusura ? ` · chiuso il ${chiusura}` : ""}
                      </p>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-[11px] font-normal"
                        >
                          {RESPONSABILITA_LABEL[r.responsabilita] ??
                            r.responsabilita}
                        </Badge>
                        {r.costoStimato != null && (
                          <span className="text-xs font-semibold tabular-nums text-text-1">
                            {formatEuroSimbolo(r.costoStimato)} stimati
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm leading-snug text-text-1">
                        {r.descrizione}
                      </p>
                      <p className="mt-1 text-xs text-text-2">
                        <span className="text-text-3">Prossima azione:</span>{" "}
                        {avanzamento
                          ? avanzamento.prossimaAzione
                          : "Chiuso: nessuna azione in coda"}
                      </p>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
                        {r.elemento && <span>Elemento: {r.elemento}</span>}
                        {r.fornitoreCoinvolto && (
                          <span>Fornitore: {r.fornitoreCoinvolto}</span>
                        )}
                        {r.responsabile && (
                          <span>Responsabile: {r.responsabile}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                      <ChipStato
                        label={statoRifacimentoLabel[r.stato] ?? r.stato}
                        tono={statoRifacimentoTono[r.stato]}
                      />
                      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                        {avanzamento && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11 text-xs lg:min-h-9"
                            disabled={updateRifacimento.isPending}
                            onClick={() =>
                              updateRifacimento.mutate({
                                id: r.id,
                                stato: avanzamento.stato as any,
                              })
                            }
                          >
                            {avanzamento.label}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="dangerGhost"
                          size="icon"
                          className="h-11 w-11 lg:h-9 lg:w-9"
                          aria-label={`Elimina il rifacimento di ${r.clienteNome}`}
                          title="Elimina rifacimento"
                          onClick={() =>
                            setDeleteTarget({
                              type: "rifacimento",
                              id: r.id,
                              label: etichettaRecord(r),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </DataSurface>
        </TabsContent>
      </Tabs>

      {/* ── Create reclamo dialog ────────────────────────────────── */}
      <Dialog open={reclamoDialogOpen} onOpenChange={setReclamoDialogOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12">
            <DialogTitle>Nuovo reclamo</DialogTitle>
            <DialogDescription>
              Commessa e descrizione sono obbligatorie. Il reclamo nasce
              «aperto»: lo stato si fa avanzare dalla coda.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="reclamo-commessa">Commessa *</Label>
              <Select
                value={reclamoForm.commessaId}
                onValueChange={v => {
                  const c = commessaItems.find(
                    (c: any) => c.id === parseInt(v)
                  );
                  setReclamoForm({
                    ...reclamoForm,
                    commessaId: v,
                    clienteNome: c?.cliente ?? "",
                  });
                  setReclamoErrori(({ commessaId: _ignora, ...resto }) => resto);
                }}
              >
                <SelectTrigger
                  id="reclamo-commessa"
                  aria-invalid={reclamoErrori.commessaId ? true : undefined}
                >
                  <SelectValue
                    placeholder={
                      commesse.isPending
                        ? "Carico le commesse…"
                        : commesse.isError
                          ? "Commesse non disponibili"
                          : "Seleziona"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {commessaItems.map((c: any) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.codice} — {c.cliente}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reclamoErrori.commessaId && (
                <p role="alert" className="text-xs text-danger">
                  {reclamoErrori.commessaId}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reclamo-descrizione">Descrizione *</Label>
              <Textarea
                id="reclamo-descrizione"
                rows={3}
                aria-invalid={reclamoErrori.descrizione ? true : undefined}
                value={reclamoForm.descrizione}
                onChange={e => {
                  setReclamoForm({
                    ...reclamoForm,
                    descrizione: e.target.value,
                  });
                  setReclamoErrori(
                    ({ descrizione: _ignora, ...resto }) => resto
                  );
                }}
              />
              {reclamoErrori.descrizione && (
                <p role="alert" className="text-xs text-danger">
                  {reclamoErrori.descrizione}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reclamo-responsabile">Responsabile</Label>
              <Input
                id="reclamo-responsabile"
                value={reclamoForm.responsabile}
                onChange={e =>
                  setReclamoForm({
                    ...reclamoForm,
                    responsabile: e.target.value,
                  })
                }
              />
            </div>
            {createReclamo.isError && (
              <p role="alert" className="text-xs text-danger">
                {createReclamo.error.message}
              </p>
            )}
          </div>
          <div className="sticky bottom-0 border-t border-border-soft bg-surface-raised px-5 py-3">
            <Button
              type="button"
              className="min-h-12 w-full sm:min-h-11"
              onClick={submitReclamo}
              disabled={createReclamo.isPending}
            >
              {createReclamo.isPending ? "Creazione…" : "Crea reclamo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create rifacimento dialog ────────────────────────────── */}
      <Dialog
        open={rifacimentoDialogOpen}
        onOpenChange={setRifacimentoDialogOpen}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12">
            <DialogTitle>Nuovo rifacimento</DialogTitle>
            <DialogDescription>
              Commessa, descrizione ed elemento sono obbligatori. Il costo
              stimato resta una stima interna, non un importo di commessa.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rifacimento-commessa">Commessa *</Label>
                <Select
                  value={rifacimentoForm.commessaId}
                  onValueChange={v => {
                    const c = commessaItems.find(
                      (c: any) => c.id === parseInt(v)
                    );
                    setRifacimentoForm({
                      ...rifacimentoForm,
                      commessaId: v,
                      clienteNome: c?.cliente ?? "",
                    });
                    setRifacimentoErrori(
                      ({ commessaId: _ignora, ...resto }) => resto
                    );
                  }}
                >
                  <SelectTrigger
                    id="rifacimento-commessa"
                    aria-invalid={
                      rifacimentoErrori.commessaId ? true : undefined
                    }
                  >
                    <SelectValue
                      placeholder={
                        commesse.isPending
                          ? "Carico le commesse…"
                          : commesse.isError
                            ? "Commesse non disponibili"
                            : "Seleziona"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {commessaItems.map((c: any) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.codice} — {c.cliente}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rifacimentoErrori.commessaId && (
                  <p role="alert" className="text-xs text-danger">
                    {rifacimentoErrori.commessaId}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rifacimento-responsabilita">
                  Responsabilità
                </Label>
                <Select
                  value={rifacimentoForm.responsabilita}
                  onValueChange={v =>
                    setRifacimentoForm({
                      ...rifacimentoForm,
                      responsabilita: v,
                    })
                  }
                >
                  <SelectTrigger id="rifacimento-responsabilita">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interna">Interna</SelectItem>
                    <SelectItem value="esterna">Esterna</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rifacimento-descrizione">Descrizione *</Label>
              <Textarea
                id="rifacimento-descrizione"
                rows={2}
                aria-invalid={rifacimentoErrori.descrizione ? true : undefined}
                value={rifacimentoForm.descrizione}
                onChange={e => {
                  setRifacimentoForm({
                    ...rifacimentoForm,
                    descrizione: e.target.value,
                  });
                  setRifacimentoErrori(
                    ({ descrizione: _ignora, ...resto }) => resto
                  );
                }}
              />
              {rifacimentoErrori.descrizione && (
                <p role="alert" className="text-xs text-danger">
                  {rifacimentoErrori.descrizione}
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rifacimento-elemento">
                  Elemento da rifare *
                </Label>
                <Input
                  id="rifacimento-elemento"
                  aria-invalid={rifacimentoErrori.elemento ? true : undefined}
                  value={rifacimentoForm.elemento}
                  onChange={e => {
                    setRifacimentoForm({
                      ...rifacimentoForm,
                      elemento: e.target.value,
                    });
                    setRifacimentoErrori(
                      ({ elemento: _ignora, ...resto }) => resto
                    );
                  }}
                />
                {rifacimentoErrori.elemento && (
                  <p role="alert" className="text-xs text-danger">
                    {rifacimentoErrori.elemento}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rifacimento-fornitore">
                  Fornitore coinvolto
                </Label>
                <Input
                  id="rifacimento-fornitore"
                  value={rifacimentoForm.fornitoreCoinvolto}
                  onChange={e =>
                    setRifacimentoForm({
                      ...rifacimentoForm,
                      fornitoreCoinvolto: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rifacimento-costo">Costo stimato</Label>
                <Input
                  id="rifacimento-costo"
                  inputMode="decimal"
                  placeholder="Es. 1.250,00"
                  aria-invalid={
                    rifacimentoErrori.costoStimato ? true : undefined
                  }
                  value={rifacimentoForm.costoStimato}
                  onChange={e => {
                    setRifacimentoForm({
                      ...rifacimentoForm,
                      costoStimato: e.target.value,
                    });
                    setRifacimentoErrori(
                      ({ costoStimato: _ignora, ...resto }) => resto
                    );
                  }}
                />
                {rifacimentoErrori.costoStimato && (
                  <p role="alert" className="text-xs text-danger">
                    {rifacimentoErrori.costoStimato}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rifacimento-responsabile">Responsabile</Label>
                <Input
                  id="rifacimento-responsabile"
                  value={rifacimentoForm.responsabile}
                  onChange={e =>
                    setRifacimentoForm({
                      ...rifacimentoForm,
                      responsabile: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            {createRifacimento.isError && (
              <p role="alert" className="text-xs text-danger">
                {createRifacimento.error.message}
              </p>
            )}
          </div>
          <div className="sticky bottom-0 border-t border-border-soft bg-surface-raised px-5 py-3">
            <Button
              type="button"
              className="min-h-12 w-full sm:min-h-11"
              onClick={submitRifacimento}
              disabled={createRifacimento.isPending}
            >
              {createRifacimento.isPending ? "Creazione…" : "Crea rifacimento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title={
          deleteTarget?.type === "reclamo"
            ? "Elimina reclamo"
            : "Elimina rifacimento"
        }
        description={
          deleteTarget
            ? `Eliminare «${deleteTarget.label}»? ${
                deleteTarget.type === "reclamo"
                  ? "Il reclamo sparisce dallo storico della commessa"
                  : "Il rifacimento sparisce dallo storico della commessa, costo stimato compreso"
              }. Questa azione non può essere annullata.`
            : ""
        }
        confirmLabel={
          deleteTarget?.type === "reclamo"
            ? "Elimina reclamo"
            : "Elimina rifacimento"
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "reclamo")
            deleteReclamo.mutate(deleteTarget.id);
          else deleteRifacimento.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
