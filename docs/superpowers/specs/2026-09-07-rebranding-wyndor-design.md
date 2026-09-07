# Rebranding Wyndor — design approvato

> Stato: design approvato a sezioni con la direzione il 07/09/2026. Questo
> documento fissa il marchio e il perimetro del rebranding. Il piano di
> implementazione è un documento separato.
>
> Contesto: `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md`
> §18-bis stabilisce che il prodotto si chiama Wyndor e che «il rebranding
> dell'applicazione (interfaccia, documenti, dominio, repository) è un lavoro
> separato». Questo è quel lavoro. Quella spec vive sul ramo
> `feature/ws1-fondazione-tenant` e non è ancora su `main`: finché non lo è,
> il riferimento va letto lì.

## 1. Sintesi

Il gestionale smette di chiamarsi «Ruffino Flow» e diventa **Wyndor**, con un
marchio proprio. Il cambio riguarda tre strati: il marchio visivo, le stringhe
dell'applicazione, la documentazione viva.

La separazione che regge tutto: **Wyndor è il prodotto, Ruffino Group è il
primo cliente**. Dentro l'applicazione si vede Wyndor. Sui documenti che
arrivano al cliente finale si vede il marchio del rivenditore — oggi Ruffino
Group, domani chi compra la piattaforma. È la regola già scritta in §8 del
design SaaS, e questo rebranding è la prima volta che viene applicata.

## 2. Decisioni prese (07/09/2026)

| Decisione | Scelta |
| --- | --- |
| Perimetro | Applicazione, superfici esterne e documentazione viva. Fuori: repository, `package.json`, dominio, infrastruttura. |
| Marchio nell'app | Il marchio Ruffino Group esce dalla barra laterale e dall'accesso, sostituito da Wyndor. |
| Direzione del marchio | Due ante in prospettiva: anta fissa e anta in apertura. |
| Finitura | Angolo smussato, raggio 4 unità su 100. |
| Colori | Borgogna esistente come base, **ambra** come accento nuovo del solo marchio. |
| Icona iOS | Si aggiunge il PNG 180×180 mancante, generato da script. |

## 3. Il marchio

### 3.1 Che cosa rappresenta

Due ante viste in prospettiva. A sinistra l'anta fissa, ferma e verticale. A
destra l'anta in apertura, il cui bordo libero è più alto del bordo sul
cardine: è la deformazione prospettica di un pannello che ruota verso chi
guarda. Fra le due, il varco.

Il nome Wyndor tiene dentro *window* e *door*; il marchio dice la stessa cosa
senza disegnare una finestra, che è il segno che usano quasi tutti nel settore.

### 3.2 Geometria canonica

Sistema di riferimento `viewBox="0 0 100 100"`. Ingombro del marchio:
x da 12 a 88, y da 8 a 92. Raggio di raccordo: 4.

- **Anta fissa** — `<rect x="12" y="16" width="27" height="68" rx="4"/>`
- **Anta in apertura** — quadrilatero di vertici (48,8) (88,22) (88,78)
  (48,92), con i quattro angoli raccordati a raggio 4. Il tracciato espanso è
  nell'Appendice A.

Le coordinate sono normative. Chi ridisegna il marchio parte da queste, non da
una misurazione a occhio di un file esportato.

### 3.3 Colori

| Ruolo | Chiaro | Scuro |
| --- | --- | --- |
| Anta fissa | `#d92f55` (borgogna, `--primary`) | `#ff6b79` (`--primary` scuro) |
| Anta in apertura | `#e8a33d` (ambra) | `#f0b657` (ambra schiarita) |

L'ambra è un token nuovo, `--brand-accent`, e appartiene **al solo marchio**.
Non entra nella scala semantica: non indica stati, non colora componenti, non
si usa per avvisi. Serve a distinguere il prodotto dall'interfaccia, che è
esattamente la ragione per cui la direzione l'ha chiesta.

Il valore è stato scelto per non collidere con i token già in uso: `#e8a33d`
resta distante sia da `--color-warning` (`#8b5700`) sia da
`--color-accent-brand` (`#ef7046`).

### 3.4 Varianti previste

- **Lockup orizzontale** — segno più parola, per la barra laterale e le
  intestazioni.
- **Lockup impilato** — segno sopra, parola sotto, per l'accesso e i documenti.
- **Solo segno** — favicon, notifica push, icona applicazione, barra laterale
  compressa.
- **Una tinta sola** — entrambe le ante nello stesso colore, separate dal solo
  varco. Serve per timbri, stampa in bianco e nero e fondi pieni. Il marchio
  regge perché il varco è una forma, non un colore.

La parola «Wyndor» si compone in Plus Jakarta Sans 600, crenatura −0.03em, con
la maiuscola iniziale. Non si scrive mai tutto maiuscolo né tutto minuscolo.

### 3.5 Che cosa non si fa al marchio

- Non si applicano filtri CSS. Oggi `.sidebar-logo` fa
  `filter: brightness(0) invert(1)`: appiattisce il logo a silhouette e
  distrugge il colore. Sul marchio Wyndor cancellerebbe l'ambra.
- Non si ruota, non si inclina, non si allunga su un asse solo.
- Non si separano le due ante né si cambia l'ampiezza del varco.
- Sotto i 16 px non si usa il lockup: solo il segno.

## 4. Il marchio nel codice

### 4.1 Componente, non immagine

Oggi il logo è un `<img src="/logo.svg">` in tre punti — `NavigationSidebar`,
`LegacyDashboardLayout`, `LoginPage` — e un filtro CSS lo forza a bianco o a
nero secondo il tema. Un marchio a due colori non sopravvive a quel filtro.

Nascono quindi:

- `client/src/components/brand/WyndorMark.tsx` — il solo segno. L'anta fissa
  usa `currentColor`, l'anta in apertura `var(--brand-accent)`. Il colore lo
  decide chi lo ospita, il tema lo governa senza filtri.
- `client/src/components/brand/WyndorLockup.tsx` — segno più parola, con
  orientamento orizzontale o impilato.

`.sidebar-logo` viene eliminato da `client/src/index.css` insieme alla sua
variante `[data-ui-system="modular-control"]`.

Nella barra laterale compressa oggi compare la lettera «R» dentro un riquadro.
Diventa il segno Wyndor: un marchio esiste proprio per non dover ripiegare su
un'iniziale.

### 4.2 File statici

Restano immagini soltanto le superfici che escono dal DOM dell'applicazione:

- `client/public/favicon.svg` — solo segno, colori fissi,
  `viewBox="9 5 82 90"`: stretto sull'ingombro, perché a 16 px ogni unità di
  margine è massa sottratta al segno.
- `client/public/logo.svg` — il segno, colori fissi, con margine.

  Il file conteneva il lockup, ma un lockup in SVG richiede la parola come
  tracciato: `<text>` dipende da un font che fuori dall'applicazione non c'è,
  e convertirlo in curve richiede strumenti tipografici che il repository non
  ha. Dopo la sostituzione della chrome (§4.1) nessun componente consuma più
  questo file: resta perché `server/_core/cacheStatica.test.ts` ne verifica il
  percorso. Il **lockup vettoriale con la parola in tracciati**, quello da
  consegnare a stampatori e partner, è un lavoro dichiarato e non fatto.
- `client/public/apple-touch-icon.png` — 180×180, generato (§9).

I nomi dei file non cambiano: `server/_core/cacheStatica.test.ts` verifica
quei percorsi e non deve essere toccato per un rebranding.

## 5. Il nome nel codice

Nasce `shared/brand.ts`:

```ts
export const PRODOTTO = "Wyndor";
export const PRODOTTO_PAYOFF = "Gestionale commesse infissi";
```

Lo usano le stringhe **costruite a runtime**: intestazioni ICS, titolo delle
notifiche push, testo dentro il backup, fonti citate da Tars. Sono i punti
dove il nome viene concatenato, ed è lì che una costante evita di dimenticare
un'occorrenza.

Nel JSX e nei documenti si scrive «Wyndor» in chiaro. Infilare una costante
dentro una frase di interfaccia peggiora la leggibilità senza aggiungere
sicurezza: quelle stringhe sono già sotto test o sotto gli occhi.

## 6. Perimetro — dentro l'applicazione

| File | Che cosa cambia |
| --- | --- |
| `client/index.html` | `<title>` |
| `client/src/components/layout/NavigationSidebar.tsx` | `aria-label` ×2, `<img>` → `WyndorLockup`, «R» → segno |
| `client/src/components/layout/CompactNavigation.tsx` | `SheetTitle` |
| `client/src/components/layout/MobileTopBar.tsx` | testo del marchio |
| `client/src/components/layout/ContextBar.tsx` | etichetta |
| `client/src/components/layout/LegacyDashboardLayout.tsx` | `<img>` → `WyndorLockup` |
| `client/src/pages/LoginPage.tsx` | `<img>`, titolo, `alt` |
| `client/src/lib/shellPresentation.ts` | sezione di ripiego |
| `client/src/lib/preventivatori.ts` | due messaggi all'utente |
| `client/src/pages/Preventivatori.tsx` | tre stringhe |
| `client/src/pages/ClienteDetail.tsx` | piè di pagina del PDF |
| `client/public/notification-sw.js` | titolo di ripiego della notifica |
| `client/src/index.css` | rimozione `.sidebar-logo`, token `--brand-accent` |

Test da allineare: `client/src/lib/shellPresentation.test.ts`,
`client/src/lib/modularRoutePresentation.test.ts`.

## 7. Perimetro — superfici che escono verso l'esterno

| Superficie | Decisione |
| --- | --- |
| `server/routers/calendarSync.ts` — `PRODID` | `-//Wyndor//Calendario//IT`. Nessun effetto per chi è iscritto. |
| `server/routers/calendarSync.ts` — `X-WR-CALNAME` | «Wyndor — <label>». Chi è già iscritto vedrà il calendario cambiare nome nel proprio client. Visibile, innocuo, da dichiarare. |
| `server/notifications/deliveryWorker.ts` | Titolo della notifica push. |
| `server/_core/driveBackup.ts` — descrizione del backup | Aggiornata. |
| `server/_core/driveBackup.ts` — **cartella `Backup CRM Ruffino`** | **Non si tocca.** |

La cartella Drive merita una spiegazione, perché è l'unico punto dove un
rebranding può fare danno vero. Il nome `"Backup CRM Ruffino"` non è un
marchio: è la chiave con cui `driveCreateFolder` ritrova o crea la cartella.
Cambiandolo, l'applicazione creerebbe una cartella nuova e i backup esistenti
resterebbero in quella vecchia, invisibili al codice. Rinominarla richiede una
migrazione dedicata — leggere la cartella esistente, rinominarla via API,
verificare — e non appartiene a questo lavoro. Resta come debito dichiarato.

Test da allineare: `server/notifications/deliveryWorker.test.ts`.

## 8. Tars

Cambia soltanto `server/tars/prompt/v9.ts`, l'unico importato da
`server/tars/orchestratore.ts:22`, insieme alle cinque costanti di fonte in
`server/tars/strumenti/` (`agenda.ts`, `clienti.ts`, `commesse.ts`,
`letture.ts`, `ricerca.ts`).

Da `v1.ts` a `v8.ts` nessuno li importa: sono il registro delle versioni
passate del prompt. Riscriverli falsificherebbe un archivio. Restano com'erano.

Test da allineare: `server/tars/conversazione/context.test.ts`.

Nota: le fonti citate compaiono nelle risposte di Tars all'utente. Dopo il
rebranding Tars dirà «CRM Wyndor». È il comportamento voluto.

## 9. Icona iOS

`client/index.html` punta oggi `apple-touch-icon` a `favicon.svg`. iOS non
accetta SVG per quell'uso: chi salva l'applicazione sulla schermata home non
vede alcuna icona. Il difetto esiste già, il rebranding è l'occasione per
chiuderlo.

- `sharp` entra come dipendenza di sviluppo.
- `scripts/genera-icone.ts` genera `client/public/apple-touch-icon.png`
  (180×180) dal segno. iOS non gestisce la trasparenza, quindi il fondo è
  pieno: `#fffdfd`, il segno nei colori del tema chiaro, margine del 12% per
  lato.
- `client/index.html` punta al PNG.

Lo script è rieseguibile: se il marchio cambia, il PNG si rigenera invece di
restare indietro.

## 10. Documentazione

**Si aggiorna** — documentazione viva, descrive ciò che il sistema è oggi:

`documento_requisiti_infissi_ops.md` (titolo e occorrenze, più una voce che
data il cambio di nome), `handoff.md`, `CLAUDE.md`, `AGENTS.md`,
`.github/workflows/ci.yml` (commento), `scripts/build-prd-pdf.sh` (titolo del
PDF).

E il **gemello generato del PRD**, `PRD_infissi_ops_v4.pdf`, che è tracciato
in git e va rigenerato con `bash scripts/build-prd-pdf.sh`. È l'artefatto del
PRD più facile da consegnare a qualcuno fuori dall'azienda, quindi è il posto
peggiore dove lasciare il nome vecchio. Nessuna scansione testuale lo vede:
è un binario, e la spazzata di §13 legge solo file di testo. `v2` e `v3`
restano versioni storiche e non si rigenerano.

**Non si tocca** — verbali datati, descrivono ciò che fu deciso allora:

tutto `docs/superpowers/specs/`, tutto `docs/superpowers/plans/`,
`docs/design/`, `docs/tars/architettura-tars-v2.md`. Compreso
`docs/design/master-prompt-ruffino-flow-ui-ux-v3.md`, che ha il vecchio nome
perfino nel titolo del file: è un documento storico e il suo nome è parte del
registro.

Il PRD acquisisce la regola generale: da qui in avanti «Wyndor» nei documenti
nuovi, «Ruffino Flow» resta leggibile in quelli vecchi.

## 11. Ruffino Group: che cosa resta

`Logo_RuffinoGroup.svg` e `Monogramma_RuffinoGroup.svg` restano nel
repository. Non sono residui: diventano il marchio del tenant 1, quello che
comparirà sui documenti verso i clienti finali quando §8 del design SaaS sarà
implementato.

Restano fuori da questo lavoro, perché sono l'azienda e non il prodotto:

- `FIRMA_WHATSAPP` in `client/src/lib/whatsapp.ts`;
- i messaggi «la contattiamo da Ruffino Group» in `CommessaDetail.tsx` e
  `ClienteDetail.tsx`;
- l'intestatario delle fatture;
- il copyright «Ruffino Immobiliare S.R.L.» in `LoginPage.tsx`, che indica chi
  possiede il prodotto e non come si chiama.

Toccarli significherebbe far parlare Wyndor al posto del rivenditore, cioè
l'errore opposto a quello che il rebranding vuole correggere.

## 12. Fuori perimetro — operazioni esterne

Elencate perché siano decise, non perché siano state fatte. Nessuna di queste
viene eseguita in questo lavoro:

- nome del repository (`infissi-ops-app`);
- campo `name` in `package.json`;
- dominio di produzione e certificati;
- variabili d'ambiente e nome del servizio su Railway;
- URL di callback OAuth registrati presso Fatture in Cloud e Google, che
  dipendono dal dominio;
- rinomina della cartella Drive dei backup (§7).

Il dominio in particolare va deciso prima di vendere a un secondo cliente:
l'accesso di un tenant su un dominio che porta il nome del primo cliente è un
problema commerciale, non estetico.

## 13. Verifica

- `pnpm check`, `pnpm test`, `pnpm build` passano.
- I quattro test che citano la vecchia stringa sono allineati.

Sui test nuovi vale un vincolo del progetto: `vitest.config.ts` gira in
ambiente `node`, senza jsdom né testing-library, e raccoglie solo
`server/**`, `shared/**` e `client/src/lib/**/*.test.ts`. Un test che *renda*
`WyndorMark` non è scrivibile senza introdurre un ambiente DOM, e introdurlo
non appartiene a un rebranding. I test nuovi seguono quindi la disciplina già
in uso in `client/src/lib/tokenDiscipline.test.ts`: contratti letti dal
sorgente e dal CSS.

- `--brand-accent` è dichiarato sia nel tema chiaro sia in quello scuro.
- `WyndorMark` colora con `currentColor` e col token, mai con un hex, e porta
  il tracciato canonico dell'Appendice A.
- `.sidebar-logo` e ogni `filter: brightness(0)` sono spariti dal CSS.
- La cartella `"Backup CRM Ruffino"` è ancora nominata così in
  `driveBackup.ts` (guardia contro §7).
- I prompt `v1`–`v4` contengono ancora il vecchio nome, e l'orchestratore
  importa ancora solo `v9` (guardia contro §8).
- Nessuna occorrenza residua di «Ruffino Flow» fuori dall'archivio di §10,
  verificata da una scansione del repository.

Verifica visiva: la pagina di accesso si controlla nel browser a 1440×900 e
390×844, perché è raggiungibile senza sessione. Barra laterale, ContextBar e
MobileTopBar richiedono un utente autenticato: l'agente non digita
credenziali, quindi quel controllo resta a carico di una persona e va
dichiarato non eseguito, non dato per fatto.

## 14. Rischi

| Rischio | Mitigazione |
| --- | --- |
| Il nome del calendario cambia nei client già iscritti | Accettato e dichiarato. Nessun dato si perde, cambia l'etichetta. |
| Rinomina della cartella Drive per distrazione | §7 lo vieta esplicitamente; da controllare in revisione. |
| Il filtro CSS resta e mangia l'ambra | La rimozione di `.sidebar-logo` è parte del lavoro, non un ripulisci-dopo. |
| Riscrittura dei prompt storici v1–v8 | §8 lo vieta; sono archivio. |
| L'ambra si diffonde nell'interfaccia | `--brand-accent` è documentato come token del solo marchio. |

## Appendice A — sorgente canonica del segno

```svg
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="12" y="16" width="27" height="68" rx="4" fill="#d92f55"/>
  <path fill="#e8a33d" d="M53.321 9.862
    L85.321 21.062 A4 4 0 0 1 88 24.838
    L88 75.162 A4 4 0 0 1 85.321 78.938
    L53.321 90.138 A4 4 0 0 1 48 86.362
    L48 13.638 A4 4 0 0 1 53.321 9.862 Z"/>
</svg>
```

I punti di tangenza derivano dai vertici (48,8) (88,22) (88,78) (48,92) con
raggio 4. Agli angoli acuti del bordo libero l'apertura è 70,710° e la
distanza di tangenza 5,638; a quelli ottusi sul cardine l'apertura è 109,290°
e la distanza 2,838. Le corde dei quattro archi misurano 6,525 e 4,629, sotto
il diametro 8: nessun renderer deve riscalare i raggi. Verificato il
07/09/2026.

Nel componente React i due `fill` diventano `currentColor` e
`var(--brand-accent)`.

## Appendice B — inventario delle occorrenze

44 file contengono «Ruffino Flow» al 07/09/2026. Ripartizione:

| Gruppo | File | Destino |
| --- | --- | --- |
| Interfaccia | 11 | §6 |
| Test dell'interfaccia | 2 | §6 |
| Server | 3 | §7 |
| Test del server | 1 | §7 |
| Tars attivo (prompt v9 e 5 strumenti) | 6 | §8 |
| Test di Tars | 1 | §8 |
| Prompt storici (v1–v4) | 4 | non toccati |
| Documenti vivi | 6 | §10 |
| Documenti storici | 10 | non toccati |
| **Totale** | **44** | |

Diciotto file su quarantaquattro restano com'erano: sono archivio, non
documentazione. È il motivo per cui questo rebranding non è un
cerca-e-sostituisci.
