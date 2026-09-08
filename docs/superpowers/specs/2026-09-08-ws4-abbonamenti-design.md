# WS4 — Abbonamenti: prova, omaggio, insoluti, quota che blocca, budget Tars per azienda (spec tecnica)

**Data:** 08/09/2026 · **Stato:** approvata in chat dalla direzione (ordine WS4→WS5, provider rimandato, tolleranza 7 giorni, budget Tars 25 €/mese, fine prova → insoluto → sola lettura; «Approvato: spec, piano ed esecuzione») e **implementata** in 9 task sul branch `feature/ws4-abbonamenti` (08/09/2026, `bb2f147`…`d335a68`); non su `main`, non in produzione. Le decisioni prese durante l'esecuzione sono in §2-bis e le sezioni che ne sono cambiate sono già corrette · **Spec madre:** `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md` (§3, §4, §9, §10, §11, §16.3, §18-bis) · **Precedenti:** WS1 (fondazione tenant), WS2 (archivi per tenant), WS3 (`2026-09-08-ws3-file-integrazioni-design.md`, PR #7 aperta) · **Branch:** `feature/ws4-abbonamenti`, nato da `feature/ws3-file-integrazioni` @ `a44fc37` (finché la PR #7 non è fusa la PR del WS4 contiene anche il WS3).

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

## 2-bis. Decisioni in corso d'opera (08/09/2026)

Diciannove scelte prese mentre il piano veniva eseguito — tre nella
scansione pre-volo, quattordici durante i 9 task, due nella fix wave finale
(la revisione dell'intero branch, `final-review-report.md`) — quando il codice
vero ha contraddetto la lettera della spec o del piano. Ognuna è un emendamento
a questo documento: le sezioni che ne sono cambiate sono già corrette qui sotto
— la §4.1 (R7, R8), la §6 (R16), la §11 e la §13 (pre-2, R10), la §8 (pre-3,
R13), la §9 (R5 e R15, più la riattivazione manuale, che il testo raccontava
sbagliata) e la §10. Con loro due correzioni di lettura, senza ruling perché non c'era
niente da decidere: la §9 sopra, e la §6 sui media WhatsApp, che dalla
fusione di `main` si conservano nello storage invece di restare solo su Meta.
Registro completo, con implementer, reviewer e commit:
`.superpowers/sdd/2026-09-08-ws4-abbonamenti/progress.md`.

| # | Che cosa | Perché | Costo se sbagliata |
|---|---|---|---|
| pre-1 | nei test che importano i router (anche di rimbalzo) non si chiama mai `__resetPersistenzaPerTest()` | ereditata dal WS3: quella funzione fa `famiglie.clear()` e cancella le famiglie registrate all'import | test rossi per «store sconosciuto»; nessun danno al codice |
| pre-2 | la §6 «413» decade: `ErroreQuotaStorage` è un `TRPCError PRECONDITION_FAILED` e basta | il 413 doveva venire da rotte Express di upload che si credevano inesistenti. Il Task 5 ha poi trovato l'unica che c'è (`_core/commessaFileRoutes.ts`, documenti di commessa): non risponde 413 ma **400 con lo stesso messaggio**, perché passa dallo stesso `caricaDocumentoCommessaDaBuffer` — il 413 di quel file è il limite dei 250 MB del body parser, un'altra cosa | nessuno sul blocco (il messaggio arriva comunque); un codice HTTP meno parlante su un percorso solo |
| pre-3 | le notifiche del WS4 si scrivono direttamente nel repository delle notifiche e solo dove `notificationMode` della sede è `active`; l'avviso nella shell legge le query e non dipende da nulla | il bus degli eventi è spento per sede di default, e una notifica di contratto non deve dipendere dal proiettore | nessuno |
| R1 | `servizio.ts` (control plane) riceve subito un `case "imposta_abbonamento"` che lancia «non ancora implementato»; il Task 3 lo sostituisce | tenere esaustivo — e quindi tipato — lo `switch` sui tipi di comando fin dal task che li introduce nello schema | un comando accodato prima del Task 3 finisce in `errore` con un messaggio chiaro; nessun effetto |
| R2 | `abbonamenti` aggiunta a TUTTI i `DROP TABLE` di `repository.pg.test.ts` | un `DROP … CASCADE` di `tenants` toglie il vincolo, non la tabella, e il `CREATE IF NOT EXISTS` non la ricreava: i casi si sporcavano a vicenda | test-only |
| R3 | `prorogaProva` vale da `trialing`, `past_due` e `suspended`, senza guardia sul tipo, e riporta il contratto a **prova piena**: `paid`, `periodicita` null, `trialing`, `omaggio: null`; l'evento porta il tipo precedente | si proroga anche un omaggio scaduto, e un omaggio a cui si regalano giorni di prova non è più un omaggio: lasciarne l'etichetta farebbe leggere alla scheda «Abbonamento omaggio» con una scadenza ormai falsa | un'etichetta «omaggio in prova» incoerente nella scheda |
| R4 | la deduplicazione degli avvisi 7/3/1 guarda gli ultimi 50 eventi del tenant | in `tenant_eventi` vivono solo eventi rari; una query mirata costerebbe un indice nuovo per un caso che non esiste | un tenant molto rumoroso può rivedere un avviso |
| R5 | le sospensioni decise dall'abbonamento portano il marcatore `abbonamento: ` in `motivoStato` (es. «abbonamento: tolleranza dell'insoluto scaduta»); la riattivazione automatica agisce **solo** su quel prefisso | una sospensione decisa a mano dall'operatore («blocco io») non deve essere disfatta da un omaggio o da una proroga | registro meno leggibile; una sospensione manuale annullata per sbaglio |
| R6 | la proroga azzera anche `disdettaAFinePeriodo`; `SAAS_BUDGET_TARS_EUR_MESE=0` è valido (nessun Tars incluso) mentre il cambio resta > 0; nessun evento `abbonamento_stato` quando `da === a` | una proroga è una prova nuova, e una disdetta lasciata attiva la chiuderebbe subito; `impostaBudgetTars` accettava già lo zero come tetto esplicito; un evento `{da: active, a: active}` è rumore nel registro | nessuno |
| R7 | `avviaWorkerAbbonamenti()` si chiama SOLO dal callback di `server.listen`; l'idempotenza (`if (intervallo) return`) resta come rete | il piano la faceva chiamare anche da `completaTenants`, che gira **prima** della porta: il primo giro sarebbe partito mentre il server non rispondeva ancora | un giro di valutazione durante il boot, prima della porta |
| R8 | `pnpm tenant crea` chiama `creaProva` anche quando il tenant esiste già ma non ha abbonamento (idempotenza per slug estesa al contratto); il worker logga «rilancia pnpm tenant crea» e salta, senza creare nulla | se `creaProva` fallisse, il tenant resterebbe per sempre senza abbonamento e ogni comando risponderebbe «inesistente», senza una via di riparazione; ma un worker che crea contratti da solo è un'altra cosa | nessuno |
| R9 | un `pagamento_riuscito` verificato azzera SEMPRE `insolutoDal` e `omaggio`, anche quando l'evento non porta il periodo | un provider che manda l'evento minimale lasciava la riga in uno stato che si contraddice: `active` con un insoluto aperto | riga incoerente (attiva e insoluta insieme) |
| R10 | nei cinque siti di upload `ErroreQuotaStorage` si **propaga** sempre: rethrow prima del ripiego inline e prima dell'incapsulamento in un `Error` generico | il ripiego su `dataBase64` esisteva per lo storage non durevole, non per la quota: teneva il file fuori dallo storage e fuori dal conto dei byte, aggirando il blocco | un blocco della quota aggirabile caricando dai percorsi «giusti» |
| R11 | `verificaCaricamento` legge la cronologia degli eventi SOLO se serve (bloccato, oppure `soglia100Dal` valorizzata, oppure tenant già visto bloccato da questo processo) | erano due letture di database a **ogni** caricamento, ~147 ms l'una, anche per un'azienda lontanissima dalla quota | nessuno |
| R12 | il ledger espone `consumoAziendaMese(tenantId, adesso)` per la query `tenants.consumi` | la scheda ha bisogno del consumo del mese dell'azienda, e senza questo metodo l'avrebbe ricavato con un giro suo | nessuno |
| R13 | la notifica dello storage dentro `verificaCaricamento` non si attende (fire-and-forget con `catch`, come nel governor) | un caricamento non deve pagare la consegna di una notifica che riguarda il mese, non lui | latenza in più su un upload al giorno per azienda |
| R14 | la scheda «Abbonamento e consumi» è visibile a proprietario e direzione **anche a interruttore spento** (mostra l'omaggio del tenant 1); l'avviso nella shell resta gated su `multiAzienda` | la scheda è informativa e non promette nulla che non ci sia; una riga d'avviso in cima alle pagine, in mono-azienda, sarebbe rumore | nessuno |

| R15 | l'abbonamento è la fonte di verità: un contratto `suspended` o `cancelled` con il tenant `attivo` viene risospeso dal giro successivo del worker (entro 6 ore) col marcatore `abbonamento: `; per riaprire un'azienda si usano omaggio o proroga, mai `stato --riattiva` | due strade ci arrivano senza che nessuno abbia sbagliato — la riattivazione a mano e il ripristino archivi del WS3, che riapre il tenant proprio mentre il worker porta il contratto a `suspended` — e la coppia incoerente resterebbe tale per sempre, con l'azienda che lavora senza contratto | un'azienda insolvente che continua a scrivere; nel verso opposto, se il ramo non guardasse lo stato del tenant, un ripristino disturbato a metà |

| R16 | il tenant 1 è esente dal blocco dello spazio: `bloccoStorage` ritorna sempre «non bloccato» per `TENANT_PREDEFINITO_ID`, che resta avvisato dalle soglie 50/80/100 | esenzione simmetrica a quella del tetto Tars: la proprietaria della piattaforma paga i propri costi, e il giorno che `FLAG_MULTI_AZIENDA` si accende Ruffino Group, se è già oltre i 100 GiB, si fermerebbe da sola dopo la tolleranza | i byte della piattaforma non hanno più un freno automatico: restano le soglie e `pnpm tenant storage` a dirlo |

**Ancora aperti**, minori accettati dalle revisioni per task e registrati nel
progress — alla chiusura del Task 9 non era stata fatta una revisione
dell'intero branch, quindi nessuno di questi è passato da una fix wave finale.
*Dominio:* `limite()` della politica Tars non applica il cambio di mese, quindi
un `bloccante` armato a fine mese resta armato al primo del mese finché
`dopoPrenotazione` non riesce (serve la guardia `tarsSogliaMese !== meseLocale
→ bloccante: false`); una politica che lanciasse **in modo sincrono**
sfuggirebbe al `.catch()` dei due punti del governor (igiene di contratto, oggi
la sola implementazione è `async`); la finestra «ultimi 50 eventi» è condivisa
da più famiglie di eventi e un tipo ad alta frequenza la renderebbe stretta;
la deduplicazione di `applicaEventoProvider` guarda gli ultimi 500 eventi ed è
un check-then-act non transazionale — va sostituita con una query mirata e un
lock quando nascerà la rotta del webhook; `creaProva` non ha la guardia sul
tenant 1 (oggi irraggiungibile: il seed gira in `completaTenants`);
`tenantIdDellaSede` ripiega sul tenant 1 per una sede sconosciuta fuori da
`conTenant` (prescritto dalla spec §7). *Fedeltà del blocco* (non la sua
tenuta): quattro strati secondari degradano il codice della quota —
`server/routers/mail.ts` la riavvolge in un `BAD_REQUEST`,
`server/routers/ficAllegati.ts` e `server/fatture/emissione.ts` la
inghiottono in uno stato «errore» del proprio flusso,
`server/_core/commessaFileRoutes.ts` risponde `400` invece di un codice che
dica «precondizione»; il testo che l'utente legge resta però quello giusto.
*Notifiche:* il ripiego sulla prima sede attiva può scrivere una notifica su
una sede che il destinatario non legge (prescritto dalla spec); titolo e corpo
si costruiscono anche quando il memo del giorno li scarterà. *Test:*
`bloccatiVisti` e `bloccatiTars` non hanno un hook di azzeramento (ce l'ha solo
`avvisiDelGiorno`); nessun test di una proroga che riattiva un tenant sospeso
(il ramo è condiviso con l'omaggio, che invece è provato); l'asserzione su
`updatedAt` del repository non è stretta; non c'è un `CHECK` su
`tars_soglia_avvisata` (come `sogliaAvvisata` del WS3). *CLI e scheda:*
per il tenant 1 (R16) la scheda scrive ancora «tolleranza 7 giorni» nel
dettaglio della barra dello spazio e, fra l'80 e il 99 %, la riga d'avviso
ricorda che «oltre il 100 % i caricamenti si fermano»: due frasi vere per
tutti tranne che per lui, che non si blocca — dirle giuste chiede un campo
in più nel payload di `tenants.consumi` («questa azienda non si blocca»),
non un ritocco di testo;
`--scadenza` di un omaggio non rifiuta una data nel passato; il messaggio di
«due facce della stessa azione» dice «Indica --disdetta oppure
--annulla-disdetta» anche quando sono state date entrambe; il log del worker
nomina l'azienda per id e non per slug; la scheda mostra il messaggio del
server anche quando è «L'azienda non ha una sede attiva.», che meriterebbe una
via d'uscita scritta; `campo` di `modifica` è una stringa libera (etichetta di
lettura, non nome di colonna); resta da guardare a schermo se l'avviso
«scorre con il contenuto» anche sotto i 1200 px, dove la shell Modular
Control cambia disposizione — il commento nel codice lo dà per scontato.

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
     `extra_tars_nano` se `extra_tars_mese` è passato;
  5. `suspended`/`cancelled` con il tenant ancora `attivo` → risospensione
     col marcatore `abbonamento: ` (R15): l'abbonamento è la fonte di
     verità, e il giro rimette in pari le due cose senza registrare un
     secondo `abbonamento_stato` (R6). Un tenant sospeso da altri
     (l'operatore, il ripristino archivi del WS3) non si tocca.
- Il tenant 1 nasce `complimentary` senza scadenza, `budget_tars_nano_mese
  = NULL`, motivo «Ruffino Group, proprietaria della piattaforma»
  (`assicuraAbbonamentoPredefinito()` in `completaTenants`, dopo il seed
  del tenant): nessuna transizione lo tocca mai.

### 4.1 Worker

`server/abbonamenti/worker.ts`: `avviaWorkerAbbonamenti()` è chiamata SOLO
dal callback di `server.listen` in `server/_core/index.ts` (R7) — mai da
`completaTenants()`, che gira prima della porta —, poi ogni 6 ore
(`setInterval` con `unref`, come FiC):
`perOgniTenantAttivo("abbonamenti", t => valutaAbbonamento(t, new Date()))`
— quindi con interruttore per azienda (WS3) e mai sui sospesi
(`tenantsAttivi()` li esclude: un sospeso torna attivo solo da un comando).
Un tenant ≠ 1 senza riga di abbonamento viene **saltato** con un log
(«rilancia pnpm tenant crea»): il worker non crea niente da solo (R8).
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
  messaggio (il client lo mostra come oggi per gli errori di dominio). Nei
  cinque siti di upload — `ticketAllegati.ts` e i quattro percorsi di
  `preventiviContratti.ts` — l'errore di quota si **rilancia** prima di
  qualunque ripiego (R10): il ripiego su `dataBase64` inline e
  l'incapsulamento in un `Error` generico esistevano per lo storage non
  durevole e qui avrebbero aggirato il blocco. L'unica rotta Express che
  carica file (`_core/commessaFileRoutes.ts`, documenti di commessa) non
  risponde 413 — quello è il limite dei 250 MB del body parser — ma **400
  con lo stesso messaggio**, perché passa dallo stesso
  `caricaDocumentoCommessaDaBuffer` (pre-2, corretto in Task 5). La posta
  (`imap.ts`) e le anteprime hanno già il `try/catch` intorno a `putFile`
  (allegato elencato ma non scaricato; anteprima assente); i media
  WhatsApp, che dalla fusione di `main` si conservano nello storage
  (`conservaMediaWhatsApp`), non fanno fallire il messaggio se non si
  salvano: restano su Meta, recuperabili dopo. Dati, download, backup e
  CRM ordinario continuano.
- **Il tenant 1 non si blocca mai** (R16): `bloccoStorage` esce subito per
  `TENANT_PREDEFINITO_ID`, simmetrico al tetto Tars, che per lui è già
  `null` — la proprietaria della piattaforma paga i propri costi e non si
  toglie da sola la possibilità di caricare. Le soglie 50/80/100 del WS3
  continuano ad avvisarla, e con `bloccoDal` null i testi cadono sulla sola
  percentuale, senza parlare di una tolleranza che per lei non esiste. Se
  Ruffino Group è al 100 % la leva è `--quota-gb`, così le soglie tornano
  significative.
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
- Notifiche: i cinque tipi `abbonamento.avviso`, `abbonamento.insoluto`,
  `abbonamento.sospeso`, `consumi.storage`, `consumi.tars` si scrivono
  **direttamente** nel repository delle notifiche (`notificaAzienda`,
  `server/abbonamenti/notifiche.ts`), non passano dal bus degli eventi né
  da `projectNotification` (pre-3): destinatari i proprietari e la direzione
  **attivi** dell'azienda, `sedeId` = la prima sede attiva fra le sue, link
  `/integrazioni?scheda=abbonamento`, priorità `high` per
  insoluto/sospeso/blocco e `normal` per le soglie, poi segnale SSE e push
  come le assegnazioni. Ogni destinatario riceve **solo se
  `notificationMode` della sua sede è `active`** (il default è `legacy`: dove
  nessuno l'ha acceso gli stati si muovono lo stesso e la notifica non
  arriva). Nessuna notifica può far fallire ciò che la origina:
  `notificaAzienda` non lancia mai, e sul percorso di un caricamento la
  chiamata non si attende nemmeno (R13).
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
dell'operatore, ma NON sono il modo di riaprire un'azienda insolvente: una
riattivazione manuale non cambia l'abbonamento, che resta `suspended`, e il
giro successivo del worker (entro 6 ore) rimette in pari le due cose
risospendendo il tenant col marcatore `abbonamento: ` (R15) — l'evento
`sospeso` nel registro dice perché. Per riaprire davvero si concede un
omaggio o si proroga; il runbook lo dice. Simmetricamente, una sospensione
decisa a mano — o dal ripristino archivi del WS3 — non porta quel marcatore:
non la disfa né un omaggio né una proroga, e il ramo R15 la lascia stare
perché agisce solo su un tenant `attivo` (R5).

## 10. Errori

| Situazione | Esito |
|---|---|
| upload oltre quota e tolleranza | `PRECONDITION_FAILED` «Spazio esaurito…» (tRPC), `400` con lo stesso messaggio dalla rotta Express dei documenti di commessa; posta/anteprime: allegato non scaricato, log |
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
  disdetta; mese nuovo azzera soglie ed extra; tenant 1 intoccabile; R15:
  contratto sospeso o disdetto con azienda riaperta a mano → risospesa col
  marcatore, azienda sospesa da altri e tenant 1 intoccati.
- Worker via `perOgniTenantAttivo` (tenant sospeso escluso; interruttore;
  un giro completo che risospende un'azienda riaperta a mano, R15).
- Quota: `putFile` rifiuta solo con gancio, flag acceso, 100 % e
  tolleranza scaduta; la tolleranza parte al primo 100 % e si azzera sotto;
  i cinque siti di upload propagano l'errore invece di ripiegare
  sull'inline; posta e anteprime non lanciano.
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
| `server/routers/{ticketAllegati,preventiviContratti}.ts` | i cinque siti di upload propagano l'errore di quota (R10) |
| `server/_core/index.ts` | worker avviato nel callback del `listen` |
| `client/src/components/layout/*`, `client/src/pages/Integrazioni.tsx`, nuovo `client/src/components/abbonamento/*` | avviso e scheda |
| runbook, PRD §60.12, handoff, CLAUDE.md, `docs/storage-r2.md` | documentazione |

## 14. Cosa viene dopo

WS5 (onboarding: registrazione self-service con prova, inviti, reset
password, personalizzazione) subito dopo, sullo stesso metodo; il provider
di pagamento quando scelto, dentro l'adattatore di §5.
