// server/piattaforma/feedback.ts
// Le PAROLE e le REGOLE di una segnalazione: un'azienda che incontra un bug
// o ha un consiglio scrive due righe dal CRM e quelle due righe diventano
// una mail a supporto@wyndoor.com. Non esiste uno store: la casella di
// posta È l'archivio. Nessun backfill, nessuno svuotamento quando il tenant
// se ne va, nessun blob nuovo in JSONB.
//
// Lo screenshot facoltativo viaggia come allegato DENTRO la mail (Resend
// `attachments`, v. `_core/postaPiattaforma.ts`): non passa da `putFile`,
// quindi non consuma la quota dell'azienda, non entra nel ledger dello
// storage e non c'è niente da cancellare dopo.
//
// Il confine è lo stesso di `testi.ts`: qui si decide che cosa dire e che
// cosa si può mandare; la forma HTML sta in `_core/bustaEmail.ts`.
import { TRPCError } from "@trpc/server";
import { componiEmail } from "../_core/bustaEmail";
import { inviaPosta, postaConfigurata } from "../_core/postaPiattaforma";
import {
  FEEDBACK_DESTINATARIO_PREDEFINITO,
  MESSAGGI_FEEDBACK,
  VARIABILE_POSTA_FEEDBACK,
} from "./costanti";

export const TIPI_FEEDBACK = ["bug", "consiglio"] as const;
export type TipoFeedback = (typeof TIPI_FEEDBACK)[number];

/** 2 MB di immagine decodificata: oltre, l'allegato viene rifiutato. */
export const IMMAGINE_MAX_BYTE = 2 * 1024 * 1024;
export const IMMAGINE_TIPI_AMMESSI = ["image/png", "image/jpeg", "image/webp"] as const;

export type ImmagineFeedback = {
  nome: string;
  tipo: string;
  /** Solo i byte in base64: il client toglie il prefisso `data:`. */
  contenutoBase64: string;
};

export type ContestoFeedback = {
  azienda: { id: number; nome: string; stato: string };
  /** Il nome della sede attiva, o `null` se la sessione non ne ha una. */
  sede: string | null;
  utente: { nome: string; email: string; ruoli: string[] };
  /** Il percorso da cui è partita la segnalazione, es. `/commesse/12`. */
  pagina: string | null;
  browser: string | null;
  baseUrl: string;
  /** Iniettabile per i test: senza, «adesso». */
  inviatoIl?: Date;
};

/** Dove arrivano le segnalazioni: `POSTA_FEEDBACK`, o supporto@wyndoor.com. */
export function destinatarioFeedback(): string {
  return (
    process.env[VARIABILE_POSTA_FEEDBACK]?.trim() || FEEDBACK_DESTINATARIO_PREDEFINITO
  );
}

const ETICHETTA: Record<TipoFeedback, string> = {
  bug: "Bug",
  consiglio: "Consiglio",
};

/**
 * I byte veri dietro una stringa base64, senza decodificarla: quattro
 * caratteri fanno tre byte, meno il riempimento finale. Serve per rifiutare
 * un'immagine grossa PRIMA di allocarne il buffer.
 */
export function byteDaBase64(base64: string): number {
  const pulito = base64.replace(/\s/g, "");
  if (!pulito) return 0;
  const riempimento = pulito.endsWith("==") ? 2 : pulito.endsWith("=") ? 1 : 0;
  return Math.floor((pulito.length * 3) / 4) - riempimento;
}

/**
 * L'allegato è accettabile? Lancia il rifiuto che l'utente deve leggere —
 * tipo non ammesso o troppi byte. Il client comprime già prima di inviare:
 * questa è la difesa del server, non il messaggio abituale.
 */
export function assicuraImmagineValida(immagine: ImmagineFeedback): void {
  if (!(IMMAGINE_TIPI_AMMESSI as readonly string[]).includes(immagine.tipo)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: MESSAGGI_FEEDBACK.immagineNonValida,
    });
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(immagine.contenutoBase64)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: MESSAGGI_FEEDBACK.immagineNonValida,
    });
  }
  if (byteDaBase64(immagine.contenutoBase64) > IMMAGINE_MAX_BYTE) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: MESSAGGI_FEEDBACK.immagineTroppoGrande,
    });
  }
}

/**
 * Il percorso da cui è partita la segnalazione, ripulito: solo un cammino
 * interno che comincia con una barra. `pagina` arriva dal browser, e finisce
 * dentro un `href` della mail — un `javascript:` o un dominio altrui non
 * devono poterci entrare (`componiEmail` rifiuta già gli schemi strani, ma
 * la difesa sta qui, dove il valore entra).
 */
export function paginaSicura(pagina: string | null | undefined): string | null {
  const grezza = pagina?.trim();
  if (!grezza) return null;
  if (!/^\/[^\s]*$/.test(grezza)) return null;
  if (grezza.startsWith("//")) return null;
  return grezza.slice(0, 200);
}

const dataOra = (istante: Date): string =>
  new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  }).format(istante);

/**
 * Il riassunto nell'oggetto: la prima riga di quello che ha scritto la
 * persona, su una riga sola. Chi apre la casella deve capire di che cosa si
 * tratta senza aprire la mail; il testo intero è dentro.
 *
 * Il taglio cade sull'ultimo spazio utile, non a metà parola: «resta senza
 * cos…» si legge come un errore, «resta senza…» come una frase troncata.
 */
export function riassunto(testo: string, massimo = 70): string {
  const riga = testo.trim().split(/\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (riga.length <= massimo) return riga;
  const tagliata = riga.slice(0, massimo - 1);
  const spazio = tagliata.lastIndexOf(" ");
  // Sotto i due terzi non è più un taglio, è una parola sola lunghissima:
  // meglio troncarla che restituire un moncone.
  const utile = spazio > massimo * 0.6 ? tagliata.slice(0, spazio) : tagliata;
  return `${utile.trimEnd()}…`;
}

/**
 * Oggetto, corpo testo e corpo HTML della segnalazione. Funzione pura:
 * nessuno store, nessuna rete, nessuna variabile d'ambiente.
 *
 * Il contesto lo mette il server — azienda, sede, chi scrive, da quale
 * pagina, con quale browser — perché è esattamente la parte che chi segnala
 * non pensa mai a scrivere e senza la quale la segnalazione non si riproduce.
 */
export function componiFeedback(input: {
  tipo: TipoFeedback;
  testo: string;
  contesto: ContestoFeedback;
  conImmagine?: boolean;
}): { oggetto: string; testo: string; html: string } {
  const { contesto } = input;
  const quando = contesto.inviatoIl ?? new Date();
  const pagina = paginaSicura(contesto.pagina);
  const etichetta = ETICHETTA[input.tipo];

  const scheda = [
    { voce: "Azienda", valore: `${contesto.azienda.nome} (#${contesto.azienda.id}, ${contesto.azienda.stato})` },
    ...(contesto.sede ? [{ voce: "Sede", valore: contesto.sede }] : []),
    {
      voce: "Da",
      valore: contesto.utente.ruoli.length
        ? `${contesto.utente.nome} · ${contesto.utente.ruoli.join(", ")}`
        : contesto.utente.nome,
    },
    { voce: "Contatto", valore: contesto.utente.email },
    ...(pagina ? [{ voce: "Pagina", valore: pagina }] : []),
    ...(contesto.browser ? [{ voce: "Browser", valore: contesto.browser }] : []),
    { voce: "Inviato", valore: dataOra(quando) },
  ];

  // Le righe vuote separano i paragrafi, come le ha scritte chi segnala:
  // `componiEmail` fa l'escaping, qui non deve comparire un solo tag.
  const paragrafi = input.testo
    .trim()
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  const { html, testo } = componiEmail({
    titolo: input.tipo === "bug" ? "Segnalazione di un problema" : "Un consiglio dal campo",
    preheader: riassunto(input.testo, 110),
    paragrafi: paragrafi.length ? paragrafi : [input.testo.trim()],
    scheda,
    ...(pagina
      ? { azione: { etichetta: "Apri la pagina", href: `${contesto.baseUrl.replace(/\/+$/, "")}${pagina}` } }
      : {}),
    note: [
      "Rispondi a questa mail per scrivere direttamente a chi l'ha mandata.",
      ...(input.conImmagine ? ["In allegato l'immagine aggiunta da chi segnala."] : []),
    ],
    contatto: contesto.utente.email,
    baseUrl: contesto.baseUrl,
  });

  return {
    oggetto: `[Wyndoor] ${etichetta} · ${contesto.azienda.nome} · ${riassunto(input.testo)}`,
    testo,
    html,
  };
}

/**
 * Manda la segnalazione a supporto. Lancia — a differenza di `inviaPosta`,
 * che non lancia mai — perché qui c'è una persona che aspetta e che deve
 * sapere se il messaggio è partito: una segnalazione persa in silenzio è
 * peggio di nessun bottone.
 */
export async function inviaFeedback(input: {
  tipo: TipoFeedback;
  testo: string;
  contesto: ContestoFeedback;
  immagine?: ImmagineFeedback | null;
}): Promise<{ inviato: true }> {
  if (input.immagine) assicuraImmagineValida(input.immagine);
  if (!postaConfigurata()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: MESSAGGI_FEEDBACK.nonConfigurato,
    });
  }

  const busta = componiFeedback({
    tipo: input.tipo,
    testo: input.testo,
    contesto: input.contesto,
    conImmagine: Boolean(input.immagine),
  });

  const esito = await inviaPosta({
    a: destinatarioFeedback(),
    oggetto: busta.oggetto,
    testo: busta.testo,
    html: busta.html,
    // Supporto risponde con «Rispondi» e la risposta arriva alla persona,
    // non nel vuoto del `no-reply`.
    rispostaA: input.contesto.utente.email,
    ...(input.immagine
      ? {
          allegati: [
            {
              nome: input.immagine.nome,
              contenutoBase64: input.immagine.contenutoBase64,
              tipo: input.immagine.tipo,
            },
          ],
        }
      : {}),
  });

  if (!esito.inviato) {
    // Il motivo sta già nel log di `inviaPosta`: a chi ha scritto va una
    // frase leggibile, mai il dettaglio del fornitore.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: MESSAGGI_FEEDBACK.nonRiuscito,
    });
  }
  return { inviato: true };
}
