// Cercare la commessa DENTRO una conferma d'ordine (direzione 04/09/2026:
// «le conferme ordine sono ferme, Tars non deve arrendersi»).
//
// Le conferme arrivano dai fornitori: la mail non cita il nostro codice
// né il cliente («PAIL_2634169 RUFFINO», «Commessa-N-1013363 PENULTIMO
// PIANO»), quindi lo smistamento non trova candidati e il file resta
// allegato alla mail per mesi. Ma DENTRO il PDF il fornitore riporta il
// nostro riferimento: il cognome del cliente, l'indirizzo del cantiere,
// a volte il codice. Qui si legge il testo (PDF nativo, OCR, o il modello
// per le scansioni) e lo si confronta con TUTTE le commesse vive della
// sede con lo stesso riscontro deterministico che governa l'archiviazione
// (`riscontroCommessaNelTesto`): una sola commessa forte = trovata; più
// commesse = ambiguo, decide una persona; nessuna = non è di nessuno.
//
// Nessun modello decide qui: il modello al massimo trascrive una
// scansione, e il testo trascritto passa dallo stesso riscontro.

import { caselle } from "../../comunicazioni/caselle";
import { riferimentiDellaCommessa } from "../../commesse/costoDaConferma";
import { STATI_COMMESSA } from "../../commesse/transizioni";
import { estraiConfermeNelDocumento } from "../../documenti/estrazioneConferma";
import type { IdentitaLettura } from "../../documenti/letturaVisiva";
import { estraiTestoDocumento, type EsitoParser } from "../../documenti/parserRegistry";
import {
  riscontroCommessaNelTesto,
  type RiferimentiCommessa,
} from "../../documenti/riscontroCommessa";
import { senzaAccenti } from "../../_core/ricerca";
import { getUtentiStore } from "../../routers/utenti";

export type CommessaRicercabile = {
  id: number;
  sedeId?: number | null;
  codice?: string | null;
  cliente?: string | null;
  clienteId?: number | null;
  stato: string;
  archivedAt?: unknown;
  indirizzo?: string | null;
  citta?: string | null;
};

export type CandidatoRicerca = {
  commessaId: number;
  /** Cosa cita il testo («cliente pistone», «indirizzo via roma sarzana»). */
  prove: string[];
  /** Forte = codice, ordine noto, indirizzo o cognome pieno; debole = cognome quasi uguale o corto. */
  forza: "forte" | "debole";
  /** La commessa è in uno stato in cui la conferma è attesa (da «da ordinare» in poi). */
  attesaConferma: boolean;
};

export type FonteTesto = "testo_pdf" | "ocr" | "visione" | "nessuna";

export type EsitoRicercaCommessa = {
  /**
   * unica = una commessa sola regge il riscontro (o una sola fra quelle
   * che aspettano la conferma); ambigua = più commesse o solo indizi
   * deboli; nessuna = il testo non cita nessuna commessa viva;
   * non_leggibile = niente testo; non_letto = lettura rinviata (tetto).
   */
  esito: "unica" | "ambigua" | "nessuna" | "non_leggibile" | "non_letto";
  commessaId: number | null;
  candidati: CandidatoRicerca[];
  fonteTesto: FonteTesto;
  pagine: string[] | null;
  fornitore: string | null;
  riferimentoOrdine: string | null;
  motivo: string;
};

const DA_ORDINARE = STATI_COMMESSA.indexOf("da_ordinare");

function attendeConferma(c: CommessaRicercabile): boolean {
  const indice = STATI_COMMESSA.indexOf(c.stato as any);
  return indice >= DA_ORDINARE && c.stato !== "archiviata";
}

function viva(c: CommessaRicercabile): boolean {
  return !c.archivedAt && c.stato !== "archiviata";
}

function paroleDi(valore: string | null | undefined): string[] {
  return senzaAccenti(String(valore ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(p => p.length >= 3);
}

const PAROLE_SOCIETARIE = new Set([
  "srl", "srls", "spa", "snc", "sas", "group", "gruppo", "societa", "ditta", "impresa",
]);

/**
 * L'azienda stessa censita come cliente (o una persona del personale)
 * comparirebbe in OGNI conferma («Spett.le Ruffino Group»): non è mai una
 * commessa candidata. Interna = tutte le parole utili del nome sono nomi
 * o cognomi del personale o il nome delle caselle aziendali.
 */
export function commessaInterna(c: CommessaRicercabile, paroleInterne: ReadonlySet<string>): boolean {
  const parole = paroleDi(c.cliente).filter(p => !PAROLE_SOCIETARIE.has(p));
  if (parole.length === 0) return false;
  return parole.every(p => paroleInterne.has(p));
}

/** Nomi e cognomi del personale attivo, più il nome delle caselle della sede. */
export function paroleInterneDiSede(sedeId: number): Set<string> {
  const parole = new Set<string>();
  for (const u of getUtentiStore() as any[]) {
    if (u.attivo === false) continue;
    for (const v of [u.nome, u.cognome]) for (const p of paroleDi(v)) parole.add(p);
  }
  for (const c of caselle as any[]) {
    if (c.sedeId !== sedeId || !c.indirizzo) continue;
    const dominio = String(c.indirizzo).split("@")[1] ?? "";
    for (const p of paroleDi(dominio.split(".")[0])) parole.add(p);
  }
  return parole;
}

/** Un cognome pieno (o due parole) vale «forte»; il quasi-uguale e i cognomi corti «debole». */
function forzaDelleProve(prove: readonly string[]): "forte" | "debole" {
  for (const prova of prove) {
    if (/^(codice|ordine|indirizzo) /.test(prova)) return "forte";
    if (prova.startsWith("cliente ~")) continue;
    if (prova.startsWith("cliente ")) {
      const parole = prova.slice("cliente ".length).split(" ").filter(Boolean);
      if (parole.length >= 2 || (parole[0]?.length ?? 0) >= 6) return "forte";
    }
  }
  return "debole";
}

/**
 * Il riscontro del testo contro tutte le commesse: puro, sincrono,
 * testabile senza file. `riferimenti` di default legge costi, magazzino e
 * conferme già nel fascicolo (ordini noti).
 */
export function cercaCommessaNelTesto(input: {
  pagine: readonly string[];
  commesse: readonly CommessaRicercabile[];
  paroleInterne?: ReadonlySet<string>;
  riferimenti?: (c: CommessaRicercabile) => RiferimentiCommessa;
}): Pick<EsitoRicercaCommessa, "esito" | "commessaId" | "candidati" | "motivo"> {
  const riferimenti = input.riferimenti ?? (c => riferimentiDellaCommessa(c));
  const interne = input.paroleInterne ?? new Set<string>();
  const candidati: CandidatoRicerca[] = [];
  for (const c of input.commesse) {
    if (!viva(c) || commessaInterna(c, interne)) continue;
    const riscontro = riscontroCommessaNelTesto(input.pagine, riferimenti(c));
    if (!riscontro.ok) continue;
    candidati.push({
      commessaId: c.id,
      prove: riscontro.prove,
      forza: forzaDelleProve(riscontro.prove),
      attesaConferma: attendeConferma(c),
    });
  }
  candidati.sort(
    (a, b) =>
      Number(b.forza === "forte") - Number(a.forza === "forte") ||
      Number(b.attesaConferma) - Number(a.attesaConferma) ||
      a.commessaId - b.commessaId
  );
  const forti = candidati.filter(c => c.forza === "forte");
  const descrivi = (c: CandidatoRicerca) => `commessa ${c.commessaId} (${c.prove.join(", ")})`;
  if (forti.length === 1) {
    return {
      esito: "unica",
      commessaId: forti[0].commessaId,
      candidati,
      motivo: `Il testo cita ${forti[0].prove.join(", ")} e nessun'altra commessa viva.`,
    };
  }
  if (forti.length > 1) {
    // Due commesse dello stesso cliente: vince quella che aspetta la
    // conferma, se è una sola (l'altra è un preventivo o un lavoro finito).
    const inAttesa = forti.filter(c => c.attesaConferma);
    if (inAttesa.length === 1) {
      return {
        esito: "unica",
        commessaId: inAttesa[0].commessaId,
        candidati,
        motivo: `Il testo cita ${inAttesa[0].prove.join(", ")}; fra le commesse che citano lo stesso riferimento è l'unica in attesa di conferma (le altre: ${forti
          .filter(c => c !== inAttesa[0])
          .map(c => c.commessaId)
          .join(", ")}).`,
      };
    }
    return {
      esito: "ambigua",
      commessaId: null,
      candidati,
      motivo: `Il testo cita più commesse: ${forti.map(descrivi).join("; ")}. Decide una persona.`,
    };
  }
  if (candidati.length > 0) {
    return {
      esito: "ambigua",
      commessaId: null,
      candidati,
      motivo: `Solo indizi deboli: ${candidati.map(descrivi).join("; ")}. Decide una persona.`,
    };
  }
  return {
    esito: "nessuna",
    commessaId: null,
    candidati,
    motivo:
      "Il testo non cita nessuna commessa viva: né un codice, né un cliente, né un indirizzo, né un ordine noto.",
  };
}

// ── Lettura con memoria: il testo di un allegato si legge una volta ───────

type TestoLetto = {
  pagine: string[] | null;
  fonteTesto: FonteTesto;
  fornitore: string | null;
  riferimentoOrdine: string | null;
  motivo: string | null;
  lettoIl: number;
  /** Letto senza il modello: con un'identità si può ritentare la visione. */
  senzaVisione: boolean;
};

const TTL_MS = 12 * 60 * 60 * 1000;
const VOCI_MASSIME = 400;
const memoria = new Map<string, TestoLetto>();

/** Solo per i test. */
export function azzeraMemoriaRicercaPerTest(): void {
  memoria.clear();
}

function ricorda(chiave: string, voce: TestoLetto): void {
  memoria.delete(chiave);
  memoria.set(chiave, voce);
  if (memoria.size > VOCI_MASSIME) {
    const prima = memoria.keys().next().value;
    if (prima) memoria.delete(prima);
  }
}

export type SorgenteAllegato = {
  sedeId: number;
  comunicazioneId: number;
  allegatoIndex: number;
  leggi: () => Promise<{ buffer: Buffer; mimeType: string; nome: string }>;
};

export type LettoreCommessaNelDocumento = (
  sorgente: SorgenteAllegato,
  commesse: readonly CommessaRicercabile[]
) => Promise<EsitoRicercaCommessa>;

function fonteDi(parser: EsitoParser & { esito: "estratto" }): FonteTesto {
  if (parser.visione) return "visione";
  if (parser.ocr) return "ocr";
  return "testo_pdf";
}

/**
 * Un lettore con memoria e tetto: legge al massimo `massimoLetture` file
 * NUOVI per istanza (una chiamata del worker, una fotografia), ricorda il
 * testo per dodici ore, e con un'identità può far trascrivere al modello
 * le scansioni che l'OCR non legge. Il riscontro si ricalcola ogni volta
 * sulle commesse passate: il testo è stabile, le commesse no.
 */
export function creaLettoreCommessaNelDocumento(opzioni: {
  /** Identità per la lettura visiva; assente = solo testo nativo e OCR. */
  visione?: IdentitaLettura | null;
  massimoLetture?: number;
  paroleInterne?: (sedeId: number) => ReadonlySet<string>;
  estraiTesto?: typeof estraiTestoDocumento;
  riferimenti?: (c: CommessaRicercabile) => RiferimentiCommessa;
  now?: () => number;
}): LettoreCommessaNelDocumento {
  const estrai = opzioni.estraiTesto ?? estraiTestoDocumento;
  const now = opzioni.now ?? (() => Date.now());
  const paroleInterne = opzioni.paroleInterne ?? paroleInterneDiSede;
  const massimo = opzioni.massimoLetture ?? 10;
  let letture = 0;

  const leggi = async (sorgente: SorgenteAllegato): Promise<TestoLetto> => {
    const chiave = `${sorgente.sedeId}:${sorgente.comunicazioneId}:${sorgente.allegatoIndex}`;
    const nota = memoria.get(chiave);
    const valida = nota != null && now() - nota.lettoIl < TTL_MS;
    // Una lettura senza testo fatta senza il modello si ritenta con
    // l'identità: la scansione che l'OCR non legge la legge la visione.
    const daRitentare = valida && nota!.pagine == null && nota!.senzaVisione && Boolean(opzioni.visione);
    if (valida && !daRitentare) return nota!;
    if (letture >= massimo) {
      return nota ?? {
        pagine: null,
        fonteTesto: "nessuna",
        fornitore: null,
        riferimentoOrdine: null,
        motivo: "Lettura rinviata: raggiunto il tetto di file per questo giro.",
        lettoIl: 0,
        senzaVisione: true,
      };
    }
    letture += 1;
    let voce: TestoLetto;
    try {
      const raw = await sorgente.leggi();
      const parser = await estrai(raw.buffer, raw.mimeType, raw.nome, {
        visione: opzioni.visione ?? null,
      });
      if (parser.esito === "estratto") {
        const { estrazione } = estraiConfermeNelDocumento(parser.pagine, {
          codiceOrdine: null,
          fornitoreNome: null,
          righeOrdine: [],
        });
        voce = {
          pagine: parser.pagine,
          fonteTesto: fonteDi(parser),
          fornitore: estrazione.fornitoreCitato?.valore ?? null,
          riferimentoOrdine: estrazione.riferimentoOrdine?.valore ?? null,
          motivo: null,
          lettoIl: now(),
          senzaVisione: !opzioni.visione,
        };
      } else {
        voce = {
          pagine: null,
          fonteTesto: "nessuna",
          fornitore: null,
          riferimentoOrdine: null,
          motivo: "motivo" in parser && parser.motivo ? parser.motivo : "Testo non leggibile.",
          lettoIl: now(),
          senzaVisione: !opzioni.visione,
        };
      }
    } catch (errore) {
      voce = {
        pagine: null,
        fonteTesto: "nessuna",
        fornitore: null,
        riferimentoOrdine: null,
        motivo: `Lettura fallita: ${errore instanceof Error ? errore.message.slice(0, 160) : "errore"}`,
        lettoIl: now(),
        senzaVisione: !opzioni.visione,
      };
    }
    ricorda(chiave, voce);
    return voce;
  };

  return async (sorgente, commesse) => {
    const testo = await leggi(sorgente);
    if (testo.pagine == null) {
      return {
        esito: testo.lettoIl === 0 ? "non_letto" : "non_leggibile",
        commessaId: null,
        candidati: [],
        fonteTesto: "nessuna",
        pagine: null,
        fornitore: null,
        riferimentoOrdine: null,
        motivo: testo.motivo ?? "Testo non leggibile.",
      };
    }
    const ricerca = cercaCommessaNelTesto({
      pagine: testo.pagine,
      commesse,
      paroleInterne: paroleInterne(sorgente.sedeId),
      riferimenti: opzioni.riferimenti,
    });
    return {
      ...ricerca,
      fonteTesto: testo.fonteTesto,
      pagine: testo.pagine,
      fornitore: testo.fornitore,
      riferimentoOrdine: testo.riferimentoOrdine,
    };
  };
}
