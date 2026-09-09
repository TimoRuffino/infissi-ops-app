// server/tenants/comandi.ts
// Schemi dei payload di `tenant_comandi`, condivisi da script (produttore) e
// server (esecutore). Nessun accesso a store o database qui.
import { hostname } from "node:os";
import { z } from "zod";
import { isHashed } from "../_core/password";
import { SLUG_RE } from "./costanti";

const slug = z.string().regex(SLUG_RE, "Slug non valido: minuscole, cifre e trattini interni, max 40");
const testo = (max: number) => z.string().trim().min(1).max(max);

// Fix round Task 2 → Task 3 (revisione): un campo testuale nullable arriva
// da un form o da `--campo=` della CLI, che non sanno scrivere `null` — solo
// una stringa vuota. Senza questa normalizzazione "" cadrebbe nel validatore
// vero (es. `.email()`) e darebbe un errore invece di azzerare il campo.
// Applicato PRIMA del validatore: un valore genuinamente non valido continua
// a dare lo stesso errore di sempre.
const vuotoANull = <T extends z.ZodTypeAny>(validato: T) =>
  z.preprocess(v => (typeof v === "string" && v.trim() === "" ? null : v), validato);

export const schemaPayloadCrea = z.object({
  slug,
  nome: testo(120),
  sede: z.object({
    nome: testo(120),
    citta: z.string().trim().max(80).nullable().optional(),
  }),
  proprietario: z.object({
    nome: testo(80),
    cognome: testo(80),
    email: z.string().trim().email(),
    telefono: z.string().trim().max(40).nullable().optional(),
    // Mai in chiaro: lo script hasha prima di accodare.
    passwordHash: z.string().refine(isHashed, "passwordHash deve essere un hash scrypt"),
  }),
});
export type PayloadCrea = z.infer<typeof schemaPayloadCrea>;

export const schemaPayloadStato = z.object({
  slug,
  motivo: z.string().trim().min(3).max(500),
});

export const schemaPayloadProprietario = z.object({
  slug,
  email: z.string().trim().email(),
});

// `ricalcola_storage` (Task 4): il tenant si risolve dallo slug come gli
// altri comandi da script; il server accetta anche `comando.tenantId` diretto
// (es. dal ciclo interno), lo slug serve solo quando arriva da `pnpm tenant`.
export const schemaPayloadStorage = z.object({ slug });

// `ripristina_archivi` (Task 8): `backup` è una data «AAAA-MM-GG» o l'id di
// una cartella di Drive; `solo` limita gli store da sostituire (null = tutti
// quelli del backup). `scrivi` distingue la prova (il server legge il Drive e
// confronta, senza toccare nulla) dal ripristino vero — la prova la fa il
// server perché è lui a parlare col Drive dell'azienda, non lo script.
export const schemaPayloadRipristino = z.object({
  slug,
  backup: testo(120),
  solo: z.array(z.string().trim().min(1)).nullable().optional(),
  scrivi: z.boolean(),
  ancheTenant1: z.boolean().optional(),
});

// `imposta_abbonamento` (Task 3, spec §9): un'unica azione per comando,
// discriminata su `azione` — lo script (`pnpm tenant abbonamento`) traduce i
// suoi flag in ESATTAMENTE una di queste sette forme, mai due insieme.
// L'input resta nelle unità che un umano scrive (euro, GB, giorni): la
// conversione in nano-dollari/byte è del servizio (`server/abbonamenti/`),
// mai dello schema. `eur: null` in `budget_tars` toglie il tetto
// dell'azienda (nessun limite); in `extra_tars` l'importo è sempre positivo,
// un extra pari a zero non avrebbe senso da concedere.
export const schemaPayloadAbbonamento = z.discriminatedUnion("azione", [
  z.object({
    azione: z.literal("omaggio"),
    slug,
    motivo: testo(500),
    scadenza: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
  z.object({
    azione: z.literal("proroga"),
    slug,
    motivo: testo(500),
    giorni: z.number().int().min(1).max(365),
  }),
  z.object({
    azione: z.literal("quota"),
    slug,
    quotaGb: z.number().int().min(1).max(100_000),
  }),
  z.object({
    azione: z.literal("budget_tars"),
    slug,
    eur: z.number().min(0).max(100_000).nullable(),
  }),
  z.object({
    azione: z.literal("extra_tars"),
    slug,
    eur: z.number().positive().max(100_000),
  }),
  z.object({
    azione: z.literal("tolleranze"),
    slug,
    storage: z.number().int().min(0).max(365).optional(),
    tars: z.number().int().min(0).max(365).optional(),
  }),
  z.object({
    azione: z.literal("disdetta"),
    slug,
    disdetta: z.boolean(),
  }),
]);
export type PayloadAbbonamento = z.infer<typeof schemaPayloadAbbonamento>;

// `modifica_tenant` («Modifica azienda», piano 09/09/2026, Task 2): `slug`
// individua l'azienda (mai un `tenantId`, guardia confine.test.ts); ogni
// altro campo è facoltativo — solo quelli presenti cambiano
// (`servizio.ts#modificaTenant` confronta col record attuale). `fatturazione`
// è `.partial()`: un campo assente non tocca quello già salvato, un campo
// `null` esplicito lo azzera. Nessuna validazione fiscale oltre forma e
// lunghezza (spec: P.IVA 11 cifre, codice fiscale 11-16 caratteri, SDI 7
// caratteri, email valide). `sede`, quando presente, sostituisce nome e
// città insieme (non è un patch parziale): l'`id` la lega a UNA sede, che il
// servizio verifica appartenga al tenant.
export const schemaPayloadModificaTenant = z.object({
  slug,
  nome: testo(120).optional(),
  nuovoSlug: slug.optional(),
  note: vuotoANull(z.string().trim().max(2000).nullable()).optional(),
  fatturazione: z
    .object({
      // `.trim()` come i cinque campi vicini (fix round Task 2 → Task 3): lo
      // spazio attorno alle 11 cifre non deve far fallire una P.IVA valida.
      partitaIva: vuotoANull(z.string().trim().regex(/^\d{11}$/).nullable()),
      codiceFiscale: vuotoANull(z.string().trim().min(11).max(16).nullable()),
      indirizzoLegale: vuotoANull(z.string().trim().max(200).nullable()),
      emailAmministrativa: vuotoANull(z.string().trim().email().nullable()),
      pec: vuotoANull(z.string().trim().email().nullable()),
      codiceSdi: vuotoANull(z.string().trim().length(7).nullable()),
    })
    .partial()
    .optional(),
  sede: z
    .object({
      id: z.number().int().positive(),
      nome: testo(120),
      citta: vuotoANull(z.string().trim().max(80).nullable()),
    })
    .optional(),
});
export type PayloadModificaTenant = z.infer<typeof schemaPayloadModificaTenant>;

// `modifica_proprietario` (Task 2): `utenteId` è facoltativo — se manca e
// l'azienda ha un solo proprietario, `servizio.ts#modificaProprietario` lo
// risolve da sé; con più di un proprietario (o nessuno) rifiuta
// (`MESSAGGI.proprietarioAmbiguo`). A differenza di `fatturazione`, qui non
// è un patch: nome/cognome/email sono lo stato pieno che sostituisce quello
// attuale (stesso motivo di `sede` sopra), `telefono` assente equivale a
// nessun telefono (come in `schemaPayloadCrea.proprietario`, mai "non toccare").
export const schemaPayloadModificaProprietario = z.object({
  slug,
  utenteId: z.number().int().positive().optional(),
  nome: testo(80),
  cognome: testo(80),
  email: z.string().trim().email(),
  telefono: vuotoANull(z.string().trim().max(40).nullable()).optional(),
});
export type PayloadModificaProprietario = z.infer<typeof schemaPayloadModificaProprietario>;

export function richiestoDa(): string {
  return `script:tenant@${hostname()}`;
}
