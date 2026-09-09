// server/tenants/comandi.tipi.assert.ts
// Guardia di SOLO TIPO (Task 3 «Modifica azienda», fix round 1): nessuna riga
// qui sotto gira mai — `pnpm test` non la esegue (il nome non combacia con
// `**/*.test.ts`/`**/*.spec.ts` di vitest.config.ts), ma `pnpm check` la
// type-checka come ogni altro file sotto `server/**/*` (tsconfig.json esclude
// SOLO `**/*.test.ts`). Serve a provare, a livello di tipo, che `vuotoANull`
// (comandi.ts) non lascia più l'INPUT dei campi che avvolge a `unknown`.
//
// Prima della fix: zod 4 lasciava `z.preprocess`'s B (il parametro della
// funzione, cioè l'input del nodo) a `unknown` per difetto, perché una
// lambda senza annotazione non basta a dedurlo. `z.input<>` di ognuno dei
// dieci campi avvolti (note, i sei di fatturazione, sede.citta, telefono)
// diventava `unknown`: un payload come `{ note: 12345 }` passava il
// type-check pur restando rifiutato a runtime. Se `vuotoANull` tornasse
// senza l'annotazione, ognuno dei `// @ts-expect-error` qui sotto smetterebbe
// di essere un errore vero, e tsc fallirebbe con «Unused '@ts-expect-error'
// directive» — la stessa identica prova, al contrario.
import type { z } from "zod";
import type { schemaPayloadModificaProprietario, schemaPayloadModificaTenant } from "./comandi";

type InputModificaTenant = z.input<typeof schemaPayloadModificaTenant>;
type InputModificaProprietario = z.input<typeof schemaPayloadModificaProprietario>;

// ── Validi: string, null o assente restano ammessi (nessuna regressione) ───

const validoStringa: InputModificaTenant = { slug: "acme", note: "cliente storico" };
const validoNull: InputModificaTenant = { slug: "acme", note: null };
const validoAssente: InputModificaTenant = { slug: "acme" };
const validoFatturazione: InputModificaTenant = { slug: "acme", fatturazione: { pec: "acme@pec.it" } };
const validoFatturazioneNull: InputModificaTenant = { slug: "acme", fatturazione: { pec: null } };
const validoSedeCitta: InputModificaTenant = { slug: "acme", sede: { id: 1, nome: "HQ", citta: null } };
const validoTelefono: InputModificaProprietario = {
  slug: "acme",
  nome: "Mario",
  cognome: "Rossi",
  email: "mario@acme.it",
  telefono: null,
};

// ── Non validi: senza l'annotazione di `vuotoANull` questi passavano perché
// l'input del campo era `unknown` invece di `string | null` ────────────────

const nonValidoNote: InputModificaTenant = {
  slug: "acme",
  // @ts-expect-error — note deve essere string | null | undefined, non un numero.
  note: 12345,
};

const nonValidoPec: InputModificaTenant = {
  slug: "acme",
  fatturazione: {
    // @ts-expect-error — pec deve essere string | null | undefined, non un oggetto.
    pec: {},
  },
};

const nonValidoSedeCitta: InputModificaTenant = {
  slug: "acme",
  sede: {
    id: 1,
    nome: "HQ",
    // @ts-expect-error — sede.citta deve essere string | null, non un array.
    citta: [],
  },
};

const nonValidoTelefono: InputModificaProprietario = {
  slug: "acme",
  nome: "Mario",
  cognome: "Rossi",
  email: "mario@acme.it",
  // @ts-expect-error — telefono deve essere string | null | undefined, non un array.
  telefono: [],
};

// Le costanti sopra esistono solo per il type-check di cui sopra: questa
// funzione le "usa" tutte così nessun editor/linter futuro le segnala come
// morte, senza eseguire nulla (mai chiamata).
export function _mai_chiamata_solo_per_il_typecheck(): unknown[] {
  return [
    validoStringa,
    validoNull,
    validoAssente,
    validoFatturazione,
    validoFatturazioneNull,
    validoSedeCitta,
    validoTelefono,
    nonValidoNote,
    nonValidoPec,
    nonValidoSedeCitta,
    nonValidoTelefono,
  ];
}
