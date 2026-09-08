/**
 * I nomi delle integrazioni, in un posto solo: la pagina Impostazioni e il
 * percorso guidato devono chiamarle allo stesso modo, altrimenti il cliente
 * crede che siano due cose diverse.
 */
export const ETICHETTE: Record<string, { titolo: string; descrizione: string }> = {
  fic: {
    titolo: "Fatture in Cloud",
    descrizione: "Allinea documenti, pagamenti e anagrafica della sede.",
  },
  email: {
    titolo: "Posta",
    descrizione:
      "Le caselle IMAP della sede: i messaggi entrano in sola lettura e diventano cronologia del cliente.",
  },
  whatsapp: {
    titolo: "WhatsApp",
    descrizione: "Il numero dell'azienda, con contatti e conversazioni.",
  },
  calendario: {
    titolo: "Calendari",
    descrizione: "I calendari Google letti dentro il CRM.",
  },
  backup: {
    titolo: "Backup su Google Drive",
    descrizione: "Il salvataggio notturno della tua azienda.",
  },
  agente: {
    titolo: "Agente",
    descrizione: "Incluso nell'abbonamento: non c'è niente da collegare.",
  },
};

export function etichettaDi(chiave: string) {
  return ETICHETTE[chiave] ?? { titolo: chiave, descrizione: "" };
}
