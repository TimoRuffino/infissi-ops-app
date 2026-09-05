// Editor di una riga del contratto strutturato: categoria, voce DEI,
// misure, prezzo, oscurante integrato e accessori. Non chiama nulla e non
// decide nulla: riceve la riga e restituisce le modifiche al chiamante, che
// le manda al servizio. Il catalogo arriva dal server (contratti.catalogo):
// qui si sceglie soltanto tra le voci compatibili con la riga.
import { useMemo, useState } from "react";
import { Trash2, X } from "lucide-react";
import { formatEuro, parseEuroNonNegativo } from "@/lib/euro";
import {
  accessoriCompatibili,
  accessoriDisponibili,
  beneSignificativoDefault,
  etichettaAccessorio,
  etichettaCategoria,
  etichettaTipologia,
  mqRigaForm,
  opzioniTipologia,
  prodottiPerOscurante,
  quantitaAccessorioModificabile,
  type CatalogoContratto,
  type ProdottoCatalogo,
  type RigaForm,
} from "@/lib/contrattoView";
import {
  CATEGORIE_RIGA,
  OSCURANTI_INTEGRATI,
  gruppoPerCategoria,
  type CategoriaRiga,
  type OscuranteIntegrato,
  type ZonaClimatica,
} from "@shared/limiti/tipi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * L'oscurante integrato si vende insieme al serramento o al cassonetto
 * abbinato (H7, blocco B del foglio: il cassonetto pesa nel massimale B
 * invece che in A). Sulle altre voci non ha senso: un oscurante venduto da
 * solo è già la sua riga.
 */
const CON_OSCURANTE_ABBINATO = new Set<CategoriaRiga>([
  "serramento_pvc",
  "serramento_alluminio",
  "serramento_legno",
  "serramento_legno_alluminio",
  "cassonetto",
]);

const ETICHETTA_OSCURANTE: Record<OscuranteIntegrato, string> = {
  tapparella: "Tapparella",
  persiana: "Persiana",
  scuro: "Scuro",
};

export default function RigaContrattoEditor({
  riga,
  indice,
  puoModificare,
  zona,
  catalogo,
  onChange,
  onRimuovi,
}: {
  riga: RigaForm;
  indice: number;
  puoModificare: boolean;
  zona: ZonaClimatica | null;
  catalogo: CatalogoContratto;
  onChange: (patch: Partial<RigaForm>) => void;
  onRimuovi: () => void;
}) {
  const n = indice + 1;
  // Il prezzo si digita a mano: il testo resta quello scritto finché non si
  // esce dal campo, il valore in centesimi segue solo quando è leggibile.
  const [prezzoTesto, setPrezzoTesto] = useState(() =>
    riga.prezzoTotCent == null ? "" : formatEuro(riga.prezzoTotCent / 100)
  );

  // La voce già scelta resta sempre nell'elenco, anche se fuori zona o di
  // un'altra categoria: nasconderla lascerebbe un Select vuoto su un dato
  // che invece è salvato (v. opzioniTipologia).
  const opzioni = useMemo(
    () => opzioniTipologia(catalogo.prodotti, riga.categoria, zona, riga.tipologia),
    [catalogo.prodotti, riga.categoria, zona, riga.tipologia]
  );
  const senzaGruppoDei = gruppoPerCategoria(riga.categoria).gruppo === null;
  const trovaProdotto = (codice: string | null): ProdottoCatalogo | null =>
    codice ? (catalogo.prodotti.find(p => p.codice === codice) ?? null) : null;
  const prodottoRiga = trovaProdotto(riga.tipologia);
  const prodottiOscurante = useMemo(
    () => (riga.oscuranteIntegrato ? prodottiPerOscurante(catalogo.prodotti, riga.oscuranteIntegrato) : []),
    [catalogo.prodotti, riga.oscuranteIntegrato]
  );
  const accessori = accessoriDisponibili(catalogo.accessori, [
    prodottoRiga,
    trovaProdotto(riga.oscuranteTipologia),
  ]);
  const regolaAccessorio = (codice: string) =>
    catalogo.accessori.find(a => a.codice === codice)?.regola ?? "cad_pezzo";

  /**
   * Cambiare prodotto o oscurante cambia gli accessori proponibili: quelli
   * che non lo sono più cadono, gli altri restano con la loro quantità.
   */
  const cambiaProdotto = (patch: Pick<Partial<RigaForm>, "tipologia" | "oscuranteIntegrato" | "oscuranteTipologia">) => {
    const tipologia = "tipologia" in patch ? patch.tipologia ?? null : riga.tipologia;
    const oscuranteTipologia =
      "oscuranteTipologia" in patch ? patch.oscuranteTipologia ?? null : riga.oscuranteTipologia;
    const disponibili = accessoriDisponibili(catalogo.accessori, [
      trovaProdotto(tipologia),
      trovaProdotto(oscuranteTipologia),
    ]);
    onChange({ ...patch, accessori: accessoriCompatibili(riga.accessori, disponibili) });
  };

  return (
    <div className="rounded-lg border border-border p-2 space-y-2 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-5 shrink-0 tabular-nums text-xs text-text-3">{n}</span>
        <Input
          className="min-w-0 flex-1"
          aria-label={`Descrizione riga ${n}`}
          placeholder="Descrizione"
          value={riga.descrizione}
          disabled={!puoModificare}
          onChange={e => onChange({ descrizione: e.target.value })}
        />
        {puoModificare && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-danger hover:text-danger hover:bg-danger-soft"
            aria-label={`Rimuovi riga ${n}`}
            onClick={onRimuovi}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <Select
          value={riga.categoria}
          disabled={!puoModificare}
          onValueChange={v =>
            onChange({
              categoria: v as CategoriaRiga,
              // Cambiata la categoria, la voce DEI di prima non vale più —
              // e con essa oscurante, accessori e il default IVA.
              tipologia: null,
              oscuranteIntegrato: null,
              oscuranteTipologia: null,
              accessori: [],
              beneSignificativo: beneSignificativoDefault(v as CategoriaRiga),
            })
          }
        >
          <SelectTrigger aria-label={`Categoria riga ${n}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIE_RIGA.map(c => (
              <SelectItem key={c} value={c}>
                {etichettaCategoria(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {riga.categoria === "controtelaio" ? (
          <Select
            value={riga.tipologia ?? ""}
            disabled={!puoModificare}
            onValueChange={v => cambiaProdotto({ tipologia: v })}
          >
            <SelectTrigger aria-label={`Variante controtelaio riga ${n}`}>
              <SelectValue placeholder="Variante DEI" />
            </SelectTrigger>
            <SelectContent>
              {catalogo.controtelai.map(c => (
                <SelectItem key={c.codice} value={c.codice}>
                  {c.famiglia} — {c.variante}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : senzaGruppoDei ? (
          <Input
            aria-label={`Tipologia riga ${n}`}
            placeholder="Tipologia"
            value={riga.tipologia ?? ""}
            disabled={!puoModificare}
            onChange={e => onChange({ tipologia: e.target.value || null })}
          />
        ) : opzioni.length > 0 ? (
          <Select
            value={riga.tipologia ?? ""}
            disabled={!puoModificare}
            onValueChange={v => cambiaProdotto({ tipologia: v })}
          >
            <SelectTrigger aria-label={`Voce DEI riga ${n}`}>
              <SelectValue placeholder="Voce DEI">
                {opzioni.find(o => o.codice === riga.tipologia)?.etichetta ??
                  etichettaTipologia(riga.tipologia, catalogo.prodotti)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {opzioni.map(o => (
                <SelectItem key={o.codice} value={o.codice}>
                  {o.etichetta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-text-3 self-center">
            Nessuna voce DEI per questa categoria{zona ? ` in zona ${zona}` : ""}.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 items-center md:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_5rem_minmax(0,1fr)_auto]">
        <Input
          type="number"
          min={1}
          aria-label={`Quantità riga ${n}`}
          placeholder="Qtà"
          value={riga.quantita}
          disabled={!puoModificare}
          onChange={e => onChange({ quantita: Math.max(1, Number(e.target.value) || 1) })}
        />
        <Input
          type="number"
          aria-label={`Larghezza in mm riga ${n}`}
          placeholder="L mm"
          value={riga.larghezzaMm ?? ""}
          disabled={!puoModificare}
          onChange={e => onChange({ larghezzaMm: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <Input
          type="number"
          aria-label={`Altezza in mm riga ${n}`}
          placeholder="H mm"
          value={riga.altezzaMm ?? ""}
          disabled={!puoModificare}
          onChange={e => onChange({ altezzaMm: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <span className="tabular-nums text-xs text-text-3">{mqRigaForm(riga).toFixed(2)} mq</span>
        <Input
          inputMode="decimal"
          aria-label={`Prezzo totale riga ${n}`}
          placeholder="€ totale"
          value={prezzoTesto}
          disabled={!puoModificare}
          onChange={e => {
            setPrezzoTesto(e.target.value);
            const v = e.target.value.trim();
            const euro = parseEuroNonNegativo(v);
            if (v === "") onChange({ prezzoTotCent: null });
            else if (euro != null) onChange({ prezzoTotCent: Math.round(euro * 100) });
          }}
          onBlur={() => {
            // Testo illeggibile: si rimette in chiaro il valore che il form
            // ha davvero, invece di svuotare la casella e far credere che il
            // prezzo sia sparito.
            const euro = parseEuroNonNegativo(prezzoTesto);
            if (euro != null) setPrezzoTesto(formatEuro(euro));
            else setPrezzoTesto(riga.prezzoTotCent == null ? "" : formatEuro(riga.prezzoTotCent / 100));
          }}
        />
        <Label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
          <Switch
            checked={riga.beneSignificativo}
            disabled={!puoModificare}
            aria-label={`Bene significativo riga ${n}`}
            onCheckedChange={v => onChange({ beneSignificativo: v })}
          />
          Bene signif.
        </Label>
      </div>

      {CON_OSCURANTE_ABBINATO.has(riga.categoria) && (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-text-3 shrink-0">Oscurante</span>
            <Select
              value={riga.oscuranteIntegrato ?? "nessuno"}
              disabled={!puoModificare}
              onValueChange={v =>
                cambiaProdotto({
                  oscuranteIntegrato: v === "nessuno" ? null : (v as OscuranteIntegrato),
                  // Cambiato l'oscurante, la sua voce DEI va riscelta.
                  oscuranteTipologia: null,
                })
              }
            >
              <SelectTrigger aria-label={`Oscurante integrato riga ${n}`} className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nessuno">Nessuno</SelectItem>
                {OSCURANTI_INTEGRATI.map(o => (
                  <SelectItem key={o} value={o}>
                    {ETICHETTA_OSCURANTE[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {riga.oscuranteIntegrato && (
            <Select
              value={riga.oscuranteTipologia ?? ""}
              disabled={!puoModificare}
              onValueChange={v => cambiaProdotto({ oscuranteTipologia: v })}
            >
              <SelectTrigger aria-label={`Voce DEI oscurante riga ${n}`}>
                <SelectValue placeholder="Oscurante DEI" />
              </SelectTrigger>
              <SelectContent>
                {prodottiOscurante.map(p => (
                  <SelectItem key={p.codice} value={p.codice}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {riga.categoria === "controtelaio" && (
        <div className="flex items-center gap-2">
          <Label htmlFor={`misura-${riga.chiave}`} className="text-xs text-text-3">
            Misura DEI (mq / m / pezzi)
          </Label>
          <Input
            id={`misura-${riga.chiave}`}
            type="number"
            step="0.01"
            className="h-8 w-28"
            value={riga.misuraDei ?? ""}
            disabled={!puoModificare}
            onChange={e => onChange({ misuraDei: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
      )}

      {(accessori.length > 0 || riga.accessori.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap text-xs min-w-0">
          <span className="text-text-3">Accessori</span>
          {riga.accessori.map(a => (
            <span
              key={a.codice}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5"
            >
              {etichettaAccessorio(a.codice, catalogo.accessori)}
              {quantitaAccessorioModificabile(regolaAccessorio(a.codice)) && (
                <Input
                  type="number"
                  min={0}
                  className="h-8 w-16 px-1 text-xs"
                  aria-label={`Quantità ${etichettaAccessorio(a.codice, catalogo.accessori)} riga ${n}`}
                  value={a.quantita}
                  disabled={!puoModificare}
                  onChange={e =>
                    onChange({
                      accessori: riga.accessori.map(x =>
                        x.codice === a.codice ? { ...x, quantita: Math.max(0, Number(e.target.value) || 0) } : x
                      ),
                    })
                  }
                />
              )}
              {puoModificare && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Rimuovi ${etichettaAccessorio(a.codice, catalogo.accessori)} dalla riga ${n}`}
                  onClick={() => onChange({ accessori: riga.accessori.filter(x => x.codice !== a.codice) })}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </span>
          ))}
          {puoModificare && accessori.length > 0 && (
            <Select
              value=""
              onValueChange={codice =>
                onChange({
                  accessori: [
                    ...riga.accessori.filter(x => x.codice !== codice),
                    { codice, quantita: riga.quantita },
                  ],
                })
              }
            >
              <SelectTrigger aria-label={`Aggiungi accessorio alla riga ${n}`} className="h-7 w-44">
                <SelectValue placeholder="+ accessorio" />
              </SelectTrigger>
              <SelectContent>
                {accessori.map(a => (
                  <SelectItem key={a.codice} value={a.codice}>
                    {a.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
