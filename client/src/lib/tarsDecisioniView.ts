// Le proposte di Tars, dette come decisioni.
//
// Tre sorgenti diverse arrivano nella stessa coda — comunicazioni da
// collegare, dati letti dai documenti, consigli dell'analisi di oggi — e
// prima ognuna si presentava con le parole della propria sorgente: il
// titolo di una comunicazione era l'oggetto grezzo dell'email («PRIMED
// ticket # 2678C25B58 # RITIRO RIPARAZIONI»), mentre ciò che Tars voleva
// fare stava sotto, in piccolo, e il perché era chiuso dentro un
// «Perché e cosa succede» da aprire riga per riga.
//
// Qui ognuna diventa la stessa cosa: un'azione scritta come azione, il
// motivo in chiaro, cosa cambia se dici sì, e da dove viene. Nessun
// rendering e nessuna chiamata: solo testo, così si prova da solo.
//
// PRD §62.

/** Quanto Tars si fida di quello che propone. */
export type FiduciaDecisione = "alta" | "media" | "bassa";

/** Da dove nasce la proposta: decide l'icona e il gruppo in cui finisce. */
export type GruppoDecisione = "comunicazione" | "documento" | "consiglio";

export type Decisione = {
  chiave: string;
  gruppo: GruppoDecisione;
  /** Cosa succede se dici sì, scritto come azione. È il titolo. */
  azione: string;
  /** Perché Tars lo propone. Una riga, sempre visibile. */
  perche: string | null;
  /** Un valore che cambia: si disegna «prima → dopo». */
  cambio: { da: string; a: string } | null;
  /** Altre conseguenze del sì, una frase ciascuna. */
  effetti: string[];
  /** Da dove viene: mittente, oggetto, nome del documento, data. */
  provenienza: string | null;
  /** Le entità toccate, con il link per aprirle. */
  riguarda: { etichetta: string; link: string | null }[];
  fiducia: FiduciaDecisione | null;
  urgente: boolean;
  /** L'etichetta del pulsante: dice il gesto, non «Approva». */
  verbo: string;
};

export const ETICHETTA_FIDUCIA: Record<FiduciaDecisione, string> = {
  alta: "quasi certo",
  media: "probabile",
  bassa: "incerto",
};

export const ETICHETTA_GRUPPO: Record<GruppoDecisione, string> = {
  comunicazione: "Messaggi da collegare",
  documento: "Dati letti dai documenti",
  consiglio: "Consigli dell'analisi di oggi",
};

/** `dd/MM, HH:mm` all'ora di Roma: l'azienda sta lì, e il test non dipende dal fuso della macchina. */
export function quandoBreve(valore: string | Date | null | undefined): string | null {
  if (valore == null) return null;
  const d = valore instanceof Date ? valore : new Date(valore);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** «2 allegati nel fascicolo: a.pdf, b.pdf» — oltre i due nomi si conta e basta. */
export function fraseAllegati(nomi: readonly string[]): string | null {
  if (nomi.length === 0) return null;
  const testa = nomi.slice(0, 2).join(", ");
  const resto = nomi.length - 2;
  const elenco = resto > 0 ? `${testa} e altri ${resto}` : testa;
  return `${nomi.length} ${nomi.length === 1 ? "allegato" : "allegati"} nel fascicolo: ${elenco}`;
}

/** Le parti non vuote di una riga di provenienza, unite da «·». */
function riga(...pezzi: (string | null | undefined)[]): string | null {
  const vivi = pezzi.filter((p): p is string => typeof p === "string" && p.trim() !== "");
  return vivi.length > 0 ? vivi.join(" · ") : null;
}

export type IngressoComunicazione = {
  comunicazioneId: number;
  canale: string;
  mittente: string;
  oggetto?: string | null;
  ricevutaIl: string | Date;
  riepilogo?: string | null;
  urgenza?: string | null;
  collegamento: {
    commessaId?: number | null;
    clienteId?: number | null;
    confidenza?: string | null;
    motivo?: string | null;
  };
  candidati: readonly { tipo: string; id: number; etichetta: string }[];
  allegatiDaArchiviare: readonly string[];
};

function fiduciaDa(valore: string | null | undefined): FiduciaDecisione | null {
  return valore === "alta" || valore === "media" || valore === "bassa" ? valore : null;
}

/** Dove Tars vuole agganciare la comunicazione, col nome che legge un umano. */
export function destinazioneComunicazione(voce: IngressoComunicazione): string {
  const { commessaId, clienteId } = voce.collegamento;
  const atteso = commessaId != null ? { tipo: "commessa", id: commessaId } : clienteId != null ? { tipo: "cliente", id: clienteId } : null;
  if (atteso == null) return "una commessa da scegliere";
  const candidato = voce.candidati.find(c => c.tipo === atteso.tipo && c.id === atteso.id);
  if (candidato) return candidato.etichetta;
  // Senza etichetta il numero è l'unica verità che abbiamo: meglio dirlo
  // così, che fingere un nome.
  return `${atteso.tipo} n. ${atteso.id}`;
}

export function decisioneDaComunicazione(voce: IngressoComunicazione): Decisione {
  const destinazione = destinazioneComunicazione(voce);
  const nomeCanale = voce.canale === "whatsapp" ? "il messaggio WhatsApp" : "l'email";
  const allegati = fraseAllegati(voce.allegatiDaArchiviare);
  return {
    chiave: `comunicazione-${voce.comunicazioneId}`,
    gruppo: "comunicazione",
    azione: `Collega ${nomeCanale} a ${destinazione}`,
    perche: voce.collegamento.motivo?.trim() || voce.riepilogo?.trim() || null,
    cambio: null,
    effetti: [
      voce.collegamento.commessaId != null
        ? "Il messaggio risulta gestito e resta agganciato alla commessa"
        : "Il messaggio resta agganciato al cliente",
      ...(allegati ? [allegati] : []),
    ],
    provenienza: riga(
      voce.oggetto?.trim() ? `«${voce.oggetto.trim()}»` : null,
      voce.mittente,
      quandoBreve(voce.ricevutaIl)
    ),
    riguarda: [],
    fiducia: fiduciaDa(voce.collegamento.confidenza),
    urgente: voce.urgenza === "alta" || voce.urgenza === "critica",
    verbo: "Collega",
  };
}

export type IngressoDocumento = {
  id: number;
  etichetta: string;
  effetto?: string | null;
  motivazione?: string | null;
  valoreCorrente?: string | null;
  valoreProposto?: string | null;
  documentoNome?: string | null;
  creataIl: string | Date;
};

export function decisioneDaDocumento(p: IngressoDocumento): Decisione {
  const da = p.valoreCorrente?.trim() || null;
  const a = p.valoreProposto?.trim() || null;
  const cambio = a != null && da !== a ? { da: da ?? "—", a } : null;
  return {
    chiave: `documento-${p.id}`,
    gruppo: "documento",
    azione: p.etichetta,
    perche: p.motivazione?.trim() || null,
    cambio,
    // Con il «prima → dopo» già in evidenza, ripetere l'effetto a parole
    // sarebbe la stessa frase due volte.
    effetti: cambio == null && p.effetto?.trim() ? [p.effetto.trim()] : [],
    provenienza: riga(p.documentoNome, quandoBreve(p.creataIl)),
    riguarda: [],
    fiducia: null,
    urgente: false,
    verbo: "Applica",
  };
}

export type IngressoConsiglio = {
  testo: string;
  richiestaPerTars: string;
  entita: readonly { riferimento: string; etichetta: string; link?: string | null }[];
  azione?: { strumento: string } | null;
};

/** «crea_ticket» → «crea ticket»: il nome dello strumento non è un'etichetta. */
export function nomeStrumento(strumento: string): string {
  return strumento.replaceAll("_", " ");
}

export function decisioneDaConsiglio(p: IngressoConsiglio, indice: number): Decisione {
  const eseguibile = p.azione != null;
  return {
    chiave: `consiglio-${indice}`,
    gruppo: "consiglio",
    // Il titolo è cosa succede se dici sì — la richiesta che Tars eseguirà —
    // e il consiglio a parole diventa il motivo. Prima era il contrario, e
    // il pulsante «Esegui» non diceva che cosa.
    azione: p.richiestaPerTars,
    perche: p.testo?.trim() || null,
    cambio: null,
    effetti: eseguibile
      ? [`Tars lo fa ora con «${nomeStrumento(p.azione!.strumento)}», con i tuoi permessi, e lo scrive nel Registro`]
      : ["La richiesta va in chat: niente cambia finché non la mandi"],
    provenienza: null,
    riguarda: p.entita.map(e => ({ etichetta: e.etichetta, link: e.link ?? null })),
    fiducia: null,
    urgente: false,
    verbo: eseguibile ? "Esegui" : "Apri in chat",
  };
}

/** L'intestazione della coda. Un numero solo, quello delle righe che si vedono. */
export function titoloCoda(quante: number): string {
  if (quante === 0) return "Nessuna decisione in attesa";
  if (quante === 1) return "1 decisione in attesa";
  return `${quante} decisioni in attesa`;
}
