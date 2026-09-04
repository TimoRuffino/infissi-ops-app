// La nota di credito di una fattura emessa: totale (specchio dell'origine)
// o parziale (righe scelte, importo per riga). Il dialog raccoglie la
// selezione e il motivo; a creare la nota è il server, che ricalcola righe
// derivate, riepilogo IVA e scadenza (v. server/fatture/notaCredito.ts).
import { useEffect, useMemo, useState } from "react";

import type { Fattura, RigaFattura } from "@shared/fatturazione/tipi";
import {
  formatEuro,
  formatEuroSimbolo,
  parseEuroNonNegativo,
} from "@/lib/euro";
import { formatCent } from "@/lib/limitiView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

/** Stessa forma dell'input del router `fatture.notaCredito`. */
export type SelezioneNotaCredito =
  | { tipo: "totale" }
  | { tipo: "parziale"; righe: Array<{ ordine: number; importoCent: number }> };

/** Le righe che il server accetta di stornare una per una (`TIPI_SELEZIONABILI`). */
const TIPI_STORNABILI: ReadonlySet<RigaFattura["tipo"]> = new Set([
  "bene",
  "servizio",
  "markup",
]);

export default function NotaCreditoDialog({
  open,
  onOpenChange,
  fattura,
  inCorso = false,
  onConferma,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fattura: Fattura;
  inCorso?: boolean;
  onConferma: (selezione: SelezioneNotaCredito, motivo: string) => void;
}) {
  const [tipo, setTipo] = useState<"totale" | "parziale">("totale");
  const [scelte, setScelte] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState("");

  const stornabili = useMemo(
    () =>
      fattura.righe.filter(
        r => TIPI_STORNABILI.has(r.tipo) && r.importoCent > 0
      ),
    [fattura.righe]
  );

  // Ogni apertura riparte pulita: una selezione rimasta da un tentativo
  // precedente stornerebbe righe che l'operatore non sta guardando.
  useEffect(() => {
    if (!open) return;
    setTipo("totale");
    setScelte({});
    setMotivo("");
  }, [open]);

  const righeSelezionate = Object.entries(scelte).map(([ordine, testo]) => {
    const euro = parseEuroNonNegativo(testo);
    return {
      ordine: Number(ordine),
      importoCent: euro == null ? 0 : Math.round(euro * 100),
    };
  });
  const totaleSelezionatoCent = righeSelezionate.reduce(
    (s, r) => s + r.importoCent,
    0
  );
  const parzialeValida =
    righeSelezionate.length > 0 &&
    righeSelezionate.every(r => {
      const origine = stornabili.find(x => x.ordine === r.ordine);
      return (
        origine != null &&
        r.importoCent > 0 &&
        r.importoCent <= origine.importoCent
      );
    });

  const attiva = (r: RigaFattura, acceso: boolean) =>
    setScelte(prev => {
      const resto = { ...prev };
      if (acceso) resto[r.ordine] = formatEuro(r.importoCent / 100);
      else delete resto[r.ordine];
      return resto;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Nota di credito sulla fattura {fattura.numero ?? `#${fattura.id}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <RadioGroup
            aria-label="Cosa stornare"
            value={tipo}
            onValueChange={v => setTipo(v as "totale" | "parziale")}
            className="gap-2"
          >
            <Label className="flex items-start gap-2 text-sm">
              <RadioGroupItem
                value="totale"
                id="nc-totale"
                className="mt-0.5"
              />
              <span className="min-w-0">
                Totale — storna tutta la fattura (
                {formatCent(fattura.totaleCent)})
              </span>
            </Label>
            <Label className="flex items-start gap-2 text-sm">
              <RadioGroupItem
                value="parziale"
                id="nc-parziale"
                className="mt-0.5"
              />
              <span className="min-w-0">
                Parziale — scegli le righe e gli importi
              </span>
            </Label>
          </RadioGroup>

          {tipo === "parziale" && (
            <div className="space-y-2 min-w-0">
              {stornabili.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nessuna riga stornabile singolarmente in questa fattura.
                </p>
              )}
              {stornabili.map(r => {
                const acceso = scelte[r.ordine] !== undefined;
                return (
                  <div
                    key={r.ordine}
                    className="grid grid-cols-[1.5rem_minmax(0,1fr)_7rem] items-center gap-2 text-sm min-w-0"
                  >
                    <Checkbox
                      id={`nc-riga-${r.ordine}`}
                      checked={acceso}
                      aria-label={`Storna ${r.descrizione}`}
                      onCheckedChange={v => attiva(r, v === true)}
                    />
                    <Label
                      htmlFor={`nc-riga-${r.ordine}`}
                      className="min-w-0 font-normal"
                    >
                      <span className="block truncate">{r.descrizione}</span>
                      <span className="text-xs text-text-3 tabular-nums">
                        originale {formatCent(r.importoCent)}
                      </span>
                    </Label>
                    <Input
                      inputMode="decimal"
                      className="h-9 text-right tabular-nums"
                      aria-label={`Importo da stornare per ${r.descrizione}`}
                      value={scelte[r.ordine] ?? ""}
                      disabled={!acceso}
                      onChange={e =>
                        setScelte(prev => ({
                          ...prev,
                          [r.ordine]: e.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
              {righeSelezionate.length > 0 && (
                <p
                  className={`text-xs tabular-nums ${parzialeValida ? "text-text-2" : "text-danger"}`}
                  aria-live="polite"
                >
                  {parzialeValida
                    ? `Imponibile da stornare: ${formatEuroSimbolo(totaleSelezionatoCent / 100)} (l'IVA la ricalcola il server)`
                    : "Ogni importo deve essere maggiore di zero e non superiore all'originale."}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="nc-motivo" className="text-xs text-text-3">
              Motivo (finisce nell'intestazione della nota)
            </Label>
            <Textarea
              id="nc-motivo"
              rows={2}
              maxLength={300}
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Es. storno per rinuncia alla posa del serramento 4"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row">
          <Button
            variant="outline"
            className="h-11 sm:h-10"
            disabled={inCorso}
            onClick={() => onOpenChange(false)}
          >
            Annulla
          </Button>
          <Button
            className="h-11 sm:h-10"
            disabled={inCorso || (tipo === "parziale" && !parzialeValida)}
            onClick={() =>
              onConferma(
                tipo === "totale"
                  ? { tipo: "totale" }
                  : { tipo: "parziale", righe: righeSelezionate },
                motivo
              )
            }
          >
            {inCorso ? "Creazione…" : "Crea la nota di credito"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
