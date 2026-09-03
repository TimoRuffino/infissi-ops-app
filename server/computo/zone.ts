// server/computo/zone.ts
// Zona climatica dal comune del cantiere (DPR 412/93, Tabella A). Il foglio
// la faceva digitare a mano in INIZIO!H11: una lettera sbagliata spostava il
// massimale da 780 a 660 in silenzio. Qui si deriva dal comune; l'override
// manuale resta possibile ma è registrato (`zonaManuale`).
import comuni from "@shared/limiti/comuni-zona.json";
import type { ZonaClimatica } from "@shared/limiti/tipi";

export type ComuneZona = {
  codiceIstat: string | null;
  nome: string;
  provincia: string;
  regione: string;
  zona: ZonaClimatica;
  gradiGiorno: number;
};

const ELENCO = comuni as ComuneZona[];

export function normalizzaNomeComune(nome: string): string {
  return nome
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const INDICE = new Map<string, ComuneZona[]>();
for (const c of ELENCO) {
  const chiave = normalizzaNomeComune(c.nome);
  const lista = INDICE.get(chiave) ?? [];
  lista.push(c);
  INDICE.set(chiave, lista);
}

/**
 * Comune per nome (e provincia, se nota). Con omonimi e provincia assente
 * restituisce null: meglio chiedere che scegliere a caso.
 */
export function zonaPerComune(
  nome: string,
  provincia?: string | null
): ComuneZona | null {
  const candidati = INDICE.get(normalizzaNomeComune(nome)) ?? [];
  if (candidati.length === 0) return null;
  if (provincia) {
    return candidati.find(c => c.provincia === provincia.trim().toUpperCase()) ?? null;
  }
  return candidati.length === 1 ? candidati[0] : null;
}
