// Le scadenze di pagamento della bozza: numero, quota, data, importo e
// descrizione. Componente controllato — il totale da raggiungere e il
// salvataggio restano di chi lo monta (`BozzaFatturaEditor`): qui si
// modificano le righe e si dice se quadrano, nient'altro. La quadratura la
// pretende il server (`aggiornaBozza` rifiuta scadenze che non sommano al
// totale): mostrarla qui evita di scoprirlo con un errore.
import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";

import type {
  ScadenzaFattura,
  ScadenzaFatturaInput,
} from "@shared/fatturazione/tipi";
import { scadenzeQuadrano, sommaScadenzeCent } from "@/lib/fatturaView";
import { formatEuro, parseEuroNonNegativo } from "@/lib/euro";
import { formatCent } from "@/lib/limitiView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ScadenzaForm = {
  /** Chiave React stabile: il numero si rinumera a ogni rimozione. */
  chiave: string;
  numero: number;
  quotaTesto: string;
  /** YYYY-MM-DD, come l'input date. */
  data: string;
  importoTesto: string;
  descrizione: string;
};

/** Griglia condivisa da intestazione e righe: una sola definizione, niente colonne sfasate. */
const COLONNE =
  "grid-cols-2 md:grid-cols-[2.5rem_5rem_9.5rem_7rem_minmax(0,1fr)_2.25rem]";

/** Quante scadenze accetta `aggiornaBozza`: oltre, il server rifiuta la modifica. */
export const MAX_SCADENZE = 12;
/** Il server taglia la descrizione a 120 caratteri: meglio non farglielo fare di nascosto. */
const MAX_DESCRIZIONE_SCADENZA = 120;

/**
 * La chiave arriva da fuori: chi crea la riga sa da dove viene (`srv-` per le
 * scadenze del server, `nuova-` per quelle aggiunte qui) e i due prefissi non
 * si scontrano. Così non serve un contatore di modulo, che vivrebbe più a
 * lungo del componente.
 */
export function scadenzaDaServer(
  s: ScadenzaFattura,
  chiave: string
): ScadenzaForm {
  return {
    chiave,
    numero: s.numero,
    quotaTesto: String(s.quotaPct),
    data: s.data,
    importoTesto: formatEuro(s.importoCent / 100),
    descrizione: s.descrizione ?? "",
  };
}

/** Una scadenza nuova nasce a zero: quota e importo li scrive chi fattura. */
export function scadenzaVuota(
  numero: number,
  data: string,
  chiave: string
): ScadenzaForm {
  return {
    chiave,
    numero,
    quotaTesto: "0",
    data,
    importoTesto: "0,00",
    descrizione: "",
  };
}

function centDiTesto(testo: string): number {
  const euro = parseEuroNonNegativo(testo);
  return euro == null ? 0 : Math.round(euro * 100);
}

export function scadenzaInput(f: ScadenzaForm): ScadenzaFatturaInput {
  const quota = parseEuroNonNegativo(f.quotaTesto);
  return {
    numero: f.numero,
    quotaPct: quota == null ? 0 : Math.min(100, quota),
    data: f.data,
    importoCent: centDiTesto(f.importoTesto),
    descrizione: f.descrizione.trim() || null,
  };
}

/**
 * `sommaScadenzeCent` e `scadenzeQuadrano` lavorano sulla scadenza salvata,
 * qui invece siamo ancora nel form: `id`, `ficPaymentId` e `stato` sono
 * segnaposto e non vengono letti — alle due funzioni serve solo
 * `importoCent`.
 */
function comeScadenzaSalvata(f: ScadenzaForm, indice: number): ScadenzaFattura {
  return {
    id: indice,
    fatturaId: 0,
    ficPaymentId: null,
    stato: "attesa",
    ...scadenzaInput(f),
  };
}

export default function ScadenzeEditor({
  scadenze,
  totaleCent,
  disabilitato = false,
  onChange,
}: {
  scadenze: ScadenzaForm[];
  /** Il totale della fattura salvata: è contro questo che il server verifica. */
  totaleCent: number;
  disabilitato?: boolean;
  onChange: (scadenze: ScadenzaForm[]) => void;
}) {
  // Le chiavi delle scadenze aggiunte qui: un contatore per montaggio, non
  // di modulo — due editor aperti non si rubano i numeri.
  const contatore = useRef(0);
  const salvate = scadenze.map(comeScadenzaSalvata);
  const somma = sommaScadenzeCent(salvate);
  const quadra = scadenzeQuadrano(salvate, totaleCent);

  const rinumera = (lista: ScadenzaForm[]): ScadenzaForm[] =>
    lista.map((s, i) => ({ ...s, numero: i + 1 }));
  const aggiorna = (chiave: string, patch: Partial<ScadenzaForm>) =>
    onChange(scadenze.map(s => (s.chiave === chiave ? { ...s, ...patch } : s)));

  return (
    <section aria-label="Scadenze di pagamento" className="space-y-2 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">Scadenze</span>
        <span
          className={`text-xs tabular-nums ${quadra ? "text-success" : "text-warning"}`}
          aria-live="polite"
        >
          sommano {formatCent(somma)} su {formatCent(totaleCent)}
          {quadra ? "" : " — non quadrano"}
        </span>
        {!disabilitato && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-8"
            disabled={scadenze.length >= MAX_SCADENZE}
            title={
              scadenze.length >= MAX_SCADENZE
                ? `Non più di ${MAX_SCADENZE} scadenze per fattura.`
                : undefined
            }
            onClick={() => {
              contatore.current += 1;
              onChange(
                rinumera([
                  ...scadenze,
                  scadenzaVuota(
                    scadenze.length + 1,
                    scadenze[scadenze.length - 1]?.data ??
                      new Date().toISOString().slice(0, 10),
                    `nuova-${contatore.current}`
                  ),
                ])
              );
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Scadenza
          </Button>
        )}
      </div>

      <div
        aria-hidden="true"
        className={`hidden md:grid ${COLONNE} gap-2 text-xs text-text-3`}
      >
        <span>#</span>
        <span>Quota %</span>
        <span>Data</span>
        <span>Importo</span>
        <span>Descrizione</span>
        <span />
      </div>

      {scadenze.length === 0 && (
        <p className="text-sm text-muted-foreground py-3">
          Nessuna scadenza: la fattura non è emettibile senza almeno una rata.
        </p>
      )}

      {scadenze.map(s => (
        <div
          key={s.chiave}
          className={`grid ${COLONNE} gap-2 items-center rounded-lg border border-border p-2 md:rounded-none md:border-0 md:p-0`}
        >
          <span className="tabular-nums text-text-3 text-sm">{s.numero}ª</span>
          <Input
            inputMode="decimal"
            className="h-9"
            placeholder="Quota %"
            aria-label={`Quota in percento della scadenza ${s.numero}`}
            value={s.quotaTesto}
            disabled={disabilitato}
            onChange={e => aggiorna(s.chiave, { quotaTesto: e.target.value })}
          />
          <Input
            type="date"
            className="h-9"
            aria-label={`Data della scadenza ${s.numero}`}
            value={s.data}
            disabled={disabilitato}
            onChange={e => aggiorna(s.chiave, { data: e.target.value })}
          />
          <Input
            inputMode="decimal"
            className="h-9 text-right tabular-nums"
            placeholder="Importo €"
            aria-label={`Importo della scadenza ${s.numero}`}
            value={s.importoTesto}
            disabled={disabilitato}
            onChange={e => aggiorna(s.chiave, { importoTesto: e.target.value })}
            onBlur={() =>
              aggiorna(s.chiave, {
                importoTesto: formatEuro(centDiTesto(s.importoTesto) / 100),
              })
            }
          />
          <Input
            className="h-9 col-span-2 md:col-span-1"
            maxLength={MAX_DESCRIZIONE_SCADENZA}
            placeholder="Descrizione"
            aria-label={`Descrizione della scadenza ${s.numero}`}
            value={s.descrizione}
            disabled={disabilitato}
            onChange={e => aggiorna(s.chiave, { descrizione: e.target.value })}
          />
          {!disabilitato && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 justify-self-end text-danger hover:text-danger hover:bg-danger-soft"
              aria-label={`Rimuovi la scadenza ${s.numero}`}
              onClick={() =>
                onChange(rinumera(scadenze.filter(x => x.chiave !== s.chiave)))
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
