import { useMemo, useState } from "react";
import { statoChipClass } from "@/lib/stato";
import { useLocation } from "wouter";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Calendar,
  Info,
  MapPin,
  Search,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import ConfirmDialog from "@/components/ConfirmDialog";

// Badge stato: unica fonte lib/stato (statoChipClass).
//
// In archivio finiscono le due forme di «archiviata» (10/09/2026): il
// soft-archive `archivedAt`, ortogonale allo stato e reversibile senza
// toccarlo, e lo stato terminale «archiviata», che il board toglie comunque
// dalle colonne. Il ripristino le distingue: la prima torna com'era, la
// seconda riapre la commessa a «Interventi / Regolazioni».

export default function Archivio() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<{
    id: number;
    label: string;
    /** Chiusa dal board (stato «archiviata»): il ripristino la riapre. */
    chiusa: boolean;
  } | null>(null);

  const list = trpc.commesse.list.useQuery({ archived: "only" });
  const clientiArch = trpc.clienti.list.useQuery({ archived: "only" });
  const utils = trpc.useUtils();
  const restore = trpc.commesse.restore.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setRestoreTarget(null);
      toast.success("Commessa ripristinata");
    },
    // Riaprire una commessa chiusa chiede `commessa.change_state`: se
    // manca, l'errore va detto invece di lasciare il dialog appeso.
    onError: e => toast.error(e.message ?? "Ripristino non riuscito"),
  });
  const restoreCliente = trpc.clienti.restore.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      utils.commesse.invalidate();
      toast.success("Cliente ripristinato (con le sue commesse)");
    },
    onError: e => toast.error(e.message ?? "Ripristino non riuscito"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!q) return all;
    return all.filter(
      c =>
        c.codice.toLowerCase().includes(q) ||
        c.cliente.toLowerCase().includes(q) ||
        c.citta?.toLowerCase().includes(q) ||
        c.indirizzo?.toLowerCase().includes(q)
    );
  }, [list.data, search]);

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5">
      <PageHeader
        eyebrow="Commesse"
        title="Archivio"
        description="Commesse archiviate a mano e commesse chiuse dal board: restano complete di dati, file e storico, e da qui si ripristinano."
        metadata={<span>{list.data?.length ?? 0} commesse archiviate</span>}
      />

      <DataSurface density="compact" tone="sunken">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cerca per codice, cliente, città…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </DataSurface>

      {/* Clienti archiviati */}
      {(clientiArch.data?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Clienti archiviati ({clientiArch.data?.length ?? 0})
          </h2>
          <div className="grid grid-cols-1 gap-2">
            {(clientiArch.data ?? []).map((cl: any) => (
              <Card key={cl.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => setLocation(`/clienti/${cl.id}`)}
                  >
                    <p className="font-semibold leading-tight truncate">
                      {`${cl.cognome ?? ""} ${cl.nome ?? ""}`.trim() ||
                        cl.email ||
                        "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cl.commesseIds?.length ?? 0} commesse · archiviato{" "}
                      {cl.archivedAt
                        ? new Date(cl.archivedAt).toLocaleDateString("it-IT")
                        : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restoreCliente.mutate(cl.id)}
                    disabled={restoreCliente.isPending}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
                    Ripristina
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <DataSurface
        density="comfortable"
        tone="default"
        title="Commesse archiviate"
        description="L'archivio è separato dal Board e dal Planning, senza cancellare lo storico."
        state={
          list.isLoading
            ? {
                kind: "loading",
                title: "Caricamento archivio",
                description: "Sto preparando le commesse archiviate.",
                rows: 4,
              }
            : filtered.length === 0
              ? {
                  kind: "empty",
                  title: search
                    ? "Nessun risultato"
                    : "Nessuna commessa archiviata",
                  description: search
                    ? "Prova a cercare per codice, cliente, città o indirizzo."
                    : "Le commesse archiviate appariranno qui senza perdere il loro storico.",
                }
              : undefined
        }
      >
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((c: any) => (
            <Card
              key={c.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setLocation(`/commesse/${c.id}`)}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">
                        {c.codice}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] uppercase ${statoChipClass(
                          c.stato
                        )}`}
                      >
                        {c.stato.replace(/_/g, " ")}
                      </Badge>
                      {c.priorita === "urgente" && (
                        <Badge variant="destructive" className="text-[10px]">
                          URGENTE
                        </Badge>
                      )}
                    </div>
                    <p className="font-semibold leading-tight">
                      {c.cliente || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {c.indirizzo && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {c.indirizzo}
                          {c.citta ? `, ${c.citta}` : ""}
                        </span>
                      )}
                      {c.dataApertura && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Aperta:{" "}
                          {new Date(c.dataApertura).toLocaleDateString("it-IT")}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Archive className="h-3 w-3" />
                        {c.archivedAt
                          ? `Archiviata: ${new Date(
                              c.archivedAt
                            ).toLocaleDateString("it-IT")}`
                          : c.dataChiusura
                            ? `Chiusa: ${new Date(
                                `${c.dataChiusura}T12:00:00`
                              ).toLocaleDateString("it-IT")}`
                            : "Chiusa dal board"}
                      </span>
                      {c.assegnatoA && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          Assegnata
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setRestoreTarget({
                          id: c.id,
                          label: c.codice,
                          chiusa: c.stato === "archiviata",
                        })
                      }
                      disabled={restore.isPending}
                    >
                      <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
                      Ripristina
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLocation(`/commesse/${c.id}`)}
                      title="Apri scheda"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DataSurface>

      {/* Info footer */}
      {filtered.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-snug">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Qui stanno sia le commesse archiviate a mano sia quelle chiuse dal
          board: in entrambi i casi restano fuori da liste, board e planning
          senza perdere dati. Il ripristino riporta le prime allo stato che
          avevano e riapre le seconde a «Interventi / Regolazioni».
        </p>
      )}

      {/* Restore confirmation */}
      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={open => !open && setRestoreTarget(null)}
        title="Ripristinare la commessa?"
        description={
          restoreTarget?.chiusa
            ? `La commessa "${restoreTarget.label}" è chiusa: verrà riaperta a «Interventi / Regolazioni» e tornerà sul board. La data di chiusura viene azzerata; il passaggio resta a registro.`
            : `La commessa "${restoreTarget?.label}" tornerà attiva e ricomparirà in liste, board e planning con stato e dati invariati.`
        }
        destructive={false}
        confirmLabel="Ripristina"
        onConfirm={() => {
          if (!restoreTarget) return;
          restore.mutate(restoreTarget.id);
        }}
      />
    </div>
  );
}
