import type { Fattura, RigaFattura } from "@shared/fatturazione/tipi";
import { dataItaliana } from "./contrattoView";
import { formatCent } from "./limitiView";

/** Una riga del documento stampato: testo pieno (intestazioni e note) o voce con importi. */
export type RigaStampa =
  | { tipo: "testo"; chiave: number; testo: string }
  | {
      tipo: "voce";
      chiave: number;
      descrizione: string;
      quantita: string;
      prezzoUnit: string;
      importo: string;
      aliquota: string;
    };

/**
 * Le righe nell'ordine del documento (`ordine`), come le stampa Fatture in
 * Cloud: le intestazioni e le note occupano la riga intera, tutto il resto
 * porta quantità, prezzo unitario, importo e aliquota. Gli importi sono già
 * formattati con l'helper euro: il componente non fa aritmetica.
 */
export function righeStampa(righe: RigaFattura[]): RigaStampa[] {
  return [...righe]
    .sort((a, b) => a.ordine - b.ordine || a.id - b.id)
    .map(r =>
      r.tipo === "intestazione" || r.tipo === "nota"
        ? { tipo: "testo" as const, chiave: r.id, testo: r.descrizione }
        : {
            tipo: "voce" as const,
            chiave: r.id,
            descrizione: r.descrizione,
            quantita: quantitaTesto(r.quantita),
            prezzoUnit: formatCent(r.prezzoUnitCent),
            importo: formatCent(r.importoCent),
            aliquota: r.aliquota == null ? "—" : `${r.aliquota} %`,
          }
    );
}

function quantitaTesto(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

/**
 * Titolo del documento: una fattura emessa ha numero e data; una bozza è
 * dichiarata tale nel titolo e nella filigrana, perché la stampa di una
 * bozza non è un documento fiscale.
 */
export function intestazioneStampa(
  f: Pick<Fattura, "tipo" | "stato" | "numero" | "data">
): { titolo: string; bozza: boolean } {
  const nome = f.tipo === "nota_credito" ? "Nota di credito" : "Fattura";
  const bozza = f.stato === "bozza" || f.stato === "annullata" || !f.numero;
  if (bozza) return { titolo: `Bozza di ${nome.toLowerCase()}`, bozza: true };
  const data = f.data ? ` del ${dataItaliana(f.data)}` : "";
  return { titolo: `${nome} n. ${f.numero}${data}`, bozza: false };
}

/** "Rossi Mario · Via Alta 80, 19038 Sarzana (SP)": una riga per il blocco cliente. */
export function indirizzoCliente(
  s: { indirizzo: string; cap: string; citta: string; provincia: string } | null
): string {
  if (!s) return "";
  const luogo = [s.cap, s.citta].filter(Boolean).join(" ");
  const prov = s.provincia ? ` (${s.provincia})` : "";
  return [s.indirizzo, luogo ? `${luogo}${prov}` : ""].filter(Boolean).join(", ");
}
