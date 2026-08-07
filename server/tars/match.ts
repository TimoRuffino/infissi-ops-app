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

import { stessoNumero } from "@shared/telefono";

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
  telefono?: string | null;
  stato: string;
  archivedAt?: unknown;
};

function nomeCompleto(c: ClienteLite): string {
  return `${c.cognome ?? ""} ${c.nome ?? ""}`.trim();
}

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

/**
 * Aggancio di un messaggio WhatsApp, per numero del mittente.
 *
 * Il codice commessa citato nel testo resta la prova più forte anche qui —
 * capita che il cliente lo riporti — ma il caso normale è il numero.
 * Quando il numero identifica un cliente con più commesse aperte non si
 * indovina: si aggancia il cliente e si dichiara l'ambiguità.
 */
function matchPerTelefono(
  numero: string,
  testoIntero: string,
  clienti: ClienteLite[],
  attive: CommessaLite[]
): EsitoMatch {
  // 1. Codice esplicito nel messaggio: vale quanto nelle mail.
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
  }

  // 2. Numero del mittente = telefono di contatto di una singola commessa.
  //    È il riferimento del cantiere: più specifico dell'anagrafica cliente.
  const perCommessa = attive.filter((c) => stessoNumero(c.telefono, numero));
  if (perCommessa.length === 1) {
    return {
      clienteId: perCommessa[0].clienteId ?? null,
      commessaId: perCommessa[0].id,
      confidenza: "alta",
      motivo: `Il numero del mittente è il contatto della commessa ${perCommessa[0].codice}.`,
    };
  }

  // 3. Numero del mittente = telefono in anagrafica cliente.
  const cliente = clienti.find((c) => stessoNumero(c.telefono, numero));
  if (cliente) {
    const sue = attive.filter((c) => c.clienteId === cliente.id);
    const nome = nomeCompleto(cliente);
    if (sue.length === 1) {
      return {
        clienteId: cliente.id,
        commessaId: sue[0].id,
        confidenza: "alta",
        motivo: `Numero riconosciuto come ${nome}, che ha una sola commessa attiva (${sue[0].codice}).`,
      };
    }
    if (sue.length > 1) {
      return {
        clienteId: cliente.id,
        commessaId: null,
        confidenza: "media",
        motivo: `Numero riconosciuto come ${nome}, che ha ${sue.length} commesse attive (${sue
          .map((c) => c.codice)
          .join(", ")}): quale non è deducibile dal messaggio.`,
      };
    }
    return {
      clienteId: cliente.id,
      commessaId: null,
      confidenza: "media",
      motivo: `Numero riconosciuto come ${nome}, senza commesse attive.`,
    };
  }

  // 4. Più commesse condividono quel numero (stesso referente su cantieri
  //    diversi): meglio dichiararlo che sceglierne una.
  if (perCommessa.length > 1) {
    return {
      clienteId: null,
      commessaId: null,
      confidenza: "bassa",
      motivo: `Il numero del mittente compare su ${perCommessa.length} commesse: ${perCommessa
        .map((c) => c.codice)
        .join(", ")}.`,
    };
  }

  return {
    clienteId: null,
    commessaId: null,
    confidenza: "nessuna",
    motivo: "Numero non presente in anagrafica.",
  };
}

export function matchComunicazione(params: {
  mittente: string;
  oggetto: string;
  testo: string;
  clienti: ClienteLite[];
  commesse: CommessaLite[];
  // "whatsapp" quando il mittente è un numero di telefono anziché un
  // indirizzo email: cambia quale colonna dell'anagrafica si confronta.
  canale?: "email" | "whatsapp";
}): EsitoMatch {
  const mittente = normalizzaEmail(params.mittente);
  const testoIntero = `${params.oggetto}\n${params.testo}`;

  // Le commesse archiviate non si agganciano mai: un messaggio nuovo non
  // riapre un fascicolo chiuso.
  const attive = params.commesse.filter((c) => !c.archivedAt);

  // ── WhatsApp: il numero è l'identificatore, e in questo settore è più
  //    affidabile dell'email — il telefono in anagrafica è quasi sempre
  //    compilato, l'indirizzo spesso no.
  if (params.canale === "whatsapp") {
    return matchPerTelefono(params.mittente, testoIntero, params.clienti, attive);
  }

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
    const nome = nomeCompleto(cliente);
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
    const nome = nomeCompleto(perCognome[0]);
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
