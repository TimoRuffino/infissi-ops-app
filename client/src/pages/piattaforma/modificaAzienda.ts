// Cosa mandare quando si salva «Modifica azienda» (piano 09/09/2026, Task
// 4). Modulo PURO: nessun React, nessuna query — qui vive la sola domanda
// difficile del dialogo, «cosa è cambiato davvero», e la risposta si può
// verificare senza montare niente.
//
// Tre regole, tutte del server, che qui si rispettano invece di reinventarle:
// - si manda SOLO ciò che è cambiato (`modifica` è un patch: un campo assente
//   resta com'è);
// - la stringa vuota AZZERA (`vuotoANull` in server/tenants/comandi.ts), così
//   il modulo non ha bisogno di distinguere «vuoto» da `null`;
// - `sede` e il proprietario non sono patch ma stato pieno: appena un loro
//   campo cambia viaggiano interi, id compreso.
import { TENANT_PIATTAFORMA_ID, slugValido } from "@/lib/piattaforma";

import {
  CAMPI_FATTURAZIONE,
  emailPlausibile,
  erroreFatturazione,
  type CampoFatturazione,
} from "./testi";

/**
 * La parte di `SchedaAzienda` (server/piattaforma/letture.ts) che il dialogo
 * modifica. Strutturale, non importata: il modulo resta verificabile con un
 * oggetto scritto a mano, e la scheda vera lo soddisfa così com'è.
 */
export type SchedaModificabile = {
  id: number;
  nome: string;
  slug: string;
  note: string | null;
  fatturazione: Record<CampoFatturazione, string | null>;
  sedePredefinita: { id: number; nome: string; citta: string | null } | null;
  proprietari: Array<{
    id: number;
    nome: string;
    cognome: string;
    email: string;
    telefono: string | null;
    invitoInSospeso: boolean;
  }>;
};

/** Il modulo aperto: tutti i campi sono stringhe, anche quelli che a terra sono `null`. */
export type ValoriModifica = {
  nome: string;
  slug: string;
  note: string;
  fatturazione: Record<CampoFatturazione, string>;
  sedeNome: string;
  sedeCitta: string;
  proprietario: {
    id: number;
    nome: string;
    cognome: string;
    email: string;
    telefono: string;
  } | null;
};

/** L'input di `piattaforma.modifica`, senza `slug` e password (li mette il dialogo). */
export type PayloadModifica = {
  nome?: string;
  nuovoSlug?: string;
  note?: string;
  fatturazione?: Partial<Record<CampoFatturazione, string>>;
  sede?: { id: number; nome: string; citta: string };
};

/** L'input di `piattaforma.modificaProprietario`, senza `slug` e password. */
export type PayloadProprietario = {
  utenteId: number;
  nome: string;
  cognome: string;
  email: string;
  telefono: string;
};

export type DiffModifica = {
  /** Le sezioni toccate, in italiano: per il riepilogo e per i segni sui pannelli. */
  sezioni: string[];
  payloadAzienda: PayloadModifica | null;
  payloadProprietario: PayloadProprietario | null;
};

const SEZIONE = {
  azienda: "Azienda",
  fatturazione: "Fatturazione",
  sede: "Sede",
  proprietario: "Proprietario",
} as const;

/**
 * I valori di partenza del modulo. `proprietarioId` è quello scelto nel
 * pannello Proprietario: se non c'è (prima apertura) o non esiste più — un
 * proprietario revocato mentre il dialogo era aperto — si ripiega sul primo,
 * che è il caso normale (un'azienda ne ha uno).
 */
export function valoriIniziali(
  scheda: SchedaModificabile,
  proprietarioId: number | null
): ValoriModifica {
  const proprietario =
    scheda.proprietari.find(p => p.id === proprietarioId) ?? scheda.proprietari[0] ?? null;
  const fatturazione = Object.fromEntries(
    CAMPI_FATTURAZIONE.map(({ campo }) => [campo, scheda.fatturazione[campo] ?? ""])
  ) as Record<CampoFatturazione, string>;
  return {
    nome: scheda.nome,
    slug: scheda.slug,
    note: scheda.note ?? "",
    fatturazione,
    sedeNome: scheda.sedePredefinita?.nome ?? "",
    sedeCitta: scheda.sedePredefinita?.citta ?? "",
    proprietario: proprietario
      ? {
          id: proprietario.id,
          nome: proprietario.nome,
          cognome: proprietario.cognome,
          email: proprietario.email,
          telefono: proprietario.telefono ?? "",
        }
      : null,
  };
}

/**
 * Cosa è cambiato fra la scheda e il modulo: i due payload da mandare (o
 * `null`, e la mutation non parte) e i nomi delle sezioni toccate.
 *
 * Lo slug dell'azienda della piattaforma non entra MAI nel payload: nel
 * dialogo il campo è di sola lettura, e questa è la seconda serratura —
 * `tenant1SlugIntoccabile` tornerebbe come un comando in errore, cioè come
 * un salvataggio fallito per intero.
 */
export function diffModifica(
  scheda: SchedaModificabile,
  valori: ValoriModifica
): DiffModifica {
  const payload: PayloadModifica = {};
  const sezioni: string[] = [];

  const nome = valori.nome.trim();
  if (nome !== scheda.nome) payload.nome = nome;
  const slug = valori.slug.trim();
  if (scheda.id !== TENANT_PIATTAFORMA_ID && slug !== scheda.slug) payload.nuovoSlug = slug;
  const note = valori.note.trim();
  if (note !== (scheda.note ?? "")) payload.note = note;
  if (payload.nome != null || payload.nuovoSlug != null || payload.note != null) {
    sezioni.push(SEZIONE.azienda);
  }

  const fatturazione: Partial<Record<CampoFatturazione, string>> = {};
  for (const { campo } of CAMPI_FATTURAZIONE) {
    const valore = valori.fatturazione[campo].trim();
    if (valore !== (scheda.fatturazione[campo] ?? "")) fatturazione[campo] = valore;
  }
  if (Object.keys(fatturazione).length > 0) {
    payload.fatturazione = fatturazione;
    sezioni.push(SEZIONE.fatturazione);
  }

  const sede = scheda.sedePredefinita;
  if (sede) {
    const sedeNome = valori.sedeNome.trim();
    const sedeCitta = valori.sedeCitta.trim();
    if (sedeNome !== sede.nome || sedeCitta !== (sede.citta ?? "")) {
      payload.sede = { id: sede.id, nome: sedeNome, citta: sedeCitta };
      sezioni.push(SEZIONE.sede);
    }
  }

  let payloadProprietario: PayloadProprietario | null = null;
  const scritto = valori.proprietario;
  const originale = scritto ? scheda.proprietari.find(p => p.id === scritto.id) : undefined;
  if (scritto && originale) {
    const proprietario: PayloadProprietario = {
      utenteId: scritto.id,
      nome: scritto.nome.trim(),
      cognome: scritto.cognome.trim(),
      email: scritto.email.trim(),
      telefono: scritto.telefono.trim(),
    };
    const cambiato =
      proprietario.nome !== originale.nome ||
      proprietario.cognome !== originale.cognome ||
      proprietario.email !== originale.email ||
      proprietario.telefono !== (originale.telefono ?? "");
    if (cambiato) {
      payloadProprietario = proprietario;
      sezioni.push(SEZIONE.proprietario);
    }
  }

  return {
    sezioni,
    payloadAzienda: Object.keys(payload).length > 0 ? payload : null,
    payloadProprietario,
  };
}

/**
 * I motivi per cui «Salva» resta spento, in italiano e già leggibili. Sono
 * le stesse regole di forma degli schemi zod del comando: dirle mentre si
 * scrive costa una funzione, scoprirle dopo il viaggio costa un `ZodError`
 * che non nomina nemmeno il campo.
 */
export function erroriModulo(
  scheda: SchedaModificabile,
  valori: ValoriModifica
): string[] {
  const errori: string[] = [];

  if (valori.nome.trim() === "") errori.push("La ragione sociale non può restare vuota.");

  const slug = valori.slug.trim();
  if (scheda.id !== TENANT_PIATTAFORMA_ID && slug !== scheda.slug && !slugValido(slug)) {
    errori.push(
      "Lo slug vuole minuscole, cifre e trattini interni: al massimo 40 caratteri, mai un trattino ai bordi."
    );
  }

  for (const { campo, etichetta } of CAMPI_FATTURAZIONE) {
    const errore = erroreFatturazione(campo, valori.fatturazione[campo]);
    if (errore) errori.push(`${etichetta}: ${errore}`);
  }

  if (scheda.sedePredefinita && valori.sedeNome.trim() === "") {
    errori.push("Il nome della sede non può restare vuoto.");
  }

  const proprietario = valori.proprietario;
  if (proprietario) {
    if (proprietario.nome.trim() === "" || proprietario.cognome.trim() === "") {
      errori.push("Nome e cognome del proprietario non possono restare vuoti.");
    }
    if (!emailPlausibile(proprietario.email)) {
      errori.push("L'email del proprietario non ha la forma di un indirizzo.");
    }
  }

  return errori;
}
