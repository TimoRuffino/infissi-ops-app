# WS4 — Abbonamenti: prova, omaggio, insoluti, quota che blocca, budget Tars per azienda (spec tecnica)

**Data:** 08/09/2026 · **Stato:** approvata in chat dalla direzione (ordine WS4→WS5, provider rimandato, tolleranza 7 giorni, budget Tars 25 €/mese, fine prova → insoluto → sola lettura; «Approvato: spec, piano ed esecuzione») · **Spec madre:** `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md` (§3, §4, §9, §10, §11, §16.3, §18-bis) · **Precedenti:** WS1 (fondazione tenant), WS2 (archivi per tenant), WS3 (`2026-09-08-ws3-file-integrazioni-design.md`, PR #7 aperta) · **Branch:** `feature/ws4-abbonamenti`, nato da `feature/ws3-file-integrazioni` @ `a44fc37` (finché la PR #7 non è fusa la PR del WS4 contiene anche il WS3).

> Con il WS3 un'azienda ha i suoi archivi, i suoi file contati, il suo
> backup. Le manca un contratto: quando inizia, quando scade, cosa succede
> se non paga, quanto Tars può spendere. Il WS4 dà a ogni azienda un
> abbonamento nel control plane, una prova gratuita di 30 giorni, l'omaggio
> per chi lo merita, il percorso degli insoluti fino alla sola lettura, e
> trasforma le due risorse misurate — storage e Tars — da «conta e avvisa»
> a «conta, avvisa, tollera e poi ferma». Il provider di pagamento resta
> dietro un adattatore con una sola implementazione, «nessuno».

## 1. Obiettivo, perimetro, non-obiettivi

**Obiettivo.** Ogni tenant ha un abbonamento con stato, periodo e budget;
il sistema muove gli stati da solo (prova → insoluto → sola lettura) o su
comando (omaggio, proroga, budget, quota); storage e Tars, superata la
quota e la tolleranza, fermano solo ciò che costa. Con
`FLAG_MULTI_AZIENDA` spento nulla di tutto questo agisce.

**Entra nel WS4.**
- Tabella `abbonamenti` nel control plane, tipi ed eventi (§3).
- Prova gratuita di 30 giorni alla creazione del tenant; omaggio; avvisi a
  7, 3 e 1 giorno; insoluto e sola lettura dopo la tolleranza (§4).
- Adattatore del provider di pagamento con implementazione `nessuno` (§5).
- Quota storage che blocca i caricamenti nuovi dopo la tolleranza (§6).
- Budget Tars mensile per azienda: conteggio, soglie, blocco delle sole
  chiamate a pagamento (§7).
- Ciò che l'azienda vede: query `tenants.abbonamento` e `tenants.consumi`,
  avviso nella shell, scheda «Abbonamento e consumi» in Integrazioni (§8).
- Comandi `pnpm tenant abbonamento …`, `elenco` con stato e scadenza (§9).

**Resta fuori.**
- Checkout, portale self-service, webhook del provider, fattura del canone
  (§10.2, §10.4 della madre): arrivano quando la direzione sceglie il
  provider; l'adattatore di §5 è il posto dove entrano.
- Pacchetti extra a pagamento e capacità storage aggiuntiva a pagamento:
  qui esistono solo come **concessioni** via comando (extra Tars del mese,
  quota storage).
- Registrazione self-service, inviti, reset password (WS5); pannello
  Platform Admin (WS6): gli stessi comandi di §9 li useranno.
- Export aziendale del proprietario in sola lettura (§10.3 madre): WS6.
- Cancellazione dei dati alla scadenza: mai automatica (madre §10.3).

## 2. Decisioni prese in chat (08/09/2026)

| # | Tema | Decisione |
|---|---|---|
| 1 | Ordine | WS4 e poi WS5 di seguito, una PR ciascuno |
| 2 | Provider di pagamento | Rimandato: adattatore astratto, implementazione `nessuno`; solo prova e omaggio finché non è scelto |
| 3 | Tolleranza dopo il 100 % (storage e Tars) | 7 giorni, predefinito per ogni azienda, cambiabile per azienda |
| 4 | Budget Tars incluso | 25 €/mese per le nuove aziende (configurazione, non codice); Ruffino Group senza tetto per azienda (valgono i tetti globali `TARS_*`) |
| 5 | Prova scaduta senza provider | Avvisi a 7/3/1 giorni, poi `past_due`, dopo 7 giorni `suspended` = sola lettura (madre §10.3); un omaggio riattiva; nessuna cancellazione |
| 6 | Sicurezza a flag spento | Worker, blocchi e limiti per azienda inerti a `FLAG_MULTI_AZIENDA` spento; le sole aggiunte visibili sono le tabelle e la riga omaggio del tenant 1 |

## 3. Control plane

Tutto scritto SOLO da `server/tenants/repository.ts` (guardia
`confine.test.ts`), DDL additivo in `creaSchema`, sonda in sola lettura
estesa (`verificaSchema`, `MESSAGGI.schemaAssente` con sette tabelle).

```sql
CREATE TABLE IF NOT EXISTS abbonamenti (
  tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('paid','complimentary')),
  periodicita TEXT CHECK (periodicita IN ('monthly','yearly')),
  stato TEXT NOT NULL CHECK (stato IN ('trialing','active','past_due','grace','suspended','cancelled')),
  inizio_periodo TIMESTAMPTZ NOT NULL,
  fine_periodo TIMESTAMPTZ,                -- NULL = senza scadenza (omaggio)
  prossimo_rinnovo TIMESTAMPTZ,
  disdetta_a_fine_periodo BOOLEAN NOT NULL DEFAULT FALSE,
  budget_tars_nano_mese BIGINT,            -- NULL = nessun tetto per azienda
  extra_tars_nano BIGINT NOT NULL DEFAULT 0,
  extra_tars_mese TEXT,                    -- 'AAAA-MM' a cui l'extra appartiene
  tolleranza_storage_giorni INTEGER NOT NULL DEFAULT 7,
  tolleranza_tars_giorni INTEGER NOT NULL DEFAULT 7,
  tars_soglia_avvisata INTEGER NOT NULL DEFAULT 0,   -- 0/50/80/100, del mese `tars_soglia_mese`
  tars_soglia_mese TEXT,
  tars_soglia_100_dal TIMESTAMPTZ,
  insoluto_dal TIMESTAMPTZ,
  provider TEXT NOT NULL DEFAULT 'nessuno',
  provider_ref JSONB,
  omaggio JSONB,                           -- { motivo, attore, dataIso, scadenzaIso|null }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tenant_storage ADD COLUMN IF NOT EXISTS soglia_100_dal TIMESTAMPTZ;
```

- La quota storage resta `tenants.storage_quota_bytes` (WS3): l'abbonamento
  non la duplica; `--quota-gb` passa da `impostaQuotaStorage`.
- `TipoEvento` nuovi: `abbonamento_creato`, `abbonamento_stato` (`{ da, a, motivo }`),
  `abbonamento_omaggio`, `abbonamento_prova_prorogata`, `abbonamento_avviso`
  (`{ giorniAllaScadenza, fineIso }`), `abbonamento_modificato`
  (`{ campo, prima, dopo }`), `tars_soglia` (`{ percentuale, mese }`),
  `storage_bloccato`/`storage_sbloccato`, `tars_bloccato`/`tars_sbloccato`.
- `TipoComando` nuovo: `imposta_abbonamento` (payload §9); CHECK di
  `tenant_comandi` esteso con la guardia `pg_constraint` del WS3.
- Repository: `abbonamentoDi(tenantId)`, `salvaAbbonamento(abbonamento)`
  (upsert intero, `updated_at = NOW()`), `abbonamenti()` (cache in memoria
  come `tenants`, caricata in `caricaCache`), `impostaSoglia100Storage(tenantId, data | null)`.
- Tipi in `server/abbonamenti/tipi.ts`: `Abbonamento`, `StatoAbbonamento`,
  `TipoAbbonamento`, `Omaggio`; `costanti.ts`: `GIORNI_PROVA = 30`,
  `GIORNI_TOLLERANZA_INSOLUTO = 7` (madre §10.3), `GIORNI_AVVISO = [7, 3, 1]`,
  `TOLLERANZA_PREDEFINITA_GIORNI = 7`, `BUDGET_TARS_PREDEFINITO_EUR` letto da
  `SAAS_BUDGET_TARS_EUR_MESE` (default 25), cambio euro→USD nano con
  `SAAS_CAMBIO_EUR_USD` (default 1.08: il ledger conta in USD del provider).

## 4. Stati e transizioni

`server/abbonamenti/servizio.ts` è l'unico che cambia stato; ogni
transizione registra `abbonamento_stato` e, dove serve, chiama
`sospendi`/`riattiva` del tenant (WS1) che accende la sola lettura.

```text
crea tenant ──▶ trialing (30 gg, budget 25 €, tolleranze 7/7)
trialing  ─fine periodo senza pagamento─▶ past_due (insoluto_dal = ora)
past_due  ─7 gg (GIORNI_TOLLERANZA_INSOLUTO)─▶ suspended  (tenant → sospeso «insoluto»)
past_due | suspended ─omaggio o pagamento verificato─▶ active  (tenant → attivo)
active (paid) ─fine periodo senza rinnovo─▶ past_due          (con provider; oggi solo manuale)
active (complimentary con scadenza) ─scadenza─▶ past_due
active ─disdetta─▶ cancelled a fine periodo (servizio attivo fino a fine_periodo, poi suspended)
```

- `creaProva(tenantId, adesso)`: chiamata da `tenants.servizio.crea` subito
  dopo l'evento `creato`; idempotente (se l'abbonamento esiste non fa nulla).
- `concediOmaggio(tenantId, { motivo, scadenza | null }, attore)`: tipo
  `complimentary`, `stato = active`, `fine_periodo = scadenza`, `omaggio`
  registrato; se il tenant era sospeso per insoluto lo riattiva.
- `prorogaProva(tenantId, giorni, attore)`: solo da `trialing`/`past_due`
  di una prova; sposta `fine_periodo`, azzera `insoluto_dal`, torna
  `trialing`, riattiva il tenant se sospeso.
- `valutaAbbonamento(tenantId, adesso)` — il giro del worker (§4.1):
  1. avvisi: per `trialing`, e per `complimentary` con scadenza, se
     mancano 7, 3 o 1 giorni interi a `fine_periodo` e l'avviso di quel
     giorno non è ancora stato registrato → evento `abbonamento_avviso` +
     notifica (§8);
  2. `trialing`/`active` con `fine_periodo` passata e senza rinnovo →
     `past_due` (`insoluto_dal = adesso`), notifica «insoluto»;
  3. `past_due` con `insoluto_dal + 7 giorni < adesso` → `suspended` e
     `sospendi(tenantId, "insoluto: …", boot)`, notifica «sola lettura»;
  4. mese nuovo → azzera `tars_soglia_avvisata`, `tars_soglia_100_dal`,
     `extra_tars_nano` se `extra_tars_mese` è passato.
- Il tenant 1 nasce `complimentary` senza scadenza, `budget_tars_nano_mese
  = NULL`, motivo «Ruffino Group, proprietaria della piattaforma»
  (`assicuraAbbonamentoPredefinito()` in `completaTenants`, dopo il seed
  del tenant): nessuna transizione lo tocca mai.

### 4.1 Worker

`server/abbonamenti/worker.ts`: `avviaWorkerAbbonamenti()` dopo
`server.listen`, poi ogni 6 ore (`setInterval` con `unref`, come FiC):
`perOgniTenantAttivo("abbonamenti", t => valutaAbbonamento(t, new Date()))`
— quindi con interruttore per azienda (WS3) e mai sui sospesi
(`tenantsAttivi()` li esclude: un sospeso torna attivo solo da un comando).
A `FLAG_MULTI_AZIENDA` spento il worker non parte.

## 5. Adattatore del provider

`server/abbonamenti/provider.ts`:

```ts
export type ProviderPagamenti = {
  nome: "nessuno" | string;
  /** Avvia il checkout e restituisce l'URL da aprire; `null` se il provider non lo offre. */
  avviaCheckout(input: { tenantId: number; periodicita: "monthly" | "yearly"; ritornoUrl: string }): Promise<string | null>;
  /** Portale self-service del proprietario; `null` se assente. */
  urlPortale(tenantId: number): Promise<string | null>;
  /** Verifica e normalizza un evento firmato del provider; `null` se non valido. */
  verificaEvento(intestazioni: Record<string, string>, corpo: Buffer): Promise<EventoProvider | null>;
};
export type EventoProvider = { id: string; tipo: "pagamento_riuscito" | "pagamento_fallito" | "disdetta"; tenantId: number; periodo: { inizio: Date; fine: Date } | null };
export function providerCorrente(): ProviderPagamenti; // "nessuno": ogni metodo risponde null
```

Il servizio consuma `EventoProvider` con `applicaEventoProvider(evento)`
(idempotente per `evento.id`, registrato in `tenant_eventi`): è il punto in
cui, scelto il provider, entreranno checkout e webhook. Nessuna rotta HTTP
nasce ora.

## 6. Quota storage che blocca

- `fileStorage.ts`: gancio iniettato `impostaVerificaQuota(fn | null)` con
  `fn(tenantId, bytes) → Promise<Rifiuto | null>`; `putFile` lo chiama
  PRIMA di `driver.put`; un rifiuto lancia `ErroreQuotaStorage` (estende
  `TRPCError` con `code: "PRECONDITION_FAILED"`, messaggio «Spazio
  esaurito: l'azienda ha superato i <N> GB inclusi. Libera spazio o chiedi
  capacità aggiuntiva.»). Senza gancio (script, test) nessun controllo.
- `server/abbonamenti/quota.ts`: `verificaCaricamento(tenantId, bytes)`
  rifiuta quando `interruttoreAttivo("multiAzienda")` **e**
  `tenant_storage.bytes >= tenants.storage_quota_bytes` **e**
  `soglia_100_dal + tolleranza_storage_giorni < adesso`. `applicaSoglie`
  (WS3) imposta `soglia_100_dal` al primo attraversamento del 100 % e lo
  azzera scendendo sotto (evento `storage_sbloccato` se era bloccato).
  Il primo rifiuto del giorno registra `storage_bloccato` e notifica (§8).
- Chi carica: le procedure tRPC ricevono il `PRECONDITION_FAILED` col
  messaggio (il client lo mostra come oggi per gli errori di dominio); le
  rotte Express di upload rispondono 413 con il messaggio; la posta
  (`imap.ts`) e le anteprime hanno già il `try/catch` intorno a `putFile`
  (allegato elencato ma non scaricato; anteprima assente); i media
  WhatsApp restano su Meta, recuperabili dopo. Dati, download, backup e
  CRM ordinario continuano.
- Tolleranza e quota cambiano per azienda con `pnpm tenant abbonamento`.

## 7. Budget Tars per azienda

- `tars_costi` ha già `tenant_id` (trigger e backfill del WS2): l'INSERT
  della prenotazione lo scrive esplicitamente e la somma del mese si
  calcola anche per azienda (`COALESCE(tenant_id, 1) = <id>`).
- `LedgerCosti.prenota` riceve `tenantId` e `limiteAziendaMeseNano: number | null`;
  `ConsumoCorrente` guadagna `aziendaMeseNano`; nuovo rifiuto
  `limite: "azienda"`. Il governor (`avvolgiConGovernor`) ha
  `ContestoCosto.tenantId`, risolto in `creaProviderPerRun` da
  `tenantCorrente() ?? tenantIdDellaSede(sedeId)`: i sei chiamanti non
  cambiano.
- Politica per azienda iniettata (come il contabile dello storage):
  `impostaPoliticaTarsAzienda({ limite(tenantId, adesso), dopoPrenotazione(tenantId, aziendaMeseNano, adesso) })`
  registrata al boot da `server/abbonamenti/quota.ts`:
  - `limite` restituisce `null` se il tenant non ha budget (tenant 1) o se
    l'interruttore è spento; altrimenti `budget + extra` del mese, e lo
    rende **bloccante** solo se `tars_soglia_100_dal + tolleranza_tars_giorni < adesso`
    (prima: la prenotazione passa e si contano le soglie);
  - `dopoPrenotazione` applica le soglie 50/80/100 % del mese (evento
    `tars_soglia` una volta per soglia, `tars_soglia_100_dal` al 100 %,
    notifica §8) e, al primo rifiuto, `tars_bloccato`.
- Il rifiuto per budget d'azienda usa il percorso esistente
  (`ErroreBudget("azienda", consumo)`, `MESSAGGIO_BUDGET_AZIENDA` «Tars ha
  esaurito il budget mensile dell'azienda; le funzioni che non costano
  restano disponibili, il budget si rinnova il primo del mese»): Tars
  risponde con quel testo, i worker a pagamento (analisi, smistamento,
  lettura visiva) lo registrano e saltano. I tetti globali `TARS_*`
  restano come rete della piattaforma.
- Il rinnovo è mensile per costruzione: la somma è per `mese_locale`.
  L'utente vede una percentuale (§8), mai token o dollari.

## 8. Ciò che l'azienda vede

- `tenants.abbonamento` (`protectedProcedure`): `{ tipo, stato, periodicita,
  inizioPeriodo, finePeriodo, prossimoRinnovo, disdettaAFinePeriodo,
  omaggio: { scadenza } | null, giorniAllaScadenza, solaLettura }`.
- `tenants.consumi` (`protectedProcedure`): `{ storage: { bytes, quotaBytes,
  percentuale, bloccoDal, tolleranzaGiorni }, tars: { percentuale,
  budgetEur, extraEur, bloccoDal, tolleranzaGiorni, mese } }` —
  `budgetEur`/`extraEur` solo per proprietario e direzione, `null` agli
  altri; `percentuale` `null` quando non c'è budget (tenant 1).
- Notifiche: eventi business `abbonamento.avviso`, `abbonamento.insoluto`,
  `abbonamento.sospeso`, `consumi.storage`, `consumi.tars` pubblicati con
  `publishDomainEvent` (`recipientHints` = proprietari e direzione attivi
  dell'azienda, `sedeId` = prima sede attiva); `projectNotification`
  impara i cinque tipi (titolo, corpo, link `/integrazioni?scheda=abbonamento`,
  priorità `high` per insoluto/sospeso/blocco, `normal` per le soglie);
  in-app e push come le assegnazioni.
- Client (unico lavoro `client/` del WS4, verificato a 1440 e 390):
  - `AvvisoAzienda` in `ModularControlLayout` e `LegacyDashboardLayout`:
    una riga sotto la barra di contesto quando la prova finisce entro 7
    giorni, in insoluto, in sola lettura, storage o Tars ≥ 80 % o
    bloccati; chiudibile per sessione (`sessionStorage`), rientra al
    cambio di stato; link alla scheda.
  - Scheda «Abbonamento e consumi» in `Integrazioni.tsx` (proprietario e
    direzione): tipo con dicitura «Abbonamento omaggio» e scadenza,
    stato, giorni alla scadenza, due barre (storage, Tars) con
    percentuale e data del blocco se in tolleranza; nessun pulsante di
    pagamento finché il provider è `nessuno`.

## 9. Comandi

`pnpm tenant abbonamento --slug=<slug> <azione> [--motivo=…] [--scrivi] [--attendi]`
con una sola azione per comando: `--omaggio [--scadenza=AAAA-MM-GG]`,
`--proroga=<giorni>`, `--quota-gb=<n>`, `--budget-tars-eur=<n|nessuno>`,
`--extra-tars-eur=<n>` (del mese corrente), `--tolleranza-storage=<gg>`,
`--tolleranza-tars=<gg>`, `--disdetta` / `--annulla-disdetta`. Senza
`--scrivi` anteprima; `--motivo` obbligatorio per omaggio e proroga.
Comando `imposta_abbonamento` (`schemaPayloadAbbonamento`, discriminato
su `azione`) eseguito dal server in `eseguiComando` → `servizio`. `pnpm
tenant elenco` stampa `stato abbonamento`, `fine periodo`, `insoluto dal`.
`pnpm tenant stato --sospendi/--riattiva` restano per la mano
dell'operatore (una riattivazione manuale di un `suspended` per insoluto
NON cambia l'abbonamento: il worker lo risospenderebbe; il runbook lo
dice: per riaprire un'azienda si concede omaggio o si proroga).

## 10. Errori

| Situazione | Esito |
|---|---|
| upload oltre quota e tolleranza | `PRECONDITION_FAILED` «Spazio esaurito…» (tRPC), 413 (Express); posta/anteprime: allegato non scaricato, log |
| chiamata Tars oltre budget e tolleranza | `ErroreBudget("azienda")` → risposta di Tars col messaggio; worker che saltano e registrano |
| azienda `suspended` | sola lettura del WS1 (`PRECONDITION_FAILED` «Azienda sospesa…»); lettura, download, backup continuano |
| comando su tenant 1 (`--omaggio`, `--proroga`, `--disdetta`) | rifiutato: «Il tenant 1 è la proprietaria della piattaforma» (quota, budget e tolleranze ammessi) |
| `--budget-tars-eur` con `SAAS_CAMBIO_EUR_USD` non valido | comando in errore, nessuna scrittura |
| provider `nessuno` | `avviaCheckout`/`urlPortale` → `null`; la scheda non mostra pulsanti |
| worker che fallisce per un'azienda | interruttore del WS3 (15→120 min), evento `worker_sospeso` |

## 11. Test

- Repository (memoria + pg): `abbonamenti` upsert/cache, `soglia_100_dal`,
  CHECK dei comandi con `imposta_abbonamento`.
- Servizio con orologio finto: prova → avvisi 7/3/1 una volta sola →
  `past_due` → `suspended` con tenant sospeso; omaggio riattiva; proroga;
  disdetta; mese nuovo azzera soglie ed extra; tenant 1 intoccabile.
- Worker via `perOgniTenantAttivo` (tenant sospeso escluso; interruttore).
- Quota: `putFile` rifiuta solo con gancio, flag acceso, 100 % e
  tolleranza scaduta; la tolleranza parte al primo 100 % e si azzera sotto;
  rotte Express → 413; posta e anteprime non lanciano.
- Ledger pg con due aziende: somme per azienda e mese, rifiuto `azienda`
  solo se bloccante, tenant 1 senza tetto; governor con ledger finto:
  `tenantId` risolto, soglie e blocco, messaggio.
- Proiettore: cinque tipi → notifiche a proprietari e direzione, mai agli
  altri; router `abbonamento`/`consumi` per ruolo; comandi e CLI.
- Interruttore spento: nessun worker, nessun rifiuto, `abbonamento` del
  tenant 1 omaggio; `pnpm check/test/build`; UI a 1440 e 390 con il login
  demo dell'anteprima.

## 12. Rilascio

Additivo: `abbonamenti`, `tenant_storage.soglia_100_dal`, CHECK dei
comandi, riga omaggio del tenant 1 al boot, nuovi tipi di evento. Nessuna
migrazione a senso unico. A flag spento: nessun worker, nessun blocco,
nessun limite per azienda. Ordine: dopo la PR #7 (WS3) o insieme; la
prima azienda 2 in staging nasce in prova, si verifica l'avviso a 7
giorni con `--proroga` e l'orologio, si concede l'omaggio.

## 13. File toccati

| File | Modifica |
|---|---|
| `server/tenants/repository.ts`, `tipi.ts`, `costanti.ts` | `abbonamenti`, `soglia_100_dal`, metodi, tipi di evento/comando, messaggio schema |
| `server/abbonamenti/{tipi,costanti,servizio,worker,provider,quota,notifiche}.ts` (nuovi) | dominio dell'abbonamento |
| `server/tenants/servizio.ts`, `boot.ts`, `comandi.ts`, `router.ts`, `scripts/tenant.ts` | prova alla creazione, seed tenant 1, comando, query, CLI |
| `server/_core/fileStorage.ts`, `server/tenants/storage.ts` | gancio quota, `soglia_100_dal` nelle soglie |
| `server/tars/costi/{ledger,governor,providerGovernato}.ts` | tenant nel contesto e nella prenotazione, limite d'azienda, politica iniettata |
| `server/events/*`, `server/notifications/projector.ts` | eventi e proiezione |
| `server/_core/index.ts`, rotte Express di upload | worker dopo il listen; 413 |
| `client/src/components/layout/*`, `client/src/pages/Integrazioni.tsx`, nuovo `client/src/components/abbonamento/*` | avviso e scheda |
| runbook, PRD §60.12, handoff, CLAUDE.md, `docs/storage-r2.md` | documentazione |

## 14. Cosa viene dopo

WS5 (onboarding: registrazione self-service con prova, inviti, reset
password, personalizzazione) subito dopo, sullo stesso metodo; il provider
di pagamento quando scelto, dentro l'adattatore di §5.
