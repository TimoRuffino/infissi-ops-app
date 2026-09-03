// Tab «Contratto» della commessa: parametri del contratto, rate, righe
// strutturate e opzioni del computo. Sostituisce la tab «Prodotti»: i
// prodotti legacy restano visibili come righe «da completare».
// Salvataggio esplicito; il server ricalcola mq, zona, hash e specchia il
// pattuito sulla card Pagamenti. Le voci si scelgono dal catalogo DEI che
// arriva con la lettura: il client non prezza e non decide nulla.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatEuro, parseEuroNonNegativo } from "@/lib/euro";
import {
  avvisiForm,
  erroriForm,
  parametriDaServer,
  parametriVuoti,
  rateDefault,
  rigaDaLegacy,
  rigaDaServer,
  rigaVuota,
  totaleRigheCent,
  type CatalogoContratto,
  type RigaForm,
} from "@/lib/contrattoView";
import {
  DETRAZIONE_TIPI,
  ZONE_CLIMATICHE,
  type ContrattoInput,
  type DetrazioneImmobile,
  type DetrazioneTipo,
  type PattuitoTipo,
  type ZonaClimatica,
} from "@shared/limiti/tipi";
import RigaContrattoEditor from "@/components/contratto/RigaContrattoEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATALOGO_VUOTO: CatalogoContratto = { prodotti: [], accessori: [], controtelai: [], opere: [] };

const ETICHETTA_DETRAZIONE: Record<DetrazioneTipo, string> = {
  nessuna: "Nessuna",
  ecobonus: "Ecobonus",
  ristrutturazione: "Ristrutturazione",
};

export default function ContrattoTab({ commessaId }: { commessaId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.contratti.get.useQuery({ commessaId }, { retry: false });
  const [parametri, setParametri] = useState<ContrattoInput>(parametriVuoti);
  const [righe, setRighe] = useState<RigaForm[]>([]);
  const [pattuitoTesto, setPattuitoTesto] = useState("");
  const [sporco, setSporco] = useState(false);

  // Il form si allinea al server finché l'operatore non tocca qualcosa.
  useEffect(() => {
    if (!q.data || sporco) return;
    const c = q.data.contratto;
    if (c) {
      setParametri(parametriDaServer(c));
      setPattuitoTesto(formatEuro(c.pattuitoCent / 100));
    }
    setRighe(q.data.righe.map(rigaDaServer));
  }, [q.data, sporco]);

  const salva = trpc.contratti.salva.useMutation({
    onSuccess: esito => {
      setSporco(false);
      utils.contratti.get.invalidate({ commessaId });
      utils.computo.ultimo.invalidate({ commessaId });
      utils.commesse.invalidate();
      toast.success("Contratto salvato");
      esito.avvertenze.forEach(a => toast.warning(a));
    },
    onError: e => toast.error(e.message),
  });

  const catalogo: CatalogoContratto = q.data?.catalogo ?? CATALOGO_VUOTO;
  const opereEventuali = catalogo.opere.filter(o => o.gruppo === "eventuali");
  const errori = useMemo(() => erroriForm(parametri, righe), [parametri, righe]);
  const avvisi = useMemo(() => avvisiForm(righe, catalogo.prodotti), [righe, catalogo.prodotti]);
  const totale = totaleRigheCent(righe);
  const puoModificare = q.data?.puoModificare ?? false;
  const zona = parametri.zonaManuale ? parametri.zonaClimatica ?? null : q.data?.contratto?.zonaClimatica ?? null;

  const aggiornaRiga = (chiave: string, patch: Partial<RigaForm>) => {
    setSporco(true);
    setRighe(prev => prev.map(r => (r.chiave === chiave ? { ...r, ...patch } : r)));
  };
  const aggiornaParametri = (patch: Partial<ContrattoInput>) => {
    setSporco(true);
    setParametri(prev => ({ ...prev, ...patch }));
  };
  const aggiornaOpzioni = (patch: Partial<ContrattoInput["opzioniComputo"]>) => {
    aggiornaParametri({ opzioniComputo: { ...parametri.opzioniComputo, ...patch } });
  };

  if (q.isLoading) return <p className="text-sm text-muted-foreground py-6">Caricamento contratto…</p>;
  if (q.error) return <p className="text-sm text-danger py-6">{q.error.message}</p>;

  return (
    <div className="space-y-5 mt-4 min-w-0">
      {/* Parametri */}
      <section aria-label="Parametri del contratto" className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="pattuito" className="text-xs text-text-3">Pattuito €</Label>
          <Input
            id="pattuito"
            inputMode="decimal"
            value={pattuitoTesto}
            disabled={!puoModificare}
            onChange={e => {
              setPattuitoTesto(e.target.value);
              const euro = parseEuroNonNegativo(e.target.value);
              if (euro != null) aggiornaParametri({ pattuitoCent: Math.round(euro * 100) });
              else if (e.target.value.trim() === "") aggiornaParametri({ pattuitoCent: 0 });
            }}
            onBlur={() => {
              const euro = parseEuroNonNegativo(pattuitoTesto);
              setPattuitoTesto(euro == null ? "" : formatEuro(euro));
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Il pattuito è</Label>
          <Select
            value={parametri.pattuitoTipo}
            disabled={!puoModificare}
            onValueChange={v => aggiornaParametri({ pattuitoTipo: v as PattuitoTipo })}
          >
            <SelectTrigger aria-label="Tipo di pattuito"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lordo">Lordo, IVA inclusa</SelectItem>
              <SelectItem value="imponibile">Imponibile, IVA esclusa</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="comune" className="text-xs text-text-3">Comune del cantiere</Label>
          <Input
            id="comune"
            value={parametri.comuneCantiere ?? ""}
            disabled={!puoModificare}
            onChange={e => aggiornaParametri({ comuneCantiere: e.target.value || null })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Zona climatica</Label>
          <div className="flex items-center gap-2 h-9">
            {parametri.zonaManuale ? (
              <Select
                value={parametri.zonaClimatica ?? ""}
                disabled={!puoModificare}
                onValueChange={v => aggiornaParametri({ zonaClimatica: v as ZonaClimatica })}
              >
                <SelectTrigger aria-label="Zona climatica" className="w-20"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {ZONE_CLIMATICHE.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline">{q.data?.contratto?.zonaClimatica ?? "dal comune"}</Badge>
            )}
            <Label className="flex items-center gap-1.5 text-xs">
              <Switch
                checked={parametri.zonaManuale}
                disabled={!puoModificare}
                aria-label="Scegli la zona climatica a mano"
                onCheckedChange={v =>
                  aggiornaParametri({
                    zonaManuale: v,
                    zonaClimatica: v ? parametri.zonaClimatica ?? q.data?.contratto?.zonaClimatica ?? null : null,
                  })
                }
              />
              a mano
            </Label>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="piano" className="text-xs text-text-3">Piano</Label>
          <Input
            id="piano"
            type="number"
            value={parametri.piano ?? ""}
            disabled={!puoModificare}
            onChange={e => aggiornaParametri({ piano: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="km" className="text-xs text-text-3">Distanza dal magazzino (km)</Label>
          <Input
            id="km"
            type="number"
            step="0.5"
            value={parametri.distanzaKm ?? ""}
            disabled={!puoModificare}
            onChange={e => aggiornaParametri({ distanzaKm: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Detrazione</Label>
          <Select
            value={parametri.detrazioneTipo}
            disabled={!puoModificare}
            onValueChange={v =>
              aggiornaParametri({
                detrazioneTipo: v as DetrazioneTipo,
                detrazioneImmobile: v === "nessuna" ? null : parametri.detrazioneImmobile ?? "prima_casa",
              })
            }
          >
            <SelectTrigger aria-label="Tipo di detrazione"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DETRAZIONE_TIPI.map(t => (
                <SelectItem key={t} value={t}>{ETICHETTA_DETRAZIONE[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Immobile</Label>
          <Select
            value={parametri.detrazioneImmobile ?? ""}
            disabled={!puoModificare || parametri.detrazioneTipo === "nessuna"}
            onValueChange={v => aggiornaParametri({ detrazioneImmobile: v as DetrazioneImmobile })}
          >
            <SelectTrigger aria-label="Tipo di immobile"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prima_casa">Prima casa</SelectItem>
              <SelectItem value="altro">Altro immobile</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="firma" className="text-xs text-text-3">Data firma</Label>
          <Input
            id="firma"
            type="date"
            value={parametri.dataFirma ?? ""}
            disabled={!puoModificare}
            onChange={e => aggiornaParametri({ dataFirma: e.target.value || null })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Posa</Label>
          <Label className="flex items-center gap-2 h-9 text-sm">
            <Switch
              checked={parametri.posaInclusa}
              disabled={!puoModificare}
              aria-label="Posa inclusa nel prezzo"
              onCheckedChange={v => aggiornaParametri({ posaInclusa: v })}
            />
            inclusa nel prezzo
          </Label>
        </div>
      </section>

      {/* Rate */}
      <section aria-label="Piano rate del contratto" className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">Rate</span>
          <span className="text-xs text-muted-foreground">
            {parametri.rate.reduce((s, r) => s + r.quotaPct, 0)}% del pattuito
          </span>
          {puoModificare && (
            <div className="ml-auto flex gap-2">
              {parametri.rate.length === 0 && (
                <Button size="sm" variant="outline" className="h-7" onClick={() => aggiornaParametri({ rate: rateDefault() })}>
                  50/40/10
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() =>
                  aggiornaParametri({
                    rate: [
                      ...parametri.rate,
                      { numero: parametri.rate.length + 1, quotaPct: 0, giorni: 0, data: null, descrizione: null },
                    ],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Rata
              </Button>
            </div>
          )}
        </div>
        {parametri.rate.map((rata, i) => (
          <div
            key={rata.numero}
            className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 items-center text-sm md:grid-cols-[2.5rem_5rem_5rem_minmax(0,1fr)_2rem]"
          >
            <span className="tabular-nums text-text-3">{rata.numero}ª</span>
            <Input
              inputMode="decimal"
              aria-label={`Quota in percento della rata ${rata.numero}`}
              placeholder="%"
              value={rata.quotaPct}
              disabled={!puoModificare}
              onChange={e =>
                aggiornaParametri({
                  rate: parametri.rate.map((r, j) => (j === i ? { ...r, quotaPct: Number(e.target.value) || 0 } : r)),
                })
              }
            />
            <Input
              type="number"
              aria-label={`Giorni della rata ${rata.numero}`}
              placeholder="giorni"
              value={rata.giorni ?? ""}
              disabled={!puoModificare}
              onChange={e =>
                aggiornaParametri({
                  rate: parametri.rate.map((r, j) =>
                    j === i ? { ...r, giorni: e.target.value === "" ? null : Number(e.target.value) } : r
                  ),
                })
              }
            />
            <Input
              className="col-span-3 md:col-span-1"
              aria-label={`Descrizione della rata ${rata.numero}`}
              placeholder="Descrizione"
              value={rata.descrizione ?? ""}
              disabled={!puoModificare}
              onChange={e =>
                aggiornaParametri({
                  rate: parametri.rate.map((r, j) => (j === i ? { ...r, descrizione: e.target.value || null } : r)),
                })
              }
            />
            {puoModificare && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-danger hover:text-danger hover:bg-danger-soft"
                aria-label={`Rimuovi la rata ${rata.numero}`}
                onClick={() =>
                  aggiornaParametri({
                    rate: parametri.rate.filter((_, j) => j !== i).map((r, j) => ({ ...r, numero: j + 1 })),
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </section>

      {/* Righe */}
      <section aria-label="Righe del contratto" className="space-y-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">Righe ({righe.length})</span>
          <span className="text-xs text-muted-foreground">beni € {formatEuro(totale / 100)}</span>
          {puoModificare && (
            <Button
              size="sm"
              className="ml-auto h-7"
              onClick={() => {
                setSporco(true);
                setRighe(prev => [...prev, rigaVuota()]);
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Riga
            </Button>
          )}
        </div>
        {righe.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nessuna riga — leggi il contratto caricato o aggiungi a mano.
          </p>
        )}
        <div className="space-y-2">
          {righe.map((r, i) => (
            <RigaContrattoEditor
              key={r.chiave}
              riga={r}
              indice={i}
              puoModificare={puoModificare}
              zona={zona}
              catalogo={catalogo}
              onChange={patch => aggiornaRiga(r.chiave, patch)}
              onRimuovi={() => {
                setSporco(true);
                setRighe(prev => prev.filter(x => x.chiave !== r.chiave));
              }}
            />
          ))}
        </div>

        {(q.data?.righeLegacy.length ?? 0) > 0 && (
          <div className="space-y-1 pt-2">
            <p className="text-xs text-muted-foreground">Prodotti inseriti prima del contratto strutturato:</p>
            {q.data?.righeLegacy.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-sm rounded-md border border-dashed border-border px-2 py-1 min-w-0">
                <span className="truncate">{p.nome}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">x{p.quantita}</Badge>
                <Badge variant="outline" className="text-[10px] text-warning shrink-0">misure mancanti</Badge>
                {puoModificare && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 shrink-0"
                    onClick={() => {
                      setSporco(true);
                      setRighe(prev => [...prev, rigaDaLegacy(p)]);
                    }}
                  >
                    Converti in riga
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Opere e servizi: scelte che cambiano quali voci entrano nel limite */}
      <section aria-label="Opere e servizi nel limite" className="space-y-2">
        <span className="text-sm font-medium">Opere e servizi nel limite</span>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-text-3">Rilievo misure</Label>
            <RadioGroup
              className="flex gap-4"
              aria-label="Rilievo misure"
              value={parametri.opzioniComputo.rilievo}
              disabled={!puoModificare}
              onValueChange={v => aggiornaOpzioni({ rilievo: v as "foro" | "pezzo" })}
            >
              <Label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="foro" id="rilievo-foro" /> a foro finestra
              </Label>
              <Label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="pezzo" id="rilievo-pezzo" /> al pezzo
              </Label>
            </RadioGroup>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-3">Spese professionali</Label>
            <Label className="flex items-center gap-2 h-9 text-sm">
              <Switch
                checked={parametri.opzioniComputo.speseProfessionali}
                disabled={!puoModificare}
                aria-label="Spese professionali nel limite"
                onCheckedChange={v => aggiornaOpzioni({ speseProfessionali: v })}
              />
              comprese nel computo
            </Label>
          </div>
        </div>
        {opereEventuali.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {opereEventuali.map(o => (
              <Label key={o.codice} htmlFor={`opera-${o.codice}`} className="flex items-start gap-2 text-sm min-w-0">
                <Checkbox
                  id={`opera-${o.codice}`}
                  className="mt-0.5"
                  checked={parametri.opzioniComputo.eventuali.includes(o.codice)}
                  disabled={!puoModificare}
                  onCheckedChange={v =>
                    aggiornaOpzioni({
                      eventuali: v
                        ? [...parametri.opzioniComputo.eventuali, o.codice]
                        : parametri.opzioniComputo.eventuali.filter(c => c !== o.codice),
                    })
                  }
                />
                <span className="min-w-0">{o.descrizione}</span>
              </Label>
            ))}
          </div>
        )}
      </section>

      {avvisi.length > 0 && (
        <ul className="text-xs text-warning list-disc pl-4" aria-live="polite">
          {avvisi.map(a => <li key={a}>{a}</li>)}
        </ul>
      )}

      {errori.length > 0 && sporco && (
        <ul className="text-xs text-danger list-disc pl-4" aria-live="polite">
          {errori.map(e => <li key={e}>{e}</li>)}
        </ul>
      )}

      {puoModificare && (
        <div className="flex justify-end gap-2">
          <Button
            disabled={!sporco || errori.length > 0 || salva.isPending}
            onClick={() =>
              salva.mutate({
                commessaId,
                contratto: parametri,
                righe: righe.map(({ chiave: _chiave, ...resto }) => resto),
              })
            }
          >
            <Save className="h-4 w-4 mr-1" /> {salva.isPending ? "Salvataggio…" : "Salva contratto"}
          </Button>
        </div>
      )}
    </div>
  );
}
