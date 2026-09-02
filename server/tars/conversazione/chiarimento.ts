// Risposta a una domanda di chiarimento «Quale intendi: A oppure B?».
//
// Deterministico e indulgente, di proposito: chi risponde a una domanda
// chiusa scrive «096», «la seconda», «Bertoli», «quella dell'immobiliare»,
// non il codice completo. Si accetta tutto ciò che identifica UN solo
// candidato; l'ambiguità resta ambiguità (nessuna scelta a caso).

import type { CandidatoChiarificazioneCommessa } from "./types";

export type EsitoRispostaChiarificazione =
  | { stato: "scelto"; candidato: CandidatoChiarificazioneCommessa; motivo: string }
  | { stato: "ambiguo"; candidati: CandidatoChiarificazioneCommessa[] }
  | { stato: "non_riconosciuta" };

const ORDINALI: Array<[RegExp, number]> = [
  [/\b(?:la\s+|il\s+)?(?:prim[ao]|1[ªº°]?|uno)\b/i, 0],
  [/\b(?:la\s+|il\s+)?(?:second[ao]|2[ªº°]?|due)\b/i, 1],
  [/\b(?:la\s+|il\s+)?(?:terz[ao]|3[ªº°]?|tre)\b/i, 2],
  [/\b(?:la\s+|il\s+)?(?:quart[ao]|4[ªº°]?|quattro)\b/i, 3],
];

const STOPWORD = new Set([
  "la", "il", "lo", "le", "gli", "di", "del", "della", "dello", "dei",
  "delle", "quella", "quello", "quelle", "quelli", "commessa", "commesse",
  "codice", "numero", "intendo", "intendevo", "quella", "questa", "questo",
  "si", "sì", "ok", "va", "bene", "grazie", "per", "con", "su", "sulla",
  "sul", "srl", "spa", "snc", "sas", "societa", "società", "ditta",
]);

function normalizza(testo: string): string {
  return testo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Il progressivo di un codice COM-YYYY-NNN, come numero. */
function progressivoDiCodice(codice: string): number | null {
  const m = /(\d{1,4})\s*$/.exec(codice.trim());
  return m ? Number(m[1]) : null;
}

function annoDiCodice(codice: string): number | null {
  const m = /(\d{4})[\s\-–_]+\d{1,4}\s*$/.exec(codice.trim());
  return m ? Number(m[1]) : null;
}

export function risolviRispostaChiarificazione(
  messaggio: string,
  candidati: readonly CandidatoChiarificazioneCommessa[]
): EsitoRispostaChiarificazione {
  const testo = normalizza(messaggio).trim();
  if (!testo || candidati.length === 0) return { stato: "non_riconosciuta" };
  const unico = (
    scelti: readonly CandidatoChiarificazioneCommessa[],
    motivo: string
  ): EsitoRispostaChiarificazione | null => {
    if (scelti.length === 1) return { stato: "scelto", candidato: scelti[0], motivo };
    if (scelti.length > 1) return { stato: "ambiguo", candidati: [...scelti] };
    return null;
  };

  // 1. Codice completo (o quasi: anno + progressivo).
  const codiceCompleto = /\bcom[\s\-–_]*(\d{4})[\s\-–_]*(\d{1,4})\b/i.exec(testo);
  const annoProgressivo = codiceCompleto ?? /\b(\d{4})[\s\-–_/]+(\d{1,4})\b/.exec(testo);
  if (annoProgressivo) {
    const anno = Number(annoProgressivo[1]);
    const prog = Number(annoProgressivo[2]);
    const esito = unico(
      candidati.filter(
        c => annoDiCodice(c.codice) === anno && progressivoDiCodice(c.codice) === prog
      ),
      "codice indicato"
    );
    if (esito) return esito;
  }

  // 2. Solo il progressivo («096», «la 96», «n. 96»). Se coincide con un
  //    ordinale (1-4) e c'è un candidato con quel progressivo, vince il
  //    progressivo: «2» quando esiste COM-…-002 fra le opzioni.
  const numeri = [...testo.matchAll(/\b(\d{1,4})\b/g)].map(m => Number(m[1]));
  for (const numero of numeri) {
    const esito = unico(
      candidati.filter(c => progressivoDiCodice(c.codice) === numero),
      "progressivo indicato"
    );
    if (esito) return esito;
  }

  // 3. Ordinali («la prima», «la seconda», «2»).
  for (const [regex, indice] of ORDINALI) {
    if (regex.test(testo) && candidati[indice]) {
      return { stato: "scelto", candidato: candidati[indice], motivo: "posizione indicata" };
    }
  }

  // 4. Parole del cliente/etichetta: vince il candidato le cui parole
  //    coprono la risposta; se la risposta è dentro più candidati, chi
  //    ne copre di più; parità = ambiguo.
  const parole = testo
    .split(/[^a-z0-9]+/)
    .filter(p => p.length >= 3 && !STOPWORD.has(p));
  if (parole.length > 0) {
    const punteggi = candidati.map(c => {
      const etichetta = normalizza(`${c.codice} ${c.cliente}`);
      const paroleEtichetta = etichetta.split(/[^a-z0-9]+/).filter(Boolean);
      const coperte = parole.filter(p =>
        paroleEtichetta.some(e => e === p || (p.length >= 4 && e.startsWith(p)))
      ).length;
      return { c, coperte, totale: paroleEtichetta.length };
    });
    const massimo = Math.max(...punteggi.map(p => p.coperte));
    if (massimo > 0) {
      const migliori = punteggi.filter(p => p.coperte === massimo);
      if (migliori.length === 1) {
        return { stato: "scelto", candidato: migliori[0].c, motivo: "nome indicato" };
      }
      // Parità sulle parole coperte: preferisci il candidato con meno
      // parole estranee («Bertoli» → «Bertoli Duilio», non «IMMOBILIARE
      // BERTOLI di Bertoli Duilio»), se la differenza è netta.
      const ordinati = [...migliori].sort((a, b) => a.totale - b.totale);
      if (ordinati[0].totale < ordinati[1].totale) {
        return { stato: "scelto", candidato: ordinati[0].c, motivo: "nome indicato" };
      }
      return { stato: "ambiguo", candidati: migliori.map(m => m.c) };
    }
  }

  return { stato: "non_riconosciuta" };
}

/** Testo della seconda domanda: dice COME rispondere, non solo cosa. */
export function domandaChiarificazioneRipetuta(
  candidati: readonly CandidatoChiarificazioneCommessa[]
): string {
  const opzioni = candidati
    .slice(0, 4)
    .map((c, i) => `${i + 1}) ${c.codice} — ${c.cliente}`);
  return `Non ho riconosciuto la risposta. Quale intendi? ${opzioni.join("; ")}. Puoi rispondere col numero (es. «${progressivoDiCodice(candidati[0].codice) ?? 1}»), col codice o col nome del cliente.`;
}
