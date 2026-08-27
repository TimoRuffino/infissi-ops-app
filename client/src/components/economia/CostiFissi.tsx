// Costi fissi dell'azienda — l'elenco che spiega la cifra.
//
// Prima questa scheda mostrava i gruppi RILEVATI dall'aritmetica della
// ricorrenza (26 gruppi, €9.192/mese) mentre il break-even sommava tutti i
// documenti classificati `fisso` (37 fornitori, €9.313/mese). Due insiemi
// diversi con due numeri che si somigliavano per caso: l'elenco non spiegava
// la cifra sotto cui si decide se l'anno regge.
//
// E mancava il pezzo più grande. Stipendi, contributi, tasse, affitti pagati
// senza fattura passiva: niente di tutto questo passa da Fatture in Cloud,
// quindi non entrava nel pareggio e non c'era modo di aggiungerlo. Ora c'è.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  CalendarRange,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

const ETICHETTA_CADENZA = Object.fromEntries(
  CADENZE.map(([id, testo]) => [id, testo])
) as Record<string, string>;
const ETICHETTA_CATEGORIA = Object.fromEntries(CATEGORIE) as Record<string, string>;

function etichettaMese(mese: string): string {
  const [anno, numero] = mese.split("-");
  const nomi = [
    "gen", "feb", "mar", "apr", "mag", "giu",
    "lug", "ago", "set", "ott", "nov", "dic",
  ];
  return `${nomi[Number(numero) - 1] ?? numero} ${anno.slice(2)}`;
}

function meseCorrente(): string {
  const oggi = new Date();
  return `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, "0")}`;
}

type Bozza = {
  descrizione: string;
  fornitore: string;
  importo: string;
  cadenza: string;
  dal: string;
  al: string;
  categoria: string;
  note: string;
};

const BOZZA_VUOTA: Bozza = {
  descrizione: "",
  fornitore: "",
  importo: "",
  cadenza: "mensile",
  dal: meseCorrente(),
  al: "",
  categoria: "altro",
  note: "",
};

function FormCostoFisso({
  iniziale,
  inCorso,
  onSalva,
  onAnnulla,
}: {
  iniziale: Bozza;
  inCorso: boolean;
  onSalva: (bozza: Bozza) => void;
  onAnnulla: () => void;
}) {
  const [bozza, setBozza] = useState<Bozza>(iniziale);
  const campo = (chiave: keyof Bozza) => (valore: string) =>
    setBozza(prima => ({ ...prima, [chiave]: valore }));

  const importoValido = Number(bozza.importo.replace(",", ".")) > 0;
  const mensile = importoValido
    ? Number(bozza.importo.replace(",", ".")) /
      (CADENZE.find(([id]) => id === bozza.cadenza)?.[2] ?? 1)
    : null;

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-surface-2 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cf-descrizione">Cos'è</Label>
          <Input
            id="cf-descrizione"
            value={bozza.descrizione}
            onChange={e => campo("descrizione")(e.target.value)}
            placeholder="Stipendi operai, INPS, affitto capannone…"
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cf-importo">Importo</Label>
          <Input
            id="cf-importo"
            inputMode="decimal"
            value={bozza.importo}
            onChange={e => campo("importo")(e.target.value)}
            placeholder="0,00"
            className="h-10 tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cf-cadenza">Ogni quanto</Label>
          <Select value={bozza.cadenza} onValueChange={campo("cadenza")}>
            <SelectTrigger id="cf-cadenza" className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CADENZE.map(([id, testo]) => (
                <SelectItem key={id} value={id}>
                  {testo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cf-dal">Da</Label>
          <Input
            id="cf-dal"
            type="month"
            value={bozza.dal}
            onChange={e => campo("dal")(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cf-al">A (vuoto = ancora in corso)</Label>
          <Input
            id="cf-al"
            type="month"
            value={bozza.al}
            onChange={e => campo("al")(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cf-categoria">Categoria</Label>
          <Select value={bozza.categoria} onValueChange={campo("categoria")}>
            <SelectTrigger id="cf-categoria" className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIE.map(([id, testo]) => (
                <SelectItem key={id} value={id}>
                  {testo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cf-fornitore">A chi (facoltativo)</Label>
          <Input
            id="cf-fornitore"
            value={bozza.fornitore}
            onChange={e => campo("fornitore")(e.target.value)}
            placeholder="Banca, ente, proprietario…"
            className="h-10"
          />
        </div>
      </div>

      {/* Il mensilizzato si vede mentre si scrive: è il numero che finisce
          nel pareggio, e nasconderlo obbligava a fidarsi. */}
      {mensile != null && bozza.cadenza !== "mensile" && (
        <p className="text-xs text-text-3">
          Pesa {formatEuroSimbolo(Math.round(mensile * 100) / 100)} al mese sul
          punto di pareggio.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-10" onClick={onAnnulla}>
          Annulla
        </Button>
        <Button
          size="sm"
          className="h-10"
          disabled={!bozza.descrizione.trim() || !importoValido || inCorso}
          onClick={() => onSalva(bozza)}
        >
          {inCorso ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Salva
        </Button>
      </div>
    </div>
  );
}

const ORIGINI: Array<[string, string, string]> = [
  ["ricorrenza", "ricorrenza", "Stesso importo dallo stesso fornitore per almeno tre mesi consecutivi"],
  ["regola", "regola salvata", "Una regola creata da una persona classifica questo fornitore"],
  ["persona", "deciso a mano", "Classificato da un operatore documento per documento"],
  ["tars", "Tars", "Proposto da Tars e non ancora corretto da nessuno"],
];

/**
 * Una riga della tabella FiC.
 *
 * "regola" da sola non spiegava niente: significava sia l'aritmetica della
 * ricorrenza sia una regola creata da una persona con un click su «Tutti
 * Fisso», e le due cose portano qui fornitori molto diversi. Qui si vedono
 * separate, con i documenti sotto, e si può togliere il fornitore dai costi
 * fissi in un gesto invece che aprendo 72 documenti.
 */
function RigaFornitore({ gruppo }: { gruppo: any }) {
  const utils = trpc.useUtils();
  const [aperto, setAperto] = useState(false);
  const sposta = trpc.ficCosti.spostaFornitore.useMutation({
    onSuccess: r => {
      utils.ficCosti.invalidate();
      utils.economia.invalidate();
      toast.success(
        `${r.aggiornati} documenti di ${r.fornitore} spostati fuori dai costi fissi`
      );
    },
    onError: e => toast.error(e.message),
  });

  const origini = ORIGINI.filter(([id]) => (gruppo.origini?.[id] ?? 0) > 0);

  return (
    <>
      <tr className="border-b border-border/60 last:border-0">
        <td className="px-3 py-2.5 font-medium align-top">
          <span className="block max-w-[16rem] truncate">{gruppo.fornitore}</span>
          <button
            type="button"
            className="mt-0.5 inline-flex items-center text-xs font-normal text-text-3 hover:text-text-1"
            aria-expanded={aperto}
            onClick={() => setAperto(v => !v)}
          >
            <ChevronRight
              className={cn("mr-0.5 h-3 w-3 transition-transform", aperto && "rotate-90")}
              aria-hidden="true"
            />
            <CalendarRange className="mr-1 h-3 w-3" aria-hidden="true" />
            {gruppo.documenti} document{gruppo.documenti === 1 ? "o" : "i"} su{" "}
            {gruppo.mesi} mes{gruppo.mesi === 1 ? "e" : "i"}
          </button>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums align-top">
          {formatEuroSimbolo(gruppo.mensile)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-text-3 align-top">
          {formatEuroSimbolo(gruppo.totale)}
        </td>
        <td className="px-3 py-2.5 align-top">
          <div className="flex flex-wrap gap-1">
            {origini.map(([id, etichetta, aiuto]) => (
              <Badge
                key={id}
                variant="outline"
                className="text-[10px]"
                title={aiuto}
              >
                {etichetta}
                {origini.length > 1 ? ` ${gruppo.origini[id]}` : ""}
              </Badge>
            ))}
          </div>
        </td>
      </tr>
      {aperto && (
        <tr className="border-b border-border/60 bg-surface-2 last:border-0">
          <td colSpan={4} className="px-3 py-2.5">
            {gruppo.spiegazioni?.length > 0 && (
              <ul className="mb-2 space-y-0.5 text-xs text-text-2">
                {gruppo.spiegazioni.map((testo: string) => (
                  <li key={testo}>— {testo}</li>
                ))}
              </ul>
            )}
            <ul className="mb-2 divide-y divide-border/60 rounded-md border border-border bg-surface">
              {gruppo.righe.map((riga: any) => (
                <li
                  key={riga.id}
                  className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 truncate text-text-2">
                    {riga.descrizione ?? "Senza descrizione"}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-3">
                    {etichettaMese(riga.data.slice(0, 7))} ·{" "}
                    {formatEuroSimbolo(riga.importo)}
                  </span>
                </li>
              ))}
            </ul>
            {/* Togliere un fornitore deve spostare i documenti E la regola:
                senza la regola i documenti nuovi rientrerebbero al sync dopo. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-3">
                Non è un costo fisso? Sposta tutti i {gruppo.documenti} documenti:
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs"
                disabled={sposta.isPending}
                onClick={() =>
                  sposta.mutate({
                    fornitore: gruppo.fornitore,
                    classificazione: "variabile_commessa",
                  })
                }
              >
                {sposta.isPending &&
                sposta.variables?.classificazione === "variabile_commessa" ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                È di commessa
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs"
                disabled={sposta.isPending}
                onClick={() =>
                  sposta.mutate({
                    fornitore: gruppo.fornitore,
                    classificazione: "straordinario",
                  })
                }
              >
                {sposta.isPending &&
                sposta.variables?.classificazione === "straordinario" ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                È straordinario
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function CostiFissi() {
  const utils = trpc.useUtils();
  const daFic = trpc.ficCosti.fissiPerFornitore.useQuery();
  const manuali = trpc.costiFissi.list.useQuery();
  const [form, setForm] = useState<{ id: number | null; bozza: Bozza } | null>(
    null
  );

  const invalida = () => {
    utils.costiFissi.invalidate();
    utils.economia.invalidate();
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

  if (daFic.isLoading || manuali.isLoading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="h-5 w-5 mx-auto animate-spin text-text-3" />
      </div>
    );
  }

  const gruppi = daFic.data?.gruppi ?? [];
  const mensileFic = daFic.data?.totaleMensile ?? 0;
  const voci = manuali.data?.voci ?? [];
  const mensileManuale = manuali.data?.totaleMensile ?? 0;
  const totale = Math.round((mensileFic + mensileManuale) * 100) / 100;

  const salva = (bozza: Bozza) => {
    const comune = {
      descrizione: bozza.descrizione.trim(),
      fornitore: bozza.fornitore.trim() || null,
      importo: Number(bozza.importo.replace(",", ".")),
      cadenza: bozza.cadenza as any,
      dal: bozza.dal,
      al: bozza.al || null,
      categoria: bozza.categoria as any,
      note: bozza.note.trim() || null,
    };
    if (form?.id == null) crea.mutate(comune);
    else aggiorna.mutate({ id: form.id, ...comune });
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Repeat className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Costi fissi mensili</p>
              <p className="text-xs text-text-3">
                È la cifra che il punto di pareggio sta usando
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-end gap-x-6 gap-y-2">
            <div className="text-right">
              <p className="eyebrow !text-text-3">Da Fatture in Cloud</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatEuroSimbolo(mensileFic)}
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow !text-text-3">Aggiunti a mano</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatEuroSimbolo(mensileManuale)}
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow !text-text-3">Totale al mese</p>
              <p className="text-2xl font-bold tabular-nums">
                {formatEuroSimbolo(totale)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Aggiunti a mano ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Aggiunti a mano</h3>
          <p className="text-xs text-text-3">
            Stipendi, contributi, tasse, affitti senza fattura: da Fatture in
            Cloud non passano, e senza non c&apos;è pareggio che tenga.
          </p>
        </div>
        {form === null && (
          <Button
            size="sm"
            className="h-10"
            onClick={() => setForm({ id: null, bozza: BOZZA_VUOTA })}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Aggiungi
          </Button>
        )}
      </div>

      {form !== null && (
        <FormCostoFisso
          key={form.id ?? "nuovo"}
          iniziale={form.bozza}
          inCorso={crea.isPending || aggiorna.isPending}
          onSalva={salva}
          onAnnulla={() => setForm(null)}
        />
      )}

      {voci.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border/70">
              {voci.map((voce: any) => (
                <li
                  key={voce.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {voce.descrizione}
                    </p>
                    <p className="truncate text-xs text-text-3">
                      {ETICHETTA_CATEGORIA[voce.categoria] ?? voce.categoria} ·{" "}
                      {ETICHETTA_CADENZA[voce.cadenza] ?? voce.cadenza} ·{" "}
                      {etichettaMese(voce.dal)} →{" "}
                      {voce.al ? etichettaMese(voce.al) : "in corso"}
                      {voce.fornitore ? ` · ${voce.fornitore}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums">
                      {formatEuroSimbolo(voce.mensile)}
                      <span className="ml-1 text-xs font-normal text-text-3">
                        /mese
                      </span>
                    </p>
                    {voce.cadenza !== "mensile" && (
                      <p className="text-xs tabular-nums text-text-3">
                        {formatEuroSimbolo(voce.importo)} a rata
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Modifica ${voce.descrizione}`}
                      onClick={() =>
                        setForm({
                          id: voce.id,
                          bozza: {
                            descrizione: voce.descrizione,
                            fornitore: voce.fornitore ?? "",
                            importo: String(voce.importo),
                            cadenza: voce.cadenza,
                            dal: voce.dal,
                            al: voce.al ?? "",
                            categoria: voce.categoria,
                            note: voce.note ?? "",
                          },
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-danger"
                      aria-label={`Elimina ${voce.descrizione}`}
                      disabled={elimina.isPending}
                      onClick={() => elimina.mutate({ id: voce.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {voci.length === 0 && form === null && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-text-3">
            Nessun costo fisso aggiunto a mano. Il pareggio sta girando senza
            stipendi, contributi e tasse.
          </CardContent>
        </Card>
      )}

      {/* ── Da Fatture in Cloud ────────────────────────────────────────── */}
      <div className="pt-1">
        <h3 className="text-sm font-semibold">Da Fatture in Cloud</h3>
        <p className="text-xs text-text-3">
          I documenti classificati «Fisso» negli ultimi 12 mesi
          {daFic.data
            ? ` (${etichettaMese(daFic.data.periodoDa.slice(0, 7))} → ${etichettaMese(daFic.data.periodoA.slice(0, 7))}, ${daFic.data.mesiCoperti} mesi con dati)`
            : ""}
          . È la stessa selezione che alimenta il pareggio.
        </p>
      </div>

      {gruppi.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-3">
            Nessun acquisto classificato «Fisso» nel periodo. Un costo che
            torna ogni mese con lo stesso importo viene riconosciuto da solo
            dopo il terzo mese; gli altri si classificano dal tab Acquisti.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* La tabella scorre dentro il suo contenitore: la pagina non
                deve mai guadagnare uno scroll orizzontale. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-3">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Fornitore
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">
                      Al mese
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">
                      Totale 12 mesi
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Perché è qui
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {gruppi.map((gruppo: any) => (
                    <RigaFornitore key={gruppo.fornitore} gruppo={gruppo} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <details className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-2">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-text-1">
          Come si calcola questo numero
        </summary>
        <div className="space-y-2 pb-2 leading-relaxed">
          <p>
            <strong>Totale al mese</strong> = le fatture d&apos;acquisto
            classificate «Fisso» negli ultimi 12 mesi, divise per i mesi con
            dati, <strong>più</strong> le voci aggiunte a mano, che pesano per
            quanto valgono oggi. È esattamente la cifra che il punto di
            pareggio divide per il margine di contribuzione.
          </p>
          <p>
            Un acquisto diventa «Fisso» in tre modi diversi, e la colonna
            <em> Perché è qui</em> dice quale:
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong>ricorrenza</strong> — aritmetica: stesso fornitore,
              stesso importo (tolleranza 50 centesimi), almeno tre mesi
              consecutivi. Nessun modello, nessuna valutazione.
            </li>
            <li>
              <strong>regola salvata</strong> — qualcuno ha premuto «Tutti
              Fisso» su quel fornitore in Acquisti, e da allora ogni suo
              documento nasce fisso. È il motivo per cui in questo elenco
              possono comparire fornitori che fissi non sono.
            </li>
            <li>
              <strong>deciso a mano</strong> / <strong>Tars</strong> —
              classificato documento per documento.
            </li>
          </ul>
          <p>
            Se un fornitore non ci deve stare, aprilo e premi «È di commessa» o
            «È straordinario»: sposta tutti i suoi documenti <em>e</em> la
            regola, così non rientra al prossimo sync. Da quel momento
            l&apos;aritmetica della ricorrenza lo lascia stare anche se fattura
            la stessa cifra ogni mese — un trasportatore regolare resta
            manodopera di commessa.
          </p>
          <p>
            La soglia dei 50 centesimi resta stretta di proposito: allargandola
            al 5% entrerebbero i fornitori di serramenti, e un costo variabile
            contato come fisso sballa sia il pareggio sia il margine di
            contribuzione.
          </p>
        </div>
      </details>
    </div>
  );
}
