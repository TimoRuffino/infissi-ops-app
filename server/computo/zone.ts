// server/computo/zone.ts
// Zona climatica dal comune del cantiere (DPR 412/93, Tabella A). Il foglio
// la faceva digitare a mano in INIZIO!H11: una lettera sbagliata spostava il
// massimale da 780 a 660 in silenzio. Qui si deriva dal comune; l'override
// manuale resta possibile ma è registrato (`zonaManuale`).
//
// Le sigle di provincia in shared/limiti/comuni-zona.json sono quelle del
// 1993 (fonte: Tabella A del DPR, vedi scripts/importa-comuni-zona.py):
// province istituite dopo non compaiono — LO (Lodi), MB (Monza e Brianza),
// PU (Pesaro e Urbino, ancora PS), FM (Fermo, ancora AP), BT (Barletta-
// Andria-Trani, ancora BA), e BI (Biella) solo in parte — i loro comuni
// restano sotto la provincia di origine (es. Monza è salvata come "MI").
// Una tabella comune→provincia aggiornata non è derivabile da questo PDF;
// per questo `zonaPerComune` usa la provincia SOLO per scegliere fra
// omonimi, non per respingere un comune trovato univocamente.
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
 * Comune per nome (e provincia, se nota). La provincia serve SOLO a
 * disambiguare gli omonimi: se il nome ha un unico candidato viene
 * restituito comunque, anche quando la provincia indicata non corrisponde
 * (le sigle del dataset sono quelle del 1993 — vedi commento in testa al
 * file). Con più candidati (omonimi veri, es. Samone TO/TN) la provincia
 * deve corrispondere, altrimenti null: meglio chiedere che scegliere a
 * caso. Nome sconosciuto → null.
 */
export function zonaPerComune(
  nome: string,
  provincia?: string | null
): ComuneZona | null {
  const candidati = INDICE.get(normalizzaNomeComune(nome)) ?? [];
  if (candidati.length === 0) return null;
  if (candidati.length === 1) return candidati[0];
  if (!provincia) return null;
  return candidati.find(c => c.provincia === provincia.trim().toUpperCase()) ?? null;
}
