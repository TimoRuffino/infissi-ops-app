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
  erroreLunghezzaCampo,
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
 *
 * Nit della revisione (fix round 1, Task 4): mancavano i tetti di lunghezza
 * dello stesso schema — solo la forma (vuoto, email, slug) era controllata
 * qui, la lunghezza no. `erroreLunghezzaCampo` (testi.ts) porta gli stessi
 * `.max()` di `schemaPayloadModificaTenant`/`schemaPayloadModificaProprietario`
 * (server/tenants/comandi.ts): `indirizzoLegale` li aveva già, attraverso
 * `erroreFatturazione`, e resta lì invariato.
 */
export function erroriModulo(
  scheda: SchedaModificabile,
  valori: ValoriModifica
): string[] {
  const errori: string[] = [];

  if (valori.nome.trim() === "") errori.push("La ragione sociale non può restare vuota.");
  const erroreNome = erroreLunghezzaCampo("nome", valori.nome);
  if (erroreNome) errori.push(erroreNome);

  const slug = valori.slug.trim();
  if (scheda.id !== TENANT_PIATTAFORMA_ID && slug !== scheda.slug && !slugValido(slug)) {
    errori.push(
      "Lo slug vuole minuscole, cifre e trattini interni: al massimo 40 caratteri, mai un trattino ai bordi."
    );
  }

  const erroreNote = erroreLunghezzaCampo("note", valori.note);
  if (erroreNote) errori.push(erroreNote);

  for (const { campo, etichetta } of CAMPI_FATTURAZIONE) {
    const errore = erroreFatturazione(campo, valori.fatturazione[campo]);
    if (errore) errori.push(`${etichetta}: ${errore}`);
  }

  if (scheda.sedePredefinita) {
    if (valori.sedeNome.trim() === "") errori.push("Il nome della sede non può restare vuoto.");
    const erroreSedeNome = erroreLunghezzaCampo("sedeNome", valori.sedeNome);
    if (erroreSedeNome) errori.push(erroreSedeNome);
  }

  const proprietario = valori.proprietario;
  if (proprietario) {
    if (proprietario.nome.trim() === "" || proprietario.cognome.trim() === "") {
      errori.push("Nome e cognome del proprietario non possono restare vuoti.");
    }
    const erroreNomeProp = erroreLunghezzaCampo("propNome", proprietario.nome);
    if (erroreNomeProp) errori.push(erroreNomeProp);
    const erroreCognomeProp = erroreLunghezzaCampo("propCognome", proprietario.cognome);
    if (erroreCognomeProp) errori.push(erroreCognomeProp);
    if (!emailPlausibile(proprietario.email)) {
      errori.push("L'email del proprietario non ha la forma di un indirizzo.");
    }
    const erroreTelefonoProp = erroreLunghezzaCampo("propTelefono", proprietario.telefono);
    if (erroreTelefonoProp) errori.push(erroreTelefonoProp);
  }

  return errori;
}

// ── Fix round 1 (Task 4): un secondo tentativo dopo il fallimento composto ──

/**
 * Cosa risulta già salvato da un tentativo precedente, dentro la STESSA
 * apertura del dialogo. `azienda` porta lo slug su cui si trova adesso
 * l'azienda (quello nuovo, se `nuovoSlug` era nel payload): serve perché,
 * dopo un cambio di slug, `ModificaAziendaDialog#rinfresca` non ricarica la
 * `scheda` finché il dialogo resta aperto — altrimenti la query del vecchio
 * slug risponderebbe NOT_FOUND e il dialogo (con dentro l'eventuale link
 * dell'invito riemesso) sparirebbe con lo stato d'errore di `AziendaDetail`.
 */
export type EsitoParziale = {
  azienda: { slug: string } | null;
  proprietario: boolean;
};

export type DaRipetere = {
  payloadAzienda: PayloadModifica | null;
  payloadProprietario: PayloadProprietario | null;
  /** Lo slug su cui mandare i comandi: quello nuovo se l'azienda è già salvata, altrimenti quello con cui il dialogo è stato aperto. */
  slug: string;
  /**
   * Le sezioni ANCORA da salvare, per il riepilogo sopra la password: una
   * volta a terra spariscono di qui anche se `diff` (calcolato sulla scheda
   * vecchia, per il motivo sopra) le vede ancora come cambiate.
   */
  sezioni: string[];
};

const SEZIONI_AZIENDA: readonly string[] = [SEZIONE.azienda, SEZIONE.fatturazione, SEZIONE.sede];

/**
 * Cosa manda DAVVERO un tentativo, dato ciò che uno precedente ha già
 * salvato. Nasce da un bug preciso della revisione: `diff` si calcola
 * sempre sulla `scheda` con cui il dialogo è stato aperto (di proposito non
 * si ricarica dopo un cambio di slug, v. sopra), quindi se lo slug cambia e
 * poi `modificaProprietario` fallisce, un secondo tentativo che si limitasse
 * a rileggere `diff` manderebbe di nuovo il payload dell'azienda — con lo
 * slug VECCHIO, che dopo il cambio risponde NOT_FOUND — e il proprietario
 * non si potrebbe più salvare in nessun modo. Questa funzione toglie dal
 * payload ciò che `fatto` dice già andato a buon fine e sposta il bersaglio
 * sullo slug nuovo, cosicché il secondo comando parta da solo, sul tenant
 * giusto.
 */
export function payloadDaRipetere(
  diff: DiffModifica,
  slugApertura: string,
  fatto: EsitoParziale
): DaRipetere {
  const sezioni = diff.sezioni.filter(sezione => {
    if (fatto.azienda && SEZIONI_AZIENDA.includes(sezione)) return false;
    if (fatto.proprietario && sezione === SEZIONE.proprietario) return false;
    return true;
  });
  return {
    payloadAzienda: fatto.azienda ? null : diff.payloadAzienda,
    payloadProprietario: fatto.proprietario ? null : diff.payloadProprietario,
    slug: fatto.azienda?.slug ?? slugApertura,
    sezioni,
  };
}
