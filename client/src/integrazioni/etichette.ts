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

/**
 * Le sezioni della pagina Impostazioni. Stanno qui per la stessa ragione
 * delle etichette: il titolo di una sezione e il nome dell'integrazione che
 * ci vive dentro sono la stessa promessa fatta due volte, e una sola fonte
 * impedisce che divergano.
 */
export const SEZIONI: Record<
  string,
  { titolo: string; descrizione: string }
> = {
  abbonamento: {
    titolo: "Abbonamento e consumi",
    descrizione:
      "Il piano dell'azienda, la sua scadenza e quanto è stato consumato di spazio e di budget Tars. Proroghe e capacità aggiuntiva passano da chi gestisce la piattaforma.",
  },
  canali: {
    titolo: "Canali",
    descrizione:
      "Posta e WhatsApp entrano nel CRM in sola lettura e diventano cronologia del cliente. Le credenziali si scrivono una volta e non si rileggono.",
  },
  contabilita: {
    titolo: "Contabilità",
    descrizione:
      "Fatture in Cloud allinea documenti, pagamenti e anagrafica della sede. Le operazioni che scrivono si simulano prima e dichiarano cosa cambia.",
  },
  limiti: {
    titolo: "Limiti di spesa",
    descrizione:
      "Massimali, prodotti DEI, accessori, opere, coefficienti e detrazioni del computo limiti in vigore, con la data di validità. Sola lettura in questa fase.",
  },
  calendari: {
    titolo: "Calendari",
    descrizione:
      "Due direzioni distinte e indipendenti: i calendari Google si leggono dentro il CRM, e gli appuntamenti del CRM si pubblicano come feed iCal.",
  },
  backup: {
    titolo: "Backup e storage",
    descrizione:
      "Il salvataggio notturno della tua azienda. Finché Drive non è collegato il backup viene comunque eseguito, ma resta sul disco del server.",
  },
  agente: {
    titolo: "Agente",
    descrizione:
      "Diagnostica tecnica di Tars: interruttori, provider e budget. Le proposte restano inerti finché una persona non le approva.",
  },
  direzione: {
    titolo: "Gestione direzione",
    descrizione:
      "Scorciatoie verso le superfici raggiungibili dalla direzione. Ogni destinazione applica la propria guardia e il proprio router.",
  },
};

export function sezioneDi(chiave: string) {
  return SEZIONI[chiave] ?? { titolo: chiave, descrizione: "" };
}

/**
 * L'ancora del pannello di un'integrazione dentro la pagina Impostazioni.
 * Serve a due gesti: «Collega» su un'integrazione il cui collegamento vive
 * in un modulo (la posta, il QR di WhatsApp) e «Scegli» di Fatture in Cloud,
 * che porta all'elenco delle aziende. Portare qualcuno in cima a una pagina
 * lunga e lasciarlo cercare non è un arrivo, è un secondo compito.
 */
export function ancoraDi(chiave: string): string {
  return `integrazione-${chiave}`;
}
