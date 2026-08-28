// Costi fissi — quanto costa tenere aperta l'azienda ogni mese.
//
// Una sezione sola, due sorgenti dichiarate riga per riga:
//
//   Da FiC        i fornitori classificati «Fisso» in Acquisti, mensilizzati
//                 sul periodo base. Fatture in Cloud fa fede: qui non si
//                 conferma niente una seconda volta.
//   Dichiarato    stipendi, contributi, tasse, affitti senza fattura passiva.
//                 In FiC non ci sono e non ci saranno.
//
// Prima erano due registri scollegati: classificare venti fornitori come
// fissi lasciava il totale a zero, e la coda delle ricorrenze non si svuotava
// mai perché una conferma non toglieva il candidato. Da fuori sembrava che
// niente si salvasse.
//
// Niente tabelle: la coda aveva cinque colonne e i bottoni per classificare
// finivano oltre il bordo dello scroll orizzontale a 1440, quindi si vedeva
// ma non si poteva smaltire.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const CADENZE = [
  ["mensile", "Ogni mese", 1],
  ["bimestrale", "Ogni 2 mesi", 2],
  ["trimestrale", "Ogni 3 mesi", 3],
  ["quadrimestrale", "Ogni 4 mesi", 4],
  ["semestrale", "Ogni 6 mesi", 6],
  ["annuale", "Una volta l'anno", 12],
] as const;

const CATEGORIE = [
  ["personale", "Personale"],
  ["immobili", "Immobili"],
  ["veicoli", "Veicoli"],
  ["servizi", "Servizi"],
  ["finanziari", "Finanziari"],
  ["tasse", "Tasse e contributi"],
  ["altro", "Altro"],
] as const;

const CADENZA_LABEL = Object.fromEntries(
  CADENZE.map(([id, label]) => [id, label])
) as Record<string, string>;
const CATEGORIA_LABEL = Object.fromEntries(CATEGORIE) as Record<string, string>;

const NOMI_MESE = [
  "gen", "feb", "mar", "apr", "mag", "giu",
  "lug", "ago", "set", "ott", "nov", "dic",
];

function etichettaMese(mese: string | null | undefined): string {
  if (!mese) return "—";
  const [anno, numero] = mese.split("-");
  return `${NOMI_MESE[Number(numero) - 1] ?? numero} ${anno.slice(2)}`;
}

function meseCorrente(): string {
  const oggi = new Date();
  return `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, "0")}`;
}

type Bozza = {
  descrizione: string;
  importo: string;
  cadenza: string;
  dal: string;
  al: string;
  categoria: string;
  fornitore: string;
};

const BOZZA_VUOTA: Bozza = {
  descrizione: "",
  importo: "",
  cadenza: "mensile",
  dal: meseCorrente(),
  al: "",
  categoria: "altro",
  fornitore: "",
};

function bozzaDaVoce(voce: any): Bozza {
  return {
    descrizione: voce.descrizione,
    importo: String(voce.importo),
    cadenza: voce.cadenza,
    dal: voce.dal,
    al: voce.al ?? "",
    categoria: voce.categoria,
    fornitore: voce.fornitore ?? "",
  };
}

function FormCosto({
  value,
  pending,
  onChange,
  onSubmit,
  onCancel,
  submitLabel = "Salva",
}: {
  value: Bozza;
  pending: boolean;
  onChange: (value: Bozza) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const set = (key: keyof Bozza, next: string) =>
    onChange({ ...value, [key]: next });
  const importo = Number(value.importo.replace(",", "."));
  const mensile =
    importo > 0
      ? importo / (CADENZE.find(([id]) => id === value.cadenza)?.[2] ?? 1)
      : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="costo-descrizione">Descrizione</Label>
        <Input
          id="costo-descrizione"
          value={value.descrizione}
          onChange={e => set("descrizione", e.target.value)}
          placeholder="Stipendi operai, INPS, affitto capannone…"
          className="h-10"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="costo-importo">Importo per scadenza</Label>
        <Input
          id="costo-importo"
          inputMode="decimal"
          value={value.importo}
          onChange={e => set("importo", e.target.value)}
          placeholder="0,00"
          className="h-10 tabular-nums"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="costo-cadenza">Cadenza</Label>
        <Select value={value.cadenza} onValueChange={next => set("cadenza", next)}>
          <SelectTrigger id="costo-cadenza" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CADENZE.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="costo-dal">Valido da</Label>
        <Input
          id="costo-dal"
          type="month"
          value={value.dal}
          onChange={e => set("dal", e.target.value)}
          className="h-10"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="costo-al">Valido a (facoltativo)</Label>
        <Input
          id="costo-al"
          type="month"
          value={value.al}
          onChange={e => set("al", e.target.value)}
          className="h-10"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="costo-categoria">Categoria</Label>
        <Select
          value={value.categoria}
          onValueChange={next => set("categoria", next)}
        >
          <SelectTrigger id="costo-categoria" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIE.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="costo-fornitore">Fornitore (facoltativo)</Label>
        <Input
          id="costo-fornitore"
          value={value.fornitore}
          onChange={e => set("fornitore", e.target.value)}
          placeholder="Se è lo stesso di una fattura FiC, la sostituisce"
          className="h-10"
        />
      </div>
      {mensile != null && value.cadenza !== "mensile" && (
        <p className="text-xs text-text-3 sm:col-span-2">
          Incidenza mensile:{" "}
          {formatEuroSimbolo(Math.round(mensile * 100) / 100)}.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
          Annulla
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={
            !value.descrizione.trim() || !(importo > 0) || !value.dal || pending
          }
          onClick={onSubmit}
        >
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** Una riga del registro che arriva da Fatture in Cloud. */
function RigaFic({ riga }: { riga: any }) {
  const utils = trpc.useUtils();
  const [aperta, setAperta] = useState(false);
  const sposta = trpc.ficCosti.spostaFornitore.useMutation({
    onSuccess: r => {
      utils.costiFissi.invalidate();
      utils.ficCosti.invalidate();
      utils.economia.invalidate();
      toast.success(`${r.fornitore}: ${r.aggiornati} documenti riclassificati`);
    },
    onError: e => toast.error(e.message),
  });

  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-[12rem] flex-1">
          <p className="truncate text-sm font-medium">{riga.descrizione}</p>
          <p className="truncate text-xs text-text-3">
            {riga.documenti} document{riga.documenti === 1 ? "o" : "i"} in{" "}
            {riga.mesi} mes{riga.mesi === 1 ? "e" : "i"} ·{" "}
            {formatEuroSimbolo(riga.totalePeriodo)} nel periodo
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          Da FiC
        </Badge>
        <p className="shrink-0 text-right font-semibold tabular-nums">
          {formatEuroSimbolo(riga.mensile)}
          <span className="ml-1 text-xs font-normal text-text-3">/mese</span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 shrink-0 text-xs"
          aria-expanded={aperta}
          onClick={() => setAperta(v => !v)}
        >
          <ChevronRight
            className={cn("mr-1 h-3 w-3 transition-transform", aperta && "rotate-90")}
            aria-hidden="true"
          />
          {aperta ? "Chiudi" : "Dettagli"}
        </Button>
      </div>

      {aperta && (
        <div className="space-y-2 rounded-md border border-border bg-surface-2 p-2.5">
          <ul className="space-y-1">
            {riga.righe.slice(0, 12).map((doc: any) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="min-w-0 truncate text-text-2">
                  {doc.descrizione ?? "Senza descrizione"}
                </span>
                <span className="shrink-0 tabular-nums text-text-3">
                  {doc.data} · {formatEuroSimbolo(doc.importo)}
                </span>
              </li>
            ))}
            {riga.righe.length > 12 && (
              <li className="text-xs text-text-3">
                …e altri {riga.righe.length - 12} documenti.
              </li>
            )}
          </ul>
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
            <span className="w-full text-[11px] text-text-3">
              Non è un costo fisso? Sposta tutti i suoi documenti:
            </span>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={sposta.isPending}
              onClick={() =>
                sposta.mutate({
                  fornitore: riga.fornitore,
                  classificazione: "variabile_commessa",
                })
              }
            >
              {sposta.isPending &&
              sposta.variables?.classificazione === "variabile_commessa" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              È di commessa
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={sposta.isPending}
              onClick={() =>
                sposta.mutate({
                  fornitore: riga.fornitore,
                  classificazione: "straordinario",
                })
              }
            >
              {sposta.isPending &&
              sposta.variables?.classificazione === "straordinario" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              È straordinario
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Una riga del registro dichiarata a mano. */
function RigaDichiarata({
  riga,
  onModifica,
  onElimina,
  eliminaInCorso,
}: {
  riga: any;
  onModifica: () => void;
  onElimina: () => void;
  eliminaInCorso: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
      <div className="min-w-[12rem] flex-1">
        <p className="truncate text-sm font-medium">{riga.descrizione}</p>
        <p className="truncate text-xs text-text-3">
          {CATEGORIA_LABEL[riga.categoria] ?? riga.categoria} ·{" "}
          {CADENZA_LABEL[riga.cadenza] ?? riga.cadenza} ·{" "}
          {etichettaMese(riga.dal)} → {riga.al ? etichettaMese(riga.al) : "in corso"}
          {riga.fornitore ? ` · ${riga.fornitore}` : ""}
        </p>
        {/* Se rimpiazza un fornitore FiC va detto qui: altrimenti il totale
            sembra aver perso una riga. */}
        {riga.sostituisceFic != null && (
          <p className="truncate text-xs text-warning">
            Sostituisce {formatEuroSimbolo(riga.sostituisceFic)}/mese di
            fatture FiC dello stesso fornitore: contati una volta sola.
          </p>
        )}
      </div>
      <Badge variant="outline" className="shrink-0 text-[10px]">
        Dichiarato
      </Badge>
      <p className="shrink-0 text-right font-semibold tabular-nums">
        {formatEuroSimbolo(riga.mensile)}
        <span className="ml-1 text-xs font-normal text-text-3">/mese</span>
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          aria-label={`Modifica ${riga.descrizione}`}
          onClick={onModifica}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 text-danger"
          aria-label={`Elimina ${riga.descrizione}`}
          disabled={eliminaInCorso}
          onClick={onElimina}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

/**
 * Un candidato in coda.
 *
 * Le tre azioni classificano il fornitore in Acquisti, e basta: se è fisso
 * entra nel registro da solo. Il dialog di conferma che c'era prima creava
 * una seconda registrazione scollegata dai documenti, e il candidato restava
 * in coda anche dopo averlo confermato.
 */
function CandidatoRicorrenza({ gruppo }: { gruppo: any }) {
  const utils = trpc.useUtils();
  const classifica = trpc.ficCosti.spostaFornitore.useMutation({
    onSuccess: (r, variabili) => {
      utils.costiFissi.invalidate();
      utils.economia.invalidate();
      utils.ficCosti.invalidate();
      toast.success(
        variabili.classificazione === "fisso"
          ? `${r.fornitore} è ora un costo fisso · ${r.aggiornati} documenti`
          : `${r.fornitore}: ${r.aggiornati} documenti riclassificati`
      );
    },
    onError: e => toast.error(e.message),
  });
  const mesi: string[] = gruppo.mesi ?? [];
  const inCorsoSu = classifica.isPending
    ? classifica.variables?.classificazione
    : null;

  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-[12rem] flex-1">
          <p className="truncate text-sm font-medium">{gruppo.fornitore}</p>
          <p className="text-xs text-text-3">
            {mesi.length} mesi consecutivi · {etichettaMese(mesi[0])} →{" "}
            {etichettaMese(mesi[mesi.length - 1])}
          </p>
        </div>
        <p className="shrink-0 text-right font-semibold tabular-nums">
          {formatEuroSimbolo(gruppo.importo)}
          <span className="ml-1 text-xs font-normal text-text-3">/mese</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          className="min-h-11"
          disabled={classifica.isPending}
          onClick={() =>
            classifica.mutate({
              fornitore: gruppo.fornitore,
              classificazione: "fisso",
            })
          }
        >
          {inCorsoSu === "fisso" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-3.5 w-3.5" />
          )}
          È un costo fisso
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={classifica.isPending}
          onClick={() =>
            classifica.mutate({
              fornitore: gruppo.fornitore,
              classificazione: "variabile_commessa",
            })
          }
        >
          {inCorsoSu === "variabile_commessa" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          È di commessa
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={classifica.isPending}
          onClick={() =>
            classifica.mutate({
              fornitore: gruppo.fornitore,
              classificazione: "straordinario",
            })
          }
        >
          {inCorsoSu === "straordinario" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          È straordinario
        </Button>
      </div>
    </li>
  );
}

export default function CostiFissi({
  onVaiAdAcquisti,
}: {
  onVaiAdAcquisti?: () => void;
}) {
  const utils = trpc.useUtils();
  const registro = trpc.costiFissi.list.useQuery();
  const candidati = trpc.ficCosti.ricorrenti.useQuery();
  const [form, setForm] = useState<{ id: number | null; value: Bozza } | null>(
    null
  );

  const invalida = () => {
    utils.costiFissi.invalidate();
    utils.economia.invalidate();
    utils.ficCosti.invalidate();
  };
  const crea = trpc.costiFissi.create.useMutation({
    onSuccess: () => {
      invalida();
      setForm(null);
      toast.success("Costo fisso aggiunto");
    },
    onError: e => toast.error(e.message),
  });
  const aggiorna = trpc.costiFissi.update.useMutation({
    onSuccess: () => {
      invalida();
      setForm(null);
      toast.success("Costo fisso aggiornato");
    },
    onError: e => toast.error(e.message),
  });
  const elimina = trpc.costiFissi.remove.useMutation({
    onSuccess: invalida,
    onError: e => toast.error(e.message),
  });

  if (registro.isLoading || candidati.isLoading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-3" />
      </div>
    );
  }

  const d = registro.data;
  const righe: any[] = d?.righe ?? [];
  const vociManuali: any[] = d?.voci ?? [];
  const gruppi = candidati.data?.gruppi ?? [];
  const totale = d?.totaleMensile ?? 0;
  const daFic = righe.filter(r => r.fonte === "fic");
  const dichiarate = righe.filter(r => r.fonte === "dichiarato");

  const salvaManuale = (value: Bozza) => {
    const input = {
      descrizione: value.descrizione.trim(),
      importo: Number(value.importo.replace(",", ".")),
      cadenza: value.cadenza as any,
      dal: value.dal,
      al: value.al || null,
      categoria: value.categoria as any,
      fornitore: value.fornitore.trim() || null,
    };
    if (form?.id == null) crea.mutate(input);
    else aggiorna.mutate({ id: form.id, ...input });
  };

  const apriForm = (voceId: number | null) => {
    if (voceId == null) return setForm({ id: null, value: BOZZA_VUOTA });
    const voce = vociManuali.find(v => v.id === voceId);
    if (voce) setForm({ id: voce.id, value: bozzaDaVoce(voce) });
  };

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="totale-fissi"
        className="rounded-lg border border-primary/30 bg-surface p-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Economia</p>
            <h2 id="totale-fissi" className="text-base font-semibold">
              Costa {formatEuroSimbolo(totale)} al mese tenere aperta l&apos;azienda
            </h2>
            <p className="text-xs text-text-3">
              Media sugli ultimi {d?.mesiCoperti ?? 0} mesi con documenti
              ({d?.periodoDa} → {d?.periodoA}). È questo il numero che il
              minimo da fatturare deve coprire.
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums">
              {formatEuroSimbolo(totale)}
              <span className="ml-1 text-sm font-normal text-text-3">/mese</span>
            </p>
            <p className="text-xs text-text-3">
              {formatEuroSimbolo(d?.totaleFic ?? 0)} da FiC ·{" "}
              {formatEuroSimbolo(d?.totaleDichiarato ?? 0)} dichiarato
            </p>
          </div>
        </div>

        {/* Un totale calcolato mentre centinaia di documenti sono ancora da
            classificare è provvisorio, e va detto dove si legge la cifra. */}
        {(d?.documentiDaClassificare ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {d?.documentiDaClassificare} acquisti del periodo per{" "}
              {formatEuroSimbolo(d?.importoDaClassificare ?? 0)} non sono
              ancora classificati: il totale può solo salire.
            </span>
            {onVaiAdAcquisti && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 shrink-0 text-xs"
                onClick={onVaiAdAcquisti}
              >
                Classificali
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ── Coda: prima del registro, perché è il lavoro da fare ───────── */}
      {gruppi.length > 0 && (
        <section aria-labelledby="da-decidere" className="space-y-2">
          <div className="min-w-0">
            <h2 id="da-decidere" className="text-base font-semibold">
              Sembrano canoni
              <Badge variant="warning" className="ml-2 text-[10px]">
                {gruppi.length}
              </Badge>
            </h2>
            <p className="text-xs text-text-3">
              Stesso fornitore, stesso importo, almeno tre mesi consecutivi.
              L&apos;aritmetica li nota, ma non sa se sono struttura: decidilo
              qui e spariscono da questa lista.
            </p>
          </div>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-surface">
            {gruppi.map((gruppo: any) => (
              <CandidatoRicorrenza key={gruppo.chiave} gruppo={gruppo} />
            ))}
          </ul>
        </section>
      )}

      {/* ── Dichiarati a mano ──────────────────────────────────────────── */}
      <section aria-labelledby="dichiarati" className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 id="dichiarati" className="text-base font-semibold">
              Dichiarati a mano
              <span className="ml-2 text-sm font-normal text-text-3">
                {formatEuroSimbolo(d?.totaleDichiarato ?? 0)}/mese
              </span>
            </h2>
            <p className="text-xs text-text-3">
              Quello che in Fatture in Cloud non passa: stipendi, contributi,
              tasse, affitti pagati senza fattura passiva.
            </p>
          </div>
          <Button className="min-h-11" onClick={() => apriForm(null)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Aggiungi voce
          </Button>
        </div>
        {form && (
          <div className="rounded-lg border border-primary/40 bg-surface-2 p-3">
            <FormCosto
              value={form.value}
              pending={crea.isPending || aggiorna.isPending}
              onChange={value => setForm({ ...form, value })}
              onSubmit={() => salvaManuale(form.value)}
              onCancel={() => setForm(null)}
            />
          </div>
        )}
        {dichiarate.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-text-3">
            Nessuna voce dichiarata. Il costo fisso sta girando senza stipendi,
            contributi e tasse: il minimo da fatturare esce più basso del vero.
          </div>
        ) : (
          <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-surface">
            {dichiarate.map((riga: any) => (
              <RigaDichiarata
                key={riga.chiave}
                riga={riga}
                eliminaInCorso={elimina.isPending}
                onModifica={() => apriForm(riga.id)}
                onElimina={() => elimina.mutate({ id: riga.id })}
              />
            ))}
          </ul>
        )}
        {/* Le voci scadute non pesano più, ma restano modificabili: senza
            questo elenco sparivano dalla pagina e non si potevano riaprire. */}
        {vociManuali.length > dichiarate.length && (
          <p className="text-xs text-text-3">
            {vociManuali.length - dichiarate.length} voci non più valide non
            pesano sul totale.{" "}
            {vociManuali
              .filter(v => !dichiarate.some(r => r.id === v.id))
              .map(v => (
                <Button
                  key={v.id}
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => apriForm(v.id)}
                >
                  {v.descrizione}
                </Button>
              ))
              .reduce(
                (acc: any[], el, i) =>
                  i === 0 ? [el] : [...acc, <span key={`s${i}`}> · </span>, el],
                []
              )}
          </p>
        )}
      </section>

      {/* ── Da Fatture in Cloud ────────────────────────────────────────── */}
      <section aria-labelledby="da-fic" className="space-y-2">
        <div className="min-w-0">
          <h2 id="da-fic" className="text-base font-semibold">
            Da Fatture in Cloud
            <span className="ml-2 text-sm font-normal text-text-3">
              {formatEuroSimbolo(d?.totaleFic ?? 0)}/mese
            </span>
          </h2>
          <p className="text-xs text-text-3">
            I fornitori classificati «Fisso» nella scheda Acquisti. Non serve
            confermarli qui: la classificazione basta.
          </p>
        </div>
        {daFic.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-text-3">
            Nessun fornitore classificato come fisso.{" "}
            {onVaiAdAcquisti && (
              <Button variant="link" className="h-auto p-0" onClick={onVaiAdAcquisti}>
                Classificali in Acquisti
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-surface">
            {daFic.map((riga: any) => (
              <RigaFic key={riga.chiave} riga={riga} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
