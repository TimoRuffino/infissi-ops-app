import { useMemo, useState } from "react";
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
import ConfirmDialog from "@/components/ConfirmDialog";

// Colore per badge stato — copiato dal sidebar di CommesseList per coerenza
// visiva. Deliberatamente senza "archiviata" perché qui `stato` è quello
// ORIGINALE preservato (il soft-archive è ortogonale allo stato).
const statoColors: Record<string, string> = {
  preventivo: "bg-slate-100 text-slate-700",
  misure_esecutive: "bg-blue-100 text-blue-800",
  aggiornamento_contratto: "bg-cyan-100 text-cyan-800",
  fatture_pagamento: "bg-amber-100 text-amber-800",
  da_ordinare: "bg-yellow-100 text-yellow-800",
  produzione: "bg-indigo-100 text-indigo-800",
  ordini_ultimazione: "bg-purple-100 text-purple-800",
  attesa_posa: "bg-orange-100 text-orange-800",
  finiture_saldo: "bg-green-100 text-green-800",
  interventi_regolazioni: "bg-teal-100 text-teal-800",
  archiviata: "bg-gray-100 text-gray-600",
};

export default function Archivio() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<
    { id: number; label: string } | null
  >(null);

  const list = trpc.commesse.list.useQuery({ archived: "only" });
  const utils = trpc.useUtils();
  const restore = trpc.commesse.restore.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setRestoreTarget(null);
      toast.success("Commessa ripristinata");
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!q) return all;
    return all.filter(
      (c) =>
        c.codice.toLowerCase().includes(q) ||
        c.cliente.toLowerCase().includes(q) ||
        c.citta?.toLowerCase().includes(q) ||
        c.indirizzo?.toLowerCase().includes(q)
    );
  }, [list.data, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Archive className="h-6 w-6 text-primary" />
            Archivio commesse
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Commesse archiviate quando il cliente non procede con il lavoro. I
            dati, i file e lo stato di avanzamento sono preservati: in qualsiasi
            momento puoi ripristinare la commessa e farla tornare attiva.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {list.data?.length ?? 0} archiviate
          </Badge>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Cerca per codice, cliente, città…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Lista */}
      {list.isLoading && (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      )}
      {!list.isLoading && filtered.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-2">
            <Archive className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {search
                ? "Nessuna commessa archiviata corrisponde alla ricerca."
                : "Nessuna commessa archiviata. Le commesse che archivi da qui in avanti appariranno qui."}
            </p>
          </CardContent>
        </Card>
      )}

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
                      className={`text-[10px] uppercase ${
                        statoColors[c.stato] ?? ""
                      }`}
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
                    {c.cliente || <span className="text-muted-foreground">—</span>}
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
                    {c.archivedAt && (
                      <span className="flex items-center gap-1">
                        <Archive className="h-3 w-3" />
                        Archiviata:{" "}
                        {new Date(c.archivedAt).toLocaleDateString("it-IT")}
                      </span>
                    )}
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
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRestoreTarget({ id: c.id, label: c.codice })
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

      {/* Info footer */}
      {filtered.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-snug">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Archiviare una commessa la nasconde da liste, board e planning senza
          perdere dati. Il ripristino la riporta attiva con lo stato di
          avanzamento invariato.
        </p>
      )}

      {/* Restore confirmation */}
      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title="Ripristinare la commessa?"
        description={`La commessa "${restoreTarget?.label}" tornerà attiva e ricomparirà in liste, board e planning con stato e dati invariati.`}
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
