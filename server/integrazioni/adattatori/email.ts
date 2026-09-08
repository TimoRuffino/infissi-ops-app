// L'email resta IMAP com'è (decisione 3): host, porta, utente, password.
// Su Aruba, Register e le PEC OAuth non esiste, e nessun account
// sviluppatore — nostro o di chiunque — può sostituire quelle quattro cose.
//
// `imap.ts` sa già fare la prova viva (`testaCasella`) e sa già tradurre
// l'errore in una frase utile (`messaggioErrore`, che `testaCasella`
// restituisce in `errore`). Qui non si riscrive nulla di tutto ciò: si
// aggiunge il rimedio, che dipende dalla casella, e l'azione.

import { caselle, type Casella } from "../../comunicazioni/caselle";
import { testaCasella } from "../../comunicazioni/imap";
import type { Adattatore, Avvio, Problema, Stato } from "../contratto";

function dellaSede(sedeId: number | null): Casella[] {
  return caselle.filter(c => c.sedeId === (sedeId ?? 1));
}

/**
 * Credenziali o host sbagliati si correggono; un timeout o una connessione
 * rifiutata spesso passano da soli. La frase arriva già tradotta da
 * `imap.ts`: qui si decide solo che bottone mostrare.
 */
export function azionePerGuasto(errore: string): "ricollega" | "riprova" {
  return /timeout|limitando|rifiutata: porta/i.test(errore)
    ? "riprova"
    : "ricollega";
}

export const email: Adattatore = {
  chiave: "email",
  ambito: "sede",
  permesso: "direzione",

  async stato(ctx): Promise<Stato> {
    const attive = dellaSede(ctx.sedeId).filter(c => c.attiva);
    return {
      chiave: "email",
      ambito: "sede",
      collegato: attive.length > 0,
      soggetto:
        attive.length === 0
          ? null
          : attive.length === 1
            ? attive[0].indirizzo
            : `${attive.length} caselle`,
      verificatoIl: attive.map(c => c.ultimaSync).find(Boolean) ?? null,
      problema: null,
    };
  },

  async verifica(ctx): Promise<Problema | null> {
    // La prima casella rotta basta: il rimedio la nomina, e chi la sistema
    // rilancia la prova.
    for (const c of dellaSede(ctx.sedeId).filter(x => x.attiva)) {
      const esito = await testaCasella(c);
      if (!esito.ok) {
        return {
          causa: esito.errore,
          rimedio: `Correggi i dati della casella ${c.indirizzo} qui sotto e riprova.`,
          azione: azionePerGuasto(esito.errore),
        };
      }
    }
    return null;
  },

  async avvia(): Promise<Avvio> {
    // Il modulo host/porta/utente/password vive nel client: non c'è nessun
    // giro esterno da avviare.
    return { tipo: "modulo" };
  },
};
