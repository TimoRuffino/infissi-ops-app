// Costi fissi — registro confermato e coda dei candidati FiC.
//
// Niente tabelle qui dentro, per un motivo misurato: la coda aveva cinque
// colonne e tre bottoni nell'ultima, circa 1360px, mentre a 1440 con la
// sidebar ne restano ~1136. I bottoni per classificare finivano oltre il
// bordo dello scroll orizzontale, quindi la coda si vedeva ma non si poteva
// smaltire. A 390px non se ne parlava proprio.
//
// Righe che vanno a capo, invece: l'importo resta a destra, le azioni stanno
// sulla loro riga e sono sempre raggiungibili a qualsiasi larghezza.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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

function bozzaDaCandidato(candidato: any): Bozza {
  return {
    descrizione: candidato.fornitore,
    importo: String(candidato.importo),
    cadenza: "mensile",
    dal: candidato.mesi?.[0] ?? meseCorrente(),
    al: "",
    categoria: "servizi",
    fornitore: candidato.fornitore,
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

/** Una voce del registro confermato. */
function VoceConfermata({
  voce,
  onModifica,
  onElimina,
  eliminaInCorso,
}: {
  voce: any;
  onModifica: () => void;
  onElimina: () => void;
  eliminaInCorso: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
      <div className="min-w-[12rem] flex-1">
        <p className="truncate text-sm font-medium">{voce.descrizione}</p>
        <p className="truncate text-xs text-text-3">
          {CATEGORIA_LABEL[voce.categoria] ?? voce.categoria} ·{" "}
          {CADENZA_LABEL[voce.cadenza] ?? voce.cadenza} ·{" "}
          {etichettaMese(voce.dal)} → {voce.al ? etichettaMese(voce.al) : "in corso"}
          {voce.fornitore ? ` · ${voce.fornitore}` : ""}
        </p>
      </div>
      <Badge variant="outline" className="shrink-0 text-[10px]">
        {voce.origine === "fic" ? "FiC confermato" : "Manuale"}
      </Badge>
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums">
          {formatEuroSimbolo(voce.mensile)}
          <span className="ml-1 text-xs font-normal text-text-3">/mese</span>
        </p>
        {voce.cadenza !== "mensile" && (
          <p className="text-xs tabular-nums text-text-3">
            {formatEuroSimbolo(voce.importo)} a scadenza
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          aria-label={`Modifica ${voce.descrizione}`}
          onClick={onModifica}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 text-danger"
          aria-label={`Elimina ${voce.descrizione}`}
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
 * Le tre azioni stanno su una riga propria che va a capo: sono la ragione
 * per cui questa sezione esiste, e nella tabella precedente erano la prima
 * cosa a finire fuori schermo.
 */
function CandidatoRicorrenza({
  gruppo,
  onConferma,
}: {
  gruppo: any;
  onConferma: () => void;
}) {
  const utils = trpc.useUtils();
  const classifica = trpc.ficCosti.spostaFornitore.useMutation({
    onSuccess: r => {
      utils.costiFissi.invalidate();
      utils.economia.invalidate();
      utils.ficCosti.invalidate();
      toast.success(`${r.fornitore}: ${r.aggiornati} documenti riclassificati`);
    },
    onError: e => toast.error(e.message),
  });
  const mesi: string[] = gruppo.mesi ?? [];

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
          onClick={onConferma}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Conferma fisso
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
          {classifica.isPending &&
          classifica.variables?.classificazione === "variabile_commessa" ? (
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
          {classifica.isPending &&
          classifica.variables?.classificazione === "straordinario" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          È straordinario
        </Button>
      </div>
    </li>
  );
}

export default function CostiFissi() {
  const utils = trpc.useUtils();
  const registro = trpc.costiFissi.list.useQuery();
  const candidati = trpc.ficCosti.ricorrenti.useQuery();
  const [form, setForm] = useState<{ id: number | null; value: Bozza } | null>(
    null
  );
  const [candidato, setCandidato] = useState<any | null>(null);

  const invalida = () => {
    utils.costiFissi.invalidate();
    utils.economia.invalidate();
    utils.ficCosti.invalidate();
  };
  const crea = trpc.costiFissi.create.useMutation({
    onSuccess: () => {
      invalida();
      setForm(null);
    },
    onError: e => toast.error(e.message),
  });
  const aggiorna = trpc.costiFissi.update.useMutation({
    onSuccess: () => {
      invalida();
      setForm(null);
    },
    onError: e => toast.error(e.message),
  });
  const elimina = trpc.costiFissi.remove.useMutation({
    onSuccess: invalida,
    onError: e => toast.error(e.message),
  });
  const conferma = trpc.costiFissi.confermaDaFic.useMutation({
    onSuccess: () => {
      invalida();
      setCandidato(null);
    },
    onError: e => toast.error(e.message),
  });

  if (registro.isLoading || candidati.isLoading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-3" />
      </div>
    );
  }

  const voci = registro.data?.voci ?? [];
  const gruppi = candidati.data?.gruppi ?? [];
  const totale = registro.data?.totaleMensile ?? 0;
  const potenziale = candidati.data?.totaleMensilePotenziale ?? 0;

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

  const confermaCandidato = (value: Bozza) =>
    conferma.mutate({
      chiave: candidato.chiave,
      descrizione: value.descrizione.trim(),
      importo: Number(value.importo.replace(",", ".")),
      cadenza: value.cadenza as any,
      dal: value.dal,
      al: value.al || null,
      categoria: value.categoria as any,
    });

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="totale-certo"
        className="rounded-lg border border-primary/30 bg-surface p-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Economia</p>
            <h2 id="totale-certo" className="text-base font-semibold">
              Totale certo
            </h2>
            <p className="text-xs text-text-3">
              Solo il registro confermato alimenta il punto di pareggio.
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums">
              {formatEuroSimbolo(totale)}
              <span className="ml-1 text-sm font-normal text-text-3">/mese</span>
            </p>
            <p className="text-xs text-text-3">
              {voci.length} {voci.length === 1 ? "voce attiva" : "voci attive"}
              {gruppi.length > 0
                ? ` · ${gruppi.length} in attesa per ${formatEuroSimbolo(potenziale)}`
                : ""}
            </p>
          </div>
        </div>
      </section>

      {/* ── Coda: prima del registro, perché è il lavoro da fare ───────── */}
      <section aria-labelledby="da-confermare" className="space-y-2">
        <div className="min-w-0">
          <h2 id="da-confermare" className="text-base font-semibold">
            Da confermare
            {gruppi.length > 0 && (
              <Badge variant="warning" className="ml-2 text-[10px]">
                {gruppi.length}
              </Badge>
            )}
          </h2>
          <p className="text-xs text-text-3">
            Ricorrenze rilevate dall&apos;aritmetica: stesso fornitore, stesso
            importo, almeno tre mesi consecutivi. Non entrano nel totale finché
            una persona non decide.
          </p>
        </div>
        {gruppi.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-text-3">
            Nessun candidato da confermare.
          </div>
        ) : (
          <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-surface">
            {gruppi.map((gruppo: any) => (
              <CandidatoRicorrenza
                key={gruppo.chiave}
                gruppo={gruppo}
                onConferma={() => setCandidato(gruppo)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Registro confermato ────────────────────────────────────────── */}
      <section aria-labelledby="registro-confermato" className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 id="registro-confermato" className="text-base font-semibold">
              Registro confermato
            </h2>
            <p className="text-xs text-text-3">
              Voci manuali o confermate da FiC, con validità e incidenza
              mensile verificabili.
            </p>
          </div>
          <Button
            className="min-h-11"
            onClick={() => setForm({ id: null, value: BOZZA_VUOTA })}
          >
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
        {voci.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-text-3">
            Nessuna voce confermata. Il totale certo è zero: il pareggio sta
            girando senza stipendi, contributi e tasse.
          </div>
        ) : (
          <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-surface">
            {voci.map((voce: any) => (
              <VoceConfermata
                key={voce.id}
                voce={voce}
                eliminaInCorso={elimina.isPending}
                onModifica={() => setForm({ id: voce.id, value: bozzaDaVoce(voce) })}
                onElimina={() => elimina.mutate({ id: voce.id })}
              />
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={candidato !== null}
        onOpenChange={open => !open && setCandidato(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conferma costo fisso</DialogTitle>
            <DialogDescription>
              {candidato?.fornitore} · proposta FiC. Controlla i dati prima di
              aggiungerla al registro certo.
            </DialogDescription>
          </DialogHeader>
          {candidato && (
            <CandidatoForm
              candidato={candidato}
              pending={conferma.isPending}
              onCancel={() => setCandidato(null)}
              onSubmit={confermaCandidato}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CandidatoForm({
  candidato,
  pending,
  onCancel,
  onSubmit,
}: {
  candidato: any;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: Bozza) => void;
}) {
  const [value, setValue] = useState(() => bozzaDaCandidato(candidato));
  return (
    <FormCosto
      value={value}
      pending={pending}
      onChange={setValue}
      onSubmit={() => onSubmit(value)}
      onCancel={onCancel}
      submitLabel="Conferma e registra"
    />
  );
}
