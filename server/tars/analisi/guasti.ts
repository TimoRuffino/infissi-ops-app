// «Occhi chiusi» — le fonti da cui Tars dovrebbe vedere e non vede più
// (direzione 08/09/2026, punto 7 del piano `2026-09-08-tars-piu-intelligente`).
//
// Fino a oggi la fotografia contava solo ciò che era ENTRATO. Se la posta
// era ferma da tre giorni non entrava niente, e il mattino scriveva «tutto
// calmo»: l'unico difetto che mente in modo rassicurante. Qui si guardano
// le diagnostiche che le integrazioni già scrivono — `ultimoErrore`,
// `ultimaSync`, `lastResult` — e si dice quale occhio è chiuso.
//
// Deterministico e senza segreti: nessun token, nessuna password, nessun
// indirizzo completo finisce nel testo che legge il modello.

import { caselle, type Casella } from "../../comunicazioni/caselle";
import { configWhatsApp } from "../../comunicazioni/whatsapp";
import { ficConfigDiSede, type FicConfig } from "../../routers/fattureInCloud";

/** Una casella ferma da più di così non è una pausa: è un guasto. */
export const ORE_CASELLA_FERMA = 6;
/** Fatture in Cloud gira una volta al giorno: sotto le 36 ore è normale. */
export const ORE_FIC_FERMO = 36;

export type GravitaGuasto = "ferma" | "rallentata";

export type GuastoIntegrazione = {
  /** Chiave stabile: `casella:3`, `whatsapp:1`, `fic`. */
  chiave: string;
  testo: string;
  gravita: GravitaGuasto;
  /** Dove si ripara. */
  link: string;
};

export type DipendenzeGuasti = {
  caselle: () => readonly Casella[];
  whatsapp: () => readonly { id: number; sedeId: number; nome: string; attiva: boolean; ultimoErrore: string | null }[];
  fic: (sedeId: number) => FicConfig | null;
};

export function dipendenzeGuastiReali(): DipendenzeGuasti {
  return {
    caselle: () => caselle,
    whatsapp: () => configWhatsApp as any[],
    fic: sedeId => ficConfigDiSede(sedeId),
  };
}

function ore(da: Date | string | null | undefined, adesso: Date): number | null {
  if (!da) return null;
  const t = new Date(da).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (adesso.getTime() - t) / 3_600_000);
}

function daOre(n: number): string {
  if (n < 48) return `${Math.floor(n)} ore`;
  return `${Math.floor(n / 24)} giorni`;
}

/**
 * Il motivo dell'ultimo errore, ridotto a una riga e senza segreti: i
 * messaggi IMAP e OAuth possono contenere l'indirizzo o pezzi di token.
 */
function motivoBreve(errore: string): string {
  const prima = errore.split("\n")[0].trim();
  const senzaSegreti = prima
    // Indirizzi: un messaggio IMAP cita la casella per intero.
    .replace(/\b[\w.%+-]+@[\w.-]+\.\w+\b/g, "…")
    // La parola chiave resta, il valore che la segue no. Si perde qualche
    // dettaglio del motivo («token scaduto» → «token …»): meglio un motivo
    // più povero che un segreto in una riga che finisce sotto gli occhi
    // del modello e nella pagina.
    .replace(/\b(bearer|token|password|secret|api[_-]?key)\b\s*[:=]?\s*\S+/gi, "$1 …")
    // Qualunque stringa lunga senza spazi: un token, un id opaco, un hash.
    .replace(/\b[A-Za-z0-9_\-.]{20,}\b/g, "…");
  return senzaSegreti.length > 120 ? `${senzaSegreti.slice(0, 117)}…` : senzaSegreti;
}

/**
 * Le fonti mute o in errore di una sede. Sola lettura: non tocca né
 * riconnette niente, dice soltanto che l'occhio è chiuso.
 */
export function guastiDiSede(input: {
  sedeId: number;
  adesso: Date;
  deps?: DipendenzeGuasti;
}): GuastoIntegrazione[] {
  const deps = input.deps ?? dipendenzeGuastiReali();
  const { sedeId, adesso } = input;
  const guasti: GuastoIntegrazione[] = [];

  for (const casella of deps.caselle()) {
    if (casella.sedeId !== sedeId || !casella.attiva) continue;
    if (casella.ultimoErrore) {
      guasti.push({
        chiave: `casella:${casella.id}`,
        testo: `Casella «${casella.nome}»: l'ultima sincronizzazione è fallita (${motivoBreve(casella.ultimoErrore)}). Finché non riparte non entra nessuna mail, quindi nessuna conferma d'ordine e nessun allegato.`,
        gravita: "ferma",
        link: "/impostazioni?tab=integrazioni",
      });
      continue;
    }
    const ferma = ore(casella.ultimaSync, adesso);
    if (ferma == null) {
      guasti.push({
        chiave: `casella:${casella.id}`,
        testo: `Casella «${casella.nome}»: attiva ma mai sincronizzata. Da qui non è mai entrato niente.`,
        gravita: "ferma",
        link: "/impostazioni?tab=integrazioni",
      });
    } else if (ferma >= ORE_CASELLA_FERMA) {
      guasti.push({
        chiave: `casella:${casella.id}`,
        testo: `Casella «${casella.nome}»: nessuna sincronizzazione da ${daOre(ferma)}. Il giro normale è di pochi minuti: qualcosa la sta bloccando.`,
        gravita: "ferma",
        link: "/impostazioni?tab=integrazioni",
      });
    }
  }

  for (const numero of deps.whatsapp()) {
    if (numero.sedeId !== sedeId || !numero.attiva) continue;
    if (numero.ultimoErrore) {
      guasti.push({
        chiave: `whatsapp:${numero.id}`,
        testo: `WhatsApp «${numero.nome}»: ultimo errore ${motivoBreve(numero.ultimoErrore)}. I messaggi e i file mandati dai clienti possono non arrivare.`,
        gravita: "ferma",
        link: "/impostazioni?tab=integrazioni",
      });
    }
  }

  const fic = deps.fic(sedeId);
  if (fic?.enabled) {
    const scaduto =
      fic.authMode === "oauth" &&
      !fic.refreshTokenCifrato &&
      (fic.accessTokenExpiresAt == null ||
        new Date(fic.accessTokenExpiresAt).getTime() <= adesso.getTime());
    if (scaduto) {
      guasti.push({
        chiave: "fic",
        testo:
          "Fatture in Cloud: il collegamento è scaduto e non c'è un refresh token per rinnovarlo da solo. Va ricollegato a mano, altrimenti fatture e incassi restano fermi a quello che c'è.",
        gravita: "ferma",
        link: "/impostazioni?tab=integrazioni",
      });
    } else {
      const fermo = ore(fic.lastSyncAt, adesso);
      const erroreUltimo =
        fic.lastResult && /err|fail|401|403|scadut/i.test(fic.lastResult)
          ? fic.lastResult
          : null;
      if (erroreUltimo) {
        guasti.push({
          chiave: "fic",
          testo: `Fatture in Cloud: l'ultima sincronizzazione non è andata a buon fine (${motivoBreve(erroreUltimo)}).`,
          gravita: "ferma",
          link: "/impostazioni?tab=integrazioni",
        });
      } else if (fermo == null) {
        guasti.push({
          chiave: "fic",
          testo:
            "Fatture in Cloud: collegato ma mai sincronizzato. Fatture e incassi non sono ancora entrati.",
          gravita: "ferma",
          link: "/impostazioni?tab=integrazioni",
        });
      } else if (fermo >= ORE_FIC_FERMO) {
        guasti.push({
          chiave: "fic",
          testo: `Fatture in Cloud: nessuna sincronizzazione da ${daOre(fermo)}. Fatture e incassi che vedi possono essere vecchi.`,
          gravita: "rallentata",
          link: "/impostazioni?tab=integrazioni",
        });
      }
    }
  }

  return guasti;
}
