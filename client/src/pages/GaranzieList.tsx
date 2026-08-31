// /garanzie — il registro delle garanzie della sede.
//
// Una lista a rischio controllato: la scadenza si legge a parole prima che a
// colori, e ogni riga dice a quale commessa appartiene. Le date le calcola il
// server (`dataScadenza`); qui si decide solo come mostrarle, con l'unica
// soglia di lettura della UI (30 giorni) tenuta distinta dalla finestra di 90
// giorni usata da `garanzie.stats`.
//
// Registrare, modificare ed eliminare restano operazioni di direzione:
// `RequireDirezione` è la guardia UX della route e `adminProcedure` resta il
// confine vero lato server.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  HelpCircle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import {
  warrantyExpiryLabel,
  warrantyExpiryTone,
  type WarrantyExpiryTone,
} from "@/lib/supportQueue";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ConfirmDialog";
import SearchSelect from "@/components/SearchSelect";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type DeleteTarget = { id: number; label: string } | null;

const TIPO_LABEL: Record<string, string> = {
  prodotto: "Prodotto",
  posa: "Posa in opera",
  accessorio: "Accessorio",
  vetro: "Vetro",
  altro: "Altro",
};

const TIPI = Object.keys(TIPO_LABEL);

const TUTTI_I_TIPI = "tutti";

// Lo stato è un campo del record, non una deduzione dalla data: una garanzia
// sospesa o revocata non torna "attiva" perché la scadenza è lontana.
const STATO_REGISTRO_LABEL: Record<string, string> = {
  attiva: "Attiva",
  scaduta: "Scaduta",
  sospesa: "Sospesa",
  revocata: "Revocata",
};

const STATO_REGISTRO_TONO: Record<string, string> = {
  scaduta: "border-danger/25 bg-danger-soft text-danger",
  sospesa: "border-warning/25 bg-warning-soft text-warning",
  revocata: "border-border-soft bg-surface-2 text-text-2",
};

const TONO_SCADENZA: Record<
  WarrantyExpiryTone,
  { classe: string; icona: typeof Clock }
> = {
  expired: {
    classe: "border-danger/25 bg-danger-soft text-danger",
    icona: AlertTriangle,
  },
  due: {
    classe: "border-warning/25 bg-warning-soft text-warning",
    icona: Clock,
  },
  current: {
    classe: "border-success/25 bg-success-soft text-success",
    icona: CheckCircle2,
  },
};

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatData(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("it-IT");
}

const emptyForm = {
  commessaId: "",
  tipo: "prodotto" as string,
  descrizione: "",
  fornitore: "",
  dataInizio: new Date().toISOString().split("T")[0],
  durataMesi: "60",
  documentoRif: "",
  note: "",
};

export default function GaranzieList() {
  const [, setLocation] = useLocation();
  const [filtroTipo, setFiltroTipo] = useState<string>(TUTTI_I_TIPI);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState({
    tipo: "prodotto" as string,
    descrizione: "",
    fornitore: "",
    documentoRif: "",
    note: "",
  });

  const { user } = useAuth();
  // La route è già dietro `RequireDirezione`; questo è lo specchio UX di
  // `adminProcedure`, non una policy client: senza direzione la lista resta
  // leggibile e i controlli di scrittura non vengono montati.
  const puoGestire = isDirezione(user);

  const garanzie = trpc.garanzie.list.useQuery(
    filtroTipo === TUTTI_I_TIPI ? {} : { tipo: filtroTipo }
  );
  const stats = trpc.garanzie.stats.useQuery();
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  const createGaranzia = trpc.garanzie.create.useMutation({
    onSuccess: () => {
      utils.garanzie.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success("Garanzia registrata");
    },
    onError: e => toast.error(e.message ?? "Registrazione non riuscita"),
  });

  const updateGaranzia = trpc.garanzie.update.useMutation({
    onSuccess: () => {
      utils.garanzie.invalidate();
      setEditOpen(false);
      setEditId(null);
      toast.success("Garanzia aggiornata");
    },
    onError: e => toast.error(e.message ?? "Aggiornamento non riuscito"),
  });

  const deleteGaranzia = trpc.garanzie.delete.useMutation({
    onSuccess: () => {
      utils.garanzie.invalidate();
      setDeleteTarget(null);
      toast.success("Garanzia eliminata");
    },
    onError: e => {
      setDeleteTarget(null);
      toast.error(e.message ?? "Eliminazione non riuscita");
    },
  });

  function openEdit(g: any) {
    setEditId(g.id);
    setEditForm({
      tipo: g.tipo,
      descrizione: g.descrizione,
      fornitore: g.fornitore ?? "",
      documentoRif: g.documentoRif ?? "",
      note: g.note ?? "",
    });
    setEditOpen(true);
  }

  // Indice commessa per id: la riga dice a chi appartiene la garanzia senza
  // una seconda query per riga.
  const commessaById = useMemo(() => {
    const m = new Map<number, any>();
    for (const c of commesse.data ?? []) m.set(c.id, c);
    return m;
  }, [commesse.data]);

  const commessaOptions = useMemo(
    () =>
      (commesse.data ?? []).map((c: any) => ({
        value: String(c.id),
        label: `${c.codice} — ${c.cliente}`,
        keywords: [c.codice, c.cliente, c.citta, c.indirizzo]
          .filter(Boolean)
          .join(" "),
        hint: c.citta ?? undefined,
      })),
    [commesse.data]
  );

  const righe = garanzie.data ?? [];
  const s = stats.data;

  const nuovaGaranziaButton = (
    <Button
      type="button"
      className="min-h-11"
      onClick={() => {
        setForm(emptyForm);
        setDialogOpen(true);
      }}
    >
      <Plus className="h-4 w-4" aria-hidden="true" /> Nuova garanzia
    </Button>
  );

  // Quattro stati distinti: caricamento, errore con riprova, registro vuoto e
  // filtro senza risultati. Un filtro a vuoto non è "nessuna garanzia".
  const statoLista: StatePanelProps | undefined = garanzie.isPending
    ? {
        kind: "loading",
        title: "Carico il registro garanzie",
        description: "Recupero le garanzie della sede attiva.",
        rows: 5,
      }
    : garanzie.isError
      ? {
          kind: "error",
          title: "Registro non caricato",
          description:
            "Non è stato possibile leggere le garanzie della sede. Nessuna garanzia è stata modificata.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => garanzie.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : righe.length === 0
        ? filtroTipo !== TUTTI_I_TIPI
          ? {
              kind: "empty",
              title: "Nessuna garanzia di questo tipo",
              description:
                "Le garanzie degli altri tipi restano nel registro: togli il filtro per rivederle.",
              action: (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setFiltroTipo(TUTTI_I_TIPI)}
                >
                  Mostra tutte
                </Button>
              ),
            }
          : {
              kind: "empty",
              title: "Nessuna garanzia registrata",
              description: puoGestire
                ? "Registra qui prodotto, posa e accessori: la scadenza viene calcolata dalla data di inizio e dalla durata."
                : "Quando la direzione registrerà una garanzia la troverai in questo registro.",
              action: puoGestire ? nuovaGaranziaButton : undefined,
            }
        : undefined;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Post-vendita"
        title="Garanzie"
        description="Il registro delle coperture attive: a quale commessa appartengono, da quando valgono e quanto manca alla scadenza."
        busy={garanzie.isFetching}
        metadata={
          stats.isPending ? (
            <span>Conteggi in caricamento…</span>
          ) : stats.isError ? (
            <span>Conteggi non disponibili</span>
          ) : (
            <>
              <span>
                <strong className="tabular-nums text-text-1">
                  {s?.total ?? 0}
                </strong>{" "}
                registrate
              </span>
              <span>
                <strong className="tabular-nums text-text-1">
                  {s?.attive ?? 0}
                </strong>{" "}
                attive
              </span>
              <span>
                <strong className="tabular-nums text-warning">
                  {s?.inScadenza ?? 0}
                </strong>{" "}
                in scadenza entro 90 giorni
              </span>
              <span>
                <strong className="tabular-nums text-danger">
                  {s?.scadute ?? 0}
                </strong>{" "}
                scadute
              </span>
            </>
          )
        }
        primaryAction={puoGestire ? nuovaGaranziaButton : undefined}
      />

      <DataSurface density="compact" tone="sunken">
        <div
          role="group"
          aria-label="Filtra per tipo di garanzia"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {[TUTTI_I_TIPI, ...TIPI].map(tipo => {
            const attivo = filtroTipo === tipo;
            return (
              <Button
                key={tipo}
                type="button"
                variant={attivo ? "default" : "outline"}
                aria-pressed={attivo}
                className="min-h-11 text-xs"
                onClick={() => setFiltroTipo(tipo)}
              >
                {tipo === TUTTI_I_TIPI ? "Tutte" : TIPO_LABEL[tipo]}
              </Button>
            );
          })}
        </div>
      </DataSurface>

      <DataSurface
        density="compact"
        tone="default"
        title="Garanzie registrate"
        description="Una riga per copertura, ordinata per scadenza: la più vicina resta in alto."
        state={statoLista}
        footer={
          puoGestire ? undefined : (
            <span>
              Registro in sola lettura: creare, modificare ed eliminare una
              garanzia resta della direzione.
            </span>
          )
        }
      >
        <div className="-mx-3 -mb-3 min-w-0 border-t border-border-soft sm:-mx-4 sm:-mb-4">
          {righe.map((g: any) => {
            const commessa = g.commessaId
              ? commessaById.get(g.commessaId)
              : null;
            const giorni = daysUntil(g.dataScadenza);
            const tono = Number.isFinite(giorni)
              ? warrantyExpiryTone(giorni)
              : null;
            const statoRegistro = g.stato ?? "attiva";
            const registroDiverso = statoRegistro !== "attiva";
            const presentazione = tono ? TONO_SCADENZA[tono] : null;
            const IconaScadenza = presentazione?.icona ?? HelpCircle;
            const dataInizio = formatData(g.dataInizio);
            const dataScadenza = formatData(g.dataScadenza);

            return (
              <article
                key={g.id}
                aria-label={`Garanzia ${g.descrizione}`}
                className="grid min-w-0 gap-3 border-b border-border-soft px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,1.2fr)_auto]"
              >
                {/* Cosa copre e con quale documento. */}
                <div className="min-w-0">
                  <h3 className="text-sm font-bold leading-tight text-text-1">
                    {g.descrizione}
                  </h3>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-3">
                    <Badge variant="outline" className="text-[11px]">
                      {TIPO_LABEL[g.tipo] ?? g.tipo}
                    </Badge>
                    {g.documentoRif && (
                      <span className="codice-mono">{g.documentoRif}</span>
                    )}
                    {g.fornitore && <span>Fornitore: {g.fornitore}</span>}
                  </div>
                  {g.note && (
                    <p className="mt-1.5 whitespace-pre-line border-l-2 border-border-soft pl-2 text-xs text-text-2">
                      {g.note}
                    </p>
                  )}
                </div>

                {/* Di chi è e per quanto vale. */}
                <div className="min-w-0">
                  {commessa ? (
                    <button
                      type="button"
                      onClick={() => setLocation(`/commesse/${commessa.id}`)}
                      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--radius-control)] text-sm text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Apri la commessa"
                    >
                      <span className="codice-mono shrink-0">
                        {commessa.codice}
                      </span>
                      <span className="truncate">{commessa.cliente}</span>
                    </button>
                  ) : commesse.isPending ? (
                    <p className="text-sm text-text-3">Commessa in lettura…</p>
                  ) : commesse.isError ? (
                    <p className="text-sm text-text-3">
                      Riferimento commessa non letto
                    </p>
                  ) : (
                    <p className="text-sm text-text-3">
                      Commessa non più leggibile in questa sede
                    </p>
                  )}
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" aria-hidden="true" />
                      {dataInizio && dataScadenza
                        ? `Dal ${dataInizio} al ${dataScadenza}`
                        : "Periodo non leggibile"}
                    </span>
                    {typeof g.durataMesi === "number" && (
                      <span className="tabular-nums">{g.durataMesi} mesi</span>
                    )}
                  </div>
                </div>

                {/* Quanto manca, e cosa si può fare. */}
                <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                  {registroDiverso ? (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold",
                        STATO_REGISTRO_TONO[statoRegistro] ??
                          "border-border-soft bg-surface-2 text-text-2"
                      )}
                    >
                      {STATO_REGISTRO_LABEL[statoRegistro] ??
                        String(statoRegistro).replace(/_/g, " ")}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold",
                        presentazione?.classe ??
                          "border-border-soft bg-surface-2 text-text-2"
                      )}
                    >
                      <IconaScadenza className="h-3.5 w-3.5" aria-hidden="true" />
                      {tono
                        ? warrantyExpiryLabel(tono)
                        : "Scadenza non leggibile"}
                    </span>
                  )}
                  <span className="text-xs text-text-3 lg:text-right">
                    {dataScadenza
                      ? `Scade il ${dataScadenza}`
                      : "Data di scadenza assente"}
                  </span>

                  {puoGestire && (
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="quiet"
                        size="icon"
                        className="h-11 w-11 lg:h-9 lg:w-9"
                        aria-label={`Modifica la garanzia ${g.descrizione}`}
                        title="Modifica garanzia"
                        onClick={() => openEdit(g)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="dangerGhost"
                        size="icon"
                        className="h-11 w-11 lg:h-9 lg:w-9"
                        aria-label={`Elimina la garanzia ${g.descrizione}`}
                        title="Elimina garanzia"
                        onClick={() =>
                          setDeleteTarget({ id: g.id, label: g.descrizione })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </DataSurface>

      {/* Nuova garanzia — la scadenza la calcola il server da inizio + durata. */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12">
            <DialogTitle>Registra garanzia</DialogTitle>
            <DialogDescription>
              La data di scadenza non si scrive a mano: viene calcolata dalla
              data di inizio e dalla durata in mesi.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label>Commessa *</Label>
              <SearchSelect
                options={commessaOptions}
                value={form.commessaId}
                onChange={v => setForm({ ...form, commessaId: v })}
                placeholder="Seleziona la commessa coperta"
                searchPlaceholder="Cerca per codice, cliente…"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="garanzia-tipo">Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={v => setForm({ ...form, tipo: v })}
                >
                  <SelectTrigger id="garanzia-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPI.map(tipo => (
                      <SelectItem key={tipo} value={tipo}>
                        {TIPO_LABEL[tipo]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="garanzia-durata">Durata (mesi)</Label>
                <Input
                  id="garanzia-durata"
                  type="number"
                  min={1}
                  value={form.durataMesi}
                  onChange={e =>
                    setForm({ ...form, durataMesi: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="garanzia-descrizione">Descrizione *</Label>
              <Input
                id="garanzia-descrizione"
                placeholder="Es. Serramenti in PVC, profilo e ferramenta"
                value={form.descrizione}
                onChange={e =>
                  setForm({ ...form, descrizione: e.target.value })
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="garanzia-fornitore">Fornitore</Label>
                <Input
                  id="garanzia-fornitore"
                  value={form.fornitore}
                  onChange={e =>
                    setForm({ ...form, fornitore: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="garanzia-inizio">Data inizio</Label>
                <Input
                  id="garanzia-inizio"
                  type="date"
                  value={form.dataInizio}
                  onChange={e =>
                    setForm({ ...form, dataInizio: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="garanzia-documento">Riferimento documento</Label>
              <Input
                id="garanzia-documento"
                placeholder="GAR-2026-…"
                value={form.documentoRif}
                onChange={e =>
                  setForm({ ...form, documentoRif: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="garanzia-note">Note</Label>
              <Textarea
                id="garanzia-note"
                rows={2}
                value={form.note}
                onChange={e => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>

          <div className="sticky bottom-0 border-t border-border-soft bg-surface-raised px-5 py-3">
            <Button
              type="button"
              className="min-h-12 w-full sm:min-h-11"
              onClick={() =>
                createGaranzia.mutate({
                  commessaId: parseInt(form.commessaId),
                  tipo: form.tipo as any,
                  descrizione: form.descrizione,
                  fornitore: form.fornitore || undefined,
                  dataInizio: form.dataInizio,
                  durataMesi: parseInt(form.durataMesi) || 60,
                  documentoRif: form.documentoRif || undefined,
                  note: form.note || undefined,
                })
              }
              disabled={
                !form.commessaId ||
                !form.descrizione.trim() ||
                createGaranzia.isPending
              }
            >
              {createGaranzia.isPending ? "Registrazione…" : "Registra"}
            </Button>
            {(!form.commessaId || !form.descrizione.trim()) && (
              <p className="mt-2 text-xs text-text-3">
                Commessa e descrizione sono obbligatorie.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modifica — commessa, inizio e durata restano quelli registrati. */}
      <Dialog
        open={editOpen}
        onOpenChange={o => {
          setEditOpen(o);
          if (!o) setEditId(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12">
            <DialogTitle>Modifica garanzia</DialogTitle>
            <DialogDescription>
              Periodo e commessa non si cambiano da qui: restano quelli con cui
              la garanzia è stata registrata.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="garanzia-edit-tipo">Tipo</Label>
                <Select
                  value={editForm.tipo}
                  onValueChange={v => setEditForm({ ...editForm, tipo: v })}
                >
                  <SelectTrigger id="garanzia-edit-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPI.map(tipo => (
                      <SelectItem key={tipo} value={tipo}>
                        {TIPO_LABEL[tipo]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="garanzia-edit-fornitore">Fornitore</Label>
                <Input
                  id="garanzia-edit-fornitore"
                  value={editForm.fornitore}
                  onChange={e =>
                    setEditForm({ ...editForm, fornitore: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="garanzia-edit-descrizione">Descrizione</Label>
              <Input
                id="garanzia-edit-descrizione"
                value={editForm.descrizione}
                onChange={e =>
                  setEditForm({ ...editForm, descrizione: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="garanzia-edit-documento">
                Riferimento documento
              </Label>
              <Input
                id="garanzia-edit-documento"
                value={editForm.documentoRif}
                onChange={e =>
                  setEditForm({ ...editForm, documentoRif: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="garanzia-edit-note">Note</Label>
              <Textarea
                id="garanzia-edit-note"
                rows={2}
                value={editForm.note}
                onChange={e =>
                  setEditForm({ ...editForm, note: e.target.value })
                }
              />
            </div>
          </div>
          <div className="sticky bottom-0 border-t border-border-soft bg-surface-raised px-5 py-3">
            <Button
              type="button"
              className="min-h-12 w-full sm:min-h-11"
              onClick={() =>
                editId &&
                updateGaranzia.mutate({
                  id: editId,
                  tipo: editForm.tipo as any,
                  descrizione: editForm.descrizione || undefined,
                  fornitore: editForm.fornitore || undefined,
                  documentoRif: editForm.documentoRif || undefined,
                  note: editForm.note || undefined,
                })
              }
              disabled={updateGaranzia.isPending}
            >
              {updateGaranzia.isPending ? "Aggiornamento…" : "Aggiorna"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title="Elimina garanzia"
        description={`Eliminare "${deleteTarget?.label}"? La copertura sparisce dal registro della commessa e non è recuperabile.`}
        confirmLabel="Elimina garanzia"
        onConfirm={() => deleteTarget && deleteGaranzia.mutate(deleteTarget.id)}
      />
    </div>
  );
}
