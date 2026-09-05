# Fatturazione guidata (piano 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una pagina «Fatturazione» sotto Economia con le commesse da fatturare (card con passi, importi e «Inizia fatturazione»/«Continua») e una pagina a quattro passi per commessa — Documenti, Contratto, Limiti, Fattura — che riusa i componenti dei piani 1-3; le tab della pagina commessa diventano riassunti in sola lettura con «Apri fatturazione».

**Architecture:** una funzione pura server (`calcolaPassi`) decide lo stato dei passi da contratto, computo, documenti e fatture (CRM e FiC); un router `fatturazioneGuidata` (dietro `limiti`) espone `daFare` e `passi` in una lettura per store; il client aggiunge due pagine, tre componenti e una prop `modalita` ai tre tab esistenti. Nessuna mutation nuova: ogni passo usa i router esistenti.

**Tech Stack:** React 19, Wouter, tRPC 11, zod 4, Tailwind 4 + shadcn (Tabs, Card, Badge, Button), lucide, vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md` (§2 decisioni, §4 modello, §5-6 server/client, §7 permessi, §8 test).

## Global Constraints

- Branch `feature/fatturazione-guidata`; **mai push su `main`** senza decisione esplicita.
- `sedeId` su ogni query; commessa di altra sede → `NOT_FOUND` «Commessa non trovata.», mai `FORBIDDEN`.
- Flag: router dietro `procedureConInterruttore("limiti")`; passo Fattura visibile solo con `fatturazione`; «Leggi il contratto» solo con `contrattoEstrazione` (letti da `trpc.platform.interruttori`).
- Importi solo con `economia.read` (server: `null` altrimenti; client: riga nascosta); mai aritmetica float sugli importi (`@shared/euroCent`, `client/src/lib/euro.ts`).
- Nessun mirror di capability sul client; i pulsanti si disattivano dai flag `puo*` già restituiti dai router esistenti e dagli errori `FORBIDDEN`.
- UI: token semantici di `client/src/index.css`, lucide con `aria-label` sui pulsanti icona, `min-w-0`, nessuno scroll orizzontale globale, target touch ≥ 44 px, `prefers-reduced-motion`; verifica 1440×900 e 390×844 senza errori console (a carico del controller).
- Nessun dato di clienti reali in test/fixture; commenti e messaggi in italiano; commit Conventional Commits in italiano chiusi da `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; diff additivi, niente riformattazioni di righe non toccate.
- Ogni task chiude con `pnpm check` e `pnpm test` verdi; Task 7 anche `pnpm build`.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `shared/fatturazione/passi.ts` | tipi `PassoFatturazione`, `EsitoPasso`, `CommessaDaFatturare`, `ORDINE_PASSI`, `ETICHETTA_PASSO` |
| `server/fatturazione/passi.ts` (+ test) | `calcolaPassi(input)` pura: dai dati grezzi allo stato dei passi e a `prossimoPasso` |
| `server/routers/fatturazioneGuidata.ts` (+ test) | `daFare`, `passi`; mount in `server/routers.ts` |
| `client/src/lib/fatturazioneView.ts` (+ test) | etichette, tono dei pallini, `etichettaPulsante`, `giorniTesto`, `importiCard` |
| `client/src/components/fatturazione/CardCommessaDaFatturare.tsx` | card dell'elenco |
| `client/src/components/fatturazione/PassiFatturazione.tsx` | stepper dei quattro passi |
| `client/src/components/fatturazione/PassoDocumenti.tsx` | passo 1: fascicolo, caricamento, «Leggi il contratto» |
| `client/src/components/documenti/ElencoDocumentiCommessa.tsx` | elenco documenti + caricamento estratto da `CommessaDetail.tsx` e riusato |
| `client/src/pages/Fatturazione.tsx` | elenco a card con filtri e ricerca |
| `client/src/pages/FatturazioneCommessa.tsx` | pagina a passi |
| `client/src/components/contratto/ContrattoTab.tsx`, `client/src/components/computo/LimitiTab.tsx`, `client/src/components/fattura/FatturaTab.tsx` | prop `modalita` (`"guidata"` con `onAvanti`, `"lettura"` con riassunto + link) |
| `client/src/pages/CommessaDetail.tsx`, `client/src/components/contratto/ContrattoStatoBanner.tsx` | tab in sola lettura, banner con «Apri fatturazione» |
| `client/src/lib/navigation.ts`, `client/src/App.tsx` | voce di menu e rotte |
| `handoff.md`, spec §6 | documentazione |

## Fatti del codice esistente (verificati il 05/09/2026)

- Commesse: `getCommesseStore()`, `getCommessaById(id)` (`server/routers/commesse.ts`; campi `id`, `codice`, `cliente` (stringa), `stato`, `sedeId`, `importoTotale`, `updatedAt`); stati in `STATI_COMMESSA` (`shared`), fra cui `aggiornamento_contratto` e `fatture_pagamento`.
- Timeline: `stepsDiCommessa(commessaId) → { dataCompletamento: string | null; stato: string }[]` (`server/routers/timeline.ts:191`): la milestone il cui `stato` coincide con lo stato corrente dà `statoDal`.
- Documenti: `getDocumentiDiCommessa(commessaId): Documento[]` (`server/routers/preventiviContratti.ts:963`; `Documento.tipo` è un `DocTipo`, `contratto` incluso; `mimeType`).
- Contratto: `leggiContratto(sedeId, commessaId)` (`server/contratti/servizio.ts:315`) → contratto + righe o null; `Contratto.pattuitoCent`, `pattuitoTipo`.
- Computo: `ultimoComputo(sedeId, commessaId)` e `computoValido(sedeId, commessaId): Promise<boolean>` (`server/computo/servizio.ts:83, 95`; stantio quando `hashRighe`/`hashParametri` divergono dal contratto); `Computo.esito` `"ok" | "incompleto"`, `limiteCent`.
- Fatture CRM: `fatturePerCommessa(sedeId, commessaId)` (`server/fatture/servizio.ts:340`), `Fattura.stato`, `totaleCent`, `tipo`.
- Fatture FiC: `ficFatture` (array esportato da `server/routers/ficFatture.ts:194`, campi `sedeId`, `commessaId: number | null`, `stato`, `commessaMatch`).
- Authz: `authorizeCoreOperation`, `effectiveCapabilitySet(ctx, [...])` (`server/authz/enforcement.ts:81`); capability `contratto.read`, `economia.read` (`server/authz/capabilities.ts`).
- Router modello: `server/routers/computo.ts` (`procedureConInterruttore("limiti")`, `sedeCorrente`, `commessaInSede`); mount in `server/routers.ts` (~r. 210).
- Client: `trpc.platform.interruttori.useQuery`; `PageHeader`/`DataSurface` (`client/src/components/patterns/*`, uso in `client/src/pages/Pagamenti.tsx`); nav in `client/src/lib/navigation.ts:143-165` (gruppo Economia con `requiredCapabilities`, `loadingFallbackRoles`); rotte in `client/src/App.tsx` (~r. 100, `lazy`); tab in `CommessaDetail.tsx` (r. 1249-1275 trigger, 1555/1632/1639 contenuti; documenti in r. 1416-1440 con `trpc.preventiviContratti.byCommessa` e upload inline); `ContrattoStatoBanner` (`onApri(tab)`, `documentoContratto`, `onLeggi`); `LeggiContrattoDialog({ commessaId, documento, onClose, onApplicato })`; `LimitiTab({ commessaId })`, `FatturaTab({ commessaId })`, `ContrattoTab` (leggi le props).
- Test router: `server/routers/contratti.test.ts` (contesto con ruoli, `appRouter.createCaller`).

---

### Task 1: Tipi condivisi e `calcolaPassi` pura

**Files:**
- Create: `shared/fatturazione/passi.ts`, `server/fatturazione/passi.ts`
- Test: `server/fatturazione/passi.test.ts`

**Interfaces:**
- Produces (`shared/fatturazione/passi.ts`):

```ts
export const ORDINE_PASSI = ["documenti", "contratto", "limiti", "fattura"] as const;
export type PassoFatturazione = (typeof ORDINE_PASSI)[number];
export type EsitoPasso = "da_fare" | "in_corso" | "fatto" | "non_disponibile";
export const ETICHETTA_PASSO: Record<PassoFatturazione, string> = {
  documenti: "Documenti", contratto: "Contratto", limiti: "Limiti", fattura: "Fattura",
};
export type StatoDaFatturare = "aggiornamento_contratto" | "fatture_pagamento";
export type CommessaDaFatturare = {
  commessaId: number; codice: string; cliente: string; stato: StatoDaFatturare;
  statoDal: string | null; giorniNelloStato: number | null;
  documenti: { totale: number; contratti: number };
  passi: Record<PassoFatturazione, EsitoPasso>;
  prossimoPasso: PassoFatturazione | null;
  pattuitoCent: number | null; pattuitoTipo: "lordo" | "imponibile" | null;
  fatturaPrevistaCent: number | null; fatturaPrevistaStima: boolean;
  fatturaStato: string | null;
};
```

- Produces (`server/fatturazione/passi.ts`):

```ts
export type IngressoPassi = {
  documenti: { tipo: string; mimeType: string }[];
  contratto: { righe: number; pattuitoCent: number; pattuitoTipo: "lordo" | "imponibile" } | null;
  computo: { valido: boolean; esito: "ok" | "incompleto" } | null;
  fatture: { stato: string; totaleCent: number; tipo: string }[];   // CRM
  flag: { limiti: boolean; fatturazione: boolean };
};
export const STATI_FATTURA_EMESSA = new Set(["emessa", "inviata", "consegnata", "mancata_consegna"]);
export function calcolaPassi(i: IngressoPassi): { passi: Record<PassoFatturazione, EsitoPasso>; prossimoPasso: PassoFatturazione | null; fatturaStato: string | null; fatturaPrevistaCent: number | null; fatturaPrevistaStima: boolean };
```

Regole (spec §4.1 e §4.3): `documenti` fatto se `contratto != null` o esiste un documento `tipo === "contratto"`; `contratto` fatto con `righe ≥ 1`, in_corso con contratto senza righe; `limiti` non_disponibile se `!flag.limiti`, fatto se `computo?.valido && esito === "ok"`, in_corso se il computo esiste, altrimenti da_fare; `fattura` non_disponibile se `!flag.fatturazione`, fatto se una fattura di tipo `fattura` ha stato in `STATI_FATTURA_EMESSA`, in_corso se esiste una fattura non annullata, altrimenti da_fare; `fatturaStato` = stato della fattura più recente non annullata; `fatturaPrevistaCent` = `totaleCent` della bozza/in_emissione se c'è, altrimenti pattuito lordo (`pattuitoTipo === "lordo"` → `pattuitoCent`, stima false) o `Math.round(pattuitoCent * 1.10)` (stima true), `null` senza contratto; `prossimoPasso` = primo passo non `fatto` e non `non_disponibile` in `ORDINE_PASSI`, altrimenti `null`.

- [ ] **Step 1: Test (fallisce)** — tabella: (a) niente di niente → tutti da_fare, prossimo `documenti`; (b) documento contratto senza contratto → documenti fatto, prossimo `contratto`; (c) contratto con 3 righe + computo valido ok → limiti fatto, prossimo `fattura`; (d) computo esistente ma non valido → limiti in_corso; (e) bozza → fattura in_corso, `fatturaPrevistaCent = totaleCent`, prossimo `fattura`; (f) fattura `inviata` → fatto, prossimo null; (g) flag fatturazione spento → non_disponibile e prossimo `limiti`/null; (h) pattuito imponibile 1000000 senza bozza → 1100000 con stima true; (i) fattura `annullata` non conta.
- [ ] **Step 2: Eseguire e vedere fallire** — `pnpm vitest run server/fatturazione/passi.test.ts`.
- [ ] **Step 3: Implementare** (funzione pura, nessun import server).
- [ ] **Step 4: Verdi, `pnpm check`, commit**

```bash
git add shared/fatturazione/passi.ts server/fatturazione/passi.ts server/fatturazione/passi.test.ts
git commit -m "feat(fatturazione): lo stato dei quattro passi è una funzione pura"
```

---

### Task 2: Router `fatturazioneGuidata` (`daFare`, `passi`)

**Files:**
- Create: `server/routers/fatturazioneGuidata.ts`
- Modify: `server/routers.ts` (mount `fatturazioneGuidata`)
- Test: `server/routers/fatturazioneGuidata.test.ts`

**Interfaces:**
- Consumes: Task 1; `getCommesseStore`, `stepsDiCommessa`, `getDocumentiDiCommessa`, `leggiContratto`, `ultimoComputo`/`computoValido`, `fatturePerCommessa`, `ficFatture`, `interruttoreAttivo`, `effectiveCapabilitySet`.
- Produces: `fatturazioneGuidata.daFare` (query, senza input) → `CommessaDaFatturare[]`; `fatturazioneGuidata.passi` (query `{ commessaId }`) → `CommessaDaFatturare`.

Regole: `procedura = procedureConInterruttore("limiti")`; capability `contratto.read`; `mostraImporti = caps.has("economia.read")`; in `daFare` filtra le commesse della sede con `stato ∈ {aggiornamento_contratto, fatture_pagamento}`, escludi quelle con una fattura FiC collegata (`ficFatture.some(f => f.sedeId === sedeId && f.commessaId === c.id)`) o con fattura CRM in `STATI_FATTURA_EMESSA`; `statoDal` dalla milestone della timeline con `stato === c.stato` (`dataCompletamento`), altrimenti `c.updatedAt`; `giorniNelloStato` in giorni interi (Europe/Rome, `istanteComeLocale` di `server/tars/tempo.ts` se comodo, altrimenti differenza in UTC a mezzanotte); ordina per `giorniNelloStato` decrescente e poi `codice`. Per evitare N+1: una lettura di `ficFatture` per sede, i contratti/computi/fatture per commessa con `Promise.all` sulle commesse filtrate (sono poche decine). `passi` per una commessa: `commessaInSede` → `NOT_FOUND` altrimenti.

- [ ] **Step 1: Test (fallisce)** — con commesse create via `appRouter.createCaller` (contesto direzione e contesto `commerciale`): (a) due commesse negli stati giusti + una in `produzione` → elenco di 2; (b) commessa con fattura FiC collegata (inserisci in `ficFatture` un elemento con `commessaId`) → esclusa; (c) commessa con bozza CRM → inclusa con `fatturaStato: "bozza"`; con fattura `emessa` (usa il repository fatture in memoria: `getFattureRepository().crea(...)` + `aggiornaStato`) → esclusa; (d) contesto senza `economia.read` (ruolo `commerciale`) → `pattuitoCent`/`fatturaPrevistaCent` null; (e) `passi` su commessa di altra sede → NOT_FOUND; (f) flag limiti spento → PRECONDITION_FAILED; (g) ordinamento per giorni decrescente.
- [ ] **Step 2–4: fallire, implementare, verdi, commit**

```bash
git add server/routers/fatturazioneGuidata.ts server/routers/fatturazioneGuidata.test.ts server/routers.ts
git commit -m "feat(fatturazione): le commesse da fatturare e i loro passi, in una query"
```

---

### Task 3: Elenco «Fatturazione» sotto Economia

**Files:**
- Create: `client/src/lib/fatturazioneView.ts`, `client/src/lib/fatturazioneView.test.ts`, `client/src/components/fatturazione/CardCommessaDaFatturare.tsx`, `client/src/pages/Fatturazione.tsx`
- Modify: `client/src/lib/navigation.ts` (voce «Fatturazione», icona `ReceiptText`, path `/fatturazione`, `requiredCapabilities: ["contratto.read"]`, `loadingFallbackRoles: ["direzione", "amministrazione"]`, prima di «Contabilità»; aggiorna la mappa dei titoli r. ~299), `client/src/lib/navigation.test.ts` (aspettative sul gruppo Economia), `client/src/App.tsx` (rotte `/fatturazione` e `/fatturazione/:id` lazy)

**Interfaces (`fatturazioneView.ts`):**

```ts
export function etichettaPulsante(passi: Record<PassoFatturazione, EsitoPasso>): "Inizia fatturazione" | "Continua" | "Fatturata";
export function tonoPasso(e: EsitoPasso): "neutro" | "attivo" | "ok" | "spento";
export function giorniTesto(g: number | null): string; // "oggi", "1 giorno", "12 giorni", "—"
export function importiCard(c: CommessaDaFatturare): { pattuito: string | null; prevista: string | null; stima: boolean };
export function filtraCommesse(elenco: CommessaDaFatturare[], filtro: { stato: "tutti" | StatoDaFatturare; testo: string }): CommessaDaFatturare[];
```

Pagina: `PageHeader` con titolo «Fatturazione» e sottotitolo «Commesse in aggiornamento contratto o fatture/pagamento senza una fattura», riga di controlli (select stato, input ricerca), `DataSurface` con griglia di card (`grid gap-3 md:grid-cols-2 xl:grid-cols-3`), stati `loading`/`error`/vuoto («Nessuna commessa da fatturare»); card: cliente (titolo), codice, badge stato + giorni, «N documenti (M contratti)», quattro pallini con etichetta (`aria-label` con esito), riga importi solo se non null («Pattuito € … · Fattura prevista € … (stima)»), pulsante primario → `Link` a `/fatturazione/${commessaId}`. Con flag `limiti` spento la pagina mostra il `DataSurface` in stato «non disponibile».

- [ ] **Step 1: Test di `fatturazioneView` (fallisce)** — etichette del pulsante per tutti da_fare / misto / fattura fatto; `giorniTesto`; `importiCard` con null e con stima; `filtraCommesse` per stato e testo (case-insensitive su cliente e codice).
- [ ] **Step 2: Implementare**; **Step 3: `pnpm check`, `pnpm test`; commit**

```bash
git add client/src/lib/fatturazioneView.ts client/src/lib/fatturazioneView.test.ts client/src/components/fatturazione/CardCommessaDaFatturare.tsx client/src/pages/Fatturazione.tsx client/src/lib/navigation.ts client/src/lib/navigation.test.ts client/src/App.tsx
git commit -m "feat(fatturazione): la pagina Fatturazione elenca le commesse da fatturare con i quattro passi"
```

---

### Task 4: Elenco documenti riusabile e passo «Documenti»

**Files:**
- Create: `client/src/components/documenti/ElencoDocumentiCommessa.tsx` (estratto da `CommessaDetail.tsx` r. ~1416-1500: elenco con tipo, nome, data, azioni apri/scarica/riclassifica/collega ordine/«Leggi il contratto», e il caricamento con selezione del tipo), `client/src/components/fatturazione/PassoDocumenti.tsx`
- Modify: `client/src/pages/CommessaDetail.tsx` (usa `ElencoDocumentiCommessa` al posto del blocco inline, stesse props e stessi comportamenti)

**Interfaces:**
- `ElencoDocumentiCommessa({ commessaId, documenti, onLeggiContratto?, onCollegaOrdine?, compatto? })`: nessuna logica nuova, solo estrazione; le mutation restano quelle di oggi (`preventiviContratti.upload`, `riclassifica`, ecc.).
- `PassoDocumenti({ commessaId, passo: EsitoPasso, onAvanti })`: intestazione «1 · Documenti», testo guida («Carica il contratto firmato e leggilo per proporre il contratto strutturato»), `ElencoDocumentiCommessa`, `LeggiContrattoDialog` sul documento scelto (solo con `contrattoEstrazione`), pulsante «Avanti» attivo se `passo === "fatto"`.

- [ ] **Step 1: Estrarre il componente senza cambiare comportamento** (diff di `CommessaDetail.tsx` = solo la sostituzione); `pnpm check`; verifica manuale del controller sulla pagina commessa.
- [ ] **Step 2: `PassoDocumenti`**; **Step 3: commit**

```bash
git add client/src/components/documenti/ElencoDocumentiCommessa.tsx client/src/components/fatturazione/PassoDocumenti.tsx client/src/pages/CommessaDetail.tsx
git commit -m "feat(fatturazione): il fascicolo della commessa è un componente, e il primo passo lo usa"
```

---

### Task 5: Pagina a passi e modalità guidata dei tre tab

**Files:**
- Create: `client/src/components/fatturazione/PassiFatturazione.tsx`, `client/src/pages/FatturazioneCommessa.tsx`
- Modify: `client/src/components/contratto/ContrattoTab.tsx`, `client/src/components/computo/LimitiTab.tsx`, `client/src/components/fattura/FatturaTab.tsx` (prop `modalita?: "guidata" | "lettura"` e `onAvanti?: () => void`; default = comportamento attuale)

**Interfaces:**
- `PassiFatturazione({ passi, corrente, onVai })`: quattro voci (`ORDINE_PASSI`) con numero, etichetta, pallino (`tonoPasso`), `aria-current="step"` sul corrente; click consentito su passi `fatto`/`in_corso` e sul prossimo; su mobile `overflow-x-auto` con `snap`.
- `FatturazioneCommessa`: legge `fatturazioneGuidata.passi` e `commesse.byId`; passo iniziale = `prossimoPasso` (o `documenti`), `?passo=` nell'URL per riprendere; intestazione con cliente, codice, stato, link «Apri commessa»; riepilogo dei passi precedenti in una riga (contratto: N righe, pattuito; limiti: limite €; solo con importi disponibili); contenuto: `PassoDocumenti` / `ContrattoTab modalita="guidata" onAvanti` / `LimitiTab modalita="guidata" onAvanti` / `FatturaTab modalita="guidata"`; in coda «Indietro» e «Avanti» (attivo se il passo è `fatto`); dopo ogni mutation dei figli `utils.fatturazioneGuidata.passi.invalidate({ commessaId })` (i figli espongono `onCambiato?`); passo `fattura` con flag spento → messaggio «Fatturazione non attiva».
- Modalità `"guidata"` nei tab: nessuna intestazione di tab, pulsante «Avanti» (o «Salva e avanti» nel contratto quando il modulo è sporco: salva poi chiama `onAvanti`), `onCambiato` dopo salvataggi/emissioni.

- [ ] **Step 1: prop `modalita`/`onAvanti`/`onCambiato` nei tre tab** (additiva, default invariato); `pnpm check`.
- [ ] **Step 2: `PassiFatturazione` e `FatturazioneCommessa`**; **Step 3: `pnpm check`, `pnpm test`; commit**

```bash
git add client/src/components/fatturazione/PassiFatturazione.tsx client/src/pages/FatturazioneCommessa.tsx client/src/components/contratto/ContrattoTab.tsx client/src/components/computo/LimitiTab.tsx client/src/components/fattura/FatturaTab.tsx
git commit -m "feat(fatturazione): la pagina a passi — documenti, contratto, limiti, fattura — con avanzamento"
```

---

### Task 6: Tab in sola lettura e banner

**Files:**
- Modify: `client/src/components/contratto/ContrattoTab.tsx`, `client/src/components/computo/LimitiTab.tsx`, `client/src/components/fattura/FatturaTab.tsx` (modalità `"lettura"`: riassunto compatto — contratto: righe, pattuito, cantiere; limiti: limite e esito; fattura: stato, numero, totale — e pulsante «Apri fatturazione» → `/fatturazione/${commessaId}?passo=<tab>`), `client/src/pages/CommessaDetail.tsx` (passa `modalita="lettura"` ai tre tab), `client/src/components/contratto/ContrattoStatoBanner.tsx` (con flag `limiti`: pulsante principale «Apri fatturazione» al posto dei tre pulsanti tab; i tre restano come link secondari solo se `modalita` non è lettura)

- [ ] **Step 1: Implementare**; **Step 2: `pnpm check`, `pnpm test`; verifica del controller in browser (pagina commessa: tab riassunto + pulsante; banner)**; **Step 3: commit**

```bash
git add client/src/components/contratto/ContrattoTab.tsx client/src/components/computo/LimitiTab.tsx client/src/components/fattura/FatturaTab.tsx client/src/pages/CommessaDetail.tsx client/src/components/contratto/ContrattoStatoBanner.tsx
git commit -m "feat(commessa): contratto, limiti e fattura in sola lettura con un solo pulsante «Apri fatturazione»"
```

---

### Task 7: Documentazione e verifica finale

**Files:**
- Modify: `handoff.md` (sezione «11-vicies sedecies. Fatturazione guidata — piano 4 (05/09/2026)» prima di «## 12.»: cosa c'è, come si usa, regole dei passi, filtro «senza fattura», permessi, verifica browser; voce in §12), `docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md` (precisazioni emerse), `.claude/launch.json` (nessuna variabile nuova: verificare)
- Verifica: `pnpm check && pnpm test && pnpm build`; browser 1440×900 e 390×844 su `/fatturazione`, `/fatturazione/:id` (quattro passi), `/commesse/:id` (tab in lettura), console pulita.

- [ ] **Step 1: Scrivere**; **Step 2: gate e verifica**; **Step 3: commit**

```bash
git add handoff.md docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
git commit -m "docs(fatturazione): handoff della fatturazione guidata e spec precisata"
```

---

## Note per il controller (auto-revisione del piano)

- **Copertura spec**: §2 elenco/filtro → Task 2; percorso a passi → Task 5; tab in lettura → Task 6; card con importi → Task 3; §3 passo Documenti con fascicolo e lettura → Task 4; §4 modello → Task 1; §5 server → Task 2; §6 client → Task 3-6; §7 permessi/sede/flag → Task 2 (server) e Task 3/5 (client, solo visibilità); §8 test → ogni task; §9 fuori ambito rispettato (nessuna mutation nuova).
- **Coerenza dei nomi**: `calcolaPassi`, `ORDINE_PASSI`, `ETICHETTA_PASSO`, `CommessaDaFatturare`, `fatturazioneGuidata.daFare/passi`, `etichettaPulsante`, `tonoPasso`, `giorniTesto`, `importiCard`, `filtraCommesse`, `PassiFatturazione`, `PassoDocumenti`, `ElencoDocumentiCommessa`, prop `modalita`/`onAvanti`/`onCambiato` — identici in ogni task.
- **Rischi**: Task 4 estrae codice da `CommessaDetail.tsx` (file grande): il diff deve essere una sostituzione pura, verificata in browser prima di proseguire; Task 5 tocca tre componenti densi: la prop è additiva e il default lascia tutto com'è.
- **Ordine**: 1 → 2 → 3 → 4 → 5 → 6 → 7. Task 1-2 con modello economico; 4-5 con modello capace (integrazione UI); review finale con il modello più capace.
