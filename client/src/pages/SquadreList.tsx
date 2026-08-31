import { useMemo, useState } from "react";
import { HardHat, Plus } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import ConfirmDialog from "@/components/ConfirmDialog";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import SquadraRosterCard from "@/components/squadre/SquadraRosterCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { trpc } from "@/lib/trpc";

// Fasi in cui la commessa è "in mano alla squadra": dalla posa in poi.
const FASI_POSA = ["attesa_posa", "finiture_saldo", "interventi_regolazioni"];

// Interventi che pesano davvero sul carico di una squadra.
const STATI_INTERVENTO_ATTIVO = ["pianificato", "in_corso"];

type DeleteTarget = { id: number; label: string } | null;

export default function SquadreList() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const [, setLocation] = useLocation();
  const { user } = useAuth();
  // La lista è aperta a tutti i ruoli (serve sapere chi è in cantiere);
  // creare/modificare/eliminare resta direzione, come lato server: i router
  // `squadre.create/update/delete` usano `adminProcedure`, non una capability.
  // Questo è quindi lo specchio UX del server, non una policy client.
  const puoModificare = isDirezione(user);

  const squadre = trpc.squadre.list.useQuery();
  const interventi = trpc.interventi.list.useQuery({});
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  // Interventi ancora aperti per squadra, ordinati per data: è la risposta a
  // "questa squadra quando è impegnata?".
  const interventiPerSquadra = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const i of interventi.data ?? []) {
      if (!i.squadraId) continue;
      if (!STATI_INTERVENTO_ATTIVO.includes(i.stato)) continue;
      const arr = m.get(i.squadraId) ?? [];
      arr.push(i);
      m.set(i.squadraId, arr);
    }
    for (const arr of Array.from(m.values())) {
      arr.sort((a: any, b: any) =>
        String(a.dataPianificata ?? "9999-12-31").localeCompare(
          String(b.dataPianificata ?? "9999-12-31")
        )
      );
    }
    return m;
  }, [interventi.data]);

  // Commesse assegnate a ciascuna squadra, solo quelle ancora attive: è la
  // risposta a "questa squadra su cosa sta lavorando?".
  const commessePerSquadra = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const c of commesse.data ?? []) {
      if (!c.squadraId || c.archivedAt || c.stato === "archiviata") continue;
      const arr = m.get(c.squadraId) ?? [];
      arr.push(c);
      m.set(c.squadraId, arr);
    }
    for (const arr of Array.from(m.values())) {
      arr.sort((a: any, b: any) => {
        // Prima le commesse già in fase di posa: sono quelle su cui
        // la squadra è operativa adesso.
        const ap = FASI_POSA.includes(a.stato) ? 0 : 1;
        const bp = FASI_POSA.includes(b.stato) ? 0 : 1;
        return ap - bp || String(a.codice).localeCompare(String(b.codice));
      });
    }
    return m;
  }, [commesse.data]);

  const createSquadra = trpc.squadre.create.useMutation({
    onSuccess: () => {
      utils.squadre.invalidate();
      setDialogOpen(false);
      resetForm();
      toast.success("Squadra creata");
    },
    // Il messaggio del server è l'unica verità: il dialog resta aperto.
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });

  const updateSquadra = trpc.squadre.update.useMutation({
    onSuccess: () => {
      utils.squadre.invalidate();
      setDialogOpen(false);
      setEditId(null);
      resetForm();
      toast.success("Squadra aggiornata");
    },
    onError: e => toast.error(e.message ?? "Salvataggio non riuscito"),
  });

  const deleteSquadra = trpc.squadre.delete.useMutation({
    onSuccess: () => {
      utils.squadre.invalidate();
      setDeleteTarget(null);
      toast.success("Squadra eliminata");
    },
    onError: e => toast.error(e.message ?? "Eliminazione non riuscita"),
  });

  const [form, setForm] = useState({
    nome: "",
    caposquadra: "",
    telefono: "",
    note: "",
  });

  function resetForm() {
    setForm({ nome: "", caposquadra: "", telefono: "", note: "" });
  }

  function openCreate() {
    if (!puoModificare) return;
    setEditId(null);
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(id: number) {
    if (!puoModificare) return;
    const s = (squadre.data ?? []).find((x: any) => x.id === id);
    if (!s) return;
    setEditId(s.id);
    setForm({
      nome: s.nome,
      caposquadra: s.caposquadra ?? "",
      telefono: s.telefono ?? "",
      note: s.note ?? "",
    });
    setDialogOpen(true);
  }

  function chiediEliminazione(id: number) {
    if (!puoModificare) return;
    const s = (squadre.data ?? []).find((x: any) => x.id === id);
    if (!s) return;
    setDeleteTarget({ id: s.id, label: s.nome });
  }

  function handleSave() {
    if (!puoModificare) return;
    if (editId) {
      updateSquadra.mutate({
        id: editId,
        nome: form.nome || undefined,
        caposquadra: form.caposquadra || undefined,
        telefono: form.telefono || undefined,
        note: form.note || undefined,
      });
    } else {
      createSquadra.mutate({
        nome: form.nome,
        caposquadra: form.caposquadra || undefined,
        telefono: form.telefono || undefined,
        note: form.note || undefined,
      });
    }
  }

  const list = squadre.data ?? [];

  // Il carico (interventi e commesse) è un dato a parte dal roster: finché non
  // è letto non si scrive come zero, né si maschera un errore con "nessuno".
  const caricoNoto = interventi.isSuccess && commesse.isSuccess;
  const caricoInErrore = interventi.isError || commesse.isError;

  // Quattro stati dati espliciti. Nessun permission-state sulla lettura: il
  // router `squadre.list` è aperto a ogni utente autenticato della sede, e
  // l'assenza di gestione si dice nell'header, non nascondendo il roster.
  const statoSuperficie: StatePanelProps | undefined = squadre.isPending
    ? {
        kind: "loading",
        title: "Carico il roster",
        description: "Recupero le squadre attive della sede.",
        rows: 3,
      }
    : squadre.isError
      ? {
          kind: "error",
          title: "Roster non caricato",
          description:
            "Non è stato possibile leggere le squadre della sede. Nessun dato è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => squadre.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : list.length === 0
        ? {
            kind: "empty",
            title: "Nessuna squadra registrata",
            description: puoModificare
              ? "Registra la prima squadra di posa per assegnarle interventi e commesse."
              : "Quando la direzione registrerà una squadra la troverai qui.",
            action: puoModificare ? (
              <Button type="button" className="min-h-11" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Nuova squadra
              </Button>
            ) : undefined,
          }
        : undefined;

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5">
      <PageHeader
        eyebrow="Operatività"
        title={
          <span className="inline-flex items-center gap-2">
            <HardHat className="h-6 w-6 text-primary" aria-hidden="true" />
            Squadre di posa
          </span>
        }
        description="Chi è in cantiere e su quali commesse. Il roster è in lettura per tutta la sede."
        busy={squadre.isFetching}
        metadata={
          <>
            {/* Un conteggio che non conosciamo non si mostra come zero. */}
            {squadre.isPending ? (
              <span>Conteggio squadre in caricamento…</span>
            ) : squadre.isError ? (
              <span>Conteggio squadre non disponibile</span>
            ) : (
              <span>
                <strong className="tabular-nums text-text-1">
                  {list.length}
                </strong>{" "}
                {list.length === 1 ? "squadra attiva" : "squadre attive"}
              </span>
            )}
            {squadre.isFetching && !squadre.isPending ? (
              <span role="status">Aggiornamento in corso…</span>
            ) : null}
          </>
        }
        primaryAction={
          puoModificare ? (
            <Button type="button" className="min-h-11" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Nuova squadra
            </Button>
          ) : (
            <p className="text-sm text-text-3">
              Gestione squadre riservata alla direzione.
            </p>
          )
        }
      />

      <section className="min-w-0" aria-label="Roster squadre">
        <DataSurface
          density="comfortable"
          tone="sunken"
          state={statoSuperficie}
          toolbar={
            caricoInErrore ? (
              <p
                role="status"
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2"
              >
                Interventi e commesse non caricati: il carico delle squadre non
                è mostrato.
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  onClick={() => {
                    if (interventi.isError) interventi.refetch();
                    if (commesse.isError) commesse.refetch();
                  }}
                >
                  Riprova
                </Button>
              </p>
            ) : null
          }
        >
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((s: any) => (
              <SquadraRosterCard
                key={s.id}
                squadra={s}
                interventiAttivi={interventiPerSquadra.get(s.id) ?? []}
                commesseAttive={commessePerSquadra.get(s.id) ?? []}
                canManage={puoModificare}
                caricoNoto={caricoNoto}
                onEdit={openEdit}
                onDelete={chiediEliminazione}
                onOpenCommessa={id => setLocation(`/commesse/${id}`)}
              />
            ))}
          </div>
        </DataSurface>
      </section>

      {/* Gestione: montata solo per la direzione, come `adminProcedure`. */}
      {puoModificare ? (
        <>
          <Dialog
            open={dialogOpen}
            onOpenChange={open => {
              setDialogOpen(open);
              if (!open) {
                setEditId(null);
                resetForm();
              }
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editId ? "Modifica squadra" : "Nuova squadra"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="squadra-nome">Nome squadra *</Label>
                  <Input
                    id="squadra-nome"
                    value={form.nome}
                    onChange={e => setForm({ ...form, nome: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="squadra-caposquadra">Caposquadra</Label>
                    <Input
                      id="squadra-caposquadra"
                      value={form.caposquadra}
                      onChange={e =>
                        setForm({ ...form, caposquadra: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="squadra-telefono">Telefono</Label>
                    <Input
                      id="squadra-telefono"
                      inputMode="tel"
                      value={form.telefono}
                      onChange={e =>
                        setForm({ ...form, telefono: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="squadra-note">Note</Label>
                  <Textarea
                    id="squadra-note"
                    rows={2}
                    value={form.note}
                    onChange={e => setForm({ ...form, note: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  className="min-h-12 sm:min-h-11"
                  onClick={handleSave}
                  disabled={
                    !form.nome ||
                    createSquadra.isPending ||
                    updateSquadra.isPending
                  }
                >
                  {editId ? "Aggiorna" : "Crea squadra"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={!!deleteTarget}
            onOpenChange={(o: boolean) => !o && setDeleteTarget(null)}
            title="Elimina squadra"
            description={`Eliminare "${deleteTarget?.label}"? Questa azione non può essere annullata.`}
            confirmLabel="Elimina squadra"
            busy={deleteSquadra.isPending}
            onConfirm={() =>
              deleteTarget && deleteSquadra.mutate(deleteTarget.id)
            }
          />
        </>
      ) : null}
    </div>
  );
}
