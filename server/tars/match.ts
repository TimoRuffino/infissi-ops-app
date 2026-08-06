// Aggancio di una mail a cliente e commessa.
//
// Deterministico e spiegabile, di proposito: nessun modello qui dentro.
// Le regole sono in ordine di forza, e la prima che scatta vince. Ogni
// esito porta con sé il motivo, che finisce a video ("perché questa mail
// è finita su COM-2026-035") e nel contesto che Tars riceve.
//
// Quando due commesse sono ugualmente plausibili non si indovina: si
// restituisce confidenza "bassa" con l'elenco dei candidati, e sarà
// l'operatore (o Tars con chiedi_chiarimento) a decidere.

const CODICE_RE = /\bCOM[\s\-–_]?(\d{4})[\s\-–_]?(\d{1,4})\b/i;

export type EsitoMatch = {
  clienteId: number | null;
  commessaId: number | null;
  confidenza: "alta" | "media" | "bassa" | "nessuna";
  motivo: string | null;
};

type ClienteLite = {
  id: number;
  nome?: string | null;
  cognome?: string | null;
  email?: string | null;
  telefono?: string | null;
};

type CommessaLite = {
  id: number;
  codice: string;
  clienteId?: number | null;
  email?: string | null;
  stato: string;
  archivedAt?: unknown;
};

function normalizzaEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

/** Estrae il codice commessa da un testo, in qualunque punteggiatura. */
export function estraiCodiceCommessa(testo: string): string | null {
  const m = CODICE_RE.exec(testo);
  if (!m) return null;
  const anno = m[1];
  const prog = m[2].padStart(3, "0");
  return `COM-${anno}-${prog}`;
}

export function matchComunicazione(params: {
  mittente: string;
  oggetto: string;
  testo: string;
  clienti: ClienteLite[];
  commesse: CommessaLite[];
}): EsitoMatch {
  const mittente = normalizzaEmail(params.mittente);
  const testoIntero = `${params.oggetto}\n${params.testo}`;

  // Le commesse archiviate non si agganciano mai: una mail nuova non
  // riapre un fascicolo chiuso.
  const attive = params.commesse.filter((c) => !c.archivedAt);

  // ── 1. Codice commessa citato per esteso. La prova più forte che esista.
  const codice = estraiCodiceCommessa(testoIntero);
  if (codice) {
    const commessa = attive.find(
      (c) => c.codice.toUpperCase() === codice.toUpperCase()
    );
    if (commessa) {
      return {
        clienteId: commessa.clienteId ?? null,
        commessaId: commessa.id,
        confidenza: "alta",
        motivo: `Il codice ${codice} compare nel messaggio.`,
      };
    }
    // Codice citato ma inesistente (o archiviato): meglio dirlo che tacere.
    return {
      clienteId: null,
      commessaId: null,
      confidenza: "bassa",
      motivo: `Il messaggio cita ${codice}, che non corrisponde a nessuna commessa attiva.`,
    };
  }

  // ── 2. Mittente = email di un cliente censito.
  const cliente = mittente
    ? params.clienti.find((c) => normalizzaEmail(c.email) === mittente)
    : undefined;

  if (cliente) {
    const sue = attive.filter((c) => c.clienteId === cliente.id);
    const nome = `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim();
    if (sue.length === 1) {
      return {
        clienteId: cliente.id,
        commessaId: sue[0].id,
        confidenza: "alta",
        motivo: `Mittente riconosciuto come ${nome}, che ha una sola commessa attiva (${sue[0].codice}).`,
      };
    }
    if (sue.length > 1) {
      // Cliente certo, commessa no: agganciamo il cliente e lasciamo
      // scoperta la commessa invece di scegliere a caso.
      return {
        clienteId: cliente.id,
        commessaId: null,
        confidenza: "media",
        motivo: `Mittente riconosciuto come ${nome}, che ha ${sue.length} commesse attive (${sue
          .map((c) => c.codice)
          .join(", ")}): quale non è deducibile dal messaggio.`,
      };
    }
    return {
      clienteId: cliente.id,
      commessaId: null,
      confidenza: "media",
      motivo: `Mittente riconosciuto come ${nome}, senza commesse attive.`,
    };
  }

  // ── 3. Email di contatto indicata sulla singola commessa (spesso è il
  //       riferimento del cantiere, diverso da quello dell'anagrafica).
  if (mittente) {
    const perEmailCommessa = attive.filter(
      (c) => normalizzaEmail(c.email) === mittente
    );
    if (perEmailCommessa.length === 1) {
      return {
        clienteId: perEmailCommessa[0].clienteId ?? null,
        commessaId: perEmailCommessa[0].id,
        confidenza: "media",
        motivo: `L'indirizzo del mittente è il contatto della commessa ${perEmailCommessa[0].codice}.`,
      };
    }
    if (perEmailCommessa.length > 1) {
      return {
        clienteId: null,
        commessaId: null,
        confidenza: "bassa",
        motivo: `L'indirizzo del mittente compare su ${perEmailCommessa.length} commesse: ${perEmailCommessa
          .map((c) => c.codice)
          .join(", ")}.`,
      };
    }
  }

  // ── 4. Cognome del cliente nell'oggetto. Debole: solo se univoco e lungo
  //       abbastanza da non essere un falso positivo ("Riva", "Neri").
  const oggetto = params.oggetto.toLowerCase();
  const perCognome = params.clienti.filter((c) => {
    const cognome = (c.cognome ?? "").trim().toLowerCase();
    return cognome.length >= 5 && oggetto.includes(cognome);
  });
  if (perCognome.length === 1) {
    const sue = attive.filter((c) => c.clienteId === perCognome[0].id);
    const nome = `${perCognome[0].cognome ?? ""} ${perCognome[0].nome ?? ""}`.trim();
    return {
      clienteId: perCognome[0].id,
      commessaId: sue.length === 1 ? sue[0].id : null,
      confidenza: "bassa",
      motivo: `Nell'oggetto compare il cognome di ${nome}. Verifica prima di usarlo.`,
    };
  }

  return {
    clienteId: null,
    commessaId: null,
    confidenza: "nessuna",
    motivo: null,
  };
}
