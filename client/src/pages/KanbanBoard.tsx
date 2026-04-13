import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Calendar, AlertTriangle, ChevronRight, ChevronLeft } from "lucide-react";
import { useLocation } from "wouter";

const COLONNE = [
  { id: "preventivo", label: "Preventivo", color: "bg-slate-500" },
  { id: "misure_esecutive", label: "Misure Esecutive", color: "bg-blue-500" },
  { id: "aggiornamento_contratto", label: "Agg. Contratto", color: "bg-cyan-500" },
  { id: "fatture_pagamento", label: "Fatture / Pagamento", color: "bg-amber-500" },
  { id: "da_ordinare", label: "Da Ordinare", color: "bg-yellow-500" },
  { id: "produzione", label: "Produzione", color: "bg-indigo-500" },
  { id: "ordini_ultimazione", label: "Ordini Ultimaz.", color: "bg-purple-500" },
  { id: "attesa_posa", label: "Attesa Posa", color: "bg-orange-500" },
  { id: "finiture_saldo", label: "Finiture / Saldo", color: "bg-green-500" },
  { id: "interventi_regolazioni", label: "Interventi / Regolaz.", color: "bg-teal-500" },
] as const;

const prioritaColors: Record<string, string> = {
  urgente: "bg-red-100 text-red-800",
  alta: "bg-orange-100 text-orange-800",
  media: "bg-gray-100 text-gray-700",
  bassa: "bg-gray-50 text-gray-500",
};

export default function KanbanBoard() {
  const [, setLocation] = useLocation();
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  const updateCommessa = trpc.commesse.update.useMutation({
    onSuccess: () => utils.commesse.invalidate(),
  });

  function getCommesseByStato(stato: string) {
    return commesse.data?.filter((c: any) => c.stato === stato) ?? [];
  }

  function handleMove(commessaId: number, newStato: string) {
    updateCommessa.mutate({ id: commessaId, stato: newStato as any });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Board Commesse</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Stato avanzamento — avanza o arretra le commesse
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {COLONNE.map((col, colIdx) => {
          const items = getCommesseByStato(col.id);
          const prevStato = colIdx > 0 ? COLONNE[colIdx - 1].id : null;
          const nextStato = colIdx < COLONNE.length - 1 ? COLONNE[colIdx + 1].id : null;

          return (
            <div key={col.id} className="min-w-0">
              {/* Column header */}
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <div className={`w-2 h-2 rounded-full shrink-0 ${col.color}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wide truncate">
                  {col.label}
                </span>
                <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">
                  {items.length}
                </Badge>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-[120px] bg-muted/30 rounded-lg p-1.5">
                {items.map((c: any) => (
                  <Card
                    key={c.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setLocation(`/commesse/${c.id}`)}
                  >
                    <CardContent className="p-2 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[9px] text-muted-foreground truncate">
                          {c.codice}
                        </span>
                        {(c.priorita === "urgente" || c.priorita === "alta") && (
                          <Badge className={`text-[8px] px-1 py-0 shrink-0 ${prioritaColors[c.priorita]}`}>
                            {c.priorita === "urgente" && <AlertTriangle className="h-2 w-2 mr-0.5" />}
                            {c.priorita.toUpperCase()}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] font-semibold leading-tight truncate">{c.cliente}</p>
                      {c.citta && (
                        <p className="text-[9px] text-muted-foreground flex items-center gap-0.5 truncate">
                          <MapPin className="h-2 w-2 shrink-0" /> {c.citta}
                        </p>
                      )}
                      {c.dataConsegnaPrevista && (
                        <p className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                          <Calendar className="h-2 w-2 shrink-0" /> {c.dataConsegnaPrevista}
                        </p>
                      )}
                      {/* Move buttons */}
                      <div className="flex gap-1 mt-1">
                        {prevStato && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 flex-1 text-[9px] px-1 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMove(c.id, prevStato);
                            }}
                          >
                            <ChevronLeft className="h-3 w-3" />
                            Indietro
                          </Button>
                        )}
                        {nextStato && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 flex-1 text-[9px] px-1 text-primary hover:bg-primary/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMove(c.id, nextStato);
                            }}
                          >
                            Avanza
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {items.length === 0 && (
                  <p className="text-[9px] text-muted-foreground text-center py-4">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
