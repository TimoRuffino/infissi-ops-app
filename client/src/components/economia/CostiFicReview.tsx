import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const CLASSI = [
  ["fisso", "Fisso"],
  ["variabile_commessa", "Variabile commessa"],
  ["straordinario", "Straordinario"],
  ["dubbio", "Dubbio"],
] as const;

function RigaCosto({ costo }: { costo: any }) {
  const utils = trpc.useUtils();
  const [classificazione, setClassificazione] = useState(costo.classificazione);
  const [ricorda, setRicorda] = useState(false);
  const mutation = trpc.ficCosti.riclassifica.useMutation({
    onSuccess: () => {
      utils.ficCosti.invalidate();
      utils.economia.invalidate();
      toast.success("Classificazione aggiornata");
    },
    onError: error => toast.error(error.message),
  });
  const modificata = classificazione !== costo.classificazione || ricorda;

  const editor = (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <Select value={classificazione} onValueChange={setClassificazione}>
        <SelectTrigger
          className="h-10 min-w-0 sm:w-[190px]"
          aria-label="Classificazione costo"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CLASSI.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex min-h-10 items-center gap-2 text-xs text-text-2">
        <Checkbox
          checked={ricorda}
          onCheckedChange={value => setRicorda(value === true)}
        />
        Ricorda regola
      </label>
      <Button
        size="icon"
        variant={modificata ? "default" : "outline"}
        className="h-10 w-10 shrink-0"
        disabled={!modificata || mutation.isPending}
        aria-label="Salva classificazione"
        onClick={() =>
          mutation.mutate({ id: costo.id, classificazione, ricorda })
        }
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
      </Button>
    </div>
  );

  return (
    <>
      <tr className="hidden border-t md:table-row">
        <td className="px-3 py-3">
          <p className="font-medium">{costo.fornitoreNome}</p>
          <p className="max-w-[320px] truncate text-xs text-text-3">
            {costo.descrizione || "Nessuna descrizione"}
          </p>
        </td>
        <td className="px-3 py-3 text-sm text-text-2">
          {costo.categoriaFic || "—"}
        </td>
        <td className="px-3 py-3 text-right font-semibold tabular-nums">
          {formatEuroSimbolo(costo.importoNetto)}
        </td>
        <td className="px-3 py-3 text-sm tabular-nums text-text-2">
          {new Date(`${costo.data}T12:00:00`).toLocaleDateString("it-IT")}
        </td>
        <td className="px-3 py-3">{editor}</td>
      </tr>
      <tr className="border-t md:hidden">
        <td colSpan={5} className="space-y-3 px-3 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {costo.fornitoreNome}
              </p>
              <p className="text-xs text-text-3">
                {costo.categoriaFic || "Senza categoria"}
              </p>
            </div>
            <p className="shrink-0 font-bold tabular-nums">
              {formatEuroSimbolo(costo.importoNetto)}
            </p>
          </div>
          {costo.descrizione && (
            <p className="text-xs text-text-2">{costo.descrizione}</p>
          )}
          {editor}
        </td>
      </tr>
    </>
  );
}

export default function CostiFicReview({ anno }: { anno: number }) {
  const [soloDubbi, setSoloDubbi] = useState(true);
  const query = trpc.ficCosti.list.useQuery({
    anno,
    classificazione: soloDubbi ? "dubbio" : undefined,
  });
  const rows = query.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Acquisti e costi FiC</h2>
          <p className="text-xs text-text-3">
            Tars classifica automaticamente; conferma soltanto i casi dubbi.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={rows.length > 0 && soloDubbi ? "warning" : "outline"}>
            {rows.length} {soloDubbi ? "da rivedere" : "documenti"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="min-h-10"
            onClick={() => setSoloDubbi(value => !value)}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {soloDubbi ? "Mostra tutti" : "Solo dubbi"}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {query.isLoading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-text-3" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-3">
            {soloDubbi
              ? "Nessun costo dubbio: il calcolo non richiede revisioni."
              : "Nessun documento ricevuto sincronizzato per questo anno."}
          </div>
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead className="hidden bg-surface-2 text-xs text-text-3 md:table-header-group">
              <tr>
                <th className="w-[29%] px-3 py-2 text-left font-medium">
                  Fornitore
                </th>
                <th className="w-[15%] px-3 py-2 text-left font-medium">
                  Categoria
                </th>
                <th className="w-[12%] px-3 py-2 text-right font-medium">
                  Netto
                </th>
                <th className="w-[12%] px-3 py-2 text-left font-medium">
                  Data
                </th>
                <th className="w-[32%] px-3 py-2 text-left font-medium">
                  Classificazione
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(costo => (
                <RigaCosto key={costo.id} costo={costo} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
