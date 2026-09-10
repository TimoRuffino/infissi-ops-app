// Dalla correzione all'ancora.
//
// La persona non annota il PDF: corregge un valore sbagliato. Il codice
// guarda dove quel valore sta nel testo e registra che cosa lo PRECEDE —
// l'etichetta stampata — insieme alla forma attesa. Nel profilo il valore non
// entra mai: entra il modo di ritrovarlo.
//
// Due casi in cui NON si deriva niente, ed entrambi sono voluti: il valore
// non compare nel foglio (allora non è un appiglio, è un'invenzione), oppure
// compare ma non ha niente prima (nessuna etichetta a cui agganciarsi).

import type {
  AncoraCampo,
  CampoAncorabile,
  FormaValore,
  PosizioneAncora,
} from "@shared/documenti/profilo";

export type Correzione = { campo: CampoAncorabile; valore: string };

const IMPORTO = /^\d{1,3}(?:[.\s]\d{3})*,\d{2}$|^\d+,\d{2}$/;
const DATA = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const NUMERO = /^[A-Z]{0,4}[-_/]?\d{3,}$/i;

function formaDi(valore: string): FormaValore {
  if (IMPORTO.test(valore)) return "importo";
  if (DATA.test(valore)) return "data";
  if (NUMERO.test(valore)) return "numero";
  return "testo";
}

/** L'ultima parola stampata prima del valore: è l'appiglio. */
function etichettaPrima(
  prima: string
): { etichetta: string; posizione: PosizioneAncora } | null {
  // Due o più spazi = una colonna: il valore sta nella cella a destra.
  const celle = prima.split(/\s{2,}/);
  const ultimaCella = celle[celle.length - 1]?.trim() ?? "";
  const posizione: PosizioneAncora =
    celle.length > 1 && ultimaCella === "" ? "cella_a_destra" : "dopo_etichetta";
  const testo =
    (posizione === "cella_a_destra" ? celle[celle.length - 2] : ultimaCella) ?? "";
  // L'etichetta è fatta di parole, non di cifre: «2026 - CV » → «CV».
  const parole = testo
    .split(/[\s:.\-–|]+/)
    .map(p => p.trim())
    .filter(p => p.length >= 2 && !/\d/.test(p));
  if (parole.length === 0) return null;
  return { etichetta: parole.slice(-2).join(" ").slice(0, 40), posizione };
}

export function derivaAncore(
  pagine: readonly string[],
  correzioni: readonly Correzione[]
): AncoraCampo[] {
  const ancore: AncoraCampo[] = [];
  for (const c of correzioni) {
    const valore = c.valore.trim();
    if (!valore) continue;
    for (let p = 0; p < pagine.length; p += 1) {
      const idx = pagine[p].indexOf(valore);
      if (idx < 0) continue;
      const inizioRiga = pagine[p].lastIndexOf("\n", idx) + 1;
      const prima = pagine[p].slice(inizioRiga, idx);
      const appiglio = etichettaPrima(prima);
      // Il valore c'è ma non ha niente prima: nessun appiglio, nessuna ancora.
      if (!appiglio) break;
      ancore.push({
        campo: c.campo,
        etichetta: appiglio.etichetta,
        posizione: appiglio.posizione,
        forma: formaDi(valore),
        pagina: p + 1,
      });
      break;
    }
  }
  return ancore;
}
