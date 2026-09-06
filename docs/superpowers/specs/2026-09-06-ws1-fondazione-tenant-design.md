# Workstream 1 — Fondazione tenant (design, 06/09/2026)

**Data:** 06/09/2026 sera · **Stato:** approvato a sezioni in chat (sei
sezioni, direzione); piano di implementazione da scrivere; nessun codice
finché il piano non è approvato · **Branch:** `claude/ruffino-flow-saas-multi-afaecf`
(solo documentazione; il codice nascerà su un branch di lavoro) ·
**Spec madre:** `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md`
(sezioni 1–18, Appendice A, §18-bis) · **Prodotto:** Wyndor (spec madre
§18-bis; Ruffino Group è il tenant 1).

## 1. Perché e perimetro

La spec madre (§17) ordina otto workstream. Questo è il primo: mette in piedi
il **tenant** come entità del sistema, lo risolve a ogni richiesta, lo impone
con guardie server-side e dà al control plane il suo primo pezzo relazionale.
Non tocca gli archivi business: quelli diventano tenant-aware nel WS2.

Decisioni prese in chat il 06/09/2026 sera (una domanda alla volta):

| # | Decisione | Scelta |
|---|---|---|
| 1 | Taglio WS1/WS2 | **Porta chiusa a chiave**: il tenant esiste, è nel contesto, ha guardie; gli archivi business restano quelli di oggi e ogni richiesta di un tenant diverso da 1 viene rifiutata dal server finché WS2 non apre la porta |
| 2 | Proprietario azienda | **Ottavo ruolo** in `ruoli[]`, conta nel massimo di 3, con capability propria; solo un proprietario assegna o toglie il ruolo |
| 3 | Chi crea i tenant | **Servizio di dominio + script CLI**; il Platform Admin come identità arriva col WS6 e userà lo stesso servizio |
| 4 | Rollback | **`FLAG_MULTI_AZIENDA` on/off**, fail-closed come gli altri interruttori; spento = il CRM di oggi |
| 5 | Stato del tenant | **`tenants.stato` attivo/sospeso + sola lettura** applicata da middleware; WS4 mapperà gli stati dell'abbonamento qui |
| 6 | Scrittura degli store | **Il server è l'unico a scrivere** tabelle e store; lo script accoda comandi in una tabella e il server li esegue (vincolo del repo: mai scritture esterne con l'istanza viva) |

Consegna del WS1, in una riga: *un utente di Ruffino Group lavora come oggi;
il sistema sa che appartiene al tenant 1, lo scrive in ogni contesto, rifiuta
chiunque altro e può mettere un'azienda in sola lettura.*

**Fuori perimetro** (workstream successivi): `tenantId` sui record business e
chiavi `tenant:<id>:<store>` (WS2); prefissi storage, backup per tenant,
credenziali e worker per tenant (WS3); abbonamenti, webhook, consumi, budget
Tars per azienda (WS4); inviti, reset password, onboarding, marchio del
rivenditore, visibilità del menu (WS5); identità Platform Admin, MFA, accesso
di supporto, pannello (WS6); rebranding Wyndor (lavoro a parte).

## 2. Vocabolario

- **Tenant / azienda**: il rivenditore cliente di Wyndor. Confine di
  proprietà di utenti, sedi, dati, file, integrazioni, consumi. Id numerico;
  `1` è Ruffino Group (`TENANT_PREDEFINITO_ID`).
- **Sede**: confine operativo dentro il tenant, come oggi (§34 PRD).
- **Proprietario**: ruolo `proprietario`; titolare dell'account azienda.
- **Control plane**: tabelle trasversali (`tenants`, `tenant_eventi`,
  `tenant_comandi`) e il servizio che le governa. Non contiene dati business.
- **Porta chiusa**: la guardia temporanea del WS1 che rifiuta ogni tenant
  diverso da 1. Ha un nome (`portaChiusaPerTenant`) perché il WS2 la toglie.
- **Comando**: una riga di `tenant_comandi` accodata dallo script ed eseguita
  dal server.
- **Interruttore**: `multiAzienda` → env `FLAG_MULTI_AZIENDA`.

## 3. Architettura

Approccio scelto (A): il tenant è risolto nel contesto a ogni richiesta, dallo
store `utenti` più la tabella `tenants`, e imposto da middleware tRPC. Un solo
punto di verità; i router business restano intatti. Scartati: tenant nel JWT
(vecchio fino a 7 giorni, contro «verificato a ogni confine») e tenant come
«sede radice» nello store `sedi` (mescola i due confini, viola §12.1).

### 3.1 File nuovi

| File | Ruolo |
|---|---|
| `server/tenants/costanti.ts` | `TENANT_PREDEFINITO_ID = 1`, slug e nome del tenant 1 |
| `server/tenants/tipi.ts` | `TenantRecord`, `Attore`, tipi dei comandi e degli eventi |
| `server/tenants/comandi.ts` | schemi zod dei payload dei comandi, condivisi da script e server |
| `server/tenants/repository.ts` | `ensureSchema()` (tabelle, indici, trigger), variante Postgres e in memoria, cache dei tenant; **unico file con `INSERT INTO tenant*`** |
| `server/tenants/servizio.ts` | servizio di dominio: `assicuraTenantPredefinito`, `crea`, `sospendi`, `riattiva`, `assegnaProprietario`, `revocaProprietario`, `eseguiComandiInAttesa` |
| `server/tenants/contesto.ts` | `risolviTenantPerUtente`, `sediAmmesse`, `sedePredefinita` |
| `server/tenants/router.ts` | `tenants.mio` |
| `server/tenants/boot.ts` | `avviaTenants()`: schema, cache, seed, comandi, intervallo |
| `scripts/tenant.ts` | CLI `pnpm tenant crea|stato|proprietario|elenco` |
| `server/_core/contestoDiProva.ts` | helper per i test che costruiscono un `TrpcContext` |
| `docs/runbooks/multi-azienda.md` | runbook: flag, boot, comandi, script, rollback, verifica |

### 3.2 File modificati

| File | Cosa cambia |
|---|---|
| `server/_core/context.ts` | `tenantId`, `tenant`; rilettura dell'utente dallo store; `sediIds` ristrette al tenant |
| `server/_core/trpc.ts` | `sessionProcedure`; guardie porta chiusa e sola lettura in `protectedProcedure`; `adminProcedure` costruita sopra |
| `server/_core/permissions.ts` | `assertTenantScope` |
| `server/routers.ts` | login: porta chiusa; montaggio del router `tenants` |
| `server/routers/utenti.ts` | `tenantId`, backfill, ruolo `proprietario`, guardie per tenant, validazione `sediIds`, funzioni interne esportate per il servizio |
| `server/routers/sedi.ts` | `tenantId`, backfill, filtri per tenant, `sedePredefinita`, `switch` validato |
| `server/routers/permessi.ts` | `findUserInSede` verifica anche il tenant |
| `server/authz/capabilities.ts` | ruolo `proprietario`, capability `tenant.manage_proprietari`, eccezione del corto circuito direzione |
| `server/tars/contesto.ts`, `server/tars/strumenti/tipi.ts`, `server/tars/azioni/policy.ts`, `server/tars/strumenti/comune.ts` | `tenantId` obbligatorio nel `ContestoRun`, niente fallback di sede, catalogo fail-closed, ctx di dominio con tenant |
| `server/platform/interruttori.ts` | `multiAzienda` → `FLAG_MULTI_AZIENDA` |
| `server/_core/index.ts` | `avviaTenants()` nell'ordine di boot |
| `client/src/lib/roles.ts`, `client/src/pages/UtentiList.tsx`, `client/src/components/users/UserPermissionsDialog.tsx` | ruolo ed etichetta «Proprietario»; opzione visibile solo a chi è proprietario |
| `.env.example`, `docs/runbooks/piattaforma-recovery.md`, PRD §60.9, `handoff.md` | documentazione |
| 83 file di test che costruiscono `TrpcContext` a mano | `tenantId: 1, tenant: null` (codemod, poi `pnpm check`) |

### 3.3 Cosa non cambia

I 50 store business e i loro router; `assertSedeScope` e i 165 filtri per
sede; file, backup, integrazioni, worker; ledger Tars e costi; `platform_feature_flags`
(per sede: la sede appartiene a un tenant); override e deleghe (per sede).

## 4. Dati

### 4.1 Control plane relazionale

`ensureSchema()` nel modulo, come `authz/repository.ts`, additivo e
idempotente; variante in memoria senza `DATABASE_URL`.

```sql
CREATE TABLE IF NOT EXISTS tenants (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,          -- ^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$
  nome          TEXT NOT NULL,
  stato         TEXT NOT NULL CHECK (stato IN ('attivo','sospeso')),
  motivo_stato  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- seed: INSERT (1,'ruffino-group','Ruffino Group','attivo') ON CONFLICT (id) DO NOTHING;
--       SELECT setval('tenants_id_seq', GREATEST((SELECT MAX(id) FROM tenants), 1));

CREATE TABLE IF NOT EXISTS tenant_eventi (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
  tipo        TEXT NOT NULL,   -- creato | sospeso | riattivato | proprietario_assegnato | proprietario_revocato | comando_fallito
  attore      TEXT NOT NULL,   -- utente:<id> | script:<nome> | boot
  motivo      TEXT,
  dettagli    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tenant_eventi_tenant_idx ON tenant_eventi (tenant_id, created_at DESC);
-- trigger tenant_eventi_solo_insert: BEFORE UPDATE OR DELETE → RAISE EXCEPTION
-- (DROP TRIGGER IF EXISTS + CREATE TRIGGER, dentro ensureSchema)

CREATE TABLE IF NOT EXISTS tenant_comandi (
  id            BIGSERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario')),
  tenant_id     BIGINT,                      -- NULL per 'crea'
  payload       JSONB NOT NULL,              -- validato con gli schemi di comandi.ts
  stato         TEXT NOT NULL DEFAULT 'in_attesa' CHECK (stato IN ('in_attesa','eseguito','errore')),
  esito         JSONB,                       -- { tenantId, sedeId, utenteId } oppure { errore }
  richiesto_da  TEXT NOT NULL,               -- script:tenant@<host>
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eseguito_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tenant_comandi_attesa_idx ON tenant_comandi (stato, id) WHERE stato = 'in_attesa';
```

`tenant_eventi` è la prima tabella del repo con append-only garantito dal
database. È il registro che WS4 e WS6 useranno per pagamenti, omaggi e
accessi di supporto.

### 4.2 Store JSONB

Restano store (decisione A.4 punto 1 della spec madre): il membership è un
campo dell'utente, un utente appartiene a un solo tenant (spec madre §5.1).

- `utenti[].tenantId: number` e `sedi[].tenantId: number`; backfill a 1 in
  `onLoad`, idempotente, con salvataggio differito come per `sediIds`.
- L'email dell'utente resta unica su tutta l'installazione: il login è per
  sola email e non può disambiguare fra tenant.
- `DEFAULT_SEDE_ID` resta solo come valore di backfill dei record legacy; la
  sede di ripiego a runtime è `sedePredefinita(tenantId)` = prima sede attiva
  del tenant, per id crescente. Se un tenant non ha sedi attive la sessione
  ha `sedeId = null` e ogni `protectedProcedure` risponde
  `PRECONDITION_FAILED` «L'azienda non ha una sede attiva».
- Id di utenti e sedi restano globali (uno store): nessuna collisione fra
  tenant in WS1.

### 4.3 Seed e backfill al boot (solo con interruttore acceso)

1. Riga del tenant 1 (`ON CONFLICT DO NOTHING`) e `setval`.
2. Per ogni tenant senza proprietari attivi: il primo utente direzione attivo
   del tenant (id più basso) con meno di 3 ruoli riceve `proprietario`;
   evento `proprietario_assegnato` con attore `boot`. Se nessun candidato,
   riga di log `[tenants] tenant <id> senza proprietario` e si rimedia con
   `pnpm tenant proprietario`. Per Ruffino Group il candidato è l'utente 1.
3. Conteggi nel log: `[tenants] tenant 1 pronto: N utenti, M sedi`.

### 4.4 Ruoli e capability

- `RUOLI` = i sette di oggi più `proprietario`; `MAX_RUOLI` resta 3; specchio
  in `client/src/lib/roles.ts`, etichetta «Proprietario».
- Nuova capability `tenant.manage_proprietari`: assegnare e togliere il ruolo
  `proprietario`. Profilo `proprietario` = `SHARED_CAPABILITIES` +
  `tenant.manage_proprietari`. Chi è anche direzione ha il resto per
  costruzione.
- Eccezione esplicita in `capabilitiesForRoles`: la direzione ha tutte le
  capability **tranne** `tenant.manage_proprietari`, che arriva solo dal
  ruolo `proprietario`. È l'unica eccezione al corto circuito, commentata nel
  codice e provata da un test.
- `tenant.manage_proprietari` non è né delegabile né sovrascrivibile: le
  procedure di `permessi.*` che creano override e deleghe la rifiutano con
  `FORBIDDEN`. Altrimenti una direzione potrebbe concedersela da sola.
- Le facoltà future del proprietario (abbonamento, export, chiusura) nascono
  con le loro capability nei workstream che le costruiscono. Nessun nome
  riservato ora.
- Sedi: chi è direzione o proprietario vede tutte le sedi attive del tenant.

### 4.5 Guardie dell'ultimo presidio, per tenant

`countDirezioneAttivi(tenantId)` e `countProprietariAttivi(tenantId)`. Una
modifica (update, disattivazione, delete) che porterebbe uno dei due a zero
nel tenant viene rifiutata con `PRECONDITION_FAILED` e il messaggio di oggi
(«ultimo utente direzione attivo…», e il gemello per il proprietario). Il
conteggio non attraversa mai i tenant.

## 5. Contesto e procedure

### 5.1 Risoluzione (`createContext`, interruttore acceso)

1. Autenticazione come oggi: `sdk.authenticateRequest` (percorso OAuth
   legacy, in produzione inattivo perché `OAUTH_SERVER_URL` è vuoto), poi
   `verifyLocalSession` (JWT locale).
2. Rilettura dell'utente dallo store `utenti` per `id`, **solo** per gli
   utenti con `loginMethod: "local"`. Se non esiste o `attivo === false`:
   `user = null` (richiesta non autenticata). Chiude la falla per cui un JWT
   resta valido 7 giorni dopo la cancellazione o la disattivazione
   dell'utente. Un utente del percorso OAuth legacy non viene mai cercato in
   `utenti` (i suoi id vengono da un'altra tabella e potrebbero collidere):
   con interruttore acceso non ha tenant ed è non autenticato, fail-closed.
3. `tenantId = utente.tenantId`; `tenant = perId(tenantId)` dalla cache del
   modulo (tabella piccola, caricata al boot, aggiornata da ogni scrittura
   del servizio; una replica sola, come oggi: se domani ce ne fossero due, la
   cache diventa una lettura a ogni richiesta o un canale `LISTEN/NOTIFY`).
   Tenant assente dalla cache (riga cancellata a mano): `user = null`.
4. `sediIds = sediAmmesse(utente, tenantId)`: direzione o proprietario →
   tutte le sedi attive del tenant; altri → `utente.sediIds` ∩ sedi del
   tenant; se vuoto → `[sedePredefinita(tenantId)]` oppure `[]`.
5. `sedeId` = cookie `active_sede` se in `sediIds`, altrimenti
   `sediIds[0] ?? null`.

Tipo:

```ts
export type TenantRecord = {
  id: number; slug: string; nome: string;
  stato: "attivo" | "sospeso"; motivoStato: string | null;
  createdAt: Date; updatedAt: Date;
};
export type TrpcContext = {
  req; res;
  user: (User | LocalUser) | null;
  tenantId: number | null;       // null solo se non autenticato
  tenant: TenantRecord | null;   // null se non autenticato o interruttore spento
  sedeId: number | null;
  sediIds: number[];
};
```

Interruttore spento: `tenantId = 1` per ogni utente autenticato, `tenant = null`,
`sediIds` da `allowedSediForUser` come oggi, nessuna rilettura in più.

### 5.2 Procedure (`server/_core/trpc.ts`)

```text
publicProcedure   = cronometro
sessionProcedure  = publicProcedure + requireUser          // tenantId: number nel ctx a valle
protectedProcedure= sessionProcedure + guardiaTenant       // porta chiusa + sola lettura
adminProcedure    = protectedProcedure + requireAdmin      // ctx.user.role === "admin" (direzione), come oggi
procedureConInterruttore(nome) = protectedProcedure + assicuraInterruttore(nome)
```

`guardiaTenant`, solo con interruttore acceso:
- **porta chiusa**: `ctx.tenantId !== TENANT_PREDEFINITO_ID` →
  `PRECONDITION_FAILED` «L'azienda non è ancora attiva su questa
  installazione.» Implementata da `portaChiusaPerTenant(tenantId)` in
  `server/tenants/servizio.ts`, con il commento «da togliere nel WS2».
- **sola lettura**: `type === "mutation"` e `ctx.tenant?.stato === "sospeso"`
  → `PRECONDITION_FAILED` «Azienda sospesa: il gestionale è in sola
  lettura.» Esente `sedi.switch` (scrive solo un cookie), per `path`.
- **senza sede attiva**: `ctx.sedeId == null` → `PRECONDITION_FAILED`
  «L'azienda non ha una sede attiva.»

`sessionProcedure` la usano solo `tenants.mio` e, domani, l'onboarding.
`auth.me`, `auth.login`, `auth.logout`, `system.health` restano pubbliche.

Login (`auth.login`): dopo la verifica della password, con interruttore
acceso, se il tenant dell'utente non è 1 → lo stesso errore della porta
chiusa, prima di emettere il cookie. Nessuna sessione inutile.

### 5.3 Isolamento del control plane

- `assertTenantScope(record, tenantId)` in `server/_core/permissions.ts`,
  gemello di `assertSedeScope`: `NOT_FOUND` «Risorsa non trovata.», mai
  `FORBIDDEN`; con `tenantId == null` non fa nulla.
- `utenti.byId/update/delete`, `sedi.update`, `permessi.*` (via
  `findUserInSede`) lo applicano; `utenti.list` con `adminScope` e
  `sedi.listAll` filtrano per `ctx.tenantId`.
- `sedi.create` e `utenti.create` stampano `tenantId = ctx.tenantId`.
- `sediIds` in `utenti.create/update` devono essere sedi esistenti del
  tenant: altrimenti `NOT_FOUND`. Oggi nessuna validazione: il piano
  controlla che nessun test crei utenti con sedi fittizie, e in caso crea
  prima la sede.
- `sedi.switch` accetta solo sedi in `sediAmmesse`.
- Chi assegna o toglie `proprietario`: `utenti.create/update` verificano
  `effectiveCapabilitySet(ctx)` ⊇ `tenant.manage_proprietari`; altrimenti
  `FORBIDDEN` «Solo un proprietario può nominare o revocare un
  proprietario.» Il cambio passa dal servizio (`assegnaProprietario` /
  `revocaProprietario`) che scrive l'evento.

### 5.4 Catalogo degli errori

| Caso | Codice | Messaggio |
|---|---|---|
| tenant diverso da 1 (login o procedura) | `PRECONDITION_FAILED` | L'azienda non è ancora attiva su questa installazione. |
| mutation con tenant sospeso | `PRECONDITION_FAILED` | Azienda sospesa: il gestionale è in sola lettura. |
| nessuna sede attiva nel tenant | `PRECONDITION_FAILED` | L'azienda non ha una sede attiva. |
| record di utente o sede di altro tenant | `NOT_FOUND` | Risorsa non trovata. |
| proprietario senza capability | `FORBIDDEN` | Solo un proprietario può nominare o revocare un proprietario. |
| ultimo proprietario o direzione del tenant | `PRECONDITION_FAILED` | messaggi di oggi, al plurale dei presìdi |
| utente cancellato o disattivato con JWT valido | `UNAUTHORIZED` | messaggio standard di sessione |
| interruttore spento e `proprietario` aggiunto a chi non lo ha | `PRECONDITION_FAILED` | Il ruolo proprietario richiede FLAG_MULTI_AZIENDA. |

## 6. Servizio, comandi, script

### 6.1 Servizio di dominio (`server/tenants/servizio.ts`)

```ts
type Attore = { tipo: "utente"; id: number } | { tipo: "script"; nome: string } | { tipo: "boot" };

assicuraTenantPredefinito(): Promise<void>;                       // §4.3
perId(id: number): TenantRecord | null;                           // cache
perSlug(slug: string): TenantRecord | null;
crea(input: CreaTenantInput, attore: Attore): Promise<{ tenant: TenantRecord; sedeId: number; utenteId: number }>;
sospendi(tenantId: number, motivo: string, attore: Attore): Promise<TenantRecord>;
riattiva(tenantId: number, motivo: string, attore: Attore): Promise<TenantRecord>;
assegnaProprietario(tenantId: number, utenteId: number, attore: Attore): Promise<void>;
revocaProprietario(tenantId: number, utenteId: number, attore: Attore): Promise<void>;
eseguiComandiInAttesa(): Promise<{ eseguiti: number; falliti: number }>;
portaChiusaPerTenant(tenantId: number): boolean;                  // WS1 soltanto
```

`CreaTenantInput` = `{ slug, nome, sede: { nome, citta? }, proprietario: { nome, cognome, email, telefono?, passwordHash } }`.
`crea` è **idempotente per slug**: se il tenant esiste, completa ciò che manca
(sede se il tenant non ha sedi, utente se l'email non esiste) e non duplica.
Ordine: riga in `tenants`; poi sede e utente in un'unica
`conTransazioneStoreAtomica([sedi, utenti])` usando le funzioni interne
esportate dai router (`creaSedeInterna`, `creaUtenteInterno`: stessa
allocazione di id, stesso hashing, stesse validazioni; i router esportano
anche gli handle dei due store per la transazione); poi evento `creato`.
L'utente nasce con `ruoli: ["proprietario", "direzione"]`, `sediIds` = la
sede creata, `attivo: true`. Un tenant creato in produzione resta dietro la
porta chiusa fino al WS2.

`sospendi`/`riattiva`: aggiornano `stato` e `motivo_stato`, evento,
aggiornano la cache. Sospendere il tenant 1 è permesso: lo script chiede
conferma esplicita perché mette Ruffino Group in sola lettura.

`revocaProprietario` applica la guardia dell'ultimo proprietario.

### 6.2 Comandi

Il server è l'unico a scrivere `tenants`, `tenant_eventi` e gli store. Lo
script produce soltanto righe di `tenant_comandi`, tramite `repository.accoda`.
Il server esegue con `eseguiComandiInAttesa()` al boot e ogni 30 s
(`setInterval(...).unref()`, solo con interruttore acceso, in-process, una
replica): `SELECT … WHERE stato = 'in_attesa' ORDER BY id FOR UPDATE SKIP LOCKED`
in transazione, un comando alla volta, validazione del payload con gli schemi
di `comandi.ts`, chiamata del servizio con attore `script:<richiesto_da>`,
poi `stato = eseguito` con `esito`, oppure `stato = errore` con il messaggio
ed evento `comando_fallito` (quando esiste un tenant a cui attribuirlo). Nessun
retry automatico: un comando fallito si legge e si riaccoda a mano. Idempotenza:
un comando ha un solo esito; `crea` è idempotente per slug anche se riaccodato.

Con interruttore spento i comandi restano in attesa e il boot lo scrive nel
log.

### 6.3 Script `scripts/tenant.ts` (`pnpm tenant …`)

```text
pnpm tenant elenco                                   # sola lettura: tenant, stato, comandi in attesa
pnpm tenant crea --slug acme --nome "Acme Infissi" --sede "Acme Infissi" \
                 --email titolare@acme.it --nome-utente Mario --cognome Rossi [--scrivi] [--attendi]
pnpm tenant stato --slug acme (--sospendi | --riattiva) --motivo "…" [--scrivi] [--attendi]
pnpm tenant proprietario --slug acme --email m.rossi@acme.it (--assegna | --revoca) [--scrivi] [--attendi]
```

- Senza `--scrivi` mostra il comando che accoderebbe e non scrive (come
  `storage:probe-write`).
- La password del proprietario arriva da `TENANT_PROPRIETARIO_PASSWORD` o da
  un prompt nascosto; stessa regola di 12 caratteri; hashata dallo script con
  `hashPassword` prima di entrare nel payload. Mai in chiaro su riga di
  comando, nella tabella o nel log.
- `--attendi` interroga `tenant_comandi` fino a 90 s e stampa l'esito.
- Lo script parla solo con il database (`DATABASE_URL`), mai con gli store:
  è sicuro con l'istanza viva. Senza database rifiuta di partire.
- Ogni sottocomando registra `richiesto_da = script:tenant@<hostname>`.

### 6.4 Router `tenants` (`server/tenants/router.ts`)

`tenants.mio` (`sessionProcedure`): `{ id, slug, nome, stato, proprietario:
boolean, multiAzienda: boolean }`. Con interruttore spento risponde il tenant
1 (dalla tabella se c'è, altrimenti il record predefinito) e
`multiAzienda: false`. Nessun'altra procedura in WS1.

## 7. Tars

- `ContestoRun.tenantId: number` obbligatorio (`server/tars/strumenti/tipi.ts`).
- `costruisciContesto` (`server/tars/contesto.ts`): `tenantId` da
  `ctx.tenantId`; se `ctx.sedeId == null` lancia `UNAUTHORIZED: sessione
  senza sede` invece di ripiegare su `DEFAULT_SEDE_ID`; il fingerprint delle
  cache include il tenant.
- `server/tars/azioni/policy.ts`: come per la sede, un contesto senza
  `tenantId` intero positivo non ottiene alcuna azione (fail-closed).
- `server/tars/strumenti/comune.ts`: il ctx tRPC costruito per il dominio
  porta `tenantId` e `tenant`.
- Nessuna colonna `tenant_id` sui ledger in WS1: la sede implica il tenant.

## 8. Interruttore, boot, rollback, produzione

### 8.1 Interruttore

`multiAzienda` → `FLAG_MULTI_AZIENDA` in `interruttori.ts`, letto a ogni
chiamata, fail-closed: acceso per default solo in development e test, spento
in produzione finché l'env non dice `on`.

**Sempre presente** (anche spento): le tre tabelle (schema additivo al boot);
`tenantId` su utenti e sedi con il backfill; `proprietario` nell'enum dei
ruoli; la cache dei tenant caricata.

**Spento**: `tenantId = 1`, `tenant = null`, nessuna guardia; `tenants.mio`
risponde col tenant 1 e `multiAzienda: false`; i comandi restano in attesa;
`utenti.create/update` rifiutano di **aggiungere** `proprietario` a chi non
lo ha e non toccano chi già lo ha; la direzione gestisce gli utenti come oggi.

**Acceso**: seed del tenant 1, proprietario di ripiego, contesto, guardie,
porta chiusa, sola lettura, comandi ogni 30 s, ruolo assegnabile dai
proprietari.

### 8.2 Ordine di boot (`server/_core/index.ts`)

Dopo `bootstrapAll()` (gli `onLoad` hanno già scritto `tenantId = 1`) e
prima dei worker: `avviaTenants()` = `ensureSchema()` → carica la cache →
se acceso: `assicuraTenantPredefinito()` → `eseguiComandiInAttesa()` →
intervallo 30 s. In produzione un fallimento dello schema ferma l'avvio, come
per policy ed eventi. Il runbook di recovery aggiunge il passo e le righe di
log `[tenants]`.

### 8.3 Rollback

`FLAG_MULTI_AZIENDA=off` e riavvio: comportamento di prima, dati intatti. I
campi in più vengono ignorati; il ruolo `proprietario` già assegnato resta e
non dà nulla oltre le capability condivise. Anche il revert del codice è
sicuro: tabelle e campi non hanno consumatori.

### 8.4 Produzione (Railway), in ordine

1. Deploy con interruttore spento. Verifica in sola lettura (runbook): riga
   del tenant 1, utenti e sedi con `tenantId`, nessun comando in attesa,
   nessun errore `[tenants]`.
2. Backup Drive riuscito nelle 24 ore precedenti.
3. `FLAG_MULTI_AZIENDA=on` e riavvio. Verifica: log `[tenants] tenant 1
   pronto`, evento `proprietario_assegnato` per l'utente 1, `tenants.mio`
   dal client con login di direzione.
4. Nessun tenant 2 in produzione finché WS2 non apre la porta; in staging sì,
   per provare la porta.

Dati toccati dal WS1 in produzione: `tenantId` su utenti e sedi, il ruolo
dell'utente 1. Nessuna copia di store, nessuna chiave rinominata.

## 9. Client

Solo: `proprietario` e l'etichetta «Proprietario» in `client/src/lib/roles.ts`
e nelle mappe delle etichette (`UtentiList.tsx`, `UserPermissionsDialog.tsx`);
l'opzione del ruolo nel modulo utente compare solo se `tenants.mio.proprietario`
è vero (il server rifiuta comunque). Nessuna pagina nuova, nessun banner di
sola lettura (arriva con WS4, quando la sospensione sarà un fatto
dell'abbonamento). Verifica a 1440×900 e 390×844 sulla pagina Utenti: se il
login demo non è disponibile all'agente, lo si dichiara nel handoff.

## 10. Test e accettazione

Vitest; i test di router usano `appRouter.createCaller(ctx)` con contesti
costruiti da `contestoDiProva()`; in test l'interruttore è acceso per default
e i test che vogliono il comportamento spento lo impostano esplicitamente.

1. `server/tenants/contesto.test.ts`: tenant dell'utente; sedi ristrette al
   tenant; cookie di una sede altrui ignorato; utente cancellato o
   disattivato → non autenticato; nessuna sede attiva → `sedeId = null`;
   interruttore spento → `tenantId = 1`, `tenant = null`.
2. `server/_core/guardieTenant.test.ts`: porta chiusa per un tenant 2 su una
   procedura business; `tenants.mio` risponde anche al tenant 2; sola lettura
   del tenant sospeso (query ok, mutation rifiutata, `sedi.switch` esente);
   `adminProcedure` e `procedureConInterruttore` ereditano; login rifiutato
   per il tenant 2.
3. `server/routers/utenti.tenant.test.ts`: `proprietario` solo con
   `tenant.manage_proprietari`; direzione esclusa; ultimo proprietario e
   ultima direzione per tenant (il tenant 1 non conta per il tenant 2);
   `byId/update/delete` cross-tenant → `NOT_FOUND`; `sediIds` fuori tenant →
   `NOT_FOUND`; email unica globale; spento: non aggiunge, conserva.
4. `server/routers/sedi.tenant.test.ts`: `create` stampa il tenant; `listAll`
   per tenant; `update` e `switch` su sede altrui rifiutati; ripiego sulla
   prima sede attiva del tenant.
5. `server/tenants/servizio.test.ts` (repository in memoria): `crea` (tenant,
   sede, utente, eventi), idempotenza per slug, slug non valido o duplicato,
   `sospendi`/`riattiva` con eventi e cache, `assegna`/`revoca` con guardia,
   comandi `in_attesa → eseguito | errore`, payload non valido → errore,
   spento → nessuna esecuzione.
6. `server/tenants/repository.pg.test.ts` (Postgres vero, `describe.skipIf`
   come `jsonbSnapshot.pg.test.ts`): schema idempotente, trigger append-only
   che rifiuta `UPDATE` e `DELETE`, seed del tenant 1 e `setval`, `FOR UPDATE
   SKIP LOCKED` sui comandi.
7. `server/tars/contesto.tenant.test.ts`: `tenantId` nel `ContestoRun`;
   senza sede → errore; fingerprint diverso per tenant diverso; catalogo
   vuoto senza tenant.
8. Strutturali (`server/tenants/confine.test.ts`, stile
   `tars/costi/confine.test.ts`): nessuno schema di input tRPC o di strumento
   Tars contiene `tenantId` o `tenant`; `INSERT INTO tenant` compare solo in
   `server/tenants/repository.ts`; `portaChiusaPerTenant` ha esattamente
   due chiamanti, la guardia e il login.
9. `server/authz/capabilities.test.ts` e `server/routers/permessi.test.ts`:
   `capabilitiesForRoles(["direzione"])` non contiene
   `tenant.manage_proprietari`; `["proprietario"]` sì più le condivise;
   override e delega su `tenant.manage_proprietari` rifiutati con `FORBIDDEN`.

Accettazione:
- `pnpm check`, `pnpm test`, `pnpm build` verdi; la suite esistente passa
  senza cambiare aspettative (solo `tenantId: 1, tenant: null` nei contesti).
- In locale con interruttore acceso: login dell'utente 1 → `tenants.mio` =
  Ruffino Group, proprietario vero; un tenant 2 creato via `pnpm tenant crea`
  → il suo utente si ferma alla porta; `pnpm tenant stato --sospendi` sul
  tenant 1 → sola lettura, poi `--riattiva`.
- Con interruttore spento: nessuna differenza osservabile rispetto a oggi.
- Client verificato a 1440×900 e 390×844, o dichiarato non verificato.
- Documentazione aggiornata (§11).

## 11. Documentazione da aggiornare col codice

- PRD: §60.9 «Workstream 1 — fondazione tenant» con contratto e stato; §3.2
  (rilettura dell'utente a ogni richiesta), §4.1 (ottavo ruolo), §34 (tenant
  sopra la sede), §28.1 (tabelle nuove).
- `handoff.md`: novità, mappa del codice (`server/tenants/`), checklist di
  deploy, voce 21.
- `.env.example`: `FLAG_MULTI_AZIENDA=off` e `TENANT_PROPRIETARIO_PASSWORD`.
- `docs/runbooks/multi-azienda.md` (nuovo) e `docs/runbooks/piattaforma-recovery.md`
  (ordine di boot).
- `docs/tars/architettura-tars-v2.md`: `tenantId` nel `ContestoRun`.

## 12. Rischi e punti aperti

- **83 file di test** costruiscono `TrpcContext` a mano: il tipo cambia, va
  fatto un codemod (`tenantId: 1, tenant: null`) e poi `pnpm check`. Da
  fare per primo nel piano, così il resto lavora su una suite verde.
- **Validazione di `sediIds`** (§5.3): può rompere test che assegnano sedi
  fittizie. Il piano lo verifica prima di attivarla.
- **Una replica**: cache dei tenant e ciclo dei comandi sono in-process, come
  ogni worker del repo. Con più repliche servono lettura per richiesta o
  `LISTEN/NOTIFY`: registrato nel handoff, non risolto qui.
- **JWT a 7 giorni**: resta; la rilettura dello store toglie l'utente
  cancellato, non accorcia il token.
- **`role: "admin"` legacy**: resta derivato da `direzione`; il proprietario
  senza direzione ha `role: "user"` e non passa `adminProcedure`, per scelta.
- **Sospensione senza banner**: fino al WS4 la sola lettura si vede solo dagli
  errori delle mutation; in WS1 la sospensione è un atto dell'operatore.
- **Utenti OAuth legacy**: con interruttore acceso restano fuori se non hanno
  un record in `utenti`; il percorso è spento in produzione.
- **Prova gratuita di 30 giorni** (decisione della stessa sera, spec madre
  §18-bis): non tocca il WS1. Un tenant in prova è `attivo`; la prova, la
  sua scadenza e la registrazione senza pagamento vivono nell'abbonamento
  (WS4) e nell'onboarding (WS5).

## 13. Cosa viene dopo

Il piano di implementazione (`docs/superpowers/plans/`) scompone questa spec
in task con test; il codice parte solo dopo l'approvazione del piano. Poi
WS2: `tenantId` sui record business, chiavi `tenant:<id>:<store>`, backfill di
Ruffino Group con dry-run e rollback, e la rimozione di `portaChiusaPerTenant`.
