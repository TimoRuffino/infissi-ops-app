// L'agente non si collega: non ha `avvia` né `scollega`.
//
// Esiste perché la cornice sia onesta. Un'integrazione che non richiede
// nessun gesto deve poterlo dire — sparire dall'elenco farebbe credere al
// cliente che manchi qualcosa da fare.

import type { Adattatore, Problema, Stato } from "../contratto";

export const agente: Adattatore = {
  chiave: "agente",
  ambito: "azienda",
  permesso: "utente",

  async stato(): Promise<Stato> {
    return {
      chiave: "agente",
      ambito: "azienda",
      collegato: true,
      soggetto: "Incluso nell'abbonamento",
      verificatoIl: null,
      problema: null,
    };
  },

  async verifica(): Promise<Problema | null> {
    // Il provider è della piattaforma: se manca la chiave è un guasto
    // nostro, non un collegamento che il cliente possa rifare.
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return {
        causa: "L'agente non è raggiungibile.",
        rimedio:
          "È un guasto della piattaforma: non serve nessuna azione da parte tua.",
        azione: "assistenza",
      };
    }
    return null;
  },
};
