// Avvolge l'Embedded Signup che esiste già: `scambiaCode`,
// `sottoscriviApp`, `numeriDellaWaba`, `sincronizzaStorico`. Il collegamento
// era da un click già prima del WS5; davanti c'era «apriti un account
// sviluppatore Meta», e quello è caduto col ripiego di piattaforma.

import { appPubblica, configWhatsApp } from "../../comunicazioni/whatsapp";
import type { Adattatore, Avvio, Problema, Stato } from "../contratto";

function numeroDellaSede(sedeId: number | null) {
  return configWhatsApp.find(c => c.sedeId === (sedeId ?? 1) && c.attiva);
}

export const whatsapp: Adattatore = {
  chiave: "whatsapp",
  ambito: "sede",
  permesso: "direzione",

  async stato(ctx): Promise<Stato> {
    const mia = numeroDellaSede(ctx.sedeId);
    return {
      chiave: "whatsapp",
      ambito: "sede",
      collegato: !!mia?.tokenCifrato,
      soggetto: mia?.numero ?? null,
      verificatoIl: null,
      problema: null,
    };
  },

  async verifica(ctx): Promise<Problema | null> {
    const mia = numeroDellaSede(ctx.sedeId);
    if (!mia?.ultimoErrore) return null;
    // Meta concede 24 ore per la sincronizzazione della coexistence: oltre
    // quella finestra il numero va offboardato e rifatto. Detto in italiano,
    // non come errore Meta grezzo.
    if (/24|expired|window/i.test(mia.ultimoErrore)) {
      return {
        causa:
          "La finestra di 24 ore concessa da Meta per importare lo storico è scaduta.",
        rimedio:
          "Scollega il numero e rifai il collegamento: contatti e conversazioni ripartiranno.",
        azione: "ricollega",
      };
    }
    return {
      causa: "WhatsApp ha segnalato un problema su questo numero.",
      rimedio: "Riprova fra qualche minuto; se resta, ricollega il numero.",
      azione: "riprova",
    };
  },

  async avvia(ctx): Promise<Avvio> {
    const app = appPubblica(ctx.sedeId);
    if (!app.pronta) {
      throw new Error(
        "App WhatsApp della piattaforma non configurata: imposta WHATSAPP_APP_ID, WHATSAPP_CONFIG_ID e WHATSAPP_APP_SECRET."
      );
    }
    return { tipo: "popup", configId: app.configId };
  },
};
