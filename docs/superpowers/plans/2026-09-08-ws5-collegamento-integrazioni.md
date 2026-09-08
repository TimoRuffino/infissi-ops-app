# WS5 — Collegamento delle integrazioni in self-service — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un'azienda che si attiva collega le proprie integrazioni da sola, senza assistenza e senza mai aprire un'area sviluppatori, dietro un contratto unico che fa rispondere tutte le integrazioni alle stesse tre domande.

**Architecture:** Una directory nuova `server/integrazioni/` definisce un contratto (`Adattatore`) e un registro; sei adattatori lo implementano **avvolgendo** i router esistenti senza modificarli. Un router tRPC unico li espone. Lato client, una `SchedaIntegrazione` sola li disegna tutti, in due modalità — attivazione guidata e impostazioni — che sono gli stessi componenti, non due schermate.

**Tech Stack:** TypeScript, Express 4, tRPC 11, Vitest, React 19, Wouter, TanStack Query, Tailwind 4, shadcn/Radix.

**Spec:** `docs/superpowers/specs/2026-09-08-ws5-collegamento-integrazioni-design.md`

**Perimetro di questo piano:** fasi 1, 2 e 3 della spec §11 — la cornice, l'attivazione guidata, WhatsApp. La **fase 4** (OAuth calendario in entrata) ha un piano proprio: dipende da `'gcal'` nel CHECK di `oauth_state`, che è una modifica di WS3 non ancora fatta (spec §7.1), e dalla verifica del consent screen Google. La **fase 5** (calendario in scrittura) ha spec propria.

## Global Constraints

Valgono per **ogni** task. Copiate dalla spec e da `CLAUDE.md`.

- **Base:** `feature/ws4-abbonamenti` (contiene WS3). Branch di lavoro: `feature/ws5-collegamento-integrazioni`.
- **Zona vietata, nessuna eccezione in questo piano:** `server/tenants/**`, `server/_core/persistence.ts`, `server/_core/fileStorage.ts`, `server/_core/driveBackup.ts`, `server/_core/rotteAnonime.ts`, `server/routers/fattureInCloud.ts`, `server/routers/backup.ts`, `server/routers/externalCalendars.ts`. Gli adattatori **importano e chiamano** le funzioni esportate da questi file; non ne modificano una riga.
- **Guardie:** ogni procedura applica la guardia dell'adattatore, non una guardia unica del router. `adminProcedure` per `fic`, `backup`, `email`, `whatsapp`; `protectedProcedure` per `calendario`, `agente`. Non si allarga né si restringe nessun permesso esistente.
- **`sedeId` su ogni entità, query e mutation.** Un record di un'altra sede produce `NOT_FOUND`, mai un'informazione utile a enumerarne l'id.
- **`stato()` non effettua nessuna chiamata di rete.** È la garanzia che la pagina non paghi sei chiamate esterne a ogni caricamento. Coperta da test in Task 1 e riverificata a ogni adattatore.
- **`verifica()` è l'unica che chiama il fornitore**, su richiesta, con cache 60 s, mai in un giro su tutti i tenant.
- **Importi:** helper di `client/src/lib/euro.ts`. **UI:** token semantici di `client/src/index.css`, mai hex locali; Plus Jakarta Sans; icone lucide con `aria-label` sui pulsanti solo icona; nessuno scroll orizzontale globale; `min-w-0` su tabelle e pannelli.
- **Niente segreti nei log:** mai access token, refresh token, password, app secret o payload cliente completi.
- **Definizione di completato:** `pnpm check`, `pnpm test` e `pnpm build` passano. Le modifiche UI sono controllate a 1440×900 e 390×844 senza errori console.
- **Documenti per ultimi:** PRD, `handoff.md` e `docs/runbooks/multi-azienda.md` si toccano solo nel Task 14, dopo l'atterraggio di WS3 e WS4, per non ripetere la collisione PRD 5.33–5.36 del 05/09.

## File Structure

**Nuovi — server**

| File | Responsabilità |
|---|---|
| `server/integrazioni/contratto.ts` | Solo tipi: `Chiave`, `Problema`, `Stato`, `Avvio`, `Adattatore`. Nessuna logica, nessun import di dominio. |
| `server/integrazioni/registro.ts` | L'elenco delle sei in ordine di attivazione, e `adattatoreDi(chiave)`. |
| `server/integrazioni/cache.ts` | Cache 60 s degli esiti di `verifica()`, per chiave e sede. |
| `server/integrazioni/adattatori/agente.ts` | Non si collega: dichiara «incluso», legge il budget WS4 in sola lettura. |
| `server/integrazioni/adattatori/backup.ts` | Avvolge `backupStatus`, `checkBackupRoot`, `oauthClientFromEnv`, `issueOAuthState`, `buildAuthUrl`, `disconnectOAuth`. |
| `server/integrazioni/adattatori/email.ts` | Avvolge lo store `caselle`; `verifica()` = login IMAP vero. |
| `server/integrazioni/adattatori/fic.ts` | Avvolge `getCfg`, `accessTokenFic`, `ficGet`, `issueFicOAuthState`, `buildFicAuthUrl`. Porta i due spigoli: azienda non scelta, callback canonico. |
| `server/integrazioni/adattatori/whatsapp.ts` | Avvolge `getAppWhatsApp`, `appPubblica`, `configWhatsApp`, `completaOnboarding`. |
| `server/integrazioni/attivazione.ts` | Store `onboarding_integrazioni` per azienda: per chiave, `saltata \| collegata \| in_corso` e quando. |
| `server/integrazioni/router.ts` | `integrazioni.*`: `elenco`, `verifica`, `avvia`, `completa`, `scollega`, `attivazione`, `salta`. |

**Nuovi — client**

| File | Responsabilità |
|---|---|
| `client/src/integrazioni/useIntegrazioni.ts` | Hook: elenco, verifica su richiesta, avvio, completamento. |
| `client/src/integrazioni/SchedaIntegrazione.tsx` | La scheda unica: soggetto, stato, problema con rimedio, azione. |
| `client/src/integrazioni/PercorsoAttivazione.tsx` | Modalità `attivazione`: stessi componenti, ordinati, con «salta». |

**Modificati**

| File | Modifica |
|---|---|
| `server/routers.ts` | Registra `integrazioni: integrazioniRouter`. |
| `server/comunicazioni/whatsapp.ts` | `getAppWhatsApp` prende un ripiego di piattaforma dall'ambiente; l'override per sede resta e vince. |
| `client/src/pages/Integrazioni.tsx` | Ricomposta sulle schede unificate. |
| `client/src/components/WhatsAppCard.tsx` | I tre campi dell'app escono dalla scheda del cliente; il fallback manuale si declassa a diagnostica. |

---

### Task 1: Il contratto, il registro e il primo adattatore

Vertical slice completa: tipi, registro, router e l'adattatore più semplice — `agente`, che non si collega. Alla fine del task `integrazioni.elenco()` risponde davvero.

**Files:**
- Create: `server/integrazioni/contratto.ts`
- Create: `server/integrazioni/registro.ts`
- Create: `server/integrazioni/adattatori/agente.ts`
- Create: `server/integrazioni/router.ts`
- Modify: `server/routers.ts`
- Test: `server/integrazioni/registro.test.ts`

**Interfaces:**
- Consumes: `router`, `protectedProcedure`, `adminProcedure` da `server/_core/trpc`; `TrpcContext` da `server/_core/context`.
- Produces: i tipi di `contratto.ts` (`Chiave`, `Problema`, `Stato`, `Avvio`, `Ctx`, `Adattatore`); `REGISTRO: Adattatore[]` e `adattatoreDi(chiave: Chiave): Adattatore | null` da `registro.ts`; `integrazioniRouter` da `router.ts`. Ogni task successivo aggiunge un adattatore al `REGISTRO` e non cambia questi nomi.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/integrazioni/registro.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { REGISTRO, adattatoreDi } from "./registro";

function ctx(sedeId = 1): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "local-1",
      name: "Admin Ruffino",
      email: "admin@ruffinogroup.it",
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {}, get: () => "app.wyndoor.com" } as any,
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [1, 2],
    tenantId: 1,
    tenant: null,
  };
}

describe("registro delle integrazioni", () => {
  it("l'ordine è quello dell'attivazione, non l'alfabeto", () => {
    // Sottosuccessione: gli adattatori entrano nel registro man mano che i
    // loro task atterrano, ma sempre in quest'ordine. Il Task 12 sostituisce
    // questa asserzione con l'elenco completo.
    const atteso = ["fic", "email", "whatsapp", "backup", "agente"];
    const presenti = REGISTRO.map(a => a.chiave);
    expect(presenti).toEqual(atteso.filter(c => presenti.includes(c)));
  });

  it("una chiave sconosciuta non risolve", () => {
    expect(adattatoreDi("inesistente" as any)).toBeNull();
  });

  it("elenco risponde con uno Stato per ogni adattatore registrato", async () => {
    const stati = await appRouter.createCaller(ctx()).integrazioni.elenco();
    expect(stati.map(s => s.chiave)).toEqual(REGISTRO.map(a => a.chiave));
  });

  it("stato() non effettua nessuna chiamata di rete", async () => {
    const spia = vi.spyOn(globalThis, "fetch");
    await appRouter.createCaller(ctx()).integrazioni.elenco();
    expect(spia).not.toHaveBeenCalled();
    spia.mockRestore();
  });

  it("l'agente non si collega: nessun avvio, nessuno scollegamento", async () => {
    const agente = adattatoreDi("agente")!;
    expect(agente.avvia).toBeUndefined();
    expect(agente.scollega).toBeUndefined();
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm test server/integrazioni/registro.test.ts`
Expected: FAIL — `Cannot find module './registro'`.

- [ ] **Step 3: Scrivere il contratto**

`server/integrazioni/contratto.ts`:

```ts
// Il contratto unico del collegamento (WS5, spec §3).
//
// Non è inventato: `fattureInCloud` e `backup` espongono già `status`,
// `oauthStartUrl` e `disconnectOAuth` con gli stessi nomi. Qui l'accordo
// diventa esplicito e vale anche per le altre quattro.
//
// Solo tipi: nessuna logica, nessun import di dominio. Un adattatore importa
// questo file, mai il contrario.

import type { TrpcContext } from "../_core/context";

export type Chiave =
  | "fic"
  | "email"
  | "whatsapp"
  | "calendario"
  | "backup"
  | "agente";

/** Cosa si è rotto e cosa deve fare la persona. Mai un codice, mai uno stack. */
export type Problema = {
  causa: string;
  rimedio: string;
  azione: "ricollega" | "riprova" | "scegli" | "assistenza" | null;
};

export type Stato = {
  chiave: Chiave;
  ambito: "sede" | "azienda";
  collegato: boolean;
  /**
   * Cosa è collegato, col suo nome: «+39 0187 872687», «Ruffino Group Srl».
   * Uno stato che non nomina la cosa collegata non è uno stato.
   */
  soggetto: string | null;
  verificatoIl: Date | null;
  problema: Problema | null;
};

export type Avvio =
  | { tipo: "url"; url: string } // OAuth: FiC, Drive, calendario
  | { tipo: "popup"; configId: string } // Embedded Signup WhatsApp
  | { tipo: "modulo" }; // IMAP: il modulo vive nel client

export type Ctx = TrpcContext;

export type Adattatore = {
  chiave: Chiave;
  ambito: "sede" | "azienda";
  /** La guardia che il router sottostante applica già. Non si allarga. */
  permesso: "direzione" | "utente";

  /** Sola lettura, nessuna chiamata di rete: regge il caricamento pagina. */
  stato(ctx: Ctx): Promise<Stato>;
  /** Prova viva: una chiamata vera al fornitore. Costa, quindi non è `stato`. */
  verifica(ctx: Ctx): Promise<Problema | null>;

  avvia?(ctx: Ctx, opz?: unknown): Promise<Avvio>;
  completa?(ctx: Ctx, esito: unknown): Promise<void>;
  scollega?(ctx: Ctx): Promise<void>;
};
```

- [ ] **Step 4: Scrivere l'adattatore `agente`**

`server/integrazioni/adattatori/agente.ts`:

```ts
// L'agente non si collega: non ha `avvia` né `scollega`.
//
// Esiste perché la cornice sia onesta. Un'integrazione che non richiede
// nessun gesto deve poterlo dire — sparire dall'elenco farebbe credere al
// cliente che manchi qualcosa da fare.

import type { Adattatore, Problema, Stato } from "../contratto";

export const agente: Adattatore = {
  chiave: "agente",
  ambito: "azienda",
  permesso: "utente",

  async stato(): Promise<Stato> {
    return {
      chiave: "agente",
      ambito: "azienda",
      collegato: true,
      soggetto: "Incluso nell'abbonamento",
      verificatoIl: null,
      problema: null,
    };
  },

  async verifica(): Promise<Problema | null> {
    // Il provider è della piattaforma: se manca la chiave è un guasto
    // nostro, non un collegamento che il cliente possa rifare.
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return {
        causa: "L'agente non è raggiungibile.",
        rimedio: "È un guasto della piattaforma: non serve nessuna azione da parte tua.",
        azione: "assistenza",
      };
    }
    return null;
  },
};
```

- [ ] **Step 5: Scrivere il registro**

`server/integrazioni/registro.ts`:

```ts
// Le sei integrazioni, in ordine di attivazione: prima i soldi, poi i
// canali, poi il calendario, poi il backup. L'agente chiude perché non
// chiede niente. L'ordine è dato qui una volta e vale sia per la pagina
// delle impostazioni sia per il percorso guidato.
//
// Gli adattatori entrano nel registro man mano che i loro task atterrano.

import type { Adattatore, Chiave } from "./contratto";
import { agente } from "./adattatori/agente";

export const REGISTRO: Adattatore[] = [agente];

export function adattatoreDi(chiave: Chiave): Adattatore | null {
  return REGISTRO.find(a => a.chiave === chiave) ?? null;
}
```


- [ ] **Step 6: Scrivere il router**

`server/integrazioni/router.ts`:

```ts
// Il router unico del collegamento (WS5, spec §3.3).
//
// Ogni procedura applica la guardia DELL'ADATTATORE, non una guardia unica:
// oggi FiC, backup e mail sono `adminProcedure`, i calendari
// `protectedProcedure`. Appiattire la differenza sarebbe allargare o
// restringere permessi di nascosto.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import type { Adattatore, Chiave, Ctx } from "./contratto";
import { REGISTRO, adattatoreDi } from "./registro";

const chiaveSchema = z.enum([
  "fic",
  "email",
  "whatsapp",
  "calendario",
  "backup",
  "agente",
]);

/**
 * Risolve l'adattatore e applica la sua guardia.
 *
 * Chiave sconosciuta e permesso negato danno lo STESSO `NOT_FOUND`: un
 * `FORBIDDEN` distinguerebbe «esiste ma non puoi» da «non esiste», ed è
 * un'informazione che non serve a chi ha diritto e serve a chi enumera.
 */
export function risolvi(ctx: Ctx, chiave: Chiave): Adattatore {
  const a = adattatoreDi(chiave);
  const direzione = ctx.user?.role === "admin";
  if (!a || (a.permesso === "direzione" && !direzione)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Integrazione non trovata." });
  }
  return a;
}

export const integrazioniRouter = router({
  /** Sola lettura: nessuna chiamata esterna, regge il caricamento pagina. */
  elenco: protectedProcedure.query(async ({ ctx }) => {
    const visibili = REGISTRO.filter(
      a => a.permesso !== "direzione" || ctx.user?.role === "admin"
    );
    return Promise.all(visibili.map(a => a.stato(ctx)));
  }),

  verifica: protectedProcedure
    .input(z.object({ chiave: chiaveSchema }))
    .mutation(({ ctx, input }) => risolvi(ctx, input.chiave).verifica(ctx)),

  avvia: protectedProcedure
    .input(z.object({ chiave: chiaveSchema, opzioni: z.unknown().optional() }))
    .mutation(({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      if (!a.avvia) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Questa integrazione non si collega.",
        });
      }
      return a.avvia(ctx, input.opzioni);
    }),

  completa: protectedProcedure
    .input(z.object({ chiave: chiaveSchema, esito: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      if (!a.completa) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Questa integrazione non si completa.",
        });
      }
      await a.completa(ctx, input.esito);
      return { ok: true as const };
    }),

  scollega: protectedProcedure
    .input(z.object({ chiave: chiaveSchema }))
    .mutation(async ({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      if (!a.scollega) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Questa integrazione non si scollega.",
        });
      }
      await a.scollega(ctx);
      return { ok: true as const };
    }),
});
```

- [ ] **Step 7: Registrare il router**

In `server/routers.ts`, accanto agli altri import:

```ts
import { integrazioniRouter } from "./integrazioni/router";
```

e dentro `appRouter`, accanto a `platform: platformRouter`:

```ts
  integrazioni: integrazioniRouter,
```

- [ ] **Step 8: Eseguire i test**

Run: `pnpm test server/integrazioni/registro.test.ts`
Expected: PASS (5 test).

- [ ] **Step 9: Controllo dei tipi**

Run: `pnpm check`
Expected: nessun errore.

- [ ] **Step 10: Commit**

```bash
git add server/integrazioni server/routers.ts
git commit -m "feat(integrazioni): il contratto unico del collegamento e il primo adattatore"
```

---

### Task 2: Adattatore `backup`

Avvolge il backup di WS3 senza toccarlo. Dopo WS3 il backup è **per azienda**, non «unico per l'installazione»: `ambito: "azienda"` registra il fatto, non lo cambia.

**Files:**
- Create: `server/integrazioni/adattatori/backup.ts`
- Modify: `server/integrazioni/registro.ts`
- Test: `server/integrazioni/adattatori/backup.test.ts`

**Interfaces:**
- Consumes: `backupStatus()`, `checkBackupRoot()`, `oauthClientFromEnv()`, `issueOAuthState(utenteId)`, `buildAuthUrl(redirectUri, state)`, `disconnectOAuth()` da `server/_core/driveBackup` (nessuna modifica a quel file).
- Produces: `backup: Adattatore` esportato da `adattatori/backup.ts`.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/integrazioni/adattatori/backup.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Ctx } from "../contratto";
import * as drive from "../../_core/driveBackup";
import { backup } from "./backup";

const ctx = { user: { id: 1, role: "admin" }, sedeId: 1, tenantId: 1 } as unknown as Ctx;

beforeEach(() => {
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://app.wyndoor.com/api/oauth/gdrive/callback";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
});

describe("adattatore backup", () => {
  it("Drive collegato: lo stato nomina l'account, non dice solo «ok»", async () => {
    vi.spyOn(drive, "backupStatus").mockReturnValue({
      driveConfigurato: true,
      mode: "oauth",
      oauthEmail: "titolare@example.it",
    } as any);

    const s = await backup.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.soggetto).toBe("titolare@example.it");
    expect(s.problema).toBeNull();
  });

  it("Drive non collegato: nessun problema, è semplicemente da collegare", async () => {
    vi.spyOn(drive, "backupStatus").mockReturnValue({
      driveConfigurato: false,
      mode: null,
      oauthEmail: null,
    } as any);

    const s = await backup.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema).toBeNull();
  });

  it("la cartella non è più raggiungibile: problema con rimedio «ricollega»", async () => {
    vi.spyOn(drive, "checkBackupRoot").mockResolvedValue({
      ok: false,
      errore: "File not found",
    } as any);

    const p = await backup.verifica(ctx);
    expect(p?.azione).toBe("ricollega");
    expect(p?.rimedio).not.toBe("");
  });

  it("senza callback canonico non offre il collegamento", async () => {
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    vi.spyOn(drive, "oauthClientFromEnv").mockReturnValue({
      clientId: "x",
      clientSecret: "y",
    });

    await expect(backup.avvia!(ctx)).rejects.toThrow(/callback/i);
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm test server/integrazioni/adattatori/backup.test.ts`
Expected: FAIL — `Cannot find module './backup'`.

- [ ] **Step 3: Scrivere il guardiano del callback canonico**

`server/integrazioni/callback.ts`:

```ts
// Il callback OAuth appartiene alla PIATTAFORMA, non all'host da cui il
// cliente naviga (spec §6).
//
// `fattureInCloud.ts:1238-1240` lo ricava da `req.get("host")` quando la
// variabile manca. Con un'installazione e un host solo funziona; il giorno
// in cui un'azienda arriva da un host diverso il redirect cambia, il
// provider lo rifiuta perché non è pre-registrato, e il messaggio che il
// cliente legge è del provider, non nostro.
//
// Qui il ripiego non esiste: senza variabile non si offre il collegamento.

export function callbackCanonico(nome: string): string {
  const url = process.env[nome]?.trim();
  if (!url) {
    throw new Error(
      `Callback di piattaforma assente: imposta ${nome} sul server prima di collegare.`
    );
  }
  return url;
}
```

- [ ] **Step 4: Scrivere l'adattatore**

`server/integrazioni/adattatori/backup.ts`:

```ts
// Avvolge il backup Drive di WS3: `driveBackup.ts` non si tocca.
//
// Dopo WS3 il backup è per AZIENDA, non «unico per l'installazione» come
// dice ancora l'intestazione della pagina Impostazioni. `ambito: "azienda"`
// registra il fatto di WS3, non lo cambia.

import {
  backupStatus,
  checkBackupRoot,
  disconnectOAuth,
  issueOAuthState,
  buildAuthUrl,
  oauthClientFromEnv,
} from "../../_core/driveBackup";
import { callbackCanonico } from "../callback";
import type { Adattatore, Avvio, Problema, Stato } from "../contratto";

export const backup: Adattatore = {
  chiave: "backup",
  ambito: "azienda",
  permesso: "direzione",

  async stato(): Promise<Stato> {
    const s = backupStatus();
    return {
      chiave: "backup",
      ambito: "azienda",
      collegato: s.driveConfigurato,
      soggetto: s.oauthEmail ?? s.serviceAccountEmail ?? null,
      verificatoIl: null,
      problema: null,
    };
  },

  async verifica(): Promise<Problema | null> {
    const esito = await checkBackupRoot();
    if (esito.ok) return null;
    return {
      causa: "La cartella di backup su Google Drive non è più raggiungibile.",
      rimedio:
        "Ricollega il tuo account Google: il permesso può essere stato revocato o la cartella spostata.",
      azione: "ricollega",
    };
  },

  async avvia(ctx): Promise<Avvio> {
    const redirectUri = callbackCanonico("GOOGLE_OAUTH_REDIRECT_URI");
    if (!oauthClientFromEnv()) {
      throw new Error("Client OAuth Google non configurato sulla piattaforma.");
    }
    const state = await issueOAuthState(Number(ctx.user?.id ?? 0));
    const url = buildAuthUrl(redirectUri, state);
    if (!url) throw new Error("URL di autorizzazione Google non costruibile.");
    return { tipo: "url", url };
  },

  async scollega(): Promise<void> {
    disconnectOAuth();
  },
};
```

- [ ] **Step 5: Registrare l'adattatore**

In `server/integrazioni/registro.ts`:

```ts
import { backup } from "./adattatori/backup";

export const REGISTRO: Adattatore[] = [backup, agente];
```

- [ ] **Step 6: Eseguire i test**

Run: `pnpm test server/integrazioni/`
Expected: PASS — i 4 nuovi e i 5 del Task 1.

- [ ] **Step 7: Commit**

```bash
git add server/integrazioni
git commit -m "feat(integrazioni): adattatore backup e il guardiano del callback canonico"
```

---

### Task 3: Adattatore `email`

Il meccanismo IMAP resta identico (decisione 3). E non si riscrive niente di
quello che c'è: `imap.ts` espone già `testaCasella`, che verifica credenziali
e raggiungibilità senza importare nulla, **e traduce da sé** l'errore IMAP in
una frase che dice all'operatore cosa fare. L'adattatore la usa e le aggiunge
solo il rimedio e l'azione.

**Files:**
- Create: `server/integrazioni/adattatori/email.ts`
- Modify: `server/integrazioni/registro.ts`
- Test: `server/integrazioni/adattatori/email.test.ts`

**Interfaces:**
- Consumes: `caselle` e il tipo `Casella` da `server/comunicazioni/caselle`; `testaCasella(casella): Promise<{ok: true; messaggi: number} | {ok: false; errore: string}>` da `server/comunicazioni/imap`. Nessuna modifica a quei file.
- Produces: `email: Adattatore`, e `azionePerGuasto(errore: string): "ricollega" | "riprova"` esportata per il test.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/integrazioni/adattatori/email.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Ctx } from "../contratto";
import { caselle } from "../../comunicazioni/caselle";
import * as imap from "../../comunicazioni/imap";
import { email, azionePerGuasto } from "./email";

const ctx = { user: { id: 1, role: "admin" }, sedeId: 1, tenantId: 1 } as unknown as Ctx;

function seminaCasella(sedeId: number, nome: string) {
  caselle.push({
    id: caselle.length + 1,
    sedeId,
    nome,
    indirizzo: `${nome.toLowerCase()}@example.it`,
    host: "mail.example.it",
    porta: 993,
    tls: true,
    passwordCifrata: "v1.finta",
    cartella: "INBOX",
    attiva: true,
    ultimoUid: null,
    uidValidity: null,
    ultimaSync: null,
    ultimoErrore: null,
    messaggiImportati: 0,
  } as any);
}

afterEach(() => {
  caselle.length = 0;
  vi.restoreAllMocks();
});

describe("adattatore email", () => {
  it("nessuna casella: da collegare, senza problema", async () => {
    const s = await email.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema).toBeNull();
  });

  it("lo stato nomina la casella della sede e ignora quelle delle altre", async () => {
    seminaCasella(1, "Ordini");
    seminaCasella(2, "Altra");

    const s = await email.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.soggetto).toBe("ordini@example.it");
  });

  it("con più caselle attive lo stato le conta invece di nominarne una a caso", async () => {
    seminaCasella(1, "Ordini");
    seminaCasella(1, "Amministrazione");

    expect((await email.stato(ctx)).soggetto).toBe("2 caselle");
  });

  it("il guasto arriva già tradotto da imap.ts: l'adattatore non lo riscrive", async () => {
    seminaCasella(1, "Ordini");
    vi.spyOn(imap, "testaCasella").mockResolvedValue({
      ok: false,
      errore: "Credenziali rifiutate dal server: controlla indirizzo e password della casella.",
    });

    const p = await email.verifica(ctx);
    expect(p?.causa).toBe(
      "Credenziali rifiutate dal server: controlla indirizzo e password della casella."
    );
    expect(p?.azione).toBe("ricollega");
    expect(p?.rimedio).toMatch(/ordini@example\.it/);
  });

  it("un guasto passeggero si riprova, non si ricollega", () => {
    expect(azionePerGuasto("Timeout di connessione: host o porta probabilmente errati")).toBe("riprova");
    expect(azionePerGuasto("Credenziali rifiutate dal server")).toBe("ricollega");
  });

  it("tutto a posto: nessun problema", async () => {
    seminaCasella(1, "Ordini");
    vi.spyOn(imap, "testaCasella").mockResolvedValue({ ok: true, messaggi: 12 });

    expect(await email.verifica(ctx)).toBeNull();
  });

  it("il collegamento è un modulo, non un giro OAuth", async () => {
    await expect(email.avvia!(ctx)).resolves.toEqual({ tipo: "modulo" });
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm test server/integrazioni/adattatori/email.test.ts`
Expected: FAIL — `Cannot find module './email'`.

- [ ] **Step 3: Scrivere l'adattatore**

`server/integrazioni/adattatori/email.ts`:

```ts
// L'email resta IMAP com'è (decisione 3): host, porta, utente, password.
// Su Aruba, Register e le PEC OAuth non esiste, e nessun account
// sviluppatore — nostro o di chiunque — può sostituire quelle quattro cose.
//
// `imap.ts` sa già fare la prova viva (`testaCasella`) e sa già tradurre
// l'errore in una frase utile (`messaggioErrore`, che `testaCasella`
// restituisce in `errore`). Qui non si riscrive nulla di tutto ciò: si
// aggiunge il rimedio, che dipende dalla casella, e l'azione.

import { caselle, type Casella } from "../../comunicazioni/caselle";
import { testaCasella } from "../../comunicazioni/imap";
import type { Adattatore, Avvio, Problema, Stato } from "../contratto";

function dellaSede(sedeId: number | null): Casella[] {
  return caselle.filter(c => c.sedeId === (sedeId ?? 1));
}

/**
 * Credenziali o host sbagliati si correggono; un timeout o una connessione
 * rifiutata spesso passano da soli. La frase arriva già tradotta da
 * `imap.ts`: qui si decide solo che bottone mostrare.
 */
export function azionePerGuasto(errore: string): "ricollega" | "riprova" {
  return /timeout|limitando|rifiutata: porta/i.test(errore) ? "riprova" : "ricollega";
}

export const email: Adattatore = {
  chiave: "email",
  ambito: "sede",
  permesso: "direzione",

  async stato(ctx): Promise<Stato> {
    const attive = dellaSede(ctx.sedeId).filter(c => c.attiva);
    return {
      chiave: "email",
      ambito: "sede",
      collegato: attive.length > 0,
      soggetto:
        attive.length === 0
          ? null
          : attive.length === 1
            ? attive[0].indirizzo
            : `${attive.length} caselle`,
      verificatoIl: attive.map(c => c.ultimaSync).find(Boolean) ?? null,
      problema: null,
    };
  },

  async verifica(ctx): Promise<Problema | null> {
    // La prima casella rotta basta: il rimedio la nomina, e chi la sistema
    // rilancia la prova.
    for (const c of dellaSede(ctx.sedeId).filter(x => x.attiva)) {
      const esito = await testaCasella(c);
      if (!esito.ok) {
        return {
          causa: esito.errore,
          rimedio: `Correggi i dati della casella ${c.indirizzo} qui sotto e riprova.`,
          azione: azionePerGuasto(esito.errore),
        };
      }
    }
    return null;
  },

  async avvia(): Promise<Avvio> {
    // Il modulo host/porta/utente/password vive nel client: non c'è nessun
    // giro esterno da avviare.
    return { tipo: "modulo" };
  },
};
```

- [ ] **Step 4: Registrare l'adattatore**

In `registro.ts`: `import { email } from "./adattatori/email";` e `REGISTRO = [email, backup, agente]`.

- [ ] **Step 5: Eseguire i test**

Run: `pnpm test server/integrazioni/`
Expected: PASS — i 7 nuovi e quelli dei Task 1 e 2.

- [ ] **Step 6: Commit**

```bash
git add server/integrazioni
git commit -m "feat(integrazioni): adattatore email, sul test di connessione che imap.ts ha gia"
```

---

### Task 4: Adattatore `fic` e i suoi due spigoli

Il collegamento è già un click. I due spigoli emergono solo guardandolo come «seconda azienda che si attiva da sola»: l'azienda non scelta e il callback dall'header `Host`.

**Files:**
- Create: `server/integrazioni/adattatori/fic.ts`
- Modify: `server/integrazioni/registro.ts`
- Test: `server/integrazioni/adattatori/fic.test.ts`

**Interfaces:**
- Consumes: `getCfg(sedeId)`, `accessTokenFic(cfg)`, `ficGet(path, token)`, `issueFicOAuthState(sedeId, redirectUri, scrittura, utenteId)`, `buildFicAuthUrl(redirectUri, state, scope)`, `ficOAuthClientFromEnv()`, `FIC_SCOPES_LETTURA`, `FIC_SCOPES_SCRITTURA` da `server/routers/fattureInCloud` (nessuna modifica a quel file); `callbackCanonico` dal Task 2.
- Produces: `fic: Adattatore`. Accetta in `avvia` l'opzione `{ scrittura?: boolean }`.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/integrazioni/adattatori/fic.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Ctx } from "../contratto";
import * as ficMod from "../../routers/fattureInCloud";
import { fic } from "./fic";

const ctx = { user: { id: 7, role: "admin" }, sedeId: 1, tenantId: 1 } as unknown as Ctx;

const cfgBase = {
  id: 1,
  sedeId: 1,
  accessTokenCifrato: "v1.finto",
  refreshTokenCifrato: null,
  accessTokenExpiresAt: null,
  oauthConnectedAt: new Date(),
  authMode: "oauth" as const,
  companyId: null,
  enabled: true,
  lastSyncAt: null,
  lastResult: null,
  lastStats: null,
  economicScopesReady: false,
  scopeScrittura: false,
};

beforeEach(() => {
  process.env.FIC_OAUTH_REDIRECT_URI = "https://app.wyndoor.com/api/oauth/fic/callback";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FIC_OAUTH_REDIRECT_URI;
});

describe("adattatore fic", () => {
  it("token valido ma nessuna azienda scelta: collegato, con azione «scegli»", async () => {
    vi.spyOn(ficMod, "getCfg").mockReturnValue({ ...cfgBase, companyId: null } as any);

    const s = await fic.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.problema?.azione).toBe("scegli");
    expect(s.problema?.causa).toMatch(/azienda/i);
  });

  it("azienda scelta: nessun problema", async () => {
    vi.spyOn(ficMod, "getCfg").mockReturnValue({ ...cfgBase, companyId: 42 } as any);

    const s = await fic.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.problema).toBeNull();
  });

  it("non collegato: da collegare, senza problema", async () => {
    vi.spyOn(ficMod, "getCfg").mockReturnValue({
      ...cfgBase,
      accessTokenCifrato: null,
      oauthConnectedAt: null,
    } as any);

    const s = await fic.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema).toBeNull();
  });

  it("avvia chiede la sola lettura: la scrittura si chiede al primo bisogno", async () => {
    vi.spyOn(ficMod, "ficOAuthClientFromEnv").mockReturnValue({ clientId: "a", clientSecret: "b" });
    vi.spyOn(ficMod, "issueFicOAuthState").mockResolvedValue("stato-1");
    const costruisci = vi
      .spyOn(ficMod, "buildFicAuthUrl")
      .mockReturnValue("https://api-v2.fattureincloud.it/oauth/authorize?x=1");

    await fic.avvia!(ctx);
    expect(costruisci).toHaveBeenCalledWith(
      "https://app.wyndoor.com/api/oauth/fic/callback",
      "stato-1",
      ficMod.FIC_SCOPES_LETTURA
    );
  });

  it("avvia({ scrittura: true }) chiede gli scope di scrittura", async () => {
    vi.spyOn(ficMod, "ficOAuthClientFromEnv").mockReturnValue({ clientId: "a", clientSecret: "b" });
    vi.spyOn(ficMod, "issueFicOAuthState").mockResolvedValue("stato-2");
    const costruisci = vi
      .spyOn(ficMod, "buildFicAuthUrl")
      .mockReturnValue("https://api-v2.fattureincloud.it/oauth/authorize?x=2");

    await fic.avvia!(ctx, { scrittura: true });
    expect(costruisci).toHaveBeenCalledWith(
      expect.any(String),
      "stato-2",
      ficMod.FIC_SCOPES_SCRITTURA
    );
  });

  it("senza callback canonico non si avvia nessun giro OAuth", async () => {
    delete process.env.FIC_OAUTH_REDIRECT_URI;
    const emetti = vi.spyOn(ficMod, "issueFicOAuthState");

    await expect(fic.avvia!(ctx)).rejects.toThrow(/FIC_OAUTH_REDIRECT_URI/);
    expect(emetti).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm test server/integrazioni/adattatori/fic.test.ts`
Expected: FAIL — `Cannot find module './fic'`.

- [ ] **Step 3: Scrivere l'adattatore**

`server/integrazioni/adattatori/fic.ts`:

```ts
// Avvolge Fatture in Cloud: `fattureInCloud.ts` non si tocca (WS3 l'ha
// riscritto per 66 righe).
//
// Il cliente non apre MAI l'area sviluppatori di FiC: `FIC_OAUTH_CLIENT_ID`
// e `FIC_OAUTH_CLIENT_SECRET` sono della piattaforma. La sua app chiede, il
// suo account concede.
//
// Due spigoli che si vedono solo dalla seconda azienda in poi:
//
// 1. L'auto-selezione dell'azienda scatta solo con UNA azienda sola
//    (`fattureInCloud.ts:358-365`). Con due o più — commercialisti, gruppi —
//    nessuno sceglie e `configured` resta falso: collegamento riuscito,
//    integrazione muta. Qui diventa un problema con l'elenco a fianco.
// 2. Il redirect URI nasce dall'header `Host`. Vedi `../callback.ts`.

import {
  FIC_SCOPES_LETTURA,
  FIC_SCOPES_SCRITTURA,
  accessTokenFic,
  buildFicAuthUrl,
  ficGet,
  ficOAuthClientFromEnv,
  getCfg,
  issueFicOAuthState,
} from "../../routers/fattureInCloud";
import { callbackCanonico } from "../callback";
import type { Adattatore, Avvio, Problema, Stato } from "../contratto";

export const fic: Adattatore = {
  chiave: "fic",
  ambito: "sede",
  permesso: "direzione",

  async stato(ctx): Promise<Stato> {
    const cfg = getCfg(ctx.sedeId);
    const collegato = !!cfg.accessTokenCifrato;
    const problema: Problema | null =
      collegato && !cfg.companyId
        ? {
            causa: "Il tuo account Fatture in Cloud non ha ancora un'azienda collegata a questa sede.",
            rimedio: "Scegli quale azienda usare: l'elenco è qui sotto.",
            azione: "scegli",
          }
        : null;

    return {
      chiave: "fic",
      ambito: "sede",
      collegato,
      soggetto: cfg.companyId ? `Azienda ${cfg.companyId}` : null,
      verificatoIl: cfg.lastSyncAt,
      problema,
    };
  },

  async verifica(ctx): Promise<Problema | null> {
    const cfg = getCfg(ctx.sedeId);
    if (!cfg.accessTokenCifrato) return null;
    try {
      const token = await accessTokenFic(cfg);
      if (!token) throw new Error("nessun token");
      await ficGet("/user/companies", token);
      return null;
    } catch {
      return {
        causa: "Fatture in Cloud non accetta più il collegamento di questa sede.",
        rimedio: "Ricollega il tuo account: l'autorizzazione può essere stata revocata.",
        azione: "ricollega",
      };
    }
  },

  async avvia(ctx, opz): Promise<Avvio> {
    // Prima il callback: se manca, non si emette nemmeno lo `state`.
    const redirectUri = callbackCanonico("FIC_OAUTH_REDIRECT_URI");
    if (!ficOAuthClientFromEnv()) {
      throw new Error("Client OAuth di Fatture in Cloud non configurato sulla piattaforma.");
    }
    // Sola lettura all'attivazione; la scrittura si chiede al primo bisogno,
    // nel momento in cui il motivo è ovvio (decisione 6).
    const scrittura = (opz as { scrittura?: boolean } | undefined)?.scrittura === true;
    const state = await issueFicOAuthState(
      ctx.sedeId ?? 1,
      redirectUri,
      scrittura,
      Number(ctx.user?.id ?? 0)
    );
    const url = buildFicAuthUrl(
      redirectUri,
      state,
      scrittura ? FIC_SCOPES_SCRITTURA : FIC_SCOPES_LETTURA
    );
    if (!url) throw new Error("URL di autorizzazione di Fatture in Cloud non costruibile.");
    return { tipo: "url", url };
  },
};
```

- [ ] **Step 4: Registrare l'adattatore**

In `registro.ts`: `REGISTRO = [fic, email, backup, agente]`.

- [ ] **Step 5: Eseguire i test**

Run: `pnpm test server/integrazioni/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/integrazioni
git commit -m "feat(integrazioni): adattatore Fatture in Cloud, con l'azienda non scelta che si dichiara"
```

---

### Task 5: Guardie, confine di sede e guardia strutturale

La cornice non deve allargare né restringere permessi. Questo task lo prova, e lascia dietro una guardia che impedisce a un adattatore futuro di sbagliare.

**Files:**
- Test: `server/integrazioni/guardie.test.ts`

**Interfaces:**
- Consumes: `REGISTRO`, `risolvi` da `server/integrazioni/router`.
- Produces: nessun modulo nuovo — solo prove.

- [ ] **Step 1: Scrivere i test**

`server/integrazioni/guardie.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { caselle } from "../comunicazioni/caselle";
import { configWhatsApp } from "../comunicazioni/whatsapp";
import { REGISTRO } from "./registro";
import { risolvi } from "./router";

function ctx(role: "admin" | "user", sedeId = 1): TrpcContext {
  return {
    user: { id: 1, role, ruolo: role === "admin" ? "direzione" : "operatore" } as any,
    req: { protocol: "https", headers: {}, get: () => "app.wyndoor.com" } as any,
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [1],
    tenantId: 1,
    tenant: null,
  };
}

/**
 * Semina, nella sede indicata, un dato riconoscibile per ogni adattatore con
 * `ambito: "sede"`. Il marcatore `sede-<n>` deve restare invisibile alle altre.
 */
function seminaDatiDellaSede(sedeId: number) {
  caselle.push({
    id: 900 + sedeId,
    sedeId,
    nome: `Casella sede-${sedeId}`,
    indirizzo: `sede-${sedeId}@example.it`,
    host: "mail.example.it",
    porta: 993,
    tls: true,
    passwordCifrata: "v1.finta",
    cartella: "INBOX",
    attiva: true,
    ultimoUid: null,
    uidValidity: null,
    ultimaSync: null,
    ultimoErrore: null,
    messaggiImportati: 0,
  } as any);
  configWhatsApp.push({
    id: 900 + sedeId,
    sedeId,
    numero: `+39 000 sede-${sedeId}`,
    phoneNumberId: `pn-${sedeId}`,
    wabaId: `waba-${sedeId}`,
    attiva: true,
    tokenCifrato: "v1.finto",
    appSecretCifrato: "",
    verifyToken: `vt-${sedeId}`,
  } as any);
}

afterEach(() => {
  caselle.length = 0;
  configWhatsApp.length = 0;
});

describe("guardie della cornice", () => {
  it("un operatore non vede nell'elenco le integrazioni della direzione", async () => {
    const stati = await appRouter.createCaller(ctx("user")).integrazioni.elenco();
    const chiavi = stati.map(s => s.chiave);
    for (const a of REGISTRO.filter(x => x.permesso === "direzione")) {
      expect(chiavi).not.toContain(a.chiave);
    }
  });

  it("un operatore che chiama per chiave un'integrazione della direzione riceve NOT_FOUND", () => {
    const direzionale = REGISTRO.find(a => a.permesso === "direzione")!;
    try {
      risolvi(ctx("user"), direzionale.chiave);
      throw new Error("doveva lanciare");
    } catch (e) {
      expect((e as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("una chiave sconosciuta dà lo STESSO NOT_FOUND: non si distingue «esiste ma non puoi»", () => {
    try {
      risolvi(ctx("user"), "inesistente" as any);
      throw new Error("doveva lanciare");
    } catch (e) {
      expect((e as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("ogni adattatore dichiara ambito e permesso", () => {
    for (const a of REGISTRO) {
      expect(["sede", "azienda"]).toContain(a.ambito);
      expect(["direzione", "utente"]).toContain(a.permesso);
    }
  });

  it("il soggetto di una sede non compare nell'elenco di un'altra", async () => {
    // CLAUDE.md: `sedeId` su ogni entità, e un record di un'altra sede non
    // deve produrre nessuna informazione utile a enumerarlo. Qui il rischio
    // è più sottile di un NOT_FOUND mancato: un adattatore che dimentica il
    // filtro non dà errore — mostra il numero, la casella o l'azienda della
    // sede sbagliata dentro la pagina giusta.
    seminaDatiDellaSede(2);

    const dellaUno = await appRouter.createCaller(ctx("admin", 1)).integrazioni.elenco();
    for (const s of dellaUno) {
      if (s.soggetto) expect(s.soggetto).not.toMatch(/sede-2/);
    }
  });

  it("guardia strutturale: nessun adattatore costruisce da sé un redirect dall'header Host", () => {
    const dir = join(__dirname, "adattatori");
    for (const f of readdirSync(dir).filter(n => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const testo = readFileSync(join(dir, f), "utf8");
      expect(testo, `${f} ricava il callback dalla richiesta invece che dalla piattaforma`)
        .not.toMatch(/req\.get\(\s*["']host["']\s*\)/);
    }
  });
});
```

- [ ] **Step 2: Eseguirli**

Run: `pnpm test server/integrazioni/guardie.test.ts`
Expected: PASS. Se un test fallisce, l'errore è nell'adattatore, non nel test: correggi l'adattatore.

Il test del confine di sede scorre `REGISTRO`: cresce da sé quando il Task 12 registra `whatsapp`, e va rieseguito lì.

- [ ] **Step 3: Commit**

```bash
git add server/integrazioni/guardie.test.ts
git commit -m "test(integrazioni): le guardie della cornice e il divieto del redirect dall'host"
```

---

### Task 6: Cache di `verifica()`

`verifica()` chiama il fornitore per davvero. Un doppio click non deve diventare due chiamate.

**Files:**
- Create: `server/integrazioni/cache.ts`
- Modify: `server/integrazioni/router.ts`
- Test: `server/integrazioni/cache.test.ts`

**Interfaces:**
- Produces: `verificaConCache(chiave, sedeId, fn): Promise<Problema | null>` e `__svuotaCachePerTest()`.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/integrazioni/cache.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { verificaConCache, __svuotaCachePerTest } from "./cache";

beforeEach(() => {
  __svuotaCachePerTest();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("cache di verifica", () => {
  it("due chiamate ravvicinate interrogano il fornitore una volta sola", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache("fic", 1, sonda);
    await verificaConCache("fic", 1, sonda);
    expect(sonda).toHaveBeenCalledTimes(1);
  });

  it("sedi diverse non si scambiano l'esito", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache("fic", 1, sonda);
    await verificaConCache("fic", 2, sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  it("dopo 60 secondi si torna a chiedere", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache("fic", 1, sonda);
    vi.advanceTimersByTime(61_000);
    await verificaConCache("fic", 1, sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  it("un errore non si mette in cache: il guasto va riprovato subito", async () => {
    const sonda = vi.fn().mockRejectedValue(new Error("rete giù"));
    await expect(verificaConCache("fic", 1, sonda)).rejects.toThrow();
    await expect(verificaConCache("fic", 1, sonda)).rejects.toThrow();
    expect(sonda).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm test server/integrazioni/cache.test.ts`
Expected: FAIL — `Cannot find module './cache'`.

- [ ] **Step 3: Scrivere la cache**

`server/integrazioni/cache.ts`:

```ts
// `verifica()` è una prova viva: chiama il fornitore. Un doppio click non
// deve diventare due chiamate, e la pagina non deve poter trasformare
// un'attesa in una raffica.
//
// In memoria e per processo: è un ammortizzatore, non una fonte di verità.
// Un errore non entra in cache — un guasto va riprovato subito, non fra
// un minuto.

import type { Chiave, Problema } from "./contratto";

const TTL_MS = 60_000;

const voci = new Map<string, { al: number; esito: Problema | null }>();

export async function verificaConCache(
  chiave: Chiave,
  sedeId: number | null,
  sonda: () => Promise<Problema | null>
): Promise<Problema | null> {
  const k = `${chiave}:${sedeId ?? "azienda"}`;
  const v = voci.get(k);
  if (v && Date.now() - v.al < TTL_MS) return v.esito;
  const esito = await sonda();
  voci.set(k, { al: Date.now(), esito });
  return esito;
}

export function __svuotaCachePerTest(): void {
  voci.clear();
}
```

- [ ] **Step 4: Collegarla al router**

In `server/integrazioni/router.ts`, sostituisci il corpo di `verifica`:

```ts
  verifica: protectedProcedure
    .input(z.object({ chiave: chiaveSchema }))
    .mutation(({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      const sede = a.ambito === "sede" ? ctx.sedeId : null;
      return verificaConCache(input.chiave, sede, () => a.verifica(ctx));
    }),
```

e aggiungi l'import: `import { verificaConCache } from "./cache";`

- [ ] **Step 5: Eseguire i test**

Run: `pnpm test server/integrazioni/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/integrazioni
git commit -m "feat(integrazioni): la prova viva non si ripete a ogni click"
```

---

### Task 7: La scheda unica, lato client

Un componente solo disegna tutte le integrazioni. È qui che «cosa si è rotto e cosa devo fare» smette di essere sei dialetti.

**Files:**
- Create: `client/src/integrazioni/useIntegrazioni.ts`
- Create: `client/src/integrazioni/SchedaIntegrazione.tsx`

**Interfaces:**
- Consumes: `trpc.integrazioni.*` dal Task 1; `DataSurface` (props: `density`, `tone`, `title`, `description`, `toolbar`, `footer`, `children`) da `client/src/components/`.
- Produces: `useIntegrazioni()` → `{ stati, inCaricamento, verifica(chiave), avvia(chiave, opzioni) }`; `<SchedaIntegrazione stato={...} azioni={...} />`.

- [ ] **Step 1: Scrivere l'hook**

`client/src/integrazioni/useIntegrazioni.ts`:

```ts
import { trpc } from "@/lib/trpc";

/**
 * L'elenco costa poco: `stato()` lato server non chiama nessun fornitore.
 * La prova viva è una mutation, perché è un'azione della persona — e
 * perché non deve partire da sola a ogni montaggio della pagina.
 */
export function useIntegrazioni() {
  const elenco = trpc.integrazioni.elenco.useQuery(undefined, { staleTime: 30_000 });
  const verifica = trpc.integrazioni.verifica.useMutation();
  const avvia = trpc.integrazioni.avvia.useMutation();

  return {
    stati: elenco.data ?? [],
    inCaricamento: elenco.isLoading,
    ricarica: () => elenco.refetch(),
    verifica,
    avvia,
  };
}
```

- [ ] **Step 2: Scrivere la scheda**

`client/src/integrazioni/SchedaIntegrazione.tsx`:

```tsx
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { DataSurface } from "@/components/DataSurface";
import { Button } from "@/components/ui/button";

type Problema = {
  causa: string;
  rimedio: string;
  azione: "ricollega" | "riprova" | "scegli" | "assistenza" | null;
};

type Stato = {
  chiave: string;
  ambito: "sede" | "azienda";
  collegato: boolean;
  soggetto: string | null;
  verificatoIl: string | Date | null;
  problema: Problema | null;
};

const ETICHETTA_AZIONE: Record<string, string> = {
  ricollega: "Ricollega",
  riprova: "Riprova",
  scegli: "Scegli",
  assistenza: "Assistenza",
};

/**
 * La scheda unica. Tre domande, sempre le stesse tre:
 * a cosa sono collegata · come mi collego · cosa si è rotto e cosa devo fare.
 *
 * `children` ospita il pannello specifico dell'integrazione (il modulo IMAP,
 * l'elenco delle aziende FiC): la cornice è comune, il dentro no.
 */
export function SchedaIntegrazione({
  stato,
  titolo,
  descrizione,
  onCollega,
  onAzione,
  children,
}: {
  stato: Stato;
  titolo: string;
  descrizione: string;
  onCollega?: () => void;
  onAzione?: (azione: string) => void;
  children?: ReactNode;
}) {
  const problema = stato.problema;
  const Icona = problema ? AlertTriangle : stato.collegato ? CheckCircle2 : Circle;

  return (
    <DataSurface
      density="compact"
      tone={problema ? "focal" : "default"}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <Icona
            aria-hidden="true"
            className={
              problema
                ? "size-4 shrink-0 text-warning"
                : stato.collegato
                  ? "size-4 shrink-0 text-success"
                  : "size-4 shrink-0 text-text-3"
            }
          />
          <span className="truncate">{titolo}</span>
        </span>
      }
      description={descrizione}
      toolbar={
        !stato.collegato && onCollega ? (
          <Button size="sm" onClick={onCollega}>
            Collega
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm text-text-2">
        {stato.collegato ? (
          <>
            Collegato a{" "}
            <strong className="font-semibold text-text-1">
              {stato.soggetto ?? "—"}
            </strong>
          </>
        ) : (
          "Non ancora collegato."
        )}
      </p>

      {problema && (
        <div className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
          <p className="text-sm font-semibold text-text-1">{problema.causa}</p>
          <p className="mt-1 text-sm text-text-2">{problema.rimedio}</p>
          {problema.azione && onAzione && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => onAzione(problema.azione!)}
            >
              {ETICHETTA_AZIONE[problema.azione]}
            </Button>
          )}
        </div>
      )}

      {children}
    </DataSurface>
  );
}
```

- [ ] **Step 3: Verificare i token semantici e l'import di DataSurface**

Run: `grep -n "text-warning\|text-success\|radius-control" client/src/index.css`
Expected: i token esistono. Se un nome differisce, usa quello reale del file — **mai un hex locale**.
Run: `grep -rn "export function DataSurface\|export const DataSurface" client/src/components/`
Expected: conferma il percorso d'import usato sopra; correggilo se differisce.

- [ ] **Step 4: Controllo dei tipi**

Run: `pnpm check`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add client/src/integrazioni
git commit -m "feat(integrazioni): la scheda unica, con il rimedio accanto al guasto"
```

---

### Task 8: `Integrazioni.tsx` ricomposta

I quattro pannelli con adattatore passano alla scheda unica. WhatsApp e calendari restano com'erano finché non arriva il loro task: la pagina non deve rompersi a metà strada.

**Files:**
- Modify: `client/src/pages/Integrazioni.tsx`

**Interfaces:**
- Consumes: `useIntegrazioni`, `SchedaIntegrazione` dal Task 7.

- [ ] **Step 1: Sostituire i quattro pannelli**

Dentro `Integrazioni.tsx`, in cima al componente `Integrazioni()`:

```tsx
const { stati, verifica, avvia } = useIntegrazioni();
const statoDi = (chiave: string) => stati.find(s => s.chiave === chiave);
```

Poi, per ciascuna delle quattro chiavi (`fic`, `email`, `backup`, `agente`), sostituisci la card esistente con la scheda unica **conservando il pannello di dettaglio come `children`**. Esempio per FiC:

```tsx
{statoDi("fic") && (
  <SchedaIntegrazione
    stato={statoDi("fic")!}
    titolo="Fatture in Cloud"
    descrizione="Allinea documenti, pagamenti e anagrafica della sede."
    onCollega={async () => {
      const esito = await avvia.mutateAsync({ chiave: "fic" });
      if (esito.tipo === "url") window.location.href = esito.url;
    }}
    onAzione={a => {
      if (a === "ricollega") void avvia.mutateAsync({ chiave: "fic" });
    }}
  >
    <FattureInCloudCard />
  </SchedaIntegrazione>
)}
```

`ImportaClientiCard`, `ResetPattuitiCard`, `TariffeLimitiPanel`, `FatturazioneConfigPanel` e le due card dei calendari **restano dove sono, invariate**.

- [ ] **Step 2: Correggere l'intestazione della pagina**

L'intestazione dice ancora che il backup è «unico per l'installazione». Dopo WS3 non è vero. Sostituisci quel testo con:

```tsx
<span>
  Il backup su Google Drive è{" "}
  <strong className="font-semibold text-text-2">della tua azienda</strong>{" "}
  e copre i dati di tutte le sue sedi.
</span>
```

- [ ] **Step 3: Controllo dei tipi e build**

Run: `pnpm check && pnpm build`
Expected: nessun errore.

- [ ] **Step 4: Verifica nel browser**

Avvia l'anteprima e apri Impostazioni. Controlla, **leggendo la console** (uno screenshot non basta: un React #185 in sviluppo è solo un log, in produzione spegne la pagina):
- nessun errore né warning in console;
- le quattro schede mostrano il soggetto collegato, non solo «ok»;
- nessuno scroll orizzontale a **1440×900** e **390×844**.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Integrazioni.tsx
git commit -m "feat(integrazioni): la pagina Impostazioni parla una lingua sola"
```

---

### Task 9: Lo stato dell'attivazione, per azienda

**Files:**
- Create: `server/integrazioni/attivazione.ts`
- Modify: `server/integrazioni/router.ts`
- Test: `server/integrazioni/attivazione.test.ts`

**Interfaces:**
- Consumes: `persistedStore<T>(nome, onLoad?)` da `server/_core/persistence` (import, non modifica).
- Produces: `passiAttivazione(ctx)`, `segnaSaltata(chiave)`; procedure `integrazioni.attivazione` e `integrazioni.salta`.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/integrazioni/attivazione.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { passiAttivazione, segnaSaltata, righeAttivazione } from "./attivazione";

function ctx(): TrpcContext {
  return {
    user: { id: 1, role: "admin", ruolo: "direzione" } as any,
    req: { protocol: "https", headers: {}, get: () => "app.wyndoor.com" } as any,
    res: {} as TrpcContext["res"],
    sedeId: 1,
    sediIds: [1],
    tenantId: 1,
    tenant: null,
  };
}

beforeEach(() => {
  righeAttivazione.length = 0;
});

describe("percorso di attivazione", () => {
  it("nasce con tutti i passi da fare, nell'ordine del registro", async () => {
    const passi = await passiAttivazione(ctx());
    expect(passi[0].chiave).toBe("fic");
    expect(passi.every(p => p.esito === "da_fare" || p.esito === "collegata")).toBe(true);
  });

  it("«salta» è disponibile su ogni passo e non blocca il resto", async () => {
    await appRouter.createCaller(ctx()).integrazioni.salta({ chiave: "email" });
    const passi = await passiAttivazione(ctx());
    expect(passi.find(p => p.chiave === "email")?.esito).toBe("saltata");
    expect(passi.find(p => p.chiave === "fic")?.esito).not.toBe("saltata");
  });

  it("il percorso riparte da dove si era interrotto", async () => {
    segnaSaltata("email");
    const passi = await passiAttivazione(ctx());
    expect(passi.find(p => p.chiave === "email")?.esito).toBe("saltata");
  });

  it("un'integrazione collegata risulta collegata anche se nessuno l'ha segnata", async () => {
    // `passiAttivazione` legge lo stato reale degli adattatori: il percorso
    // non tiene una seconda verità accanto a quella del dominio.
    const passi = await passiAttivazione(ctx());
    const agente = passi.find(p => p.chiave === "agente");
    expect(agente?.esito).toBe("collegata");
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm test server/integrazioni/attivazione.test.ts`
Expected: FAIL — `Cannot find module './attivazione'`.

- [ ] **Step 3: Scriverlo**

`server/integrazioni/attivazione.ts`:

```ts
// Lo stato del percorso guidato, per azienda (spec §5).
//
// Vive in un `persistedStore` per tenant e NON in `server/tenants/**`, che è
// zona vietata al WS5: il confine con WS3 regge anche qui.
//
// Il percorso non tiene una seconda verità accanto al dominio: «collegata»
// lo decide sempre `stato()` dell'adattatore. Qui si registra solo ciò che
// il dominio non sa — che qualcuno ha scelto di saltare un passo.

import { persistedStore } from "../_core/persistence";
import type { Chiave, Ctx } from "./contratto";
import { REGISTRO } from "./registro";

type RigaAttivazione = {
  id: number;
  chiave: Chiave;
  saltataIl: Date | null;
};

const _store = persistedStore<RigaAttivazione>("onboarding_integrazioni", items => {
  for (const r of items) if (r.saltataIl === undefined) r.saltataIl = null;
});

export const righeAttivazione = _store.items;

export type Passo = {
  chiave: Chiave;
  esito: "da_fare" | "saltata" | "collegata";
  soggetto: string | null;
};

export function segnaSaltata(chiave: Chiave): void {
  const esistente = righeAttivazione.find(r => r.chiave === chiave);
  if (esistente) esistente.saltataIl = new Date();
  else
    righeAttivazione.push({
      id: _store.prossimoId(),
      chiave,
      saltataIl: new Date(),
    });
  _store.save();
}

export async function passiAttivazione(ctx: Ctx): Promise<Passo[]> {
  const visibili = REGISTRO.filter(
    a => a.permesso !== "direzione" || ctx.user?.role === "admin"
  );
  return Promise.all(
    visibili.map(async a => {
      const s = await a.stato(ctx);
      const saltata = righeAttivazione.find(r => r.chiave === a.chiave)?.saltataIl;
      return {
        chiave: a.chiave,
        esito: s.collegato ? "collegata" : saltata ? "saltata" : "da_fare",
        soggetto: s.soggetto,
      } as Passo;
    })
  );
}
```

- [ ] **Step 4: Aggiungere le procedure al router**

In `server/integrazioni/router.ts`:

```ts
import { passiAttivazione, segnaSaltata } from "./attivazione";
```

e dentro `integrazioniRouter`:

```ts
  attivazione: protectedProcedure.query(({ ctx }) => passiAttivazione(ctx)),

  salta: protectedProcedure
    .input(z.object({ chiave: chiaveSchema }))
    .mutation(({ ctx, input }) => {
      // `risolvi` applica la guardia: non si salta un passo che non si vede.
      risolvi(ctx, input.chiave);
      segnaSaltata(input.chiave);
      return { ok: true as const };
    }),
```

- [ ] **Step 5: Eseguire i test**

Run: `pnpm test server/integrazioni/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/integrazioni
git commit -m "feat(integrazioni): il percorso di attivazione ricomincia da dove si era fermato"
```

---

### Task 10: La modalità attivazione, lato client

**Files:**
- Create: `client/src/integrazioni/PercorsoAttivazione.tsx`
- Modify: `client/src/pages/Integrazioni.tsx`

**Interfaces:**
- Consumes: `trpc.integrazioni.attivazione`, `trpc.integrazioni.salta`, `SchedaIntegrazione`.

- [ ] **Step 1: Scrivere il percorso**

`client/src/integrazioni/PercorsoAttivazione.tsx`:

```tsx
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { DataSurface } from "@/components/DataSurface";

/**
 * Gli stessi componenti della pagina Impostazioni, in ordine.
 * Non è una seconda schermata: è la stessa, ordinata.
 *
 * «Salta» è disponibile su ogni passo, sempre. La spec madre §9 dice che il
 * CRM si usa prima di aver collegato tutto: chi si attiva di venerdì sera
 * deve poter entrare senza aver collegato niente.
 */
export function PercorsoAttivazione({ onFine }: { onFine: () => void }) {
  const passi = trpc.integrazioni.attivazione.useQuery();
  const salta = trpc.integrazioni.salta.useMutation({
    onSuccess: () => passi.refetch(),
  });

  const elenco = passi.data ?? [];
  const fatti = elenco.filter(p => p.esito !== "da_fare").length;

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4">
      <DataSurface
        density="compact"
        tone="sunken"
        title="Collega le tue integrazioni"
        description={`${fatti} di ${elenco.length}. Puoi saltarne quante vuoi e tornarci dopo: il CRM funziona lo stesso.`}
      >
        <ul className="grid min-w-0 gap-2">
          {elenco.map(p => (
            <li
              key={p.chiave}
              className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3"
            >
              <span className="min-w-0 truncate text-sm text-text-1">
                {p.chiave}
                {p.soggetto && (
                  <span className="ml-2 text-text-2">{p.soggetto}</span>
                )}
              </span>
              {p.esito === "da_fare" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => salta.mutate({ chiave: p.chiave })}
                >
                  Salta
                </Button>
              )}
            </li>
          ))}
        </ul>
      </DataSurface>

      <Button variant="outline" onClick={onFine}>
        Entra nel CRM
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Innestarlo nella pagina**

In `Integrazioni.tsx`, leggi la modalità dalla query string (`?attivazione=1`) e, quando è attiva, rendi `<PercorsoAttivazione onFine={() => setLocation("/")} />` al posto delle sezioni libere. Nessuna rotta nuova: è la stessa pagina in un altro modo.

- [ ] **Step 3: Verifica nel browser**

Apri `/integrazioni?attivazione=1`. Controlla, con la console aperta:
- «Salta» presente su ogni passo `da_fare`;
- il contatore si aggiorna dopo un salto;
- «Entra nel CRM» funziona con zero integrazioni collegate;
- nessuno scroll orizzontale a 1440×900 e 390×844; nessun errore console.

- [ ] **Step 4: Commit**

```bash
git add client/src/integrazioni client/src/pages/Integrazioni.tsx
git commit -m "feat(integrazioni): l'attivazione guidata, con «salta» su ogni passo"
```

---

### Task 11: WhatsApp — le credenziali passano alla piattaforma

L'unico ostacolo fra il cliente e un collegamento da un click. L'Embedded Signup con coexistence è già tutto scritto: `scambiaCode`, `sottoscriviApp`, `sincronizzaStorico`.

**Files:**
- Modify: `server/comunicazioni/whatsapp.ts` (solo `getAppWhatsApp` e `appPubblica`)
- Test: `server/comunicazioni/whatsapp.piattaforma.test.ts`

**Interfaces:**
- Produces: `getAppWhatsApp(sedeId)` continua a restituire un `AppWhatsApp`, ma i tre campi vuoti prendono il valore di piattaforma. Firma invariata: nessun chiamante cambia.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/comunicazioni/whatsapp.piattaforma.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getAppWhatsApp, appPubblica, tutteLeAppWhatsApp } from "./whatsapp";

beforeEach(() => {
  process.env.WHATSAPP_APP_ID = "app-di-piattaforma";
  process.env.WHATSAPP_CONFIG_ID = "config-di-piattaforma";
  process.env.WHATSAPP_APP_SECRET = "segreto-di-piattaforma";
});
afterEach(() => {
  delete process.env.WHATSAPP_APP_ID;
  delete process.env.WHATSAPP_CONFIG_ID;
  delete process.env.WHATSAPP_APP_SECRET;
});

describe("app WhatsApp di piattaforma", () => {
  it("una sede senza credenziali proprie è pronta: le prende dalla piattaforma", () => {
    const pub = appPubblica(1);
    expect(pub.appId).toBe("app-di-piattaforma");
    expect(pub.configId).toBe("config-di-piattaforma");
    expect(pub.appSecretConfigurato).toBe(true);
    expect(pub.pronta).toBe(true);
  });

  it("l'app secret non esce mai dalla vista pubblica", () => {
    expect(JSON.stringify(appPubblica(1))).not.toContain("segreto-di-piattaforma");
  });

  it("l'override per sede vince: è la via di fuga se l'app di piattaforma viene limitata", () => {
    const a = getAppWhatsApp(2);
    a.appId = "app-della-sede";
    expect(appPubblica(2).appId).toBe("app-della-sede");
    expect(appPubblica(2).configId).toBe("config-di-piattaforma");
  });

  it("senza variabili di piattaforma e senza override, non è pronta", () => {
    delete process.env.WHATSAPP_APP_ID;
    delete process.env.WHATSAPP_CONFIG_ID;
    delete process.env.WHATSAPP_APP_SECRET;
    expect(appPubblica(3).pronta).toBe(false);
  });

  it("il verify token resta per record: non arriva dall'ambiente", () => {
    expect(appPubblica(1).verifyToken).toBeTruthy();
    expect(tutteLeAppWhatsApp().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm test server/comunicazioni/whatsapp.piattaforma.test.ts`
Expected: FAIL — `appId` è `""`, non `"app-di-piattaforma"`.

- [ ] **Step 3: Aggiungere il ripiego di piattaforma**

In `server/comunicazioni/whatsapp.ts`, sotto `appVuota`, aggiungi:

```ts
/**
 * Le credenziali dell'app Meta sono della PIATTAFORMA, non del cliente
 * (WS5, spec §4.5).
 *
 * Il commento storico difendeva un'app per sede perché «obbligare due sedi a
 * condividere app id, config id e app secret significherebbe obbligarle a
 * condividere il portfolio». Nel modello Tech Provider non regge: l'app non
 * possiede il portfolio, lo ONBOARDA. Una sola app fa l'Embedded Signup di
 * quanti portfolio si vuole, e ciascuno resta del suo cliente.
 *
 * Il record per sede resta come OVERRIDE e vince: è la via di fuga il giorno
 * in cui l'app di piattaforma venisse limitata da Meta.
 */
function daPiattaforma(): { appId: string; configId: string; appSecret: string } {
  return {
    appId: process.env.WHATSAPP_APP_ID?.trim() ?? "",
    configId: process.env.WHATSAPP_CONFIG_ID?.trim() ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() ?? "",
  };
}

/** L'app effettiva della sede: override dove c'è, piattaforma dove manca. */
export function appEffettiva(sedeId: number | null): {
  appId: string;
  configId: string;
  appSecretCifrato: string;
  verifyToken: string;
} {
  const a = getAppWhatsApp(sedeId);
  const p = daPiattaforma();
  return {
    appId: a.appId || p.appId,
    configId: a.configId || p.configId,
    // Il segreto di piattaforma arriva dall'ambiente in chiaro e va cifrato
    // come tutti gli altri prima di attraversare il resto del codice.
    appSecretCifrato:
      a.appSecretCifrato || (p.appSecret ? encryptSecret(p.appSecret) : ""),
    verifyToken: a.verifyToken,
  };
}
```

- [ ] **Step 4: Farla usare da `appPubblica` e da `scambiaCode`**

`appPubblica` legge da `appEffettiva` invece che da `getAppWhatsApp`:

```ts
export function appPubblica(sedeId: number | null) {
  const a = appEffettiva(sedeId);
  return {
    appId: a.appId,
    configId: a.configId,
    appSecretConfigurato: !!a.appSecretCifrato,
    verifyToken: a.verifyToken,
    pronta: !!a.appId && !!a.configId && !!a.appSecretCifrato,
  };
}
```

In `scambiaCode`, sostituisci `const app = getAppWhatsApp(sedeId);` con `const app = appEffettiva(sedeId);`. Fai lo stesso in `appSecretPer`, dove oggi ricade su `getAppWhatsApp(c.sedeId).appSecretCifrato`.

**Non toccare `rotteAnonime.ts`.** Con un segreto solo il ciclo che prova il segreto di ogni azienda diventa inutile ma continua a funzionare, ed è un file riscritto da WS3: la pulizia è debito dichiarato (spec §14).

- [ ] **Step 5: Eseguire i test**

Run: `pnpm test server/comunicazioni/`
Expected: PASS, compresi i test WhatsApp preesistenti.

- [ ] **Step 6: Commit**

```bash
git add server/comunicazioni/whatsapp.ts server/comunicazioni/whatsapp.piattaforma.test.ts
git commit -m "feat(whatsapp): l'app Meta è della piattaforma, l'override per sede resta la via di fuga"
```

---

### Task 12: Adattatore `whatsapp` e la scheda senza gli id

**Files:**
- Create: `server/integrazioni/adattatori/whatsapp.ts`
- Modify: `server/integrazioni/registro.ts`
- Modify: `client/src/components/WhatsAppCard.tsx`
- Modify: `server/integrazioni/registro.test.ts`
- Test: `server/integrazioni/adattatori/whatsapp.test.ts`

**Interfaces:**
- Consumes: `appPubblica(sedeId)` e `configWhatsApp` da `server/comunicazioni/whatsapp`.
- Produces: `whatsapp: Adattatore`, con `avvia` che restituisce `{ tipo: "popup", configId }`.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/integrazioni/adattatori/whatsapp.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Ctx } from "../contratto";
import { configWhatsApp } from "../../comunicazioni/whatsapp";
import { whatsapp } from "./whatsapp";

const ctx = { user: { id: 1, role: "admin" }, sedeId: 1, tenantId: 1 } as unknown as Ctx;

beforeEach(() => {
  configWhatsApp.length = 0;
  process.env.WHATSAPP_APP_ID = "app";
  process.env.WHATSAPP_CONFIG_ID = "config";
  process.env.WHATSAPP_APP_SECRET = "segreto";
});
afterEach(() => {
  configWhatsApp.length = 0;
  delete process.env.WHATSAPP_APP_ID;
  delete process.env.WHATSAPP_CONFIG_ID;
  delete process.env.WHATSAPP_APP_SECRET;
});

describe("adattatore whatsapp", () => {
  it("nessun numero: da collegare, senza problema", async () => {
    const s = await whatsapp.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema).toBeNull();
  });

  it("lo stato nomina il numero, non dice «ok»", async () => {
    configWhatsApp.push({
      id: 1,
      sedeId: 1,
      numero: "+39 0187 872687",
      phoneNumberId: "123",
      wabaId: "456",
      attiva: true,
      tokenCifrato: "v1.finto",
      appSecretCifrato: "",
      verifyToken: "vt",
    } as any);

    const s = await whatsapp.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.soggetto).toBe("+39 0187 872687");
  });

  it("avvia restituisce il popup con il config id, non un url", async () => {
    await expect(whatsapp.avvia!(ctx)).resolves.toEqual({
      tipo: "popup",
      configId: "config",
    });
  });

  it("senza app di piattaforma pronta, avvia rifiuta invece di aprire un popup cieco", async () => {
    delete process.env.WHATSAPP_CONFIG_ID;
    await expect(whatsapp.avvia!(ctx)).rejects.toThrow(/piattaforma/i);
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm test server/integrazioni/adattatori/whatsapp.test.ts`
Expected: FAIL — `Cannot find module './whatsapp'`.

- [ ] **Step 3: Scrivere l'adattatore**

`server/integrazioni/adattatori/whatsapp.ts`:

```ts
// Avvolge l'Embedded Signup che esiste già: `scambiaCode`,
// `sottoscriviApp`, `numeriDellaWaba`, `sincronizzaStorico`. Il collegamento
// era da un click già prima del WS5; davanti c'era «apriti un account
// sviluppatore Meta», e quello è caduto nel Task 11.

import { appPubblica, configWhatsApp } from "../../comunicazioni/whatsapp";
import type { Adattatore, Avvio, Problema, Stato } from "../contratto";

export const whatsapp: Adattatore = {
  chiave: "whatsapp",
  ambito: "sede",
  permesso: "direzione",

  async stato(ctx): Promise<Stato> {
    const mia = configWhatsApp.find(c => c.sedeId === (ctx.sedeId ?? 1) && c.attiva);
    return {
      chiave: "whatsapp",
      ambito: "sede",
      collegato: !!mia?.tokenCifrato,
      soggetto: mia?.numero ?? null,
      verificatoIl: null,
      problema: null,
    };
  },

  async verifica(ctx): Promise<Problema | null> {
    const mia = configWhatsApp.find(c => c.sedeId === (ctx.sedeId ?? 1) && c.attiva);
    if (!mia?.ultimoErrore) return null;
    // Meta concede 24 ore per la sincronizzazione della coexistence: oltre
    // quella finestra il numero va offboardato e rifatto. Detto in italiano,
    // non come errore Meta grezzo.
    if (/24|expired|window/i.test(mia.ultimoErrore)) {
      return {
        causa: "La finestra di 24 ore concessa da Meta per importare lo storico è scaduta.",
        rimedio: "Scollega il numero e rifai il collegamento: contatti e conversazioni ripartiranno.",
        azione: "ricollega",
      };
    }
    return {
      causa: "WhatsApp ha segnalato un problema su questo numero.",
      rimedio: "Riprova fra qualche minuto; se resta, ricollega il numero.",
      azione: "riprova",
    };
  },

  async avvia(ctx): Promise<Avvio> {
    const app = appPubblica(ctx.sedeId);
    if (!app.pronta) {
      throw new Error(
        "App WhatsApp della piattaforma non configurata: imposta WHATSAPP_APP_ID, WHATSAPP_CONFIG_ID e WHATSAPP_APP_SECRET."
      );
    }
    return { tipo: "popup", configId: app.configId };
  },
};
```

- [ ] **Step 4: Registrare, e riportare il test del registro all'elenco completo**

In `registro.ts`: `REGISTRO = [fic, email, whatsapp, backup, agente]`.

In `registro.test.ts`, riporta la prima asserzione alla forma completa dello Step 1 del Task 1, **togliendo `calendario`** dall'elenco atteso — arriva col suo piano:

```ts
expect(REGISTRO.map(a => a.chiave)).toEqual([
  "fic",
  "email",
  "whatsapp",
  "backup",
  "agente",
]);
```

- [ ] **Step 5: Togliere gli id dalla scheda del cliente**

In `client/src/components/WhatsAppCard.tsx`:
- i tre campi App ID, Configuration ID e App secret (righe ~501–530) vanno dentro un blocco mostrato **solo** quando `app.data?.pronta === false`, con l'intestazione «Credenziali proprie dell'app (avanzate)»;
- togli il testo «I valori stanno in **developers.facebook.com** → la …» (riga ~933) dal percorso normale: resta solo dentro il blocco avanzato;
- il modulo manuale (numero, phone number ID, WABA ID, token, app secret — righe ~939–972) va sotto un `<details>` con estate «Diagnostica»: **non è più un percorso offerto al cliente**.

- [ ] **Step 6: Eseguire test, tipi e build**

Run: `pnpm test server/integrazioni/ && pnpm check && pnpm build`
Expected: PASS, nessun errore.

- [ ] **Step 7: Verifica nel browser**

Con le tre variabili di piattaforma impostate, apri Impostazioni → WhatsApp. Con la console aperta, controlla che:
- la scheda mostri «Collega» e **nessun campo App ID / Configuration ID / App secret**;
- il blocco avanzato compaia solo togliendo le variabili;
- nessun errore console; nessuno scroll orizzontale a 1440×900 e 390×844.

- [ ] **Step 8: Commit**

```bash
git add server/integrazioni client/src/components/WhatsAppCard.tsx
git commit -m "feat(whatsapp): il cliente collega il numero senza sapere cosa sia un App ID"
```

---

### Task 13: Verifica d'insieme

**Files:** nessuno nuovo.

- [ ] **Step 1: La suite intera**

Run: `pnpm check && pnpm test && pnpm build`
Expected: tutto verde. Un test rosso qui è un difetto di questo piano, non un test da aggiornare: torna al task che l'ha introdotto.

- [ ] **Step 2: Nessun segreto nei log**

Run: `grep -rn "console\.\(log\|warn\|error\)" server/integrazioni`
Expected: nessuna riga che stampi token, password, app secret o `process.env`.

- [ ] **Step 3: Il confine con WS3 è rimasto**

```bash
git diff --name-only feature/ws4-abbonamenti...HEAD | grep -E "server/tenants/|_core/persistence|_core/fileStorage|_core/driveBackup|_core/rotteAnonime|routers/fattureInCloud|routers/backup|routers/externalCalendars"
```
Expected: **nessuna riga**. Se ne compare una, la modifica va annullata: la spec §7.2 non ammette eccezioni in questo piano.

- [ ] **Step 4: Verifica visuale finale**

Impostazioni e `/integrazioni?attivazione=1`, a **1440×900** e **390×844**, con la console aperta. Nessun errore, nessun warning React, nessuno scroll orizzontale. Uno screenshot non basta: leggi la console.

- [ ] **Step 5: Commit se qualcosa è cambiato**

```bash
git add -A
git commit -m "fix(integrazioni): esiti della verifica d'insieme"
```

---

### Task 14: Documenti — per ultimi

`handoff.md`, il PRD e `docs/runbooks/multi-azienda.md` sono modificati sia da WS3 sia da WS4. Questo task **non parte** finché quei due non sono atterrati su `main`: è la stessa collisione PRD 5.33–5.36 già risolta a mano il 05/09.

**Files:**
- Modify: `documento_requisiti_infissi_ops.md`
- Modify: `handoff.md`
- Modify: `docs/runbooks/multi-azienda.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Verificare che WS3 e WS4 siano atterrati**

Run: `git log --oneline origin/main | grep -iE "ws3|ws4"`
Expected: entrambi presenti. Altrimenti **fermati qui** e lascia il task aperto.

- [ ] **Step 2: PRD**

Aggiungi una sezione nuova, con il primo numero libero dopo quelli presi da WS3 e WS4 (verifica con `grep -n "^## 5\." documento_requisiti_infissi_ops.md | tail -5`). Contenuto: il contratto unico, le due modalità, l'app di piattaforma, e le tre integrazioni che non cambiano meccanismo (email IMAP, calendari iCal in attesa del loro piano, agente incluso).

- [ ] **Step 3: `handoff.md`**

Una voce che dica: cosa è collegabile in self-service oggi, quali variabili di piattaforma sono obbligatorie in produzione (`FIC_OAUTH_REDIRECT_URI`, il callback Google, `WHATSAPP_APP_ID/CONFIG_ID/APP_SECRET`), e che senza di esse la scheda non offre «Collega» invece di fallire a metà giro.

- [ ] **Step 4: `docs/runbooks/multi-azienda.md`**

La procedura di attivazione di una nuova azienda, dal lato dell'operatore: cosa deve essere già configurato sulla piattaforma prima che il cliente entri.

- [ ] **Step 5: `CLAUDE.md`**

Nella sezione «Integrazioni», due righe: le credenziali OAuth e Meta sono di piattaforma e non si spostano per tenant; il callback OAuth non si ricava mai dall'header `Host`.

- [ ] **Step 6: Commit**

```bash
git add documento_requisiti_infissi_ops.md handoff.md docs/runbooks/multi-azienda.md CLAUDE.md
git commit -m "docs(ws5): il collegamento in self-service in PRD, handoff, runbook e CLAUDE.md"
```

---

## Debito dichiarato, non in questo piano

- **`mittenteWebhookWhatsApp`** (`server/_core/rotteAnonime.ts`) prova il segreto di ogni azienda finché uno valida la firma. Con un segreto di piattaforma il ciclo è inutile. Da semplificare **dopo** il merge di WS3, che ha riscritto quel file.
- **`driveBackup.ts:380`**: ramo service-account con scope `drive` pieno, già fuori uso. Va tolto prima di aprire la verifica Google, perché uno scope «restricted» dichiarato farebbe scattare la fascia più costosa. Fuori da questo piano perché `driveBackup.ts` è zona vietata: va concordato con chi tiene WS3.
- **Fase 4** — OAuth calendario in entrata: piano proprio, dopo `'gcal'` nel CHECK di `oauth_state` e la verifica del consent screen Google.
- **Fase 5** — calendario in scrittura: spec propria.
