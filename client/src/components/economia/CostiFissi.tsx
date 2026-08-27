import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const CADENZE = [["mensile", "Ogni mese", 1], ["bimestrale", "Ogni 2 mesi", 2], ["trimestrale", "Ogni 3 mesi", 3], ["quadrimestrale", "Ogni 4 mesi", 4], ["semestrale", "Ogni 6 mesi", 6], ["annuale", "Una volta l'anno", 12]] as const;
const CATEGORIE = [["personale", "Personale"], ["immobili", "Immobili"], ["veicoli", "Veicoli"], ["servizi", "Servizi"], ["finanziari", "Finanziari"], ["tasse", "Tasse e contributi"], ["altro", "Altro"]] as const;
const CADENZA_LABEL = Object.fromEntries(CADENZE.map(([id, label]) => [id, label]));
const CATEGORIA_LABEL = Object.fromEntries(CATEGORIE);

type Bozza = { descrizione: string; importo: string; cadenza: string; dal: string; al: string; categoria: string; fornitore: string };
function meseCorrente() { const oggi = new Date(); return `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, "0")}`; }
const BOZZA_VUOTA: Bozza = { descrizione: "", importo: "", cadenza: "mensile", dal: meseCorrente(), al: "", categoria: "altro", fornitore: "" };

function FormCosto({ value, pending, onChange, onSubmit, onCancel, submitLabel = "Salva" }: { value: Bozza; pending: boolean; onChange: (value: Bozza) => void; onSubmit: () => void; onCancel: () => void; submitLabel?: string }) {
  const set = (key: keyof Bozza, next: string) => onChange({ ...value, [key]: next });
  const importo = Number(value.importo.replace(",", "."));
  const mensile = importo > 0 ? importo / (CADENZE.find(([id]) => id === value.cadenza)?.[2] ?? 1) : null;
  return <div className="grid gap-3 sm:grid-cols-2">
    <div className="space-y-1 sm:col-span-2"><Label htmlFor="costo-descrizione">Descrizione</Label><Input id="costo-descrizione" value={value.descrizione} onChange={e => set("descrizione", e.target.value)} className="h-10" /></div>
    <div className="space-y-1"><Label htmlFor="costo-importo">Importo per scadenza</Label><Input id="costo-importo" inputMode="decimal" value={value.importo} onChange={e => set("importo", e.target.value)} placeholder="0,00" className="h-10 tabular-nums" /></div>
    <div className="space-y-1"><Label htmlFor="costo-cadenza">Cadenza</Label><Select value={value.cadenza} onValueChange={next => set("cadenza", next)}><SelectTrigger id="costo-cadenza" className="h-10"><SelectValue /></SelectTrigger><SelectContent>{CADENZE.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1"><Label htmlFor="costo-dal">Valido da</Label><Input id="costo-dal" type="month" value={value.dal} onChange={e => set("dal", e.target.value)} className="h-10" /></div>
    <div className="space-y-1"><Label htmlFor="costo-al">Valido a (facoltativo)</Label><Input id="costo-al" type="month" value={value.al} onChange={e => set("al", e.target.value)} className="h-10" /></div>
    <div className="space-y-1"><Label htmlFor="costo-categoria">Categoria</Label><Select value={value.categoria} onValueChange={next => set("categoria", next)}><SelectTrigger id="costo-categoria" className="h-10"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIE.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1"><Label htmlFor="costo-fornitore">Fornitore (facoltativo)</Label><Input id="costo-fornitore" value={value.fornitore} onChange={e => set("fornitore", e.target.value)} className="h-10" /></div>
    {mensile != null && value.cadenza !== "mensile" && <p className="text-xs text-text-3 sm:col-span-2">Incidenza mensile: {formatEuroSimbolo(Math.round(mensile * 100) / 100)}.</p>}
    <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>Annulla</Button><Button type="button" className="min-h-11" disabled={!value.descrizione.trim() || !(importo > 0) || !value.dal || pending} onClick={onSubmit}>{pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{submitLabel}</Button></div>
  </div>;
}

function bozzaDaVoce(voce: any): Bozza { return { descrizione: voce.descrizione, importo: String(voce.importo), cadenza: voce.cadenza, dal: voce.dal, al: voce.al ?? "", categoria: voce.categoria, fornitore: voce.fornitore ?? "" }; }
function bozzaDaCandidato(candidato: any): Bozza { return { descrizione: candidato.fornitore, importo: String(candidato.importo), cadenza: "mensile", dal: candidato.mesi?.[0] ?? meseCorrente(), al: "", categoria: "servizi", fornitore: candidato.fornitore }; }

export default function CostiFissi() {
  const utils = trpc.useUtils();
  const registro = trpc.costiFissi.list.useQuery();
  const candidati = trpc.ficCosti.ricorrenti.useQuery();
  const [form, setForm] = useState<{ id: number | null; value: Bozza } | null>(null);
  const [candidato, setCandidato] = useState<any | null>(null);
  const invalida = () => { utils.costiFissi.invalidate(); utils.economia.invalidate(); utils.ficCosti.invalidate(); };
  const crea = trpc.costiFissi.create.useMutation({ onSuccess: () => { invalida(); setForm(null); }, onError: e => toast.error(e.message) });
  const aggiorna = trpc.costiFissi.update.useMutation({ onSuccess: () => { invalida(); setForm(null); }, onError: e => toast.error(e.message) });
  const elimina = trpc.costiFissi.remove.useMutation({ onSuccess: invalida, onError: e => toast.error(e.message) });
  const conferma = trpc.costiFissi.confermaDaFic.useMutation({ onSuccess: () => { invalida(); setCandidato(null); }, onError: e => toast.error(e.message) });
  const classifica = trpc.ficCosti.spostaFornitore.useMutation({ onSuccess: () => { invalida(); toast.success("Candidato rimosso dal registro delle ricorrenze."); }, onError: e => toast.error(e.message) });
  if (registro.isLoading || candidati.isLoading) return <div className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-text-3" /></div>;
  const voci = registro.data?.voci ?? [];
  const gruppi = candidati.data?.gruppi ?? [];
  const totale = registro.data?.totaleMensile ?? 0;
  const salvaManuale = (value: Bozza) => { const input = { descrizione: value.descrizione.trim(), importo: Number(value.importo.replace(",", ".")), cadenza: value.cadenza as any, dal: value.dal, al: value.al || null, categoria: value.categoria as any, fornitore: value.fornitore.trim() || null }; if (form?.id == null) crea.mutate(input); else aggiorna.mutate({ id: form.id, ...input }); };
  const confermaCandidato = (value: Bozza) => conferma.mutate({ chiave: candidato.chiave, descrizione: value.descrizione.trim(), importo: Number(value.importo.replace(",", ".")), cadenza: value.cadenza as any, dal: value.dal, al: value.al || null, categoria: value.categoria as any });
  return <div className="space-y-4">
    <section aria-labelledby="totale-certo" className="rounded-lg border border-primary/30 bg-surface p-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Economia</p><h2 id="totale-certo" className="text-base font-semibold">Totale certo</h2><p className="text-xs text-text-3">Solo il registro confermato alimenta il punto di pareggio.</p></div><div className="text-right"><p className="text-3xl font-bold tabular-nums">{formatEuroSimbolo(totale)}<span className="ml-1 text-sm font-normal text-text-3">/mese</span></p><p className="text-xs text-text-3">{voci.length} {voci.length === 1 ? "voce attiva" : "voci attive"} · {gruppi.length} candidat{gruppi.length === 1 ? "o" : "i"} esclusi</p></div></div></section>
    <section aria-labelledby="registro-confermato" className="space-y-2"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="registro-confermato" className="text-base font-semibold">Registro confermato</h2><p className="text-xs text-text-3">Voci manuali o confermate da FiC, con validità e incidenza mensile verificabili.</p></div><Button className="min-h-11" onClick={() => setForm({ id: null, value: BOZZA_VUOTA })}><Plus className="mr-1.5 h-4 w-4" />Aggiungi voce</Button></div>
      {form && <div className="rounded-lg border border-border bg-surface-2 p-3"><FormCosto value={form.value} pending={crea.isPending || aggiorna.isPending} onChange={value => setForm({ ...form, value })} onSubmit={() => salvaManuale(form.value)} onCancel={() => setForm(null)} /></div>}
      {voci.length === 0 ? <div className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-text-3">Nessuna voce confermata. Il totale certo è zero.</div> : <Table><TableHeader><TableRow><TableHead>Voce</TableHead><TableHead>Validità</TableHead><TableHead>Fonte</TableHead><TableHead className="text-right">Al mese</TableHead><TableHead className="w-20" /></TableRow></TableHeader><TableBody>{voci.map((voce: any) => <TableRow key={voce.id}><TableCell><p className="max-w-[15rem] truncate font-medium">{voce.descrizione}</p><p className="text-xs text-text-3">{CATEGORIA_LABEL[voce.categoria] ?? voce.categoria} · {CADENZA_LABEL[voce.cadenza] ?? voce.cadenza}{voce.fornitore ? ` · ${voce.fornitore}` : ""}</p></TableCell><TableCell className="text-xs text-text-2">{voce.dal} → {voce.al ?? "in corso"}</TableCell><TableCell><Badge variant="outline" className="text-[10px]">{voce.origine === "fic" ? "FiC confermato" : "Manuale"}</Badge></TableCell><TableCell className="text-right font-semibold tabular-nums">{formatEuroSimbolo(voce.mensile)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Modifica ${voce.descrizione}`} onClick={() => setForm({ id: voce.id, value: bozzaDaVoce(voce) })}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-11 w-11 text-danger" aria-label={`Elimina ${voce.descrizione}`} disabled={elimina.isPending} onClick={() => elimina.mutate({ id: voce.id })}><Trash2 className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table>}
    </section>
    <section aria-labelledby="da-confermare" className="space-y-2"><div><h2 id="da-confermare" className="text-base font-semibold">Da confermare da FiC</h2><p className="text-xs text-text-3">Ricorrenze proposte automaticamente: non entrano nel totale finché una persona non decide.</p></div>
      {gruppi.length === 0 ? <div className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-text-3">Nessun candidato da confermare.</div> : <Table><TableHeader><TableRow><TableHead>Fornitore</TableHead><TableHead>Serie rilevata</TableHead><TableHead>Motivazione</TableHead><TableHead className="text-right">Importo</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader><TableBody>{gruppi.map((gruppo: any) => <TableRow key={gruppo.chiave}><TableCell className="font-medium">{gruppo.fornitore}</TableCell><TableCell className="text-xs text-text-2">{gruppo.mesi?.length ?? 0} mesi · {gruppo.mesi?.[0]} → {gruppo.mesi?.at(-1)}</TableCell><TableCell className="max-w-[18rem] truncate text-xs text-text-3">{gruppo.motivazione}</TableCell><TableCell className="text-right font-semibold tabular-nums">{formatEuroSimbolo(gruppo.importo)}<span className="ml-1 text-xs font-normal text-text-3">/mese</span></TableCell><TableCell><div className="flex justify-end gap-1"><Button className="min-h-11" size="sm" onClick={() => setCandidato(gruppo)}>Conferma fisso</Button><Button variant="outline" size="sm" className="min-h-11" disabled={classifica.isPending} onClick={() => classifica.mutate({ fornitore: gruppo.fornitore, classificazione: "variabile_commessa" })}>Variabile</Button><Button variant="outline" size="sm" className="min-h-11" disabled={classifica.isPending} onClick={() => classifica.mutate({ fornitore: gruppo.fornitore, classificazione: "straordinario" })}>Straordinario</Button></div></TableCell></TableRow>)}</TableBody></Table>}
    </section>
    <Dialog open={candidato !== null} onOpenChange={open => !open && setCandidato(null)}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Conferma costo fisso</DialogTitle><DialogDescription>{candidato?.fornitore} · proposta FiC. Controlla i dati prima di aggiungerla al registro certo.</DialogDescription></DialogHeader>{candidato && <CandidatoForm candidato={candidato} pending={conferma.isPending} onCancel={() => setCandidato(null)} onSubmit={confermaCandidato} />}</DialogContent></Dialog>
  </div>;
}

function CandidatoForm({ candidato, pending, onCancel, onSubmit }: { candidato: any; pending: boolean; onCancel: () => void; onSubmit: (value: Bozza) => void }) { const [value, setValue] = useState(() => bozzaDaCandidato(candidato)); return <FormCosto value={value} pending={pending} onChange={setValue} onSubmit={() => onSubmit(value)} onCancel={onCancel} submitLabel="Conferma e registra" />; }
