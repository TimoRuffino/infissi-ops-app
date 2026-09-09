# WS5 — Il collegamento delle integrazioni in self-service (spec tecnica)

**Data:** 08/09/2026 · **Stato:** design approvato in chat a sezioni dalla direzione (quattro scelte + quattro sezioni); nessuna implementazione autorizzata da questa spec · **Spec madre:** `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md` (§3.3, §9, §16.4, §17 punto 5) · **Precedenti:** WS1 `2026-09-06-ws1-fondazione-tenant-design.md` e WS2 `2026-09-07-ws2-porta-aperta-design.md` (su `main` dall'08/09/2026), WS3 `2026-09-08-ws3-file-integrazioni-design.md` e WS4 `2026-09-08-ws4-abbonamenti-design.md` (implementati, non su `main`) · **Base:** `feature/ws4-abbonamenti` (contiene WS3).

> Riferimenti di riga sul codice **post-WS3** (`feature/ws4-abbonamenti`).
> Dove WS3 non ha toccato il file, valgono anche su `main`.

> Il WS3 ha reso file, backup, credenziali e guasti proprietà di ciascuna
> azienda. Restava scoperto il gesto che viene prima di tutti: **collegare**.
> Oggi sei integrazioni si collegano in sei modi diversi, due chiedono al
> cliente di aprire un account sviluppatore, e nessuna sa dire cosa si è
> rotto. Con la vendita a terzi non c'è più nessuno da chiamare: il WS5 fa
> sì che un titolare, da solo, di sera, colleghi tutto senza sapere che cosa
> sia un App ID.

## 1. Obiettivo, perimetro, non-obiettivi

**Obiettivo.** Un'azienda che si attiva collega le proprie integrazioni **da
sola, senza assistenza e senza credenziali di sviluppatore**. Ogni
integrazione risponde alle stesse tre domande con le stesse parole: a cosa
sono collegata, come mi collego, cosa si è rotto e cosa devo fare.

**Entra nel WS5.**
- Un contratto unico per «integrazione collegabile» e sei adattatori (§3, §4).
- Le due modalità — attivazione guidata e impostazioni — sugli stessi
  componenti, con lo stato del percorso salvato per azienda (§5).
- Credenziali e callback **di piattaforma**: l'app è di Wyndoor, l'account è
  del cliente (§6).
- WhatsApp: le tre credenziali dell'app Meta passano dallo store per sede a
  un ripiego di piattaforma; l'override per sede resta come via di fuga (§4.5).
- Calendari Google in **entrata** via OAuth, accanto alle sorgenti iCal
  esistenti che restano valide (§4.6).
- I due spigoli di Fatture in Cloud: azienda non scelta e callback canonico
  (§4.1).
- `verifica()` come prova viva contro il fornitore, distinta da `stato()` (§3.2).

**Resta fuori.**
- **Calendario in scrittura** (CRM → Google): approvato dalla direzione ma
  con una fisica propria — precedenza sulle modifiche a mano, cancellazioni,
  doppioni al riavvio. Spec e piano suoi (§14).
- **Email OAuth**: decisione 3. L'IMAP resta host, porta, utente e password
  come oggi (`server/comunicazioni/caselle.ts`). Cade con essa la verifica
  Google «restricted» e il security assessment annuale a pagamento.
- Inviti utenti, reset password, marchio e dati del rivenditore: sono l'altra
  metà del WS5 della spec madre, e restano a una spec loro.
- Pannello Platform Admin (WS6), export aziendale, self-service pubblico di
  registrazione.
- Ogni pulizia opportunistica dentro i file riscritti da WS3 (§7.2).

**Non-obiettivi espliciti.**
- Non si cambia il meccanismo di nessuna integrazione che già funziona: gli
  adattatori **avvolgono**, non riscrivono.
- Non si allarga né si restringe nessun permesso esistente: ogni adattatore
  dichiara la guardia che il suo router applica già (§3.3).
- Non si tocca `server/tenants/**`, `server/_core/persistence.ts`,
  `fileStorage.ts`, `driveBackup.ts`, `rotteAnonime.ts`.

## 2. Decisioni prese in chat (08/09/2026)

| # | Tema | Decisione | Alternative scartate |
|---|---|---|---|
| 1 | Chi collega | **Il cliente da solo, zero assistenza.** Alza l'asticella su tutto e rende obbligatorie le pratiche di §8 | onboarding assistito; fatto da noi con le credenziali del cliente; livelli diversi per integrazione |
| 2 | Proprietà delle app | **App di piattaforma ovunque esista OAuth.** L'app chiede, l'account del cliente concede. Il cliente non apre mai un'area sviluppatori | un'app per cliente (stato attuale di WhatsApp) |
| 3 | Email | **IMAP com'è ora**: host, porta, utente, password | OAuth Google/Microsoft; indirizzo Wyndoor con regola di inoltro; autodiscovery del server dal dominio |
| 4 | Calendari | **OAuth con l'app di piattaforma.** L'entrata entra in questa spec; l'uscita verso Google è scrittura, e la porta la decisione 5 | restare sul copia-incolla dell'indirizzo iCal segreto; rimandare a dopo il pilota |
| 5 | Calendario in scrittura | **Approvato, ma spec propria**: è una funzione nuova, non una semplificazione del collegamento | includerlo qui |
| 6 | FiC, permessi di scrittura | **Lettura all'attivazione, scrittura al primo bisogno e spiegata** nel momento in cui il motivo è ovvio | scrittura subito all'attivazione; far scegliere al cliente |
| 7 | Approccio | **A — cornice unica, sei adattatori** | solo le pratiche esterne con codice al minimo; partire dal percorso guidato |
| 8 | Confine con WS3 | **Gli adattatori avvolgono, non riscrivono**; PRD e handoff scritti per ultimi | rifattorizzare i file toccati da WS3 approfittando del passaggio |

## 3. Il contratto

### 3.1 Non è inventato, è estratto

Due integrazioni su sei parlano già lo stesso contratto, con gli stessi nomi:

```
fattureInCloud:  status   oauthStartUrl   disconnectOAuth
backup:          status   oauthStartUrl   disconnectOAuth
```

Il WS5 rende esplicito quell'accordo e lo estende alle altre quattro.

```
server/integrazioni/            ← directory nuova: conflitto zero per costruzione
  contratto.ts                  tipi
  registro.ts                   le sei, in ordine di attivazione
  adattatori/
    fic.ts  backup.ts  email.ts  agente.ts  whatsapp.ts  calendario.ts
  attivazione.ts                stato del percorso guidato, per azienda
  router.ts                     integrazioni.*
```

### 3.2 I tipi

```ts
export type Chiave =
  | "fic" | "whatsapp" | "email" | "calendario" | "backup" | "agente";

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
  /** Cosa è collegato, col suo nome: «+39 0187 872687», «Ruffino Group Srl».
   *  Uno stato che non nomina la cosa collegata non è uno stato. */
  soggetto: string | null;
  verificatoIl: Date | null;
  problema: Problema | null;
};

export type Avvio =
  | { tipo: "url"; url: string }         // OAuth: FiC, Drive, calendario
  | { tipo: "popup"; configId: string }  // Embedded Signup WhatsApp
  | { tipo: "modulo" };                  // IMAP: il modulo vive nel client

export type Adattatore = {
  chiave: Chiave;
  ambito: "sede" | "azienda";
  /** La guardia che il router sottostante applica già. Non si allarga. */
  permesso: "direzione" | "utente";

  /** Sola lettura, **nessuna chiamata esterna**: regge il caricamento pagina. */
  stato(ctx: Ctx): Promise<Stato>;
  /** Prova viva: una chiamata vera al fornitore. Costa, quindi non è `stato`. */
  verifica(ctx: Ctx): Promise<Problema | null>;

  avvia?(ctx: Ctx, opz?: unknown): Promise<Avvio>;
  completa?(ctx: Ctx, esito: unknown): Promise<void>;
  scollega?(ctx: Ctx): Promise<void>;
};
```

**La distinzione che regge tutto:** `stato()` legge quel che il server già sa
e non chiama nessuno — la pagina delle impostazioni la invoca sei volte a
ogni caricamento. `verifica()` interroga il fornitore per davvero, su
richiesta, ed è l'unica che sa dire la verità il giorno dopo una revoca. Un
pannello che dichiara «collegato» perché esiste un token salvato mente
esattamente il giorno in cui il cliente scrive.

### 3.3 Il router

```
integrazioni.elenco()             → Stato[]         nessuna chiamata esterna
integrazioni.verifica(chiave)     → Problema | null  prova viva, su richiesta
integrazioni.avvia(chiave, opz)   → Avvio
integrazioni.completa(chiave, esito)
integrazioni.scollega(chiave)
integrazioni.attivazione()        → stato del percorso
integrazioni.salta(chiave)
```

Ogni procedura applica la guardia **dell'adattatore**, non una guardia unica
del router: oggi FiC, backup e mail sono `adminProcedure`, i calendari sono
`protectedProcedure`. La cornice conserva la differenza — appiattirla sarebbe
allargare o restringere permessi di nascosto, e §16.2 della spec madre lo
vieta. Chiave sconosciuta → `NOT_FOUND`.

`verifica()` non gira mai in un giro su tutti i tenant: è un'azione della
persona che sta guardando la sua azienda. Esito in cache breve (60 s) per non
trasformare un doppio click in due chiamate al fornitore.

## 4. I sei adattatori

Quattro su sei sono carta da pacchi: non spostano logica, la vestono uguale.

### 4.1 `fic` — avvolge, e leva due spigoli

Il collegamento di oggi è già un click: `oauthStartUrl` emette lo `state` in
`oauth_state` con azienda, sede e utente (`fattureInCloud.ts:192-204`), il
cliente autorizza sul **suo** Fatture in Cloud, il callback ricava il tenant
dallo `state`, i token si salvano cifrati e il refresh è automatico. **Il
cliente non apre mai l'area sviluppatori di FiC**: `FIC_OAUTH_CLIENT_ID` e
`FIC_OAUTH_CLIENT_SECRET` sono della piattaforma.

Due spigoli emergono solo guardandolo come «seconda azienda che si attiva».

**Azienda non scelta.** L'auto-selezione scatta solo con una azienda sola
(`fattureInCloud.ts:358-365`). Con due o più — commercialisti, gruppi —
nessuno sceglie, e `configured: !!(token && cfg.companyId)`
(`fattureInCloud.ts:1172`) resta falso: collegamento riuscito, integrazione
muta. L'adattatore lo dichiara nel `Problema`:

> **causa** «Il tuo account Fatture in Cloud ha 3 aziende. Nessuna è ancora
> collegata a questa sede.» · **rimedio** l'elenco, lì · **azione** `"scegli"`

Vive in `stato()`. `fattureInCloud.ts` non si tocca.

**Callback canonico.** Il redirect URI nasce dall'header `Host`
(`fattureInCloud.ts:1238-1240`), con `FIC_OAUTH_REDIRECT_URI` come scavalco
già presente. Ogni provider OAuth accetta solo redirect **pre-registrati**:
il giorno in cui un'azienda arriva da un host diverso il giro si rompe con un
messaggio di FiC, non nostro. Regola di §6: il callback è della piattaforma,
non dell'host da cui si naviga; l'adattatore rifiuta di offrire «Collega» se
la variabile non è impostata, invece di lasciarlo scoprire a metà giro.

**Permessi di scrittura (decisione 6).** L'attivazione chiede
`FIC_SCOPES_LETTURA`. La prima volta che il cliente emette una fattura dal
CRM, il flusso stesso dichiara che serve un permesso in più e lo fa concedere
in un click chiamando `avvia({ scrittura: true })` — che esiste già. Nessun
errore muto settimane dopo, minimo privilegio conservato.

**Modalità `manual`.** Il token generato a mano dentro FiC (`FicAuthMode`)
è già classificato come ripiego in `CLAUDE.md`: qui si declassa a
diagnostica, perché è l'unica strada che riporterebbe il cliente dentro le
impostazioni di FiC.

### 4.2 `backup` — avvolge

`status`, `oauthStartUrl`, `disconnectOAuth` esistono. `verifica()` scrive e
rilegge un marcatore nella cartella Drive dell'azienda. Dopo il WS3 il backup
è **per azienda**, non «unico per l'installazione» come dice ancora
l'intestazione della pagina: `ambito: "azienda"` registra il fatto di WS3,
non lo cambia. `driveBackup.ts` non si tocca.

### 4.3 `email` — avvolge, meccanismo invariato

Il modulo resta host, porta, utente, password (decisione 3). `stato()` elenca
le caselle e il loro ultimo esito; `verifica()` fa un login IMAP vero e
traduce il fallimento in `Problema` — credenziali rifiutate, host
irraggiungibile, TLS — invece di lasciare l'errore grezzo della libreria.
`avvia()` → `{ tipo: "modulo" }`.

### 4.4 `agente` — non si collega

Non ha `avvia` né `scollega`. `stato()` dichiara «incluso nell'abbonamento» e
legge il budget di WS4 **in sola lettura**; `verifica()` conferma che il
provider risponde. È l'adattatore che rende onesta la cornice: un'integrazione
che non si collega deve poterlo dire, non sparire.

### 4.5 `whatsapp` — il pezzo difficile è già scritto

L'Embedded Signup c'è tutto, nella variante con coexistence: `FB.login` con
`config_id` (`client/src/components/WhatsAppCard.tsx:222-250`), scambio del
code per un business token che non scade (`whatsapp.ts:343`), sottoscrizione
della WABA (`whatsapp.ts:366`), lettura dei numeri, e sincronizzazione di
contatti e storico avviata da sola perché Meta concede 24 ore
(`whatsapp.ts:400`). WS3 ha già risolto l'instradamento multi-azienda del
webhook per numero (`rotteAnonime.ts:84-115`).

L'unico ostacolo è **la proprietà delle tre credenziali**. `AppWhatsApp`
(`whatsapp.ts:155-180`) tiene App ID, Configuration ID e App secret per sede,
e l'interfaccia dice al cliente dove trovarli su `developers.facebook.com`
(`WhatsAppCard.tsx:933`). Cioè: un flusso da un click con davanti «apriti un
account sviluppatore Meta».

Il commento che difende il per-sede — «obbligare due sedi a condividere app
id, config id e app secret significherebbe obbligarle a condividere il
portfolio» — non regge nel modello **Tech Provider**: l'app non possiede il
portfolio, lo **onboarda**. Una sola app fa l'Embedded Signup di quanti
portfolio si vuole. Ciò che resta legittimamente per sede è `ConfigWhatsApp`
— numero, WABA, token — e non si tocca.

Il lavoro:
- `getAppWhatsApp()` prende un ripiego di piattaforma da `WHATSAPP_APP_ID`,
  `WHATSAPP_CONFIG_ID`, `WHATSAPP_APP_SECRET`; il record per sede resta come
  **override**, ed è la via di fuga se un giorno l'app di piattaforma viene
  limitata (§12).
- I tre campi escono dalla scheda del cliente e restano dietro un pannello
  avanzato.
- Il verify token diventa uno per installazione, configurato una volta su
  Meta a livello di app. `verifyTokenValido` accetta già il token di
  qualunque app: si semplifica invece di complicarsi.
- Il fallback manuale — numero, phone number ID, WABA ID, token, app secret
  digitati a mano (`WhatsAppCard.tsx:939-972`) — si declassa a diagnostica.
- **`rotteAnonime.ts` non si tocca.** Con un segreto solo il ciclo che prova
  il segreto di ogni azienda diventa inutile, ma funziona (trova il segreto
  di piattaforma al primo giro) ed è un file riscritto da WS3: la pulizia
  è debito dichiarato, non lavoro di questa spec.

### 4.6 `calendario` — l'unico davvero nuovo

Solo **entrata** in questa spec. Oggi si incolla l'indirizzo iCal segreto di
ogni calendario, uno per uno (`server/routers/externalCalendars.ts`). Con
OAuth di piattaforma: il cliente autorizza Google e spunta i calendari da un
elenco.

Le sorgenti iCal esistenti **restano valide e non si rompono**: l'OAuth
aggiunge un tipo di sorgente accanto, non sostituisce lo store. Chi ha già
incollato indirizzi continua a funzionare senza rifare niente.

Serve un nuovo tipo di `state` OAuth: `'gcal'` (§7.1).

L'**uscita** resta il feed iCal sottoscrivibile di `calendarSync.ts`, che
funziona e non ha bisogno di nessun consenso. La scrittura in Google è §14.

## 5. Le due modalità

Gli stessi componenti, due modi — non due schermate.

- **`modo="attivazione"`** — ordinata, ripartibile, stato salvato
  progressivamente come chiede §9 della spec madre.
- **`modo="impostazioni"`** — libera: è la pagina di oggi.

L'ordine segue il bisogno: **FiC** (i soldi) → **canali** (email, WhatsApp) →
**calendario** → **backup**. L'agente si dichiara e basta.

Due vincoli della spec madre, alla lettera:

> Il CRM può essere utilizzato prima di aver collegato tutte le integrazioni.
> Un errore di una singola integrazione non annulla il tenant.

Quindi: **«salta» sempre disponibile**, nessun passo bloccante, nessuna
integrazione che fallendo lascia il tenant a metà. Chi si attiva di venerdì
sera entra nel CRM senza aver collegato niente.

Lo stato del percorso vive in un `persistedStore` per tenant
(`onboarding_integrazioni`: per chiave, `saltata | collegata | in_corso` e
quando) — **non** in `server/tenants/**`, che è zona vietata (§7.2). Il
confine con WS3 regge anche qui.

Lato client, `client/src/integrazioni/` con una `SchedaIntegrazione` sola e
un hook `useIntegrazione`. `client/src/pages/Integrazioni.tsx` scende da 1711
righe a composizione.

## 6. Credenziali e callback di piattaforma

**La regola.** L'app è di Wyndoor; l'account è del cliente. L'app chiede, il
cliente concede, il token è suo e i dati restano nel suo tenant. Il cliente
non apre **mai** un'area sviluppatori — né FiC, né Google, né Meta.

| | oggi | dopo il WS5 |
|---|---|---|
| Fatture in Cloud | `FIC_OAUTH_CLIENT_ID/SECRET` di piattaforma | invariato |
| Google (Drive, calendario) | `GOOGLE_OAUTH_CLIENT_ID/SECRET` di piattaforma | invariato, + scope calendario |
| WhatsApp | **App ID/Config ID/App secret del cliente, per sede** | `WHATSAPP_*` di piattaforma, override per sede conservato |
| Email | nessuna app: IMAP | invariato (decisione 3) |
| Agente | `OPENAI_API_KEY` di piattaforma | invariato |

**Callback canonici.** `FIC_OAUTH_REDIRECT_URI` e l'equivalente Google sono
**obbligatori in produzione**, non facoltativi: il callback appartiene alla
piattaforma e non all'host da cui il cliente naviga. Un adattatore la cui
variabile manca non offre «Collega» e lo dice come `Problema` con `azione:
"assistenza"`. Guardia strutturale nei test (§10).

**Residuo da rimuovere prima delle pratiche.** `driveBackup.ts:380` conserva
un ramo service-account con scope `drive` pieno, già fuori uso per decisione
precedente (Google One, non Workspace). Uno scope «restricted» dichiarato in
una richiesta di verifica farebbe scattare la fascia più costosa. Va tolto in
fase 0 — ed è l'**unica** eccezione ammessa al divieto di toccare
`driveBackup.ts`, da concordare con chi tiene WS3.

## 7. Confine con WS3 e WS4

Verificato sui file. WS3 sono 83 file, WS4 ne aggiunge 13, e **nessuno dei
due tocca un file `client/`**. Dei sei bersagli primari del WS5, ne toccano
zero: `whatsapp.ts`, `WhatsAppCard.tsx`, `Integrazioni.tsx`,
`CaselleEmailCard.tsx`, `calendarSync.ts`, `_core/oauth.ts`.

### 7.1 L'unico accoppiamento: `oauth_state`

WS3 crea la tabella con un vincolo chiuso (`server/tenants/repository.ts:543`):

```sql
tipo TEXT NOT NULL CHECK (tipo IN ('fic','gdrive'))
```

L'OAuth calendario ha bisogno di `'gcal'`. La DDL è `CREATE TABLE IF NOT
EXISTS`: una volta creata in produzione, **rieseguirla non aggiorna il
CHECK**.

- `'gcal'` aggiunto **in WS3, prima del merge**: una parola, nessuna
  migrazione mai. Stessa riga in `TipoStateOAuth` (`server/tenants/tipi.ts:150`).
- `'gcal'` aggiunto dopo: WS5 si porta un `ALTER TABLE … DROP CONSTRAINT …
  ADD CONSTRAINT` su una tabella del control plane, per sempre.

**È l'unica cosa che il WS5 chiede a WS3**, e va chiesta finché la PR è
aperta.

### 7.2 Zona vietata

`server/tenants/**`, `server/_core/persistence.ts`, `fileStorage.ts`,
`driveBackup.ts` (salvo §6), `rotteAnonime.ts`. I file riscritti da WS3 che
il WS5 usa — `fattureInCloud.ts`, `backup.ts`, `externalCalendars.ts` — si
**chiamano**, non si modificano.

### 7.3 Documenti

`handoff.md`, `CLAUDE.md`, il PRD e `docs/runbooks/multi-azienda.md` sono
modificati sia da WS3 sia da WS4: il conflitto è certo, non probabile — è la
collisione PRD 5.33–5.36 già risolta a mano il 05/09. **Nessun numero di
sezione PRD viene rivendicato finché WS3 e WS4 non sono atterrati**: la spec
vive nel suo file nuovo, PRD e handoff sono l'ultimo task del piano.

### 7.4 Base

WS5 parte da `feature/ws4-abbonamenti`. Tenendo la modifica dentro i file che
WS3 e WS4 non toccano, il rebase resta banale **qualunque sia l'ordine di
merge**: non ci si lega all'ordine.

## 8. Pratiche esterne — fase 0

Non dipendono da noi e hanno i tempi più lunghi del lavoro. Vanno aperte
prima del codice, non dopo.

**Meta (WhatsApp).** Business Verification della società; app in Live con
privacy policy pubblica e icona; **App Review** per l'accesso avanzato a
`whatsapp_business_management` e `whatsapp_business_messaging` — senza
«advanced» l'app tocca solo chi ha un ruolo nell'app, cioè nessun cliente
vero; configurazione Facebook Login for Business, che genera il `config_id`
già usato dal popup; webhook a livello di app, un URL e un verify token per
tutte le aziende. **Tech Provider, non Solution Partner**: ogni cliente
aggancia il proprio metodo di pagamento alla propria WABA e Meta fattura lui
le conversazioni — coerente con §3.3 della spec madre.

**Google (calendario).** Consent screen in produzione e verifica per scope
sensibili. Gratuita, ma con i tempi di Google: finché non passa, l'app resta
in «testing» con il tetto dei 100 utenti e token che scadono in sette giorni.
Nessun security assessment a pagamento, perché la decisione 3 tiene la posta
fuori dagli scope «restricted».

Meta e Google cambiano spesso le carte: questi passaggi sono da **confermare
in console** mentre la pratica avanza, non da dare per fermi in una spec.

## 9. Errori

| Situazione | Esito |
|---|---|
| callback di piattaforma non configurato | «Collega» non offerto; `Problema` con `azione: "assistenza"`; log; nessun giro OAuth avviato |
| `state` scaduto o sconosciuto | comportamento di WS3 §5: redirect con errore, log, niente salvato |
| account FiC con più aziende, nessuna scelta | `collegato: true`, `Problema` con `azione: "scegli"` e l'elenco lì |
| token revocato dal cliente presso il fornitore | `stato()` resta ottimista; `verifica()` dà `Problema` con `azione: "ricollega"` |
| login IMAP rifiutato | `Problema` tradotto (credenziali, host, TLS), mai l'errore grezzo della libreria |
| finestra 24 h della coexistence scaduta | `Problema`: il numero va offboardato e rifatto; detto in italiano, non come errore Meta |
| numero già collegato all'API altrove | `Problema` dedicato: la coexistence copre chi arriva dall'app del telefono, non chi è già su un'altra piattaforma |
| chiave di integrazione sconosciuta | `NOT_FOUND` |
| adattatore di un'altra sede o azienda | `NOT_FOUND`, mai un id che permetta di enumerare |
| un'integrazione fallisce durante l'attivazione | il passo resta da completare, il tenant non si annulla, il CRM si usa lo stesso |
| `verifica()` chiamata a raffica | esito in cache 60 s; nessuna chiamata al fornitore per il secondo click |

## 10. Test

- **Conformità del contratto**: per ogni adattatore del registro, `stato()`
  non effettua **nessuna** chiamata di rete (fetch simulato, asserzione che
  non è stato invocato). È la garanzia che la pagina non paghi sei chiamate
  esterne a ogni caricamento.
- **Guardie conservate**: ogni adattatore dichiara il permesso del router che
  avvolge; test negativo per ruolo su ciascuno. Guardia strutturale: nessuna
  procedura di `integrazioni/router.ts` applica una guardia diversa da quella
  dell'adattatore.
- **Callback canonico**: senza `FIC_OAUTH_REDIRECT_URI` (e l'equivalente
  Google), `avvia()` rifiuta e non costruisce nessun URL.
- **FiC multi-azienda**: due aziende nell'account → `collegato` con `azione:
  "scegli"`; una sola → selezionata da sola, nessun problema.
- **WhatsApp piattaforma**: con le tre variabili impostate e lo store per
  sede vuoto, `appPubblica().pronta` è vero; con l'override per sede
  valorizzato, vince l'override.
- **Calendario**: `'gcal'` accettato da `oauth_state`; una sorgente iCal
  preesistente continua a funzionare dopo l'introduzione dell'OAuth.
- **Attivazione**: percorso ripartibile dopo interruzione; «salta»
  disponibile a ogni passo; il fallimento di un'integrazione non cambia lo
  stato del tenant.
- **Confine**: un adattatore invocato su una sede di un'altra azienda dà
  `NOT_FOUND` (test cross-tenant come quelli di WS2/WS3).
- **Verifica in cache**: due chiamate ravvicinate → una sola chiamata al
  fornitore.

## 11. Rilascio in fasi

| Fase | Contenuto | Dipende da |
|---|---|---|
| **0** | Pratiche Meta e Google; `'gcal'` in WS3; variabili di piattaforma fissate; rimozione del ramo service-account di §6 | direzione |
| **1** | Contratto, registro, router; adattatori `fic`, `backup`, `email`, `agente`; `SchedaIntegrazione` e `useIntegrazione`; `Integrazioni.tsx` ricomposta; i due spigoli FiC | niente |
| **2** | Modalità attivazione, stato del percorso per azienda, «salta» | fase 1 |
| **3** | WhatsApp: ripiego di piattaforma, campi fuori dalla scheda, fallback declassato | Meta (fase 0) |
| **4** | Calendario in entrata: OAuth, elenco, sorgente accanto all'iCal | Google (fase 0), `'gcal'` |
| **5** | Calendario in scrittura | spec propria (§14) |

Le fasi 1 e 2 consegnano valore **prima** che Meta e Google rispondano: se le
pratiche vanno lunghe, il lavoro non è fermo.

Nessuna fase è distruttiva: le sorgenti iCal restano, le caselle IMAP
restano, l'override WhatsApp per sede resta. Il ritorno allo stato precedente
è togliere le variabili di piattaforma.

## 12. Rischi e limiti noti

- **Tempi Meta e Google imprevedibili.** Mitigazione: fasi 1 e 2 non ne
  dipendono.
- **Un'app sola, un raggio d'esplosione solo.** Se Meta limita l'app o Google
  sospende il client, l'integrazione cade per **tutti** i clienti insieme. È
  il modello standard di ogni SaaS, ma va dichiarato. Via di fuga:
  l'override per sede di WhatsApp — motivo per cui non si cancella.
- **`verifica()` costa chiamate esterne.** Su richiesta, con cache, mai in un
  giro su tutti i tenant.
- **Quote per app, non per cliente**, su alcune API dei fornitori: da
  misurare durante il pilota, non da stimare qui.
- **Conflitti sui documenti** (§7.3): mitigati dall'ordine, non eliminati.
- **La fase 5 ha incognite di dominio** che questa spec non risolve.
- Una prova locale senza `DATABASE_URL` non vale come verifica di `oauth_state`
  né delle query del control plane.

## 13. File toccati

**Nuovi.** `server/integrazioni/` (contratto, registro, sei adattatori,
attivazione, router, test); `client/src/integrazioni/` (`SchedaIntegrazione`,
`useIntegrazione`, modalità attivazione).

**Modificati.** `client/src/pages/Integrazioni.tsx` (ricomposta);
`client/src/components/WhatsAppCard.tsx` (campi app fuori dalla scheda
cliente, fallback a diagnostica); `client/src/components/CaselleEmailCard.tsx`
(dentro la cornice, meccanismo invariato); `server/comunicazioni/whatsapp.ts`
(ripiego di piattaforma in `getAppWhatsApp`); `server/routers.ts`
(registrazione del router); `server/_core/env.ts` (variabili nuove).

**Chiesto a WS3.** `'gcal'` in `server/tenants/repository.ts:543` e
`server/tenants/tipi.ts:150`.

**Non toccati, per regola.** `server/tenants/**`, `server/_core/persistence.ts`,
`fileStorage.ts`, `driveBackup.ts` (salvo §6), `rotteAnonime.ts`,
`server/routers/fattureInCloud.ts`, `backup.ts`, `externalCalendars.ts`.

**Ultimi, dopo l'atterraggio di WS3 e WS4.** PRD, `handoff.md`,
`docs/runbooks/multi-azienda.md`.

## 14. Cosa viene dopo

Il piano scompone questa spec in task con test; il codice parte dopo il
piano.

Due lavori nascono da qui e non ci stanno dentro:

1. **Calendario in scrittura** (decisione 5): spec propria. Precedenza fra
   CRM e modifiche a mano, cancellazioni, doppioni al riavvio, e che cosa
   succede quando il cliente scollega.
2. **L'altra metà del WS5 della spec madre**: inviti, reset password, marchio
   e dati del rivenditore nei documenti.

Debito dichiarato, da fare dopo il merge di WS3: semplificare
`mittenteWebhookWhatsApp`, che con un segreto di piattaforma non ha più
bisogno di provare il segreto di ogni azienda.
