// Dialog «Correggi la voce» del tab Limiti (08/09/2026, «devo poter
// modificare i limiti dal gestionale»): quantità, prezzo unitario, limite
// forzato, inclusione nei totali e motivo — le celle che l'ufficio ritocca
// a mano nelle copie del foglio. Il dialog raccoglie e basta: a ricalcolare è
// il server (`computo.correggiVoce`), che salva la correzione nel contratto e
// rifà il computo. Un campo lasciato uguale al calcolato non è una
// correzione: si manda `null`, e se non resta nulla la correzione si toglie.
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { VoceComputo } from "@shared/limiti/tipi";
import { formatEuro, parseEuroNonNegativo } from "@/lib/euro";
import { correzioneDi, formatCent } from "@/lib/limitiView";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const numeroIt = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 4, useGrouping: false });
const unitaDi = (v: VoceComputo) => (v.unita === "€/mq" ? "mq" : v.unita);
/** Uguali a meno del rumore decimale: una quantità riscritta identica non è una correzione. */
const stessoNumero = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export default function CorreggiVoceDialog({
  commessaId,
  voce,
  onOpenChange,
  onSalvata,
}: {
  commessaId: number;
  /** La voce aperta; `null` = dialog chiuso. */
  voce: VoceComputo | null;
  onOpenChange: (aperto: boolean) => void;
  /** Il computo è stato rifatto: chi monta rilegga lo stato dei passi. */
  onSalvata: () => void;
}) {
  const utils = trpc.useUtils();
  const [quantita, setQuantita] = useState("");
  const [prezzo, setPrezzo] = useState("");
  const [limite, setLimite] = useState("");
  const [inclusa, setInclusa] = useState(true);
  const [motivo, setMotivo] = useState("");

  const correzione = voce ? correzioneDi(voce) : null;
  // I valori del motore: quelli della voce oppure, se è già corretta, quelli
  // che il motore ha conservato nel dettaglio.
  const calcolata = voce
    ? {
        quantita: correzione?.quantitaCalcolata ?? voce.quantita,
        prezzoUnitCent: correzione?.prezzoCalcolatoCent ?? voce.prezzoUnitCent,
        limiteCent: correzione?.limiteCalcolatoCent ?? voce.limiteCent,
        inclusa: correzione?.inclusaCalcolata ?? voce.inclusa,
      }
    : null;

  // Precompilazione a ogni apertura con i valori correnti della voce (già
  // corretti, se lo sono): il limite forzato solo se lo era davvero.
  useEffect(() => {
    if (!voce) return;
    const c = correzioneDi(voce);
    setQuantita(numeroIt(voce.quantita));
    setPrezzo(formatEuro(voce.prezzoUnitCent / 100));
    setLimite(c?.limiteForzato ? formatEuro(voce.limiteCent / 100) : "");
    setInclusa(voce.inclusa);
    setMotivo(c && c.motivo !== "corretta a mano" ? c.motivo : "");
  }, [voce]);

  const correggi = trpc.computo.correggiVoce.useMutation({
    onSuccess: (_esito, variabili) => {
      void utils.computo.ultimo.invalidate({ commessaId });
      toast.success(variabili.correzione ? "Voce corretta: limiti ricalcolati" : "Correzione tolta: limiti ricalcolati");
      onOpenChange(false);
      onSalvata();
    },
    onError: e => toast.error(e.message),
  });

  function salva(): void {
    if (!voce || !calcolata) return;
    const q = parseEuroNonNegativo(quantita);
    const p = parseEuroNonNegativo(prezzo);
    const l = limite.trim() ? parseEuroNonNegativo(limite) : null;
    if (q == null) {
      toast.error("Quantità non valida: un numero, con la virgola per i decimali.");
      return;
    }
    if (p == null) {
      toast.error("Prezzo unitario non valido.");
      return;
    }
    if (limite.trim() && l == null) {
      toast.error("Limite forzato non valido: lascialo vuoto per ricalcolarlo da quantità × prezzo.");
      return;
    }
    const prezzoCent = Math.round(p * 100);
    const nuova = {
      quantita: stessoNumero(q, calcolata.quantita) ? null : q,
      prezzoUnitCent: prezzoCent === calcolata.prezzoUnitCent ? null : prezzoCent,
      limiteCent: l == null ? null : Math.round(l * 100),
      inclusa: inclusa === calcolata.inclusa ? null : inclusa,
      motivo: motivo.trim() || null,
    };
    const vuota =
      nuova.quantita == null && nuova.prezzoUnitCent == null && nuova.limiteCent == null && nuova.inclusa == null;
    correggi.mutate({ commessaId, codice: voce.codice, correzione: vuota ? null : nuova });
  }

  return (
    <Dialog open={voce != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correggi la voce</DialogTitle>
          <DialogDescription>
            {voce?.descrizione}
            {voce?.codiceDei ? ` · ${voce.codiceDei}` : ""}
          </DialogDescription>
        </DialogHeader>

        {voce && calcolata && (
          <div className="space-y-3">
            <p className="text-xs text-text-2">
              Calcolato dal motore: {numeroIt(calcolata.quantita)} {unitaDi(voce)} ×{" "}
              {formatCent(calcolata.prezzoUnitCent)} ={" "}
              <span className="font-semibold tabular-nums">{formatCent(calcolata.limiteCent)}</span>
              {calcolata.inclusa ? "" : " (non inclusa)"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="correzione-quantita">Quantità ({unitaDi(voce)})</Label>
                <Input
                  id="correzione-quantita"
                  inputMode="decimal"
                  className="min-h-11 tabular-nums"
                  value={quantita}
                  onChange={e => setQuantita(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="correzione-prezzo">Prezzo unitario (€)</Label>
                <Input
                  id="correzione-prezzo"
                  inputMode="decimal"
                  className="min-h-11 tabular-nums"
                  value={prezzo}
                  onChange={e => setPrezzo(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="correzione-limite">Limite forzato (€)</Label>
              <Input
                id="correzione-limite"
                inputMode="decimal"
                className="min-h-11 tabular-nums"
                placeholder="vuoto = quantità × prezzo"
                value={limite}
                onChange={e => setLimite(e.target.value)}
              />
              <p className="text-xs text-text-3">Se lo scrivi, vince su quantità e prezzo.</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="correzione-inclusa" checked={inclusa} onCheckedChange={setInclusa} />
              <Label htmlFor="correzione-inclusa">Inclusa nei totali</Label>
            </div>
            <div className="space-y-1">
              <Label htmlFor="correzione-motivo">Motivo</Label>
              <Textarea
                id="correzione-motivo"
                rows={2}
                maxLength={200}
                placeholder="Perché il numero cambia: resta nel computo e nella stampa"
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row">
          {correzione && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 sm:mr-auto"
              disabled={correggi.isPending}
              onClick={() => voce && correggi.mutate({ commessaId, codice: voce.codice, correzione: null })}
            >
              Ripristina il calcolo
            </Button>
          )}
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button type="button" className="min-h-11" disabled={correggi.isPending} onClick={salva}>
            {correggi.isPending ? "Salvo…" : "Salva la correzione"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
