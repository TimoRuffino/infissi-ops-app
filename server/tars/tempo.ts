// Risoluzione deterministica delle espressioni temporali italiane (T2)
// — docs/tars/architettura-tars-v2.md §20, decisione 10.
//
// Il modello NON risolve le date: passa l'espressione dell'utente così
// com'è e il server la traduce. Due semantiche distinte:
// - "locale"  → calendario Europe/Rome ("domani alle 9", "venerdì"):
//   la conversione in istante passa da parseRomeLocalDateTime esistente,
//   che resta la verità su DST (orari inesistenti/ambigui rifiutati).
// - "istante" → durata esatta ("tra due ore"): immune ai cambi d'ora.
//
// Default aziendali DICHIARATI (sempre restituiti in `assunzioni`):
// mattina=09:00, pomeriggio=15:00, sera=18:00, giorno senza orario=09:00,
// solo-orario già passato oggi→domani, giorno della settimana=prossima
// occorrenza (oggi compreso se ancora futura; con «prossimo» esplicito e
// oggi coincidente si intende +7). Regola dura (revisione): ciò che
// CONTIENE un'indicazione non riconosciuta (orario a parole, weekday in
// conflitto con la data) viene RIFIUTATO con errore tipizzato — mai
// risolto in silenzio in un momento diverso da quello chiesto.

import { TZDate } from "@date-fns/tz";
import { REMINDER_TIMEZONE } from "../reminders/time";

export type RisoluzioneTempo =
  | {
      tipo: "locale";
      dataLocale: string; // YYYY-MM-DD (calendario Europe/Rome)
      oraLocale: string; // HH:mm
      assunzioni: string[];
    }
  | { tipo: "istante"; iso: string; assunzioni: string[] };

export type CodiceErroreTempo =
  | "NON_RICONOSCIUTA"
  | "ANCORA_RICHIESTA"
  | "DATA_NON_VALIDA";

export class ErroreTempo extends Error {
  constructor(
    public codice: CodiceErroreTempo,
    messaggio: string
  ) {
    super(messaggio);
    this.name = "ErroreTempo";
  }
}

const NUMERI_PAROLA: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
  quindici: 15,
  venti: 20,
  trenta: 30,
  quarantacinque: 45,
  sessanta: 60,
};

const MESI: Record<string, number> = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

const NOMI_MESE = Object.keys(MESI).join("|");

// getDay(): 0=domenica … 6=sabato.
const GIORNI_SETTIMANA: Record<string, number> = {
  domenica: 0,
  lunedi: 1,
  martedi: 2,
  mercoledi: 3,
  giovedi: 4,
  venerdi: 5,
  sabato: 6,
};

function quantita(testo: string): number | null {
  const numero = Number(testo);
  if (Number.isInteger(numero) && numero > 0) return numero;
  return NUMERI_PAROLA[testo] ?? null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

type DataLocale = { anno: number; mese: number; giorno: number }; // mese 1-12

function oraLocaleRome(adesso: Date) {
  const locale = new TZDate(adesso, REMINDER_TIMEZONE);
  return {
    anno: locale.getFullYear(),
    mese: locale.getMonth() + 1,
    giorno: locale.getDate(),
    ore: locale.getHours(),
    minuti: locale.getMinutes(),
    giornoSettimana: locale.getDay(),
  };
}

/** Aritmetica di puro calendario (nessun fuso coinvolto). */
function aggiungiGiorni(base: DataLocale, giorni: number): DataLocale {
  const dt = new Date(Date.UTC(base.anno, base.mese - 1, base.giorno + giorni));
  return {
    anno: dt.getUTCFullYear(),
    mese: dt.getUTCMonth() + 1,
    giorno: dt.getUTCDate(),
  };
}

function dataValida(d: DataLocale): boolean {
  const dt = new Date(Date.UTC(d.anno, d.mese - 1, d.giorno));
  return (
    dt.getUTCFullYear() === d.anno &&
    dt.getUTCMonth() === d.mese - 1 &&
    dt.getUTCDate() === d.giorno
  );
}

function giornoSettimanaDi(d: DataLocale): number {
  return new Date(Date.UTC(d.anno, d.mese - 1, d.giorno)).getUTCDay();
}

function formattaData(d: DataLocale): string {
  return `${d.anno}-${pad2(d.mese)}-${pad2(d.giorno)}`;
}

/** Confronto in puro locale: (data, ora) candidata è nel futuro? */
function localeFuturo(
  d: DataLocale,
  ora: string,
  adesso: ReturnType<typeof oraLocaleRome>
): boolean {
  const candidata = `${formattaData(d)}T${ora}`;
  const corrente = `${formattaData(adesso)}T${pad2(adesso.ore)}:${pad2(adesso.minuti)}`;
  return candidata > corrente;
}

function normalizza(espressione: string): string {
  return espressione
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\bun'/g, "una ")
    .replace(/[àá]/g, "a")
    .replace(/[èé]/g, "e")
    .replace(/[ìí]/g, "i")
    .replace(/[òó]/g, "o")
    .replace(/[ùú]/g, "u")
    .replace(/\s+/g, " ")
    .replace(/[.,;!?]+$/g, "")
    .trim();
}

type OraTrovata = { ora: string; assunzione: string | null };

/**
 * Estrae l'orario (esplicito, mezzogiorno/mezzanotte o fascia). Se un
 * MARCATORE orario è presente ma non riconoscibile («alle dieci»,
 * «all'una», «verso le tre»), RIFIUTA: mai il default al posto di un
 * orario che l'utente ha indicato (revisione).
 */
function estraiOra(testo: string): OraTrovata | null {
  const esplicita =
    /(?:\balle\b|\ball')\s*(?:ore\s+)?(\d{1,2})(?:[:.](\d{2}))?(\s+e\s+mezz[oa]\b)?/.exec(
      testo
    );
  if (esplicita) {
    let ore = Number(esplicita[1]);
    let minuti = Number(esplicita[2] ?? "0");
    if (esplicita[3] && !esplicita[2]) minuti = 30; // «alle 8 e mezza»
    if (ore > 23 || minuti > 59) {
      throw new ErroreTempo(
        "DATA_NON_VALIDA",
        `L'orario «${esplicita[0].trim()}» non esiste.`
      );
    }
    // «alle 9 di sera» / «alle 3 del pomeriggio»: la fascia qualifica
    // l'ora esplicita (revisione: prima veniva ignorata → errore di 12h).
    if (
      ore >= 1 &&
      ore <= 12 &&
      /\b(?:di|della)\s+sera\b|\b(?:di|del)\s+pomeriggio\b/.test(testo)
    ) {
      ore = (ore % 12) + 12;
    }
    return { ora: `${pad2(ore)}:${pad2(minuti)}`, assunzione: null };
  }
  if (/\ba mezzogiorno\b/.test(testo)) {
    return { ora: "12:00", assunzione: null };
  }
  if (/\ba mezzanotte\b/.test(testo)) {
    return { ora: "00:00", assunzione: null };
  }
  if (/\b(?:sta)?mattina\b|\bmattino\b/.test(testo)) {
    return { ora: "09:00", assunzione: "mattina = 09:00 (orario predefinito)" };
  }
  if (/\bpomeriggio\b/.test(testo)) {
    return {
      ora: "15:00",
      assunzione: "pomeriggio = 15:00 (orario predefinito)",
    };
  }
  if (/\bsera\b|\bstasera\b/.test(testo)) {
    return { ora: "18:00", assunzione: "sera = 18:00 (orario predefinito)" };
  }
  if (/\balle\b|\ball'|\bverso\b/.test(testo)) {
    throw new ErroreTempo(
      "NON_RICONOSCIUTA",
      "L'orario è indicato ma non lo riconosco: usa le cifre, ad esempio «alle 13» o «alle 9 di sera»."
    );
  }
  return null;
}

function ancoraRichiesta(ancoraData: string | undefined): DataLocale {
  if (!ancoraData) {
    throw new ErroreTempo(
      "ANCORA_RICHIESTA",
      "L'espressione è relativa a una data di riferimento (es. la posa): serve il campo ancoraData (YYYY-MM-DD)."
    );
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ancoraData.trim());
  const d = match
    ? { anno: Number(match[1]), mese: Number(match[2]), giorno: Number(match[3]) }
    : null;
  if (!d || !dataValida(d)) {
    throw new ErroreTempo(
      "DATA_NON_VALIDA",
      `L'ancora «${ancoraData}» non è una data valida (atteso YYYY-MM-DD).`
    );
  }
  return d;
}

/**
 * Risolve un'espressione temporale italiana rispetto ad `adesso`
 * (Europe/Rome). NON verifica che il risultato sia futuro né gestisce il
 * DST: quelle verifiche restano a `server/reminders/time.ts`, l'unica
 * autorità sulla conversione locale→istante.
 */
export function risolviEspressioneTempo(
  espressione: string,
  adesso: Date,
  ancoraData?: string
): RisoluzioneTempo {
  const testo = normalizza(espressione);
  if (!testo) {
    throw new ErroreTempo("NON_RICONOSCIUTA", "Espressione temporale vuota.");
  }
  const oggi = oraLocaleRome(adesso);
  const assunzioni: string[] = [];
  const oraTrovata = estraiOra(testo);
  if (oraTrovata?.assunzione) assunzioni.push(oraTrovata.assunzione);

  const conOraODefault = (): string => {
    if (oraTrovata) return oraTrovata.ora;
    assunzioni.push("orario non indicato = 09:00 (predefinito)");
    return "09:00";
  };

  // ── Durate: «tra/fra N minuti|ore|giorni|settimane», «tra mezz'ora» ──
  const durata =
    /(?:^|\s)(?:tra|fra)\s+(mezz'?ora|un quarto d'ora|[\w']+)(?:\s+(minut[oi]|or[ae]|giorn[oi]|settiman[ae]))?(\s+e\s+mezz[oa]\b)?/.exec(
      testo
    );
  if (durata) {
    const [, grezzo, unita, eMezza] = durata;
    let minuti: number | null = null;
    let giorni: number | null = null;
    if (grezzo === "mezz'ora" || grezzo === "mezzora") minuti = 30;
    else if (grezzo === "un quarto d'ora") minuti = 15;
    else {
      const n = quantita(grezzo.replace(/'/g, ""));
      if (n != null && unita) {
        if (unita.startsWith("minut")) minuti = n;
        else if (unita.startsWith("or")) {
          minuti = n * 60 + (eMezza ? 30 : 0); // «tra due ore e mezza»
        } else if (unita.startsWith("giorn")) giorni = n;
        else giorni = n * 7;
      }
    }
    if (minuti != null) {
      // Durata esatta: istante, immune ai cambi d'ora.
      return {
        tipo: "istante",
        iso: new Date(adesso.getTime() + minuti * 60_000).toISOString(),
        assunzioni,
      };
    }
    if (giorni != null) {
      // «tra tre giorni» è calendario: stesso orario locale (o quello detto).
      const data = aggiungiGiorni(oggi, giorni);
      const ora = oraTrovata
        ? oraTrovata.ora
        : `${pad2(oggi.ore)}:${pad2(oggi.minuti)}`;
      return { tipo: "locale", dataLocale: formattaData(data), oraLocale: ora, assunzioni };
    }
    throw new ErroreTempo(
      "NON_RICONOSCIUTA",
      `Non riconosco la durata «${durata[0].trim()}». Esempi validi: «tra 30 minuti», «tra due ore», «tra tre giorni».`
    );
  }

  // ── Offset rispetto a un'ancora: «tre giorni prima», «il giorno prima» ─
  const prima =
    /(?:^|\s)(?:il giorno|(\w+)\s+(giorn[oi]|settiman[ae]))\s+prima\b/.exec(
      testo
    );
  if (prima) {
    const ancora = ancoraRichiesta(ancoraData);
    let giorni = 1;
    if (prima[1]) {
      const n = quantita(prima[1]);
      if (n == null) {
        throw new ErroreTempo(
          "NON_RICONOSCIUTA",
          `Non riconosco la quantità «${prima[1]}» in «${prima[0].trim()}».`
        );
      }
      giorni = prima[2].startsWith("settiman") ? n * 7 : n;
    }
    const data = aggiungiGiorni(ancora, -giorni);
    return {
      tipo: "locale",
      dataLocale: formattaData(data),
      oraLocale: conOraODefault(),
      assunzioni,
    };
  }

  // ── Giorni relativi ──────────────────────────────────────────────────
  if (/\bdopodomani\b/.test(testo)) {
    return {
      tipo: "locale",
      dataLocale: formattaData(aggiungiGiorni(oggi, 2)),
      oraLocale: conOraODefault(),
      assunzioni,
    };
  }
  if (/\bdomani\b/.test(testo)) {
    return {
      tipo: "locale",
      dataLocale: formattaData(aggiungiGiorni(oggi, 1)),
      oraLocale: conOraODefault(),
      assunzioni,
    };
  }
  if (/\boggi\b|\bstamattina\b|\bstasera\b/.test(testo)) {
    return {
      tipo: "locale",
      dataLocale: formattaData(oggi),
      oraLocale: conOraODefault(),
      assunzioni,
    };
  }

  // ── Giorno della settimana: «venerdì», «lunedì mattina» ─────────────
  // «venerdì 11 settembre» NON è un weekday relativo: lo gestisce il ramo
  // della data esplicita, con verifica di coerenza (revisione: prima il
  // weekday vinceva e la data veniva scartata in silenzio).
  const settimana =
    /(?:\b(prossim[oa])\s+)?\b(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b(\s+prossim[oa]\b)?/.exec(
      testo
    );
  const settimanaConData =
    settimana != null &&
    new RegExp(`\\b${settimana[2]}\\s+\\d{1,2}\\b`).test(testo);
  if (settimana && !settimanaConData) {
    const bersaglio = GIORNI_SETTIMANA[settimana[2]];
    const prossimoEsplicito = Boolean(settimana[1] || settimana[3]);
    const delta = (bersaglio - oggi.giornoSettimana + 7) % 7;
    const ora = conOraODefault();
    let data = aggiungiGiorni(oggi, delta);
    if (prossimoEsplicito && delta === 0) {
      // «prossimo sabato» detto di sabato = fra una settimana.
      data = aggiungiGiorni(data, 7);
      assunzioni.push(
        `«prossimo ${settimana[2]}» inteso come fra una settimana (${formattaData(data)})`
      );
    } else if (!localeFuturo(data, ora, oggi)) {
      data = aggiungiGiorni(data, 7);
      if (delta === 0) {
        assunzioni.push(
          `oggi è già ${settimana[2]} e l'orario è passato: inteso ${settimana[2]} prossimo`
        );
      }
    }
    return {
      tipo: "locale",
      dataLocale: formattaData(data),
      oraLocale: ora,
      assunzioni,
    };
  }

  // ── Data esplicita: «[venerdì] [il] 11 settembre [2026] [alle 10]»,
  //    «il 15/09[/2026]», «il 15» ────────────────────────────────────────
  const dataMese = new RegExp(
    `(?:\\bil\\s+)?\\b(\\d{1,2})\\s+(${NOMI_MESE})\\b(?:\\s+(\\d{4}))?`
  ).exec(testo);
  const dataNumerica = dataMese
    ? null
    : /\bil\s+(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{4}))?\b/.exec(testo);
  if (dataMese || dataNumerica) {
    const giorno = Number((dataMese ?? dataNumerica)![1]);
    const mese = dataMese
      ? MESI[dataMese[2]]
      : dataNumerica![2]
        ? Number(dataNumerica![2])
        : null;
    const anno = dataMese
      ? dataMese[3]
        ? Number(dataMese[3])
        : null
      : dataNumerica![3]
        ? Number(dataNumerica![3])
        : null;
    const ora = conOraODefault();

    if (mese == null) {
      // «il 15»: la prossima occorrenza del giorno del mese.
      let candidata: DataLocale = { anno: oggi.anno, mese: oggi.mese, giorno };
      for (
        let passi = 0;
        passi < 24 && !(dataValida(candidata) && localeFuturo(candidata, ora, oggi));
        passi++
      ) {
        const successivo = aggiungiGiorni(
          { anno: candidata.anno, mese: candidata.mese, giorno: 1 },
          32
        );
        candidata = { anno: successivo.anno, mese: successivo.mese, giorno };
      }
      if (!dataValida(candidata)) {
        throw new ErroreTempo(
          "DATA_NON_VALIDA",
          `Il giorno ${giorno} non esiste nei prossimi mesi.`
        );
      }
      assunzioni.push(
        `«il ${giorno}» inteso come la prossima occorrenza: ${formattaData(candidata)}`
      );
      return {
        tipo: "locale",
        dataLocale: formattaData(candidata),
        oraLocale: ora,
        assunzioni,
      };
    }

    if (mese < 1 || mese > 12) {
      throw new ErroreTempo("DATA_NON_VALIDA", `Il mese «${mese}» non esiste.`);
    }
    let candidata: DataLocale = { anno: anno ?? oggi.anno, mese, giorno };
    if (!dataValida(candidata)) {
      throw new ErroreTempo(
        "DATA_NON_VALIDA",
        `La data «${formattaData(candidata)}» non esiste sul calendario.`
      );
    }
    if (anno == null && !localeFuturo(candidata, ora, oggi)) {
      candidata = { ...candidata, anno: oggi.anno + 1 };
      assunzioni.push(
        `data già passata quest'anno: intesa per il ${formattaData(candidata)}`
      );
    }
    // Coerenza weekday↔data: «martedì 8 settembre» quando l'8 è un
    // martedì passa; se non lo è, rifiuto onesto (mai scegliere per conto
    // dell'utente fra le due letture).
    if (settimana) {
      const atteso = GIORNI_SETTIMANA[settimana[2]];
      if (giornoSettimanaDi(candidata) !== atteso) {
        throw new ErroreTempo(
          "DATA_NON_VALIDA",
          `Il ${formattaData(candidata)} non è un ${settimana[2]}: giorno della settimana e data non coincidono, indica quale dei due vale.`
        );
      }
    }
    return {
      tipo: "locale",
      dataLocale: formattaData(candidata),
      oraLocale: ora,
      assunzioni,
    };
  }

  // ── Solo orario: «alle 15» → oggi, o domani se già passato ──────────
  if (oraTrovata) {
    let data: DataLocale = oggi;
    if (!localeFuturo(data, oraTrovata.ora, oggi)) {
      data = aggiungiGiorni(oggi, 1);
      assunzioni.push(
        `oggi le ${oraTrovata.ora} sono già passate: inteso per domani`
      );
    }
    return {
      tipo: "locale",
      dataLocale: formattaData(data),
      oraLocale: oraTrovata.ora,
      assunzioni,
    };
  }

  throw new ErroreTempo(
    "NON_RICONOSCIUTA",
    "Non riconosco quando. Esempi validi: «domani alle 9», «venerdì», «tra due ore», «lunedì mattina», «il 15 settembre alle 10», «tre giorni prima» (con ancoraData)."
  );
}

const GIORNI_BREVI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

/** Rappresentazione leggibile in Europe/Rome: «gio 29/03/2026 09:00». */
export function formattaIstanteLocale(istante: Date): string {
  const locale = new TZDate(istante, REMINDER_TIMEZONE);
  return `${GIORNI_BREVI[locale.getDay()]} ${pad2(locale.getDate())}/${pad2(
    locale.getMonth() + 1
  )}/${locale.getFullYear()} ${pad2(locale.getHours())}:${pad2(
    locale.getMinutes()
  )}`;
}

/** Data+ora locali minuto-precise di un istante: per lo snooze custom. */
export function istanteComeLocale(istante: Date): string {
  const locale = new TZDate(istante, REMINDER_TIMEZONE);
  return `${locale.getFullYear()}-${pad2(locale.getMonth() + 1)}-${pad2(
    locale.getDate()
  )}T${pad2(locale.getHours())}:${pad2(locale.getMinutes())}`;
}
