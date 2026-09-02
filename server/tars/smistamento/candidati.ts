// Candidati deterministici di collegamento (smistamento, D1).
//
// Nessun modello qui: solo identificatori e segnali spiegabili, ognuno
// col suo motivo. Il verdetto CERTO nasce soltanto da prove forti
// (codice commessa, numero/email univoci già riconosciuti all'ingestione,
// stesso filo di una comunicazione già collegata). Tutto il resto è un
// candidato con punteggio: il modello sceglie fra questi, il server
// verifica che l'id scelto sia davvero in lista.

import { stessoNumero, normalizzaTelefono } from "@shared/telefono";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import { estraiCodiceCommessa } from "../../comunicazioni/match";
import type {
  CandidatoCollegamento,
  SegnaliMittente,
} from "./types";

export type ClienteCandidabile = {
  id: number;
  nome?: string | null;
  cognome?: string | null;
  tipo?: string | null;
  email?: string | null;
  telefono?: string | null;
  referenti?: Array<{ email?: string | null; telefono?: string | null }> | null;
  archivedAt?: unknown;
};

export type CommessaCandidabile = {
  id: number;
  codice: string;
  cliente?: string | null;
  clienteId?: number | null;
  email?: string | null;
  telefono?: string | null;
  citta?: string | null;
  indirizzo?: string | null;
  stato: string;
  archivedAt?: unknown;
};

export type ContestoCandidati = {
  comunicazione: Comunicazione;
  clienti: readonly ClienteCandidabile[];
  commesse: readonly CommessaCandidabile[];
  /** Indirizzi email delle caselle e delle persone dell'azienda (lowercase). */
  indirizziInterni: ReadonlySet<string>;
  /** Cognomi delle persone dell'azienda (lowercase): mai un indizio cliente. */
  cognomiInterni: ReadonlySet<string>;
  /** Comunicazioni già collegate nello stesso filo (v. cercaFiloCollegato). */
  filoCollegato: readonly Comunicazione[];
};

export type VerdettoCerto = {
  commessaId: number;
  clienteId: number | null;
  motivo: string;
};

export type EsitoCandidati = {
  certo: VerdettoCerto | null;
  candidati: CandidatoCollegamento[];
  segnali: SegnaliMittente;
};

const PUNTEGGIO_MASSIMO = 100;
const MASSIMO_CANDIDATI = 8;
const TESTO_UTILE = 6_000;

// Cognomi troppo corti o troppo comuni come parole italiane non valgono
// da soli: servirebbe anche il nome.
const PAROLE_COMUNI = new Set([
  "costa", "rosa", "bianco", "bianchi", "nero", "neri", "verde", "monte",
  "ponte", "porta", "porte", "vetro", "casa", "villa", "santo", "santa",
  "corso", "piazza", "sole", "luna", "mare", "riva", "campo", "fiore",
  "ferro", "legno", "conte", "marino", "franco", "romano", "grande",
]);

function normalizzaEmail(valore: string | null | undefined): string {
  return (valore ?? "").trim().toLowerCase();
}

function dominio(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

function denominazione(c: ClienteCandidabile): string {
  return `${c.cognome ?? ""} ${c.nome ?? ""}`.replace(/\s+/g, " ").trim();
}

function parolaIntera(testo: string, parola: string): boolean {
  if (!parola) return false;
  const sicura = parola.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${sicura}(?=$|[^\\p{L}\\p{N}])`, "iu").test(
    testo
  );
}

/** Il mittente originale dentro un inoltro/risposta citata, se c'è. */
export function estraiMittenteOriginale(testo: string): string | null {
  const intestazione =
    /(?:^|\n)\s*(?:>\s*)?(?:Da|From|Von|De)\s*:\s*[^\n<]*<\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\s*>/i.exec(
      testo
    ) ??
    /(?:^|\n)\s*(?:>\s*)?(?:Da|From|Von|De)\s*:\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\s*(?:\n|$)/i.exec(
      testo
    ) ??
    /Il giorno [^\n]{0,120}?<\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\s*>\s*ha scritto/i.exec(
      testo
    ) ??
    /On [^\n]{0,120}?<\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\s*>\s*wrote/i.exec(testo);
  return intestazione ? intestazione[1].toLowerCase() : null;
}

function segnaliMittente(
  comunicazione: Comunicazione,
  indirizziInterni: ReadonlySet<string>
): SegnaliMittente {
  const mittente = normalizzaEmail(comunicazione.mittente);
  const dominiInterni = new Set(
    [...indirizziInterni].map(dominio).filter(Boolean)
  );
  const interno =
    comunicazione.canale === "email" &&
    (indirizziInterni.has(mittente) || dominiInterni.has(dominio(mittente)));
  const testo = comunicazione.testo.slice(0, TESTO_UTILE);
  const marcatoreInoltro =
    /^(?:fwd?|i|tr|wg)\s*:/i.test(comunicazione.oggetto.trim()) ||
    /-{2,}\s*(?:messaggio|mail|email)?\s*(?:inoltrat[oa]|originale|forwarded message)\s*-{2,}/i.test(
      testo
    );
  const mittenteOriginale = estraiMittenteOriginale(testo);
  const originaleEsterno =
    mittenteOriginale != null &&
    mittenteOriginale !== mittente &&
    !indirizziInterni.has(mittenteOriginale) &&
    !dominiInterni.has(dominio(mittenteOriginale));
  return {
    interno,
    inoltro: marcatoreInoltro || (interno && originaleEsterno),
    mittenteOriginale: originaleEsterno ? mittenteOriginale : null,
  };
}

class Punteggi {
  private readonly voci = new Map<string, CandidatoCollegamento>();

  aggiungi(
    tipo: CandidatoCollegamento["tipo"],
    id: number,
    etichetta: string,
    punti: number,
    motivo: string
  ): void {
    const chiave = `${tipo}:${id}`;
    const voce = this.voci.get(chiave);
    if (voce) {
      voce.punteggio = Math.min(PUNTEGGIO_MASSIMO, voce.punteggio + punti);
      if (!voce.motivi.includes(motivo)) voce.motivi.push(motivo);
      return;
    }
    this.voci.set(chiave, {
      tipo,
      id,
      etichetta,
      punteggio: Math.min(PUNTEGGIO_MASSIMO, punti),
      motivi: [motivo],
    });
  }

  lista(): CandidatoCollegamento[] {
    return [...this.voci.values()]
      .sort(
        (a, b) =>
          b.punteggio - a.punteggio ||
          (a.tipo === "commessa" ? -1 : 1) - (b.tipo === "commessa" ? -1 : 1) ||
          a.id - b.id
      )
      .slice(0, MASSIMO_CANDIDATI);
  }
}

export function generaCandidati(contesto: ContestoCandidati): EsitoCandidati {
  const { comunicazione } = contesto;
  const attive = contesto.commesse.filter(
    c => c.stato !== "archiviata" && !c.archivedAt
  );
  const clienti = contesto.clienti.filter(c => !c.archivedAt);
  const perId = new Map(attive.map(c => [c.id, c] as const));
  const commesseDiCliente = (clienteId: number) =>
    attive.filter(c => c.clienteId === clienteId);
  const etichettaCommessa = (c: CommessaCandidabile) =>
    `${c.codice} — ${c.cliente ?? "cliente"}`;
  const punteggi = new Punteggi();
  const segnali = segnaliMittente(comunicazione, contesto.indirizziInterni);
  const testo = `${comunicazione.oggetto}\n${comunicazione.testo.slice(0, TESTO_UTILE)}\n${comunicazione.allegati.map(a => a.nome).join("\n")}`;

  const promuoviCliente = (
    cliente: ClienteCandidabile,
    punti: number,
    motivo: string
  ) => {
    punteggi.aggiungi("cliente", cliente.id, denominazione(cliente), punti, motivo);
    const sue = commesseDiCliente(cliente.id);
    if (sue.length === 1) {
      punteggi.aggiungi(
        "commessa",
        sue[0].id,
        etichettaCommessa(sue[0]),
        punti - 5,
        `${motivo} ${denominazione(cliente)} ha una sola commessa attiva.`
      );
    } else {
      for (const c of sue) {
        punteggi.aggiungi(
          "commessa",
          c.id,
          etichettaCommessa(c),
          Math.round(punti / 2),
          `${motivo} È una delle ${sue.length} commesse attive di ${denominazione(cliente)}.`
        );
      }
    }
  };

  // 0. Già collegata: il collegamento resta la verità; i candidati servono
  //    solo agli allegati e al modello per capire il contesto.
  if (comunicazione.commessaId != null && perId.has(comunicazione.commessaId)) {
    const c = perId.get(comunicazione.commessaId)!;
    return {
      certo: {
        commessaId: c.id,
        clienteId: c.clienteId ?? comunicazione.clienteId,
        motivo: comunicazione.matchMotivo ?? "Comunicazione già collegata.",
      },
      candidati: [
        {
          tipo: "commessa",
          id: c.id,
          etichetta: etichettaCommessa(c),
          punteggio: PUNTEGGIO_MASSIMO,
          motivi: [comunicazione.matchMotivo ?? "Già collegata."],
        },
      ],
      segnali,
    };
  }

  // 1. Codice commessa citato (prova più forte).
  const codice = estraiCodiceCommessa(testo);
  if (codice) {
    const c = attive.find(x => x.codice.toUpperCase() === codice.toUpperCase());
    if (c) {
      return {
        certo: {
          commessaId: c.id,
          clienteId: c.clienteId ?? null,
          motivo: `Il codice ${codice} compare nel messaggio.`,
        },
        candidati: [
          {
            tipo: "commessa",
            id: c.id,
            etichetta: etichettaCommessa(c),
            punteggio: PUNTEGGIO_MASSIMO,
            motivi: [`Il codice ${codice} compare nel messaggio.`],
          },
        ],
        segnali,
      };
    }
  }

  // 2. Stesso filo di comunicazioni già collegate: se tutte concordano è
  //    ereditarietà certa; se divergono, candidati.
  const filo = contesto.filoCollegato.filter(
    f => f.commessaId != null && perId.has(f.commessaId)
  );
  if (filo.length > 0) {
    const commesseFilo = new Set(filo.map(f => f.commessaId!));
    if (commesseFilo.size === 1) {
      const c = perId.get(filo[0].commessaId!)!;
      return {
        certo: {
          commessaId: c.id,
          clienteId: c.clienteId ?? filo[0].clienteId ?? null,
          motivo: `Stesso filo della comunicazione #${filo[0].id} («${filo[0].oggetto || "senza oggetto"}»), già collegata a ${c.codice}.`,
        },
        candidati: [
          {
            tipo: "commessa",
            id: c.id,
            etichetta: etichettaCommessa(c),
            punteggio: PUNTEGGIO_MASSIMO,
            motivi: [`Stesso filo della comunicazione #${filo[0].id}.`],
          },
        ],
        segnali,
      };
    }
    for (const f of filo) {
      const c = perId.get(f.commessaId!)!;
      punteggi.aggiungi(
        "commessa",
        c.id,
        etichettaCommessa(c),
        60,
        `La comunicazione #${f.id} dello stesso filo è collegata a ${c.codice}.`
      );
    }
  }

  // 3. Match dell'ingestione già presente (cliente certo, commessa no).
  if (comunicazione.clienteId != null) {
    const cliente = clienti.find(c => c.id === comunicazione.clienteId);
    if (cliente) {
      promuoviCliente(
        cliente,
        75,
        comunicazione.matchMotivo ?? "Cliente riconosciuto all'ingestione."
      );
    }
  }

  // 4. Mittente originale di un inoltro = email di un cliente o referente.
  if (segnali.mittenteOriginale) {
    const originale = segnali.mittenteOriginale;
    for (const cliente of clienti) {
      const emails = [
        normalizzaEmail(cliente.email),
        ...(cliente.referenti ?? []).map(r => normalizzaEmail(r.email)),
      ].filter(Boolean);
      if (emails.includes(originale)) {
        promuoviCliente(
          cliente,
          85,
          `Il messaggio inoltrato viene da ${originale}, indirizzo di ${denominazione(cliente)}.`
        );
      }
    }
    for (const c of attive) {
      if (normalizzaEmail(c.email) === originale) {
        punteggi.aggiungi(
          "commessa",
          c.id,
          etichettaCommessa(c),
          80,
          `Il messaggio inoltrato viene da ${originale}, contatto della commessa ${c.codice}.`
        );
      }
    }
  }

  // 5. Telefoni citati nel testo.
  const telefoniNelTesto = new Set(
    (testo.match(/(?:\+?\d[\d\s./-]{7,}\d)/g) ?? [])
      .map(t => normalizzaTelefono(t))
      .filter((t): t is string => Boolean(t))
  );
  if (telefoniNelTesto.size > 0) {
    for (const cliente of clienti) {
      const numeri = [
        cliente.telefono,
        ...(cliente.referenti ?? []).map(r => r.telefono),
      ];
      if (numeri.some(n => [...telefoniNelTesto].some(t => stessoNumero(n, t)))) {
        promuoviCliente(
          cliente,
          60,
          `Nel testo compare il numero di telefono di ${denominazione(cliente)}.`
        );
      }
    }
    for (const c of attive) {
      if ([...telefoniNelTesto].some(t => stessoNumero(c.telefono, t))) {
        punteggi.aggiungi(
          "commessa",
          c.id,
          etichettaCommessa(c),
          65,
          `Nel testo compare il numero di contatto della commessa ${c.codice}.`
        );
      }
    }
  }

  // 6. Nomi: cognome/ragione sociale del cliente nel testo (mai i cognomi
  //    delle persone dell'azienda; le parole comuni solo insieme al nome).
  for (const cliente of clienti) {
    const cognome = (cliente.cognome ?? "").trim().toLowerCase();
    const nome = (cliente.nome ?? "").trim().toLowerCase();
    const tokens = denominazione(cliente)
      .toLowerCase()
      .split(/[\s,.'’-]+/)
      .filter(t => t.length >= 4 && !PAROLE_COMUNI.has(t) && !contesto.cognomiInterni.has(t));
    if (tokens.length === 0) continue;
    const presenti = tokens.filter(t => parolaIntera(testo, t));
    if (presenti.length === 0) continue;
    const cognomeInterno = cognome && contesto.cognomiInterni.has(cognome);
    if (cognomeInterno) continue;
    const completo = presenti.length === tokens.length;
    const soloComune = presenti.every(t => PAROLE_COMUNI.has(t));
    if (soloComune) continue;
    const soloCognome =
      presenti.length === 1 && presenti[0] === cognome && cognome.length < 5;
    if (soloCognome) continue;
    const punti = completo ? 65 : presenti.length >= 2 ? 55 : 40;
    promuoviCliente(
      cliente,
      punti,
      `Nel messaggio compare «${presenti.join(" ")}» (${denominazione(cliente)}).`
    );
    void nome;
  }

  // 7. Località della commessa nel testo: solo di supporto.
  for (const c of attive) {
    const citta = (c.citta ?? "").trim().toLowerCase();
    if (citta.length >= 4 && parolaIntera(testo, citta)) {
      punteggi.aggiungi(
        "commessa",
        c.id,
        etichettaCommessa(c),
        20,
        `Nel messaggio compare la località della commessa (${c.citta}).`
      );
    }
  }

  return { certo: null, candidati: punteggi.lista(), segnali };
}
