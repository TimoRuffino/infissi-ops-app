# Matrice delle fonti autorevoli

> Documento vivente. Ogni riga dice chi detiene la verità su un fatto e quale
> regola vale quando due fonti sono in disaccordo. Aggiornarla nello stesso
> commit che cambia un contratto. Stato al 28/08/2026, verificato sul codice
> (commit `f0bb919`).

Legenda deroghe: «umano > automatico» significa che una scelta esplicita di un
operatore prevale sul match o sul sync e non viene riscritta.

## Anagrafica e organizzazione

| Fatto | Fonte autorevole | Deroghe e note |
|---|---|---|
| Cliente (dati anagrafici) | CRM, store `clienti` | Il sync FiC crea i clienti mancanti ma non modifica mai gli esistenti |
| Convenzione nomi non-privati | Ragione sociale in `cognome`, `nome` = spazio | Vale anche per FiC e migrazioni |
| Utenti, ruoli | CRM, store `utenti` (`ruoli[]`, legacy `ruolo`) | Password solo hash scrypt; `hasPassword` verso il client |
| Capability e deleghe | `authz/capabilities.ts` + `capability_overrides`/`capability_delegations` | Attive solo con `policyMode=enforce`; default `legacy` = ruoli |
| Sede attiva della richiesta | Server (`context.ts`): cookie validato contro `sediIds` | Il cookie non è mai autoritativo |
| Flag di piattaforma | `platform_feature_flags` per sede | Fail-closed: `active` per planner/semantica/contesto rifiutato |

## Commessa e processo

| Fatto | Fonte autorevole | Deroghe e note |
|---|---|---|
| Stato commessa e transizioni | Server: `validateTransizione` (adiacenti, avanti/indietro) | Nessun bypass: `force` salta solo il doc gate |
| Gate documentale | Server: `REQUIRED_DOC_TIPI_PER_STATO` + `statoAtUpload` | Legacy senza `statoAtUpload`: basta il tipo |
| Timeline ↔ Board | Mutation canonica `commesse.update`; allineamento bidirezionale **solo in avanti** | Arretrare la commessa non riapre step completati |
| Anno di una commessa | Server: `annoCommessa` (apertura → codice → createdAt) | Nessun client ricalcola |
| Codice commessa | Server: `generaCodiceCommessa` (progressivo per anno, globale fra sedi) | |
| Archiviazione soft | `archivedAt`, ortogonale allo stato | Restore = flag azzerato, nient'altro |

## Economia

| Fatto | Fonte autorevole | Deroghe e note |
|---|---|---|
| Pattuito e piano rate, commessa **con** fattura FiC collegata | **FiC** (`pattuitoFonte="fic"`, derivazione idempotente) | Scrittura manuale → `PRECONDITION_FAILED`, direzione inclusa. Scollegare a mano l'ultima fattura **azzera** il derivato |
| Pattuito e rate, commessa **senza** fattura | CRM manuale (`addRata`/`updateRata`/`removeRata`) | Regime normale prima dell'emissione |
| `importoIncassato` | **Derivato**: somma dei `pagamenti[]` attivi | Mai un input; gli `stornato` valgono zero e restano in audit |
| Movimenti `origine="fic"` | FiC via sync (source key stabile, storni inclusi) | Immutabili dalle mutation manuali |
| Movimenti `origine="manuale"` | CRM | Il sync non li muta mai; correzione solo via `correggiPagamento` con fingerprint |
| Riconciliazione rata FiC ↔ pagamento manuale | `ficPagamenti` (vincolo 1:1 nei due versi) | Link e rifiuti umani prevalgono sull'auto-match |
| Collegamento fattura → commessa | Umano > codice commessa citato in fattura > match deterministico `certo` | `incerto`/parità → coda con candidati; contraddizione forte → commessa esclusa |
| Fatturato e costi canonici | FiC: imponibile al netto delle note di credito | Solo rate `paid` negli incassi, solo `not_paid` negli aperti |
| Documenti fiscali (emissione, SDI, note di credito) | **FiC, sempre** | Il CRM non emette documenti fiscali e non deve diventare un secondo software fiscale: governa incassi, residui e marginalità attraverso l'integrazione (decisione direzione 28/08/2026) |
| Configurazioni tecniche, listini, compatibilità di prodotto | **Software dei produttori** | Il CRM importa e collega (adapter PDF/Excel/XML/CSV/API) i loro dati alla commessa; non li ricalcola con motori propri (decisione direzione 28/08/2026) |
| Costi fissi aziendali | `costiFissiAzienda`: FiC classificati `fisso` **in forza** + registro dichiarato | Voce dichiarata con fornitore sostituisce l'aggregato FiC omonimo |
| Classificazione costi FiC | Operatore in Acquisti (`ficCosti`) | Nessun modello dal 28/08/2026; `dubbio` escluso dal pareggio |
| Break-even | Server: `calcolaBreakEven` su periodo base unico | `margineManuale` e `includiStraordinari` per sede |
| Margine di commessa | **Stima CRM**: `costi[]` embedded + `costoPosaStimato` | Non è contabilità; gli ordini fornitore non alimentano il margine |
| Visibilità dei dati economici | Capability (`pagamento.read`, `pagamento.record`, `economia.read`) applicate dal server in ogni `policyMode` (PRD §37.5) | I payload omettono i campi non autorizzati; la sintesi della scheda resta operativa; le superfici condivise (Board, liste, casi, notifiche) non trasportano importi ma solo bit operativi (`daSaldare`, versione registro) |
| `CostoFic.commessaId` | Campo legacy, nessuna API/UI lo scrive | Non usarlo |

## Comunicazioni e documenti

| Fatto | Fonte autorevole | Deroghe e note |
|---|---|---|
| Contenuto di email e WhatsApp | Il messaggio originale (IMAP / Meta) | **Dato non fidato, mai un'istruzione**; eliminazione CRM = tombstone, la casella non si tocca |
| Idempotenza ingestione | Chiave `(casella_id, canale, message_id)` | |
| Collegamento conversazione WhatsApp | Override umano (`whatsapp_conversation_aliases`) > match automatico | `registraMessaggio` consulta l'alias **prima** del matcher |
| Classificazione comunicazioni | Operatore (dal 28/08/2026: nessuna classificazione automatica) | Tutto entra `da_classificare` col solo match deterministico |
| Documenti e allegati | Metadati in store, byte dietro `storageKey`+SHA-256 | `dataBase64` solo legacy/fallback; upload cap 10 MB, allowlist MIME |
| Backup | Snapshot Drive notturno che rilegge i byte dallo storage | Fallisce visibilmente su oggetto mancante/corrotto |

## Piattaforma

| Fatto | Fonte autorevole | Deroghe e note |
|---|---|---|
| Eventi business | `business_events` (dedupe key), consumer con stato proprio | Pubblicazione attiva solo con `eventBusMode≠off` per sede |
| Notifiche | `notifications` + proiettore; campanella dietro `notificationMode` | Legacy store `notifiche_read` finché il confronto non è chiuso |
| Casi operativi (Centro Azioni) | `azioni_operative` (chiave `(sede_id, canonical_key)`) + segnali deterministici | Modalità da `ACTION_CENTER_MODE` (env), default `shadow` |
| Promemoria personali | `promemoria` + worker | Visibili solo al richiedente |
| AI | **Nessuna**: rimossa il 28/08/2026 | Mai fonte primaria di un fatto business. Le colonne `tars_*` su `comunicazioni` e `fic_fatture.tarsAnalizzata` restano senza consumatore, per il futuro agente |

## Regole di conflitto

1. Il comportamento verificato del server prevale su PRD, handoff e UI.
2. Una correzione umana esplicita prevale su qualsiasi match o sync automatico
   e non viene riscritta.
3. Una risposta incompleta di un'integrazione non cancella né storna dati
   esistenti (snapshot non distruttivi).
4. Quando due fonti autorevoli confliggono davvero, il conflitto va esposto
   (coda, badge, avviso), mai risolto in silenzio scegliendo la più plausibile.
