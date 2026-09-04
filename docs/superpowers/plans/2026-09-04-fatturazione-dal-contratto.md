# Fatturazione dal contratto (piano 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dalla commessa con contratto strutturato e computo valido il CRM genera la bozza di fattura (beni, servizi entro i limiti, markup, storno/riaddebito beni significativi, diciture, scadenze), l'operatore la rivede, il CRM la emette su Fatture in Cloud (FiC numera, verifica l'XML, invia allo SdI in dry-run finché la direzione non lo spegne), archivia PDF e XML, segue lo stato SdI e sa fare la nota di credito.

**Architecture:** tabelle relazionali nuove (`fatturazione_config`, `fatture`, `fattura_righe`, `fattura_riepilogo_iva`, `fattura_scadenze`, `fattura_eventi`) con repository Postgres + fallback in memoria come `server/computo/repository.ts`; motore puro in `server/fatture/` (risolutore IVA/markup, generatore della bozza, verifica limiti, validazioni); client FiC di scrittura in `server/fic/emissione.ts` con un fake a copione per i test; pipeline idempotente `emettiFattura` a passi con eventi append-only; sonda stati ogni 15 minuti; router tRPC sottili dietro `procedureConInterruttore("fatturazione")`; UI come tab «Fattura» della commessa, pannello Impostazioni per sede e sezione in /pagamenti.

**Tech Stack:** TypeScript, Express + tRPC 11 + zod 4, postgres-js (`kvSql`), `persistedStore` solo per i record già esistenti (`fic_config`, `fic_fatture`, `commesse`, `clienti`), vitest 2, React 19 + Wouter + shadcn/Radix + Tailwind 4, `fetch` nativo verso `https://api-v2.fattureincloud.it`.

**Spec:** `docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md` (sezioni 2, 3, 4.4, 7, 8, 9, 10, 11, 13, 14) **e** `docs/superpowers/specs/2026-09-03-limiti-analisi-fogli-reali.md` §1 (le tre fatture reali). Piano 1 (`docs/superpowers/plans/2026-09-03-contratto-e-computo-limiti.md`) è già su `main`: contratto, computo, gate, tariffe esistono.

## Delta rispetto alla spec (rulings del controller, 04/09/2026)

Le tre fatture reali 127, 129 e 130/2026 (testi in mano al controller, mai nel repo) dimostrano che:

- **D-A — I beni sono modificabili e il markup è derivato.** Il risolutore della spec (§7.2) con B = prezzi delle righe del contratto dà markup negativo in tutti e tre i casi reali: in pratica la commercialista **abbassa i beni** per far posto a servizi e markup al 10 %, tenendo fermo il pattuito. Modello adottato: G fisso; B (beni significativi) e N (altri beni) proposti dai prezzi del contratto ma **modificabili**; S proposti dai limiti (arrotondati all'euro per difetto) e modificabili; M = derivato. Con M < 0 la bozza resta salvabile ma **non emettibile** e il pulsante «Riequilibra i beni» scala le righe bene in proporzione finché M = markup desiderato (default 0). Verificato: con G, B, N, S delle fatture reali il risolutore restituisce M 2.153,59 / 1.170,00 / 600,00 e i riepiloghi IVA al centesimo (Task 3).
- **D-B — Capability:** `fattura.read`, `fattura.draft`, `fattura.emit`, `fattura.credit_note` (la spec §7.3 scrive `fatture.emetti`: refuso). `fattura.read` a `amministrazione` e `commerciale`; `draft/emit/credit_note` solo `amministrazione`; `direzione` ha tutto (set completo). Nessun mirror sul client: `client/src/lib/roles.ts` non elenca capability; il client legge `Capability` dal server (`client/src/lib/navigation.ts:28`).
- **D-C — Righe derivate:** `markup`, `storno_bs`, `riaddebito_bs` e il riepilogo IVA si **rigenerano a ogni ricalcolo** server-side; l'operatore modifica solo importi di `bene`/`servizio`, scadenze, note e diciture. Una riga `nota` «Calcolo limite massimo spesa zona climatica X» nasce dai massimali del computo (come nella fattura reale 129).
- **D-D — Sync FiC:** nuovo valore `commessaMatch: "crm"` in `server/routers/ficFatture.ts`; un documento FiC il cui id è `fatture.fic_document_id` nasce collegato, salta il match automatico e la rigenerazione del PDF (già archiviato dal CRM), alimenta pattuito/rate/incassi come oggi. Avviso se `|totale − pattuito contratto| > 1 €`.
- **D-E — Dry-run:** `FATTURAZIONE_SDI_DRY_RUN` non è un interruttore del registro ma una variabile letta dal servizio di emissione: assente o non `off` ⇒ **dry-run acceso** in ogni ambiente. La UI lo dichiara sempre.
- **D-F — Documenti:** `DOC_TIPI` + `nota_credito` (etichetta «Nota di credito»); `application/xml` e `text/xml` entrano nelle allowlist di upload solo per l'archiviazione interna (non per l'upload manuale: la UI non li offre).
- **D-G — Anagrafica:** il cliente non ha PEC, codice destinatario né id FiC: si aggiungono `pec`, `codiceDestinatario`, `ficEntityId` (opzionali, additivi) in `server/routers/clienti.ts`. I validatori CF (checksum) e P.IVA (Luhn) non esistono: nascono in `shared/fatturazione/fiscale.ts`.
- **D-H — UI:** non esiste `DataTable`: le tabelle usano `client/src/components/ui/table.tsx` dentro `DataSurface`, con vista mobile a card come `ContrattoTab`.
- **D-I — Scadenze:** importi = quota % del totale lordo con resto sull'ultima; data = `rata.data` se c'è, altrimenti data fattura + `giorni`; con `giorni` null: 0 / 60 / 75 / 90 giorni per la 1ª, 2ª, 3ª, successive. Tutto modificabile in bozza.
- **D-J — Stato dopo invio in dry-run:** resta `emessa` con `inviataDryRun = true` e nota; la sonda legge comunque `ei_status` (FiC lo espone anche senza invio: `not_sent`/`missing`).
- **D-K — Sede:** `fatturazione_config` e ogni fattura portano `sede_id`; record di altra sede → `NOT_FOUND` «Fattura non trovata.».

## Global Constraints

- Branch `feature/fatturazione`; **mai push su `main`** (push su main = deploy Railway) senza decisione esplicita dell'utente.
- `sedeId` su ogni tabella, query e mutation; record di altra sede → `NOT_FOUND` con messaggio «… non trovato/a.», mai `FORBIDDEN`.
- Importi in **centesimi interi** in tutte le tabelle nuove; conversione da/verso euro solo con `shared/euroCent.ts` (`euroToCent`, `centToEuro`, `sommaCent`) e al confine con FiC (che vuole euro con 2 decimali) tramite `centToEuro`.
- Nessun nuovo store `kv_store`; tabelle con `CREATE TABLE IF NOT EXISTS` additive in `ensureSchema()` memoizzato (pattern `server/computo/repository.ts:108-144`); fallback in memoria senza `DATABASE_URL`; inserimenti multipli con il bulk helper postgres-js `tx(rows, ...colonne)` (pattern `server/computo/repository.ts:172-190`).
- Interruttore `fatturazione` (`FLAG_FATTURAZIONE`) fail-closed come `limiti`; le procedure tRPC nuove nascono con `procedureConInterruttore("fatturazione")` e richiedono anche `interruttoreAttivo("limiti")` (senza contratto strutturato non c'è bozza).
- Ogni effetto esterno (cliente FiC, documento FiC, invio SdI) passa da `server/fatture/emissione.ts`, è idempotente e scrive un evento in `fattura_eventi`; **mai** cancellazioni su FiC.
- Nessuna chiamata di rete nei test: `server/_core/testSetup.ts` vieta ogni host non locale; i test del client FiC sostituiscono `global.fetch` con `vi.fn()` (pattern `server/routers/fattureInCloud.oauth.test.ts`) o usano il fake a copione di `server/fic/fake.ts`.
- Non loggare access token, refresh token, CF, IBAN o payload cliente completi.
- Commenti e messaggi in italiano; commit Conventional Commits in italiano (`feat(fatture): …`), corpo che spiega il perché, chiuso da `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- UI: token semantici di `client/src/index.css`, Plus Jakarta Sans, layout denso; `min-w-0` e vista mobile per ogni tabella; verifica 1440×900 e 390×844 senza errori console prima di chiudere una modifica visuale.
- Ogni task chiude con `pnpm check` e `pnpm test` verdi; nessuna dipendenza npm nuova.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `shared/fatturazione/tipi.ts` | tipi condivisi: stati, tipi riga, `Fattura`, `RigaFattura`, `RiepilogoIva`, `ScadenzaFattura`, `EventoFattura`, `FatturazioneConfig`, input |
| `shared/fatturazione/diciture.ts` | testi fissi della fattura per chiave (intervento, bonifico parlante, pagamento, note) |
| `shared/fatturazione/fiscale.ts` (+ test) | `codiceFiscaleValido`, `partitaIvaValida`, `normalizzaProvincia` |
| `server/fatture/risolutore.ts` (+ test, + `__fixtures__/fatture-reali.json`) | funzione pura: da G, B, N, S a P, M, Q, riepilogo IVA, delta |
| `server/fatture/generatore.ts` (+ test) | funzione pura: da contratto + computo + cliente + config alla bozza (righe, scadenze, diciture) e `riequilibraBeni` |
| `server/fatture/repository.ts` (+ test, + `.pg.test.ts`) | 6 tabelle, memoria + Postgres |
| `server/fatture/servizio.ts` (+ test) | bozza: crea, leggi, aggiorna (ricalcolo, verifica limiti, validazioni), immutabilità |
| `server/fatture/emissione.ts` (+ test) | `emettiFattura` idempotente a passi, archiviazione PDF/XML, documento `fattura`, timeline |
| `server/fatture/sonda.ts` (+ test) | mappa `ei_status` → stato, job ogni 15 minuti, «Aggiorna stato» |
| `server/fatture/notaCredito.ts` (+ test) | bozza di nota di credito totale o parziale |
| `server/fatture/config.ts` (+ test) | configurazione per sede, verifica scope di scrittura, cache `vat_ids_fic` |
| `server/fic/emissione.ts` (+ test) | client HTTP FiC di scrittura: clienti, documenti, xml_verify, send, xml, pdf, ei_status |
| `server/fic/fake.ts` | fake a copione del client FiC per i test di pipeline |
| `server/routers/fatture.ts`, `server/routers/fatturazioneConfig.ts` (+ test) | tRPC: autorizza, valida, delega |
| `client/src/lib/fatturaView.ts` (+ test) | presentazione pura: formattazione, badge stato, indicatori limite, gruppi righe, controlli |
| `client/src/components/fattura/FatturaTab.tsx`, `BozzaFatturaEditor.tsx`, `ScadenzeEditor.tsx`, `FatturaEmessaView.tsx` | tab «Fattura» della commessa |
| `client/src/components/fattura/FatturazioneConfigPanel.tsx` | pannello Impostazioni per sede |
| `client/src/pages/Pagamenti.tsx` (sezione nuova), `client/src/pages/Integrazioni.tsx`, `client/src/pages/CommessaDetail.tsx` | integrazione nelle pagine esistenti |

## Fatti del codice esistente che i task usano (verificati il 04/09/2026)

- FiC: `server/routers/fattureInCloud.ts` — `const FIC = "https://api-v2.fattureincloud.it"` (r. 34), `FIC_SCOPES` solo lettura (r. 37-38), `FicConfig` (r. 50-69, `persistedStore("fic_config")`), `getCfg(sedeId)` (r. 101), `accessTokenFic(cfg, signal)` (r. 366-377, refresh automatico), `ficGet(path, token, signal)` (r. 405-419, unico helper: **GET soltanto**), `fetchFicConTimeout` (r. 211-248), `messaggioErroreFic(status, body)` (r. 389-403), `scaricaFatturaPdf` (r. 424-472: `?fields=id,url` poi `fetch(url)` senza bearer, tetto 10 MB, magic `%PDF-`), `buildFicAuthUrl(redirectUri, state)` (r. 189-203), `issueFicOAuthState`/`consumeFicOAuthState` (r. 169-187), `handleFicOAuthCallback` (r. 298-332), `status` (r. 962-984), `oauthStartUrl` (r. 1021-1045), scheduler orario `startFicScheduler` (r. 921-954). Callback Express in `server/_core/index.ts:294-308`.
- Sync: `server/routers/ficFatture.ts` — `FatturaFic` (r. 69-117), `CommessaMatchFic` (r. 52-61), `upsertDocumentiEmessi(rows, sedeId, syncId)` (r. 259+), `collegaFattureAutomatiche` (r. 493-582), `sincronizzaPattuitoDaFic` (r. 744-784); `server/_core/commessaPattuito.ts` — `RataCommessa`, `pattuitoModificabileAMano`, `MOTIVO_PATTUITO_BLOCCATO` (r. 121-127); `server/routers/ficAllegati.ts` — `ensureFicInvoiceAttachment`.
- Documenti: `server/routers/preventiviContratti.ts` — `Documento` (r. 66-98), `caricaDocumentoCommessaDaBuffer` (r. 938-1001), `upsertDocumentoFic` (r. 600-674), allowlist MIME (r. 176-188); `shared/docTipi.ts` (`DOC_TIPI` r. 11-27, `DOC_TIPO_LABEL`); `shared/commessaUpload.ts` (`COMMESSA_UPLOAD_ALLOWED_MIME_TYPES` r. 10-25). Storage: `server/_core/fileStorage.ts` — `putFile(collection, parentId, recordId, originalName, buffer, mimeType) → {storageKey, checksum}`, `getFile(storageKey)`, `sha256Hex`.
- Clienti: `server/routers/clienti.ts` — store non tipizzato (`persistedStore<any>("clienti")`, r. 31), `creaClienteInput` (r. 132-164), `update` (r. ~437). Commesse: `server/routers/commesse.ts` — `getCommessaById`, `applicaPattuitoDaContratto` (r. 449-501), `dipendenzeTransizioniCommesse` (r. 239-266), `pattuito` query (r. 1445-1463). `STATI_COMMESSA` in `server/commesse/transizioni.ts:11-23`. Timeline: `allineaTimelineAlBoard(commessaId, stato, utente?)` (`server/routers/timeline.ts:237`), step 3 «Fatturazione» = milestone `fatture_pagamento`.
- Contratto/computo: `shared/limiti/tipi.ts` (`Contratto`, `RigaContratto`, `RataContratto`, `Computo`, `VoceComputo`, `CATEGORIE_RIGA`), `server/contratti/servizio.ts` (`leggiContratto(sedeId, commessaId)`), `server/computo/servizio.ts` (`ultimoComputo(sedeId, commessaId) → {computo, valido, motivo}`), `server/computo/tariffe.ts` (`tariffeAttive`, `Tariffe.beneSignificativoDefault`, `Tariffe.coefficienti.ivaAgevolata`).
- Authz/flag: `authorizeCoreOperation({ctx, endpoint, capability, resourceType, resource:{sedeId}, legacyAllowed:"capability"})` (`server/authz/enforcement.ts:9-72`); `effectiveCapabilitySet(ctx, caps)`; `server/authz/capabilities.ts` (`CAPABILITIES` r. 25-35, ruoli r. 66-100); `server/platform/interruttori.ts` (unione r. 46-48, `VARIABILE` r. 51-68, `ETICHETTA` r. 71-90, `tarsAttivo` esclusioni r. 121-140); `procedureConInterruttore` (`server/_core/trpc.ts:53`); `.env.example:54-55`.
- Job: pattern `setInterval` + `inCorso` + `unref` in `server/tars/followup/worker.ts`; avvio in `server/_core/index.ts:120-130`.
- Client: `client/src/pages/CommessaDetail.tsx` — tabs controllate (`tab`/`setTab`, r. 153), `limitiAttivi` (r. 172), `computoQ` (r. 178-185), `TabsList` (r. 1205-1232), `ContrattoStatoBanner` (r. 1161-1166), `PianoRateSezione` (r. 2638-2844, props `commessaId, totalePattuito, soloLettura, daContratto`), `PagamentiCard` (r. 2846+, deriva `daContratto`); `client/src/pages/Integrazioni.tsx` — `SezioneHub` (r. 113-135), sezione «Contabilità» (r. 187-196), `FattureInCloudCard` (r. 620+); `client/src/pages/Pagamenti.tsx` (`PagamentiAutorizzata` r. 127+); primitivi `ConfirmDialog` (`client/src/components/ConfirmDialog.tsx`), `StickyActionBar` (`client/src/components/patterns/StickyActionBar.tsx`), `DataSurface` (`client/src/components/patterns/DataSurface.tsx`), `table.tsx`, `Badge`, `Dialog`; `client/src/lib/euro.ts` (`formatEuro`, `formatEuroSimbolo`, `parseEuro`); `client/src/lib/limitiView.ts` (`formatCent`).
- Test: `vitest.config.ts` include `server/**/*.test.ts`, `client/src/lib/**/*.test.ts`, `shared/**/*.test.ts`; suite Postgres `describe.skipIf(!conDatabase)` con `DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test`.

---

### Task 1: Interruttore, dry-run, capability, tipi documento e allowlist XML

**Files:**
- Modify: `server/platform/interruttori.ts:46-48,51-68,71-90,121-140`
- Modify: `server/authz/capabilities.ts:25-35,66-100`
- Modify: `shared/docTipi.ts:11-47`
- Modify: `shared/commessaUpload.ts:10-25`
- Modify: `server/routers/preventiviContratti.ts:176-188`
- Create: `server/fatture/dryRun.ts`
- Modify: `.env.example` (dopo la riga 55)
- Modify: `.claude/launch.json` (config «Limiti demo (porta 5198)»: aggiungere `"FLAG_FATTURAZIONE": "on"`)
- Test: `server/authz/capabilities.fatturazione.test.ts`, `server/fatture/dryRun.test.ts`

**Interfaces:**
- Produces: interruttore `"fatturazione"` (`FLAG_FATTURAZIONE`); capability `"fattura.read" | "fattura.draft" | "fattura.emit" | "fattura.credit_note"`; `sdiDryRun(): boolean`; `DOC_TIPI` con `"nota_credito"`; MIME `application/xml`, `text/xml` ammessi da `validaAllegatoFascicolo` e da `COMMESSA_UPLOAD_ALLOWED_MIME_TYPES`.

- [ ] **Step 1: Test capability e interruttore (fallisce)**

```ts
// server/authz/capabilities.fatturazione.test.ts
import { describe, expect, it } from "vitest";
import { CAPABILITIES, capabilitiesForRoles } from "./capabilities";
import { interruttoreAttivo, statoInterruttori } from "../platform/interruttori";

const NUOVE = ["fattura.read", "fattura.draft", "fattura.emit", "fattura.credit_note"] as const;

describe("capability fatturazione", () => {
  it("esistono nel catalogo", () => {
    const tutte = new Set<string>(CAPABILITIES);
    for (const c of NUOVE) expect(tutte.has(c)).toBe(true);
  });
  it("amministrazione fa tutto, commerciale legge, tecnico niente", () => {
    const amm = capabilitiesForRoles(["amministrazione"]);
    for (const c of NUOVE) expect(amm.has(c)).toBe(true);
    const com = capabilitiesForRoles(["commerciale"]);
    expect(com.has("fattura.read")).toBe(true);
    expect(com.has("fattura.draft")).toBe(false);
    expect(com.has("fattura.emit")).toBe(false);
    const tec = capabilitiesForRoles(["tecnico_rilievi"]);
    expect(tec.has("fattura.read")).toBe(false);
  });
  it("direzione ha il set completo", () => {
    const dir = capabilitiesForRoles(["direzione"]);
    for (const c of NUOVE) expect(dir.has(c)).toBe(true);
  });
});

describe("interruttore fatturazione", () => {
  it("è nel registro e segue FLAG_FATTURAZIONE", () => {
    const prima = process.env.FLAG_FATTURAZIONE;
    try {
      process.env.FLAG_FATTURAZIONE = "off";
      expect(interruttoreAttivo("fatturazione")).toBe(false);
      process.env.FLAG_FATTURAZIONE = "on";
      expect(interruttoreAttivo("fatturazione")).toBe(true);
      expect(Object.keys(statoInterruttori())).toContain("fatturazione");
    } finally {
      if (prima === undefined) delete process.env.FLAG_FATTURAZIONE;
      else process.env.FLAG_FATTURAZIONE = prima;
    }
  });
});
```

```ts
// server/fatture/dryRun.test.ts
import { describe, expect, it } from "vitest";
import { sdiDryRun } from "./dryRun";

describe("sdiDryRun", () => {
  it("è acceso se la variabile manca o non dice off", () => {
    const prima = process.env.FATTURAZIONE_SDI_DRY_RUN;
    try {
      delete process.env.FATTURAZIONE_SDI_DRY_RUN;
      expect(sdiDryRun()).toBe(true);
      process.env.FATTURAZIONE_SDI_DRY_RUN = "on";
      expect(sdiDryRun()).toBe(true);
      process.env.FATTURAZIONE_SDI_DRY_RUN = "qualsiasi";
      expect(sdiDryRun()).toBe(true);
      process.env.FATTURAZIONE_SDI_DRY_RUN = "off";
      expect(sdiDryRun()).toBe(false);
      process.env.FATTURAZIONE_SDI_DRY_RUN = "false";
      expect(sdiDryRun()).toBe(false);
    } finally {
      if (prima === undefined) delete process.env.FATTURAZIONE_SDI_DRY_RUN;
      else process.env.FATTURAZIONE_SDI_DRY_RUN = prima;
    }
  });
});
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `pnpm vitest run server/authz/capabilities.fatturazione.test.ts server/fatture/dryRun.test.ts`
Expected: FAIL (capability assenti, `interruttoreAttivo("fatturazione")` non compila / modulo `dryRun` assente).

- [ ] **Step 3: Implementare**

`server/platform/interruttori.ts`: aggiungere `| "fatturazione"` all'unione (commento `// Fatturazione dal contratto (piano 2, 04/09/2026): bozza, emissione FiC, sonda SdI`), `fatturazione: "FLAG_FATTURAZIONE"` in `VARIABILE`, `fatturazione: "La fatturazione dal contratto (bozza, emissione su Fatture in Cloud, stati SdI)"` in `ETICHETTA`, e `"fatturazione"` nella lista di esclusione di `tarsAttivo`/`assicuraTars` (accanto a `"limiti"`).

`server/authz/capabilities.ts`: in `CAPABILITIES`, dopo `"tariffe.manage"`:

```ts
  // Fatturazione dal contratto (piano 2, 04/09/2026). `fattura.read` è di chi
  // vende e di chi amministra; bozza, emissione e nota di credito solo di chi
  // amministra (la direzione ha il set completo per costruzione).
  "fattura.read",
  "fattura.draft",
  "fattura.emit",
  "fattura.credit_note",
```

e nei ruoli: `amministrazione` aggiunge le quattro; `commerciale` aggiunge solo `"fattura.read"`.

`shared/docTipi.ts`: aggiungere `"nota_credito"` dopo `"fattura"` in `DOC_TIPI` e `nota_credito: "Nota di credito"` in `DOC_TIPO_LABEL`.

`shared/commessaUpload.ts` e `server/routers/preventiviContratti.ts:176-188`: aggiungere `"application/xml"` e `"text/xml"` alle due allowlist con il commento `// XML FatturaPA archiviato dal CRM (piano 2): mai offerto all'upload manuale`.

```ts
// server/fatture/dryRun.ts
// Invio allo SdI in prova. Acceso finché la direzione non lo spegne per
// sede/ambiente con FATTURAZIONE_SDI_DRY_RUN=off: la prima fattura reale
// passa dal commercialista prima di uscire davvero (spec §11).
const VALORI_OFF = new Set(["off", "false", "0", "spento", "no"]);

export function sdiDryRun(): boolean {
  const grezzo = process.env.FATTURAZIONE_SDI_DRY_RUN?.trim().toLowerCase();
  return !(grezzo && VALORI_OFF.has(grezzo));
}
```

`.env.example` (dopo `# FLAG_LIMITI=off`):

```
# Fatturazione dal contratto (piano 2, 04/09/2026): fail-closed come FLAG_LIMITI
# FLAG_FATTURAZIONE=off
# Invio SdI in prova: acceso finché non vale «off» (prima fattura reale col commercialista)
# FATTURAZIONE_SDI_DRY_RUN=on
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `pnpm vitest run server/authz/capabilities.fatturazione.test.ts server/fatture/dryRun.test.ts server/authz server/platform`
Expected: PASS (anche le suite esistenti di capability e interruttori).

- [ ] **Step 5: `pnpm check` e commit**

```bash
git add server/platform/interruttori.ts server/authz/capabilities.ts server/authz/capabilities.fatturazione.test.ts shared/docTipi.ts shared/commessaUpload.ts server/routers/preventiviContratti.ts server/fatture/dryRun.ts server/fatture/dryRun.test.ts .env.example .claude/launch.json
git commit -m "feat(fatture): interruttore, dry-run SdI, capability e tipo nota di credito"
```

---

### Task 2: Tipi condivisi, diciture e validatori fiscali

**Files:**
- Create: `shared/fatturazione/tipi.ts`
- Create: `shared/fatturazione/diciture.ts`
- Create: `shared/fatturazione/fiscale.ts`
- Test: `shared/fatturazione/fiscale.test.ts`, `shared/fatturazione/diciture.test.ts`

**Interfaces:**
- Produces (tutti i task successivi li importano da `@shared/fatturazione/tipi`):

```ts
export const STATI_FATTURA = ["bozza","in_emissione","emessa","inviata","consegnata","scartata","rifiutata","mancata_consegna","annullata"] as const;
export type StatoFattura = (typeof STATI_FATTURA)[number];
export const TIPI_FATTURA = ["fattura", "nota_credito"] as const;
export type TipoFattura = (typeof TIPI_FATTURA)[number];
export const TIPI_RIGA = ["intestazione","bene","servizio","markup","storno_bs","riaddebito_bs","nota"] as const;
export type TipoRiga = (typeof TIPI_RIGA)[number];
export const ALIQUOTE = [22, 10] as const;
export type Aliquota = (typeof ALIQUOTE)[number];
export const TIPI_EVENTO = ["creata","modificata","emissione_avviata","cliente_fic","creata_fic","errore_totali","xml_ok","xml_errore","inviata","stato_sdi","scarto","annullata","nota_credito","pdf_archiviato","xml_archiviato","scavalco_limiti"] as const;
export type TipoEvento = (typeof TIPI_EVENTO)[number];

export type RigaFattura = {
  id: number; fatturaId: number; ordine: number; tipo: TipoRiga;
  descrizione: string; quantita: number; prezzoUnitCent: number; importoCent: number;
  aliquota: Aliquota | null;            // null per intestazione e nota
  voceComputoCodice: string | null;     // servizi: codice della voce del computo
  rigaCommessaId: number | null;        // beni: riga del contratto
  limiteCent: number | null;            // servizi: limite del computo
  beneSignificativo: boolean;           // beni: entra in B (true) o in N (false)
  derivata: boolean;                    // markup/storno/riaddebito/riepilogo: rigenerata dal ricalcolo
};
export type RigaFatturaInput = Omit<RigaFattura, "id" | "fatturaId">;
export type RiepilogoIva = { aliquota: Aliquota; imponibileCent: number; impostaCent: number };
export type ScadenzaFattura = {
  id: number; fatturaId: number; numero: number; quotaPct: number; data: string; // YYYY-MM-DD
  importoCent: number; descrizione: string | null; ficPaymentId: number | null;
  stato: "attesa" | "pagata" | "stornata";
};
export type ScadenzaFatturaInput = Omit<ScadenzaFattura, "id" | "fatturaId" | "ficPaymentId" | "stato">;
export type EventoFattura = { id: number; fatturaId: number; sedeId: number; tipo: TipoEvento; payload: Record<string, unknown>; actorUserId: number | null; createdAt: Date };
export type ClienteSnapshot = {
  clienteId: number | null; nome: string; tipo: "privato" | "azienda" | "condominio" | "ente_pubblico";
  codiceFiscale: string | null; partitaIva: string | null; indirizzo: string; cap: string; citta: string; provincia: string;
  email: string | null; pec: string | null; codiceDestinatario: string; // "0000000" per privati senza PEC
  ficEntityId: number | null;
};
export type Fattura = {
  id: number; sedeId: number; commessaId: number; computoId: number | null; hashRighe: string | null;
  tipo: TipoFattura; notaCreditoDi: number | null; stato: StatoFattura;
  ficDocumentId: number | null; numero: string | null; data: string | null; // YYYY-MM-DD
  clienteSnapshot: ClienteSnapshot | null;
  pattuitoTipo: "lordo" | "imponibile"; pattuitoCent: number;
  imponibileCent: number; ivaCent: number; totaleCent: number; deltaPattuitoCent: number;
  markupCent: number; stornoCent: number;
  diciture: string[]; note: string | null; intestazioneCantiere: string | null; detrazioneTipo: "nessuna" | "ecobonus" | "ristrutturazione";
  pdfStorageKey: string | null; xmlStorageKey: string | null; xmlSha256: string | null; documentoId: number | null;
  eiStatusFic: string | null; eiErrore: string | null; inviataDryRun: boolean;
  scavalcoLimiti: boolean; scavalcoMotivo: string | null;
  createdBy: number | null; emessaDa: number | null; emessaAt: Date | null; revisione: number;
  createdAt: Date; updatedAt: Date;
  righe: RigaFattura[]; riepilogo: RiepilogoIva[]; scadenze: ScadenzaFattura[];
};
export type FatturazioneConfig = {
  sedeId: number; iban: string | null; banca: string | null; intestatario: string | null;
  metodoPagamento: string; // "MP05"
  numerazioneFic: string | null; paymentAccountIdFic: number | null;
  vatIdsFic: { 22: number | null; 10: number | null };
  dicituraFooter: string | null; scopeScritturaOk: boolean; scopeVerificatoAt: Date | null; updatedAt: Date;
};
export const FATTURAZIONE_CONFIG_DEFAULT: Omit<FatturazioneConfig, "sedeId" | "updatedAt">;
export const STATI_MODIFICABILI: ReadonlySet<StatoFattura> = new Set(["bozza"]);
export function fatturaModificabile(stato: StatoFattura): boolean;
```

`shared/fatturazione/diciture.ts` esporta `DICITURE: Record<ChiaveDicitura, string>` e `dicitureDefault(detrazioneTipo)`; `shared/fatturazione/fiscale.ts` esporta `codiceFiscaleValido(cf: string): boolean` (16 caratteri, checksum ufficiale con omocodia), `partitaIvaValida(piva: string): boolean` (11 cifre, Luhn), `normalizzaProvincia(testo: string | null): string | null` (sigla di 2 lettere maiuscole, da «(SP)» o «La Spezia (SP)» o «SP»).

- [ ] **Step 1: Test dei validatori (fallisce)**

```ts
// shared/fatturazione/fiscale.test.ts
import { describe, expect, it } from "vitest";
import { codiceFiscaleValido, partitaIvaValida, normalizzaProvincia } from "./fiscale";

describe("codiceFiscaleValido", () => {
  it("accetta un CF con checksum corretto e rifiuta uno alterato", () => {
    // CF sintetico calcolato con l'algoritmo ufficiale: RSSMRA85T10A562S
    expect(codiceFiscaleValido("RSSMRA85T10A562S")).toBe(true);
    expect(codiceFiscaleValido("rssmra85t10a562s")).toBe(true);
    expect(codiceFiscaleValido("RSSMRA85T10A562T")).toBe(false);
    expect(codiceFiscaleValido("RSSMRA85T10A56")).toBe(false);
    expect(codiceFiscaleValido("")).toBe(false);
  });
  it("gestisce l'omocodia (cifre sostituite da lettere)", () => {
    // RSSMRA85T10A562S con l'ultima cifra del comune omocodificata (2 → N) e checksum ricalcolato
    expect(codiceFiscaleValido("RSSMRA85T10A56NB")).toBe(true);
  });
});

describe("partitaIvaValida", () => {
  it("usa il controllo di Luhn a 11 cifre", () => {
    expect(partitaIvaValida("01500270119")).toBe(true);
    expect(partitaIvaValida("01500270118")).toBe(false);
    expect(partitaIvaValida("IT01500270119")).toBe(true);
    expect(partitaIvaValida("123")).toBe(false);
  });
});

describe("normalizzaProvincia", () => {
  it("estrae la sigla da forme diverse", () => {
    expect(normalizzaProvincia("La Spezia (SP)")).toBe("SP");
    expect(normalizzaProvincia("(sp)")).toBe("SP");
    expect(normalizzaProvincia("SP")).toBe("SP");
    expect(normalizzaProvincia("Sarzana")).toBe(null);
    expect(normalizzaProvincia(null)).toBe(null);
  });
});
```

```ts
// shared/fatturazione/diciture.test.ts
import { describe, expect, it } from "vitest";
import { DICITURE, dicitureDefault } from "./diciture";

describe("diciture", () => {
  it("ogni bonus ha la sua frase per il bonifico parlante", () => {
    expect(dicitureDefault("ristrutturazione")).toContain("bonifico_ristrutturazione");
    expect(dicitureDefault("ecobonus")).toContain("bonifico_ecobonus");
    expect(dicitureDefault("nessuna")).not.toContain("bonifico_ristrutturazione");
    for (const chiave of dicitureDefault("ristrutturazione")) expect(DICITURE[chiave]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Eseguire e vedere fallire**

Run: `pnpm vitest run shared/fatturazione`
Expected: FAIL (moduli assenti).

- [ ] **Step 3: Implementare**

```ts
// shared/fatturazione/fiscale.ts
// Controlli fiscali deterministici per la fattura elettronica: il CF con il
// carattere di controllo (omocodia inclusa), la P.IVA con Luhn, la sigla di
// provincia. Nessuna chiamata esterna: sono regole, non servizi.
const DISPARI: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20,
  O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
const PARI: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12, N: 13,
  O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
};
// Omocodia: nelle 7 posizioni numeriche una cifra può diventare una lettera.
const OMOCODIA = "LMNPQRSTUV";

export function codiceFiscaleValido(cf: string): boolean {
  const s = (cf ?? "").trim().toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s)) return false;
  let somma = 0;
  for (let i = 0; i < 15; i++) {
    const c = s[i];
    somma += i % 2 === 0 ? DISPARI[c] : PARI[c]; // posizioni 1,3,5… (indice pari) sono "dispari"
  }
  return String.fromCharCode(65 + (somma % 26)) === s[15];
}

export function partitaIvaValida(piva: string): boolean {
  const s = (piva ?? "").trim().toUpperCase().replace(/^IT/, "");
  if (!/^\d{11}$/.test(s)) return false;
  let somma = 0;
  for (let i = 0; i < 11; i++) {
    let n = Number(s[i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    somma += n;
  }
  return somma % 10 === 0;
}

export function normalizzaProvincia(testo: string | null | undefined): string | null {
  if (!testo) return null;
  const t = testo.trim();
  const traParentesi = t.match(/\(([A-Za-z]{2})\)\s*$/);
  if (traParentesi) return traParentesi[1].toUpperCase();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return null;
}

export { OMOCODIA };
```

Nota per l'implementatore: verificare a mano il checksum dei CF di test con l'algoritmo (somma dispari/pari sopra); se il CF sintetico del test non torna, **ricalcolare il carattere di controllo nel test**, non cambiare l'algoritmo.

```ts
// shared/fatturazione/diciture.ts
// Testi fissi della fattura (copiati dalle fatture reali 2026). Sono dati:
// la direzione li cambierà da UI in una fase successiva (spec §4.3).
export const DICITURE = {
  intestazione: "Fattura per la prossima fornitura e posa di:",
  seguira_ddt: "(seguirà ddt. alla consegna)",
  beni_significativi: "Beni Significativi:",
  beni_autonomi: "Beni dotati di autonomia funzionale (strutturalmente non integrati):",
  prestazioni: "Prestazioni professionali e opere complementari relative all'installazione e alla messa in opera delle tecnologie:",
  markup: "MarkUp servizi di vendita",
  storno_bs: "Detrazione per diversa imputazione iva beni significativi",
  riaddebito_bs: "Riaddebito per diversa imputazione iva agevolata beni significativi",
  intervento_manutenzione: "Manutenzione Ordinaria\nD.P.R. 380/2001 (art. 3, 1°comma, lettera a)",
  bonifico_ristrutturazione: "Bonifico bancario parlante per Ristrutturazione Edilizia ai sensi del T.U.I.R. 917/1986 e s.m.i.",
  bonifico_ecobonus: "Bonifico bancario parlante per Detrazione Ecobonus Risparmio Energetico L.296/06 e s.m.i.",
  indicare_cf: "Indicare sul bonifico il Codice Fiscale e la nostra P.I.V.A.",
  copia_ade: "Copia del documento elettronico disponibile nella Sua area riservata dell'Agenzia delle Entrate",
  pagamento_50_40_10: "Bonifico Bancario 50/40/10: 50% all'ordine, 40% arrivo merce pronta, 10% posa in opera ultimata (date di pagamento indicative)",
  spese_professionali_escluse: "Spese professionali escluse",
} as const;
export type ChiaveDicitura = keyof typeof DICITURE;

export function dicitureDefault(detrazioneTipo: "nessuna" | "ecobonus" | "ristrutturazione"): ChiaveDicitura[] {
  const base: ChiaveDicitura[] = ["intervento_manutenzione"];
  if (detrazioneTipo === "ristrutturazione") base.push("bonifico_ristrutturazione", "indicare_cf");
  if (detrazioneTipo === "ecobonus") base.push("bonifico_ecobonus", "indicare_cf");
  base.push("copia_ade");
  return base;
}
```

`shared/fatturazione/tipi.ts`: scrivere esattamente i tipi dell'interfaccia sopra, più:

```ts
export const FATTURAZIONE_CONFIG_DEFAULT = {
  iban: null, banca: null, intestatario: null, metodoPagamento: "MP05",
  numerazioneFic: null, paymentAccountIdFic: null, vatIdsFic: { 22: null, 10: null },
  dicituraFooter: null, scopeScritturaOk: false, scopeVerificatoAt: null,
} satisfies Omit<FatturazioneConfig, "sedeId" | "updatedAt">;
export function fatturaModificabile(stato: StatoFattura): boolean { return stato === "bozza"; }
```

- [ ] **Step 4: Test verdi, `pnpm check`, commit**

Run: `pnpm vitest run shared/fatturazione`
Expected: PASS.

```bash
git add shared/fatturazione
git commit -m "feat(fatture): tipi condivisi, diciture e validatori fiscali"
```

---

### Task 3: Risolutore IVA e markup (funzione pura) con le tre fatture reali come giudice

**Files:**
- Create: `server/fatture/risolutore.ts`
- Create: `server/fatture/__fixtures__/fatture-reali.json`
- Test: `server/fatture/risolutore.test.ts`

**Interfaces:**
- Consumes: `shared/fatturazione/tipi.ts` (`Aliquota`, `RiepilogoIva`).
- Produces:

```ts
export type InputRisolutore = {
  pattuitoCent: number;                 // G
  pattuitoTipo: "lordo" | "imponibile";
  beniSignificativiCent: number;        // B = Σ righe bene con beneSignificativo
  beniAltriCent: number;                // N = Σ righe bene non significative
  serviziCent: number;                  // S = Σ righe servizio
};
export type EsitoRisolutore = {
  prestazioneCent: number;              // P = N + S + M
  markupCent: number;                   // M (può essere < 0: la bozza lo mostra e blocca l'emissione)
  stornoCent: number;                   // Q = min(B, P) se B > 0, altrimenti 0
  riepilogo: RiepilogoIva[];            // solo aliquote con imponibile ≠ 0, ordine 22 poi 10
  imponibileCent: number; ivaCent: number; totaleCent: number;
  deltaPattuitoCent: number;            // totale − G (lordo) oppure imponibile − G (imponibile)
  casoBeniSignificativi: "b_maggiore_p" | "b_minore_uguale_p" | "senza_beni";
  avvertenze: string[];
};
export function risolvi(input: InputRisolutore): EsitoRisolutore;
export function impostaCent(imponibileCent: number, aliquota: Aliquota): number; // half-up
export function riequilibraBeni(righeBeniCent: number[], targetSommaCent: number): number[]; // scala in proporzione, resto sull'ultima, mai negativi
```

Regole (spec §7.2 + D-A):

1. `imponibile`: `P = G − B`, `M = P − N − S`.
2. `lordo`: ipotesi B > P: `P = round((G − 1,22·B) / 0,98)`; se `P ≥ B` l'ipotesi cade: `P = round(G / 1,10 − B)`. Poi `M = P − N − S`.
3. Riepilogo: `Q = min(B, P)` (0 se B = 0 o P < 0 → in quel caso nessuno storno e avvertenza); imponibile 22 % = `B − Q`; imponibile 10 % = `P + Q`; imposta = `impostaCent(imponibile, aliquota)` half-up al centesimo; totale = Σ imponibili + Σ imposte.
4. Ricerca del centesimo (solo `lordo`): se `totale ≠ G`, provare `P ± 1, ±2, ±3` centesimi e tenere il primo P che dà `totale = G`; altrimenti tenere il P iniziale e riportare `deltaPattuitoCent`. In `imponibile` il totale imponibile coincide sempre con G per costruzione; `deltaPattuitoCent = 0`.
5. `M < 0` → avvertenza `«I servizi e gli altri beni superano il pattuito di € X: riduci i servizi o riequilibra i beni.»`.

- [ ] **Step 1: Fixture reale (solo importi)**

```json
// server/fatture/__fixtures__/fatture-reali.json
{
  "_nota": "Tre fatture reali del 2026 (127, 129, 130) ridotte a importi: nessun dato personale. G è il totale che la commercialista ha scelto di tenere (spec §1 analisi: lordo del contratto in 127 e 129, imponibile in 130). Riepiloghi copiati dal PDF, al centesimo.",
  "casi": [
    { "nome": "fattura-127-2026", "input": { "pattuitoCent": 1549652, "pattuitoTipo": "lordo", "beniSignificativiCent": 884746, "beniAltriCent": 0, "serviziCent": 264500 },
      "atteso": { "prestazioneCent": 479859, "markupCent": 215359, "stornoCent": 479859, "caso": "b_maggiore_p",
                  "riepilogo": [ { "aliquota": 22, "imponibileCent": 404887, "impostaCent": 89075 }, { "aliquota": 10, "imponibileCent": 959718, "impostaCent": 95972 } ],
                  "imponibileCent": 1364605, "ivaCent": 185047, "totaleCent": 1549652, "deltaPattuitoCent": 0 } },
    { "nome": "fattura-129-2026", "input": { "pattuitoCent": 1409200, "pattuitoTipo": "lordo", "beniSignificativiCent": 356200, "beniAltriCent": 302091, "serviziCent": 505800 },
      "atteso": { "prestazioneCent": 924891, "markupCent": 117000, "stornoCent": 356200, "caso": "b_minore_uguale_p",
                  "riepilogo": [ { "aliquota": 10, "imponibileCent": 1281091, "impostaCent": 128109 } ],
                  "imponibileCent": 1281091, "ivaCent": 128109, "totaleCent": 1409200, "deltaPattuitoCent": 0 } },
    { "nome": "fattura-130-2026", "input": { "pattuitoCent": 571128, "pattuitoTipo": "imponibile", "beniSignificativiCent": 326228, "beniAltriCent": 0, "serviziCent": 184900 },
      "atteso": { "prestazioneCent": 244900, "markupCent": 60000, "stornoCent": 244900, "caso": "b_maggiore_p",
                  "riepilogo": [ { "aliquota": 22, "imponibileCent": 81328, "impostaCent": 17892 }, { "aliquota": 10, "imponibileCent": 489800, "impostaCent": 48980 } ],
                  "imponibileCent": 571128, "ivaCent": 66872, "totaleCent": 638000, "deltaPattuitoCent": 0 } }
  ]
}
```

- [ ] **Step 2: Test (fallisce)**

```ts
// server/fatture/risolutore.test.ts
import { describe, expect, it } from "vitest";
import casi from "./__fixtures__/fatture-reali.json";
import { impostaCent, riequilibraBeni, risolvi } from "./risolutore";

describe("risolutore — fatture reali", () => {
  for (const caso of casi.casi) {
    it(`${caso.nome} torna al centesimo`, () => {
      const esito = risolvi(caso.input as any);
      expect(esito.prestazioneCent).toBe(caso.atteso.prestazioneCent);
      expect(esito.markupCent).toBe(caso.atteso.markupCent);
      expect(esito.stornoCent).toBe(caso.atteso.stornoCent);
      expect(esito.casoBeniSignificativi).toBe(caso.atteso.caso);
      expect(esito.riepilogo).toEqual(caso.atteso.riepilogo);
      expect(esito.imponibileCent).toBe(caso.atteso.imponibileCent);
      expect(esito.ivaCent).toBe(caso.atteso.ivaCent);
      expect(esito.totaleCent).toBe(caso.atteso.totaleCent);
      expect(esito.deltaPattuitoCent).toBe(caso.atteso.deltaPattuitoCent);
      expect(esito.avvertenze).toEqual([]);
    });
  }
});

describe("risolutore — regole", () => {
  it("impostaCent arrotonda half-up", () => {
    expect(impostaCent(959718, 10)).toBe(95972);   // 95.971,8 → 95.972
    expect(impostaCent(404887, 22)).toBe(89075);   // 89.075,14
    expect(impostaCent(5, 10)).toBe(1);            // 0,5 → 1
  });
  it("lordo del contratto 127 (15.494,72) torna esatto con la ricerca del centesimo", () => {
    const e = risolvi({ pattuitoCent: 1549472, pattuitoTipo: "lordo", beniSignificativiCent: 884746, beniAltriCent: 0, serviziCent: 264500 });
    expect(e.totaleCent).toBe(1549472);
    expect(e.deltaPattuitoCent).toBe(0);
    expect(e.markupCent).toBe(215175);
  });
  it("con i prezzi del contratto il markup è negativo e l'avvertenza lo dice", () => {
    const e = risolvi({ pattuitoCent: 1549472, pattuitoTipo: "lordo", beniSignificativiCent: 1298611, beniAltriCent: 0, serviziCent: 264500 });
    expect(e.markupCent).toBeLessThan(0);
    expect(e.avvertenze[0]).toMatch(/superano il pattuito/);
    expect(e.stornoCent).toBe(0);
  });
  it("senza beni tutto va al 10 %", () => {
    const e = risolvi({ pattuitoCent: 110000, pattuitoTipo: "lordo", beniSignificativiCent: 0, beniAltriCent: 0, serviziCent: 60000 });
    expect(e.casoBeniSignificativi).toBe("senza_beni");
    expect(e.riepilogo).toEqual([{ aliquota: 10, imponibileCent: 100000, impostaCent: 10000 }]);
    expect(e.markupCent).toBe(40000);
  });
  it("delta dichiarato quando nessun centesimo torna", () => {
    // G scelto apposta perché nessun P in ±3 centesimi dia il totale esatto
    const e = risolvi({ pattuitoCent: 1000001, pattuitoTipo: "lordo", beniSignificativiCent: 700000, beniAltriCent: 0, serviziCent: 100000 });
    expect(Math.abs(e.deltaPattuitoCent)).toBeGreaterThan(0);
    expect(Math.abs(e.deltaPattuitoCent)).toBeLessThanOrEqual(3);
  });
  it("riequilibraBeni scala in proporzione e chiude il resto sull'ultima", () => {
    expect(riequilibraBeni([1000, 3000], 2000)).toEqual([500, 1500]);
    expect(riequilibraBeni([333, 333, 334], 500)).toEqual([167, 167, 166]);
    expect(riequilibraBeni([100], 0)).toEqual([0]);
    expect(riequilibraBeni([], 100)).toEqual([]);
  });
});
```

- [ ] **Step 3: Eseguire e vedere fallire**

Run: `pnpm vitest run server/fatture/risolutore.test.ts`
Expected: FAIL (modulo assente).

- [ ] **Step 4: Implementare**

```ts
// server/fatture/risolutore.ts
// Il risolutore della fattura (spec §7.2, delta D-A): dati il pattuito G e le
// somme di beni significativi B, altri beni N e servizi S, deriva prestazione
// P, markup M, storno Q e riepilogo IVA. Funzione pura, centesimi interi.
// Regola dei beni significativi (DM 29/12/1999): se B > P l'IVA 10 % vale su
// 2P e il 22 % su B − P; se B ≤ P tutto al 10 %.
import type { Aliquota, RiepilogoIva } from "@shared/fatturazione/tipi";

export type InputRisolutore = {
  pattuitoCent: number;
  pattuitoTipo: "lordo" | "imponibile";
  beniSignificativiCent: number;
  beniAltriCent: number;
  serviziCent: number;
};

export type EsitoRisolutore = {
  prestazioneCent: number;
  markupCent: number;
  stornoCent: number;
  riepilogo: RiepilogoIva[];
  imponibileCent: number;
  ivaCent: number;
  totaleCent: number;
  deltaPattuitoCent: number;
  casoBeniSignificativi: "b_maggiore_p" | "b_minore_uguale_p" | "senza_beni";
  avvertenze: string[];
};

export function impostaCent(imponibileCent: number, aliquota: Aliquota): number {
  // half-up sui centesimi: 95.971,8 → 95.972; l'EPSILON evita 0,5 letti come 0,4999
  return Math.floor((imponibileCent * aliquota) / 100 + 0.5 + Number.EPSILON);
}

function euro(cent: number): string {
  return (cent / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Riepilogo = {
  stornoCent: number; riepilogo: RiepilogoIva[]; imponibileCent: number; ivaCent: number; totaleCent: number;
  caso: EsitoRisolutore["casoBeniSignificativi"];
};

function riepilogoPer(B: number, P: number): Riepilogo {
  const caso: Riepilogo["caso"] = B <= 0 ? "senza_beni" : B > P ? "b_maggiore_p" : "b_minore_uguale_p";
  const Q = B > 0 && P > 0 ? Math.min(B, P) : 0;
  const imp22 = B - Q;
  const imp10 = P + Q;
  const righe: RiepilogoIva[] = [];
  if (imp22 !== 0) righe.push({ aliquota: 22, imponibileCent: imp22, impostaCent: impostaCent(imp22, 22) });
  if (imp10 !== 0) righe.push({ aliquota: 10, imponibileCent: imp10, impostaCent: impostaCent(imp10, 10) });
  const imponibileCent = righe.reduce((s, r) => s + r.imponibileCent, 0);
  const ivaCent = righe.reduce((s, r) => s + r.impostaCent, 0);
  return { stornoCent: Q, riepilogo: righe, imponibileCent, ivaCent, totaleCent: imponibileCent + ivaCent, caso };
}

export function risolvi(input: InputRisolutore): EsitoRisolutore {
  const G = input.pattuitoCent;
  const B = input.beniSignificativiCent;
  const N = input.beniAltriCent;
  const S = input.serviziCent;
  const avvertenze: string[] = [];

  let P: number;
  if (input.pattuitoTipo === "imponibile") {
    P = G - B;
  } else {
    P = Math.round((G - 1.22 * B) / 0.98);
    if (P >= B) P = Math.round(G / 1.1 - B);
  }

  let scelto = riepilogoPer(B, P);
  let deltaPattuitoCent = input.pattuitoTipo === "lordo" ? scelto.totaleCent - G : scelto.imponibileCent - G;
  if (input.pattuitoTipo === "lordo" && deltaPattuitoCent !== 0) {
    // Il centesimo che l'IVA non restituisce: si cerca intorno a P (spec §7.2).
    for (const passo of [1, -1, 2, -2, 3, -3]) {
      const tentativo = riepilogoPer(B, P + passo);
      if (tentativo.totaleCent === G) {
        P = P + passo;
        scelto = tentativo;
        deltaPattuitoCent = 0;
        break;
      }
    }
  }

  const M = P - N - S;
  if (M < 0) {
    avvertenze.push(
      `I servizi e gli altri beni superano il pattuito di € ${euro(-M)}: riduci i servizi o riequilibra i beni.`
    );
  }
  return {
    prestazioneCent: P,
    markupCent: M,
    stornoCent: M < 0 ? 0 : scelto.stornoCent,
    riepilogo: scelto.riepilogo,
    imponibileCent: scelto.imponibileCent,
    ivaCent: scelto.ivaCent,
    totaleCent: scelto.totaleCent,
    deltaPattuitoCent,
    casoBeniSignificativi: scelto.caso,
    avvertenze,
  };
}

/** Scala le righe bene in proporzione fino a `targetSommaCent`; resto sull'ultima; mai negativi. */
export function riequilibraBeni(righeBeniCent: number[], targetSommaCent: number): number[] {
  if (righeBeniCent.length === 0) return [];
  const somma = righeBeniCent.reduce((s, x) => s + x, 0);
  const target = Math.max(0, targetSommaCent);
  if (somma <= 0) {
    const base = Math.floor(target / righeBeniCent.length);
    const esito = righeBeniCent.map(() => base);
    esito[esito.length - 1] += target - base * righeBeniCent.length;
    return esito;
  }
  const esito = righeBeniCent.map(x => Math.round((x * target) / somma));
  const parziale = esito.slice(0, -1).reduce((s, x) => s + x, 0);
  esito[esito.length - 1] = Math.max(0, target - parziale);
  return esito;
}
```

Nota: nel caso `M < 0` il riepilogo resta calcolato su P (serve alla UI per mostrare cosa non torna) ma `stornoCent` è 0 e l'emissione è bloccata dalle validazioni (Task 6).

- [ ] **Step 5: Test verdi, commit**

Run: `pnpm vitest run server/fatture/risolutore.test.ts`
Expected: PASS, tre fatture reali al centesimo.

```bash
git add server/fatture/risolutore.ts server/fatture/risolutore.test.ts server/fatture/__fixtures__/fatture-reali.json
git commit -m "feat(fatture): risolutore IVA e markup che riproduce le tre fatture reali al centesimo"
```

---

### Task 4: Generatore della bozza (funzione pura)

**Files:**
- Create: `server/fatture/generatore.ts`
- Test: `server/fatture/generatore.test.ts`

**Interfaces:**
- Consumes: `Contratto`, `RigaContratto`, `Computo`, `VoceComputo` (`@shared/limiti/tipi`), `ClienteSnapshot`, `RigaFatturaInput`, `ScadenzaFatturaInput`, `FatturazioneConfig` (`@shared/fatturazione/tipi`), `DICITURE`, `dicitureDefault` (`@shared/fatturazione/diciture`), `risolvi` (Task 3).
- Produces:

```ts
export type InputGeneratore = {
  contratto: Contratto; righe: RigaContratto[]; computo: Computo | null;
  cliente: ClienteSnapshot | null; commessa: { codice: string; indirizzo: string | null; citta: string | null };
  config: FatturazioneConfig; dataFattura: string; // YYYY-MM-DD
};
export type Bozza = {
  righe: RigaFatturaInput[]; scadenze: ScadenzaFatturaInput[]; diciture: ChiaveDicitura[];
  intestazioneCantiere: string | null; note: string | null; avvertenze: string[];
};
export function generaBozza(input: InputGeneratore): Bozza;
/** Righe derivate + riepilogo da righe modificabili: la usa il servizio a ogni ricalcolo. */
export function ricalcola(input: { righe: RigaFatturaInput[]; pattuitoCent: number; pattuitoTipo: "lordo" | "imponibile" }): {
  righe: RigaFatturaInput[]; esito: EsitoRisolutore;
};
export function scadenzeDaRate(rate: RataContratto[], totaleCent: number, dataFattura: string): ScadenzaFatturaInput[];
export function descrizioneRigaBene(r: RigaContratto): string;
```

Regole:

1. **Intestazione**: riga `intestazione` con `DICITURE.intestazione` + `\n` + `DICITURE.seguira_ddt`; poi una riga `intestazione` `DICITURE.beni_significativi` + descrizione delle famiglie presenti (es. «Serramenti in PVC» dalle categorie delle righe bene significative; testo = elenco unico delle etichette `serramento_pvc → "Serramenti in PVC"`, `serramento_alluminio → "Serramenti in alluminio"`, `serramento_legno → "Serramenti in legno"`, `serramento_legno_alluminio → "Serramenti in legno-alluminio"`, altre → etichetta della categoria).
2. **Beni**: una riga `bene` per riga contratto con `prezzoTotCent` non nullo: descrizione = `descrizioneRigaBene(r)` = `N.${quantita} ${descrizione}${L e H ? ` L${L} x H${H}` : ""}` (+ ` con ${oscuranteIntegrato}` se abbinato); `quantita: 1`, `importoCent = prezzoTotCent`, `aliquota: 22`, `rigaCommessaId: r.id`, `beneSignificativo: r.beneSignificativo`. Righe contratto senza prezzo → avvertenza `«Riga "${descrizione}" senza prezzo: non è in fattura.»`. Se esistono beni non significativi, prima di essi una riga `intestazione` `DICITURE.beni_autonomi`.
3. **Servizi**: riga `intestazione` `DICITURE.prestazioni`, poi una riga `servizio` per ogni `VoceComputo` con `gruppo ∈ {"opere","eventuali"}`, `inclusa = true`, `limiteCent > 0`, escluso `codice === "altri_servizi"`; descrizione = `v.descrizione`, `importoCent = Math.floor(limiteCent / 100) * 100` (limite arrotondato all'euro **per difetto**), `aliquota: 10`, `voceComputoCodice: v.codice`, `limiteCent: v.limiteCent`. Ordine: quello del computo (`v.ordine`). Senza computo valido → nessuna riga servizio e avvertenza `«Computo assente: nessun servizio proposto.»`.
4. **Nota limite**: se il computo esiste, riga `nota`: `Calcolo limite massimo spesa zona climatica ${zona}:\n` + per ogni voce `gruppo === "prodotti"` con `codice` che inizia per `massimale_` e `limiteCent > 0`: `${quantita mq} mq x ${prezzoUnit €} = € ${limite}` + `\nLimite complessivo (min CHECK1/CHECK2) € ${limiteCent}` — ultima riga in coda alla fattura (dopo storno/riaddebito).
5. **Derivate** (via `ricalcola`): `markup` (`DICITURE.markup`, aliquota 10, `derivata: true`, importo = `esito.markupCent`), `storno_bs` (`DICITURE.storno_bs`, aliquota 22, importo `−stornoCent`), `riaddebito_bs` (aliquota 10, importo `+stornoCent`) — presenti solo se `stornoCent > 0`. `ricalcola` rimuove ogni riga `derivata: true` in ingresso, somma B/N/S dalle righe `bene`/`servizio`, chiama `risolvi`, e reinserisce le derivate: `markup` subito dopo l'ultima riga `bene` (prima dell'intestazione prestazioni), storno e riaddebito dopo l'ultimo `servizio`; le `nota` restano in coda. Rinumera `ordine` da 1.
6. **Diciture**: `dicitureDefault(contratto.detrazioneTipo)` + `pagamento_50_40_10` se le rate sono esattamente 50/40/10, + `spese_professionali_escluse` se `!contratto.opzioniComputo.speseProfessionali`. `intestazioneCantiere = "Intervento da effettuare presso " + (contratto.comuneCantiere ? `${commessa.indirizzo ?? ""} ${contratto.comuneCantiere}`.trim() : `${commessa.indirizzo ?? ""} ${commessa.citta ?? ""}`.trim())` oppure null se vuoto (+ avvertenza «Indirizzo del cantiere mancante» se detrazione ≠ nessuna).
7. **Scadenze** (`scadenzeDaRate`, D-I): con `rate` vuote → default `[{50,"all'ordine"},{40,"arrivo merce pronta"},{10,"posa in opera ultimata"}]`; importi = `Math.round(totaleCent * quotaPct / 100)` con il resto sull'ultima; date: `rata.data` se presente; altrimenti `dataFattura + giorni` con `giorni ?? [0, 60, 75, 90][min(indice, 3)]`. Il totale usato è `esito.totaleCent` della bozza (ricalcolata).
8. **Avvertenze** aggiunte: tutte quelle di `risolvi`; `«Cliente senza codice fiscale: obbligatorio con la detrazione.»` se `detrazioneTipo ≠ "nessuna"` e manca `codiceFiscale`.

- [ ] **Step 1: Test (fallisce)**

```ts
// server/fatture/generatore.test.ts
import { describe, expect, it } from "vitest";
import type { Computo, Contratto, RigaContratto } from "@shared/limiti/tipi";
import { FATTURAZIONE_CONFIG_DEFAULT } from "@shared/fatturazione/tipi";
import { descrizioneRigaBene, generaBozza, ricalcola, scadenzeDaRate } from "./generatore";

const ora = new Date("2026-09-04T10:00:00Z");
function contratto(extra: Partial<Contratto> = {}): Contratto {
  return {
    commessaId: 1, sedeId: 1, pattuitoCent: 1549472, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null,
    comuneCantiere: "Sarzana", codiceIstat: null, zonaClimatica: "D", zonaManuale: false, piano: 2, distanzaKm: null,
    detrazioneTipo: "ristrutturazione", detrazioneImmobile: "prima_casa", detrazionePct: 50, dataFirma: "2026-09-03",
    rate: [], opzioniComputo: { rilievo: "foro", speseProfessionali: false, eventuali: [] },
    hashRighe: "h1", hashParametri: "h2", origine: "manuale", documentoId: null, createdBy: null, updatedBy: null,
    createdAt: ora, updatedAt: ora, ...extra,
  } as Contratto;
}
function riga(id: number, descrizione: string, quantita: number, L: number, H: number, prezzoTotCent: number, beneSignificativo = true): RigaContratto {
  return {
    id, sedeId: 1, commessaId: 1, ordine: id, categoria: "serramento_pvc", tipologia: "C25077-e", oscuranteIntegrato: null,
    oscuranteTipologia: null, descrizione, quantita, larghezzaMm: L, altezzaMm: H, mq: 0, misuraDei: null,
    prezzoUnitCent: null, prezzoTotCent, beneSignificativo, accessori: [], note: null, origine: "manuale", evidenza: null,
    createdAt: ora, updatedAt: ora,
  };
}
function computo(): Computo {
  const voce = (ordine: number, gruppo: any, codice: string, descrizione: string, limiteCent: number, extra: any = {}) => ({
    gruppo, codice, descrizione, codiceDei: null, unita: "cad", prezzoUnitCent: 0, quantita: 1, limiteCent, dettaglio: {}, ordine,
    inclusa: true, inCheck1: true, inCheck2: true, ...extra,
  });
  return {
    id: 7, sedeId: 1, commessaId: 1, hashRighe: "h1", hashParametri: "h2", tariffeAl: "2022-04-15", zona: "D", esito: "ok",
    check1Cent: 1951984, check2Cent: 1930728, deiProdottiCent: 1723146, limiteCent: 1930728, detraibileCent: 1408611,
    detrazioneStimataCent: 704306, avvertenze: [], createdBy: null, createdAt: ora,
    voci: [
      voce(1, "prodotti", "massimale_A", "Serramenti — massimale Allegato A", 1603976, { unita: "mq", quantita: 20.5638, prezzoUnitCent: 78000 }),
      voce(10, "opere", "rilievo_foro", "Rilievo tecnico delle misure esecutive", 18051),
      voce(11, "opere", "posa", "POSA IN OPERA certificata", 131400),
      voce(12, "opere", "spese_professionali", "Spese professionali", 60000, { inclusa: false }),
      voce(13, "opere", "altri_servizi", "Altri servizi 2 %", 25000),
      voce(14, "eventuali", "dime", "Dime", 129384, { inclusa: false }),
    ],
  } as Computo;
}
const righe = [riga(1, "Portafinestra a 2 ante a battente", 3, 1900, 2400, 778373), riga(2, "Finestra a 2 ante a battente", 2, 1660, 1540, 295082), riga(3, "Maniglie mod. Lama", 6, 0, 0, 60000, false)];
const base = { cliente: null, commessa: { codice: "COM-2026-001", indirizzo: "Via Alta 80", citta: "Sarzana" }, config: { ...FATTURAZIONE_CONFIG_DEFAULT, sedeId: 1, updatedAt: ora }, dataFattura: "2026-09-04" };

describe("generaBozza", () => {
  it("beni dalle righe, servizi dai limiti arrotondati per difetto, derivate e nota limite", () => {
    const b = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base });
    const tipi = b.righe.map(r => r.tipo);
    expect(tipi[0]).toBe("intestazione");
    expect(b.righe.filter(r => r.tipo === "bene")).toHaveLength(3);
    expect(b.righe.find(r => r.rigaCommessaId === 1)!.descrizione).toBe("N.3 Portafinestra a 2 ante a battente L1900 x H2400");
    expect(b.righe.find(r => r.rigaCommessaId === 3)!.beneSignificativo).toBe(false);
    const servizi = b.righe.filter(r => r.tipo === "servizio");
    expect(servizi.map(s => s.voceComputoCodice)).toEqual(["rilievo_foro", "posa"]); // niente spese prof. (esclusa), altri_servizi, dime
    expect(servizi[0].importoCent).toBe(18000); // 180,51 → 180
    expect(servizi[0].limiteCent).toBe(18051);
    expect(b.righe.some(r => r.tipo === "markup" && r.derivata)).toBe(true);
    expect(b.righe.filter(r => r.tipo === "nota").at(-1)!.descrizione).toMatch(/Calcolo limite massimo spesa zona climatica D/);
    expect(b.diciture).toEqual(["intervento_manutenzione", "bonifico_ristrutturazione", "indicare_cf", "copia_ade", "pagamento_50_40_10", "spese_professionali_escluse"]);
    expect(b.intestazioneCantiere).toBe("Intervento da effettuare presso Via Alta 80 Sarzana");
    expect(b.scadenze.map(s => s.quotaPct)).toEqual([50, 40, 10]);
    expect(b.avvertenze).toContain("Cliente senza codice fiscale: obbligatorio con la detrazione.");
  });
  it("senza computo: nessun servizio e avvertenza", () => {
    const b = generaBozza({ contratto: contratto(), righe, computo: null, ...base });
    expect(b.righe.filter(r => r.tipo === "servizio")).toHaveLength(0);
    expect(b.avvertenze).toContain("Computo assente: nessun servizio proposto.");
  });
});

describe("ricalcola", () => {
  it("toglie le derivate vecchie, ricalcola dal risolutore e rinumera", () => {
    const righeIn = [
      { ordine: 1, tipo: "bene", descrizione: "b", quantita: 1, prezzoUnitCent: 884746, importoCent: 884746, aliquota: 22, voceComputoCodice: null, rigaCommessaId: 1, limiteCent: null, beneSignificativo: true, derivata: false },
      { ordine: 2, tipo: "markup", descrizione: "vecchio", quantita: 1, prezzoUnitCent: 1, importoCent: 1, aliquota: 10, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: false, derivata: true },
      { ordine: 3, tipo: "servizio", descrizione: "s", quantita: 1, prezzoUnitCent: 264500, importoCent: 264500, aliquota: 10, voceComputoCodice: "posa", rigaCommessaId: null, limiteCent: 300000, beneSignificativo: false, derivata: false },
    ] as const;
    const { righe: out, esito } = ricalcola({ righe: righeIn as any, pattuitoCent: 1549652, pattuitoTipo: "lordo" });
    expect(esito.markupCent).toBe(215359);
    expect(out.map(r => r.tipo)).toEqual(["bene", "markup", "servizio", "storno_bs", "riaddebito_bs"]);
    expect(out.map(r => r.ordine)).toEqual([1, 2, 3, 4, 5]);
    expect(out.find(r => r.tipo === "storno_bs")!.importoCent).toBe(-479859);
    expect(out.find(r => r.tipo === "riaddebito_bs")!.importoCent).toBe(479859);
  });
});

describe("scadenzeDaRate", () => {
  it("default 50/40/10 con date 0/60/75 giorni e resto sull'ultima", () => {
    const s = scadenzeDaRate([], 1549652, "2026-09-04");
    expect(s.map(x => x.importoCent)).toEqual([774826, 619861, 154965]);
    expect(s.map(x => x.data)).toEqual(["2026-09-04", "2026-11-03", "2026-11-18"]);
    expect(s.reduce((a, x) => a + x.importoCent, 0)).toBe(1549652);
  });
  it("usa data e giorni della rata quando ci sono", () => {
    const s = scadenzeDaRate([{ numero: 1, quotaPct: 70, giorni: null, data: "2026-10-01", descrizione: "Agos" }, { numero: 2, quotaPct: 30, giorni: 10, data: null, descrizione: null }], 100000, "2026-09-04");
    expect(s.map(x => x.data)).toEqual(["2026-10-01", "2026-09-14"]);
    expect(s.map(x => x.importoCent)).toEqual([70000, 30000]);
  });
});

describe("descrizioneRigaBene", () => {
  it("senza misure niente L×H", () => {
    expect(descrizioneRigaBene(riga(9, "Maniglie", 6, 0, 0, 1))).toBe("N.6 Maniglie");
  });
});
```

Nota: nel test `riga(3, "Maniglie", 6, 0, 0, …)` L/H valgono 0: `descrizioneRigaBene` tratta 0/null come «senza misure».

- [ ] **Step 2: Eseguire e vedere fallire**

Run: `pnpm vitest run server/fatture/generatore.test.ts`
Expected: FAIL (modulo assente).

- [ ] **Step 3: Implementare**

```ts
// server/fatture/generatore.ts
// La bozza nasce dal contratto (beni), dal computo (servizi entro i limiti,
// nota del calcolo) e dalle diciture; le righe derivate (markup, storno e
// riaddebito dei beni significativi) escono dal risolutore a ogni ricalcolo,
// mai a mano. Funzione pura: il servizio la chiama e persiste.
import { DICITURE, dicitureDefault, type ChiaveDicitura } from "@shared/fatturazione/diciture";
import type { ClienteSnapshot, FatturazioneConfig, RigaFatturaInput, ScadenzaFatturaInput } from "@shared/fatturazione/tipi";
import type { CategoriaRiga, Computo, Contratto, RataContratto, RigaContratto, VoceComputo } from "@shared/limiti/tipi";
import { risolvi, type EsitoRisolutore } from "./risolutore";

export type InputGeneratore = {
  contratto: Contratto; righe: RigaContratto[]; computo: Computo | null;
  cliente: ClienteSnapshot | null; commessa: { codice: string; indirizzo: string | null; citta: string | null };
  config: FatturazioneConfig; dataFattura: string;
};
export type Bozza = {
  righe: RigaFatturaInput[]; scadenze: ScadenzaFatturaInput[]; diciture: ChiaveDicitura[];
  intestazioneCantiere: string | null; note: string | null; avvertenze: string[];
};

const FAMIGLIA: Partial<Record<CategoriaRiga, string>> = {
  serramento_pvc: "Serramenti in PVC", serramento_alluminio: "Serramenti in alluminio",
  serramento_legno: "Serramenti in legno", serramento_legno_alluminio: "Serramenti in legno-alluminio",
  cassonetto: "Cassonetti", tapparella: "Tapparelle", persiana: "Persiane", scuro: "Scuri",
  porta_blindata: "Porte blindate", portoncino: "Portoncini",
};

function rigaBase(tipo: RigaFatturaInput["tipo"], descrizione: string, importoCent: number, aliquota: 22 | 10 | null): RigaFatturaInput {
  return { ordine: 0, tipo, descrizione, quantita: 1, prezzoUnitCent: importoCent, importoCent, aliquota, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: false, derivata: false };
}

export function descrizioneRigaBene(r: RigaContratto): string {
  const misure = r.larghezzaMm && r.altezzaMm ? ` L${r.larghezzaMm} x H${r.altezzaMm}` : "";
  const oscurante = r.oscuranteIntegrato ? ` con ${r.oscuranteIntegrato}` : "";
  return `N.${r.quantita} ${r.descrizione}${misure}${oscurante}`;
}

function euro(cent: number): string {
  return (cent / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function servizioProposto(v: VoceComputo): boolean {
  return (v.gruppo === "opere" || v.gruppo === "eventuali") && v.inclusa && v.limiteCent > 0 && v.codice !== "altri_servizi";
}

function notaLimite(computo: Computo): string {
  const righe = computo.voci
    .filter(v => v.gruppo === "prodotti" && v.codice.startsWith("massimale_") && v.limiteCent > 0)
    .map(v => `${v.quantita.toLocaleString("it-IT", { maximumFractionDigits: 2 })} mq x ${euro(v.prezzoUnitCent)} = € ${euro(v.limiteCent)}`);
  return [`Calcolo limite massimo spesa zona climatica ${computo.zona ?? "-"}:`, ...righe, `Limite complessivo (min CHECK1/CHECK2) € ${euro(computo.limiteCent)}`].join("\n");
}

function aggiungiGiorni(iso: string, giorni: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
}

const GIORNI_DEFAULT = [0, 60, 75, 90];
const RATE_DEFAULT: RataContratto[] = [
  { numero: 1, quotaPct: 50, giorni: null, data: null, descrizione: "all'ordine" },
  { numero: 2, quotaPct: 40, giorni: null, data: null, descrizione: "arrivo merce pronta" },
  { numero: 3, quotaPct: 10, giorni: null, data: null, descrizione: "posa in opera ultimata" },
];

export function scadenzeDaRate(rate: RataContratto[], totaleCent: number, dataFattura: string): ScadenzaFatturaInput[] {
  const effettive = rate.length > 0 ? rate : RATE_DEFAULT;
  const importi = effettive.map(r => Math.round((totaleCent * r.quotaPct) / 100));
  const parziale = importi.slice(0, -1).reduce((s, x) => s + x, 0);
  importi[importi.length - 1] = totaleCent - parziale;
  return effettive.map((r, i) => ({
    numero: r.numero, quotaPct: r.quotaPct, importoCent: importi[i], descrizione: r.descrizione,
    data: r.data ?? aggiungiGiorni(dataFattura, r.giorni ?? GIORNI_DEFAULT[Math.min(i, GIORNI_DEFAULT.length - 1)]),
  }));
}

function rinumera(righe: RigaFatturaInput[]): RigaFatturaInput[] {
  return righe.map((r, i) => ({ ...r, ordine: i + 1 }));
}

export function ricalcola(input: { righe: RigaFatturaInput[]; pattuitoCent: number; pattuitoTipo: "lordo" | "imponibile" }): { righe: RigaFatturaInput[]; esito: EsitoRisolutore } {
  const fisse = input.righe.filter(r => !r.derivata);
  const beni = fisse.filter(r => r.tipo === "bene");
  const B = beni.filter(r => r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0);
  const N = beni.filter(r => !r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0);
  const S = fisse.filter(r => r.tipo === "servizio").reduce((s, r) => s + r.importoCent, 0);
  const esito = risolvi({ pattuitoCent: input.pattuitoCent, pattuitoTipo: input.pattuitoTipo, beniSignificativiCent: B, beniAltriCent: N, serviziCent: S });

  const markup = { ...rigaBase("markup", DICITURE.markup, esito.markupCent, 10), derivata: true };
  const storno = { ...rigaBase("storno_bs", DICITURE.storno_bs, -esito.stornoCent, 22), derivata: true };
  const riaddebito = { ...rigaBase("riaddebito_bs", DICITURE.riaddebito_bs, esito.stornoCent, 10), derivata: true };

  const corpo = fisse.filter(r => r.tipo !== "nota");
  const note = fisse.filter(r => r.tipo === "nota");
  const ultimoBene = corpo.map(r => r.tipo).lastIndexOf("bene");
  const conMarkup = [...corpo.slice(0, ultimoBene + 1), markup, ...corpo.slice(ultimoBene + 1)];
  const ultimoServizio = conMarkup.map(r => r.tipo).lastIndexOf("servizio");
  const posizione = ultimoServizio >= 0 ? ultimoServizio + 1 : conMarkup.length;
  const conStorno = esito.stornoCent > 0
    ? [...conMarkup.slice(0, posizione), storno, riaddebito, ...conMarkup.slice(posizione)]
    : conMarkup;
  return { righe: rinumera([...conStorno, ...note]), esito };
}

export function generaBozza(input: InputGeneratore): Bozza {
  const { contratto, computo } = input;
  const avvertenze: string[] = [];
  const righe: RigaFatturaInput[] = [];

  righe.push(rigaBase("intestazione", `${DICITURE.intestazione}\n${DICITURE.seguira_ddt}`, 0, null));
  const significative = input.righe.filter(r => r.beneSignificativo);
  const famiglie = [...new Set(significative.map(r => FAMIGLIA[r.categoria] ?? r.categoria))];
  righe.push(rigaBase("intestazione", `${DICITURE.beni_significativi} ${famiglie.join(", ")}`.trim(), 0, null));

  const bene = (r: RigaContratto): RigaFatturaInput => ({
    ...rigaBase("bene", descrizioneRigaBene(r), r.prezzoTotCent ?? 0, 22), rigaCommessaId: r.id, beneSignificativo: r.beneSignificativo,
  });
  for (const r of input.righe) {
    if (r.prezzoTotCent == null) { avvertenze.push(`Riga "${r.descrizione}" senza prezzo: non è in fattura.`); continue; }
    if (r.beneSignificativo) righe.push(bene(r));
  }
  const altri = input.righe.filter(r => !r.beneSignificativo && r.prezzoTotCent != null);
  if (altri.length > 0) {
    righe.push(rigaBase("intestazione", DICITURE.beni_autonomi, 0, null));
    for (const r of altri) righe.push(bene(r));
  }

  righe.push(rigaBase("intestazione", DICITURE.prestazioni, 0, null));
  if (computo) {
    for (const v of [...computo.voci].sort((a, b) => a.ordine - b.ordine).filter(servizioProposto)) {
      righe.push({ ...rigaBase("servizio", v.descrizione, Math.floor(v.limiteCent / 100) * 100, 10), voceComputoCodice: v.codice, limiteCent: v.limiteCent });
    }
    righe.push(rigaBase("nota", notaLimite(computo), 0, null));
  } else {
    avvertenze.push("Computo assente: nessun servizio proposto.");
  }

  const { righe: complete, esito } = ricalcola({ righe, pattuitoCent: contratto.pattuitoCent, pattuitoTipo: contratto.pattuitoTipo });
  avvertenze.push(...esito.avvertenze);

  const diciture = dicitureDefault(contratto.detrazioneTipo);
  const quote = contratto.rate.map(r => r.quotaPct);
  if (quote.length === 0 || (quote.length === 3 && quote[0] === 50 && quote[1] === 40 && quote[2] === 10)) diciture.push("pagamento_50_40_10");
  if (!contratto.opzioniComputo.speseProfessionali) diciture.push("spese_professionali_escluse");

  const luogo = `${input.commessa.indirizzo ?? ""} ${contratto.comuneCantiere ?? input.commessa.citta ?? ""}`.trim();
  const intestazioneCantiere = luogo ? `Intervento da effettuare presso ${luogo}` : null;
  if (!intestazioneCantiere && contratto.detrazioneTipo !== "nessuna") avvertenze.push("Indirizzo del cantiere mancante.");
  if (contratto.detrazioneTipo !== "nessuna" && !input.cliente?.codiceFiscale) avvertenze.push("Cliente senza codice fiscale: obbligatorio con la detrazione.");

  return {
    righe: complete,
    scadenze: scadenzeDaRate(contratto.rate, esito.totaleCent, input.dataFattura),
    diciture, intestazioneCantiere, note: null, avvertenze,
  };
}
```

- [ ] **Step 4: Test verdi, commit**

Run: `pnpm vitest run server/fatture/generatore.test.ts server/fatture/risolutore.test.ts`
Expected: PASS.

```bash
git add server/fatture/generatore.ts server/fatture/generatore.test.ts
git commit -m "feat(fatture): generatore della bozza da contratto e computo, righe derivate dal risolutore"
```

---

### Task 5: Repository fatture e configurazione (memoria + PostgreSQL)

**Files:**
- Create: `server/fatture/repository.ts`
- Test: `server/fatture/repository.test.ts` (memoria), `server/fatture/repository.pg.test.ts` (Postgres)

**Interfaces:**
- Consumes: tipi di `@shared/fatturazione/tipi`; `kvSql` da `server/_core/persistence`; pattern di `server/computo/repository.ts` (memoizzazione `ensureSchema`, `structuredClone`, bulk insert `tx(rows, ...cols)`, `getXRepository()` singleton + `_resetXRepositoryForTests`).
- Produces:

```ts
export type FatturaPersist = Omit<Fattura, "id" | "createdAt" | "updatedAt" | "righe" | "riepilogo" | "scadenze" | "revisione">;
export type PatchBozza = Partial<Pick<Fattura, "diciture" | "note" | "intestazioneCantiere" | "imponibileCent" | "ivaCent" | "totaleCent" | "deltaPattuitoCent" | "markupCent" | "stornoCent" | "computoId" | "hashRighe" | "scavalcoLimiti" | "scavalcoMotivo" | "pattuitoCent" | "pattuitoTipo" | "detrazioneTipo" | "clienteSnapshot">>;
export type PatchStato = Partial<Pick<Fattura, "stato" | "ficDocumentId" | "numero" | "data" | "clienteSnapshot" | "pdfStorageKey" | "xmlStorageKey" | "xmlSha256" | "documentoId" | "eiStatusFic" | "eiErrore" | "inviataDryRun" | "emessaDa" | "emessaAt" | "imponibileCent" | "ivaCent" | "totaleCent">>;
export type FiltroFatture = { sedeId: number; stati?: StatoFattura[]; tipo?: TipoFattura; limite?: number };

export type FattureRepository = {
  ensureSchema(): Promise<void>;
  // configurazione per sede
  config(sedeId: number): Promise<FatturazioneConfig>;                 // default se assente
  salvaConfig(config: FatturazioneConfig): Promise<FatturazioneConfig>;
  // fatture
  crea(input: { fattura: FatturaPersist; righe: RigaFatturaInput[]; riepilogo: RiepilogoIva[]; scadenze: ScadenzaFatturaInput[]; now: Date }): Promise<Fattura>;
  perId(sedeId: number, id: number): Promise<Fattura | null>;
  perCommessa(sedeId: number, commessaId: number): Promise<Fattura[]>;   // più recente prima
  perFicDocumentId(sedeId: number, ficDocumentId: number): Promise<Fattura | null>;
  lista(filtro: FiltroFatture): Promise<Fattura[]>;                      // senza righe (voci vuote) per le liste
  daSondare(): Promise<Array<Pick<Fattura, "id" | "sedeId" | "ficDocumentId" | "stato" | "inviataDryRun">>>; // stati inviata, o emessa con dry-run, su tutte le sedi
  /** Sostituisce righe/riepilogo/scadenze e aggiorna i totali. Blocco ottimistico: `revisioneAttesa` ≠ corrente → CONFLITTO. */
  aggiornaBozza(input: { sedeId: number; id: number; revisioneAttesa: number; patch: PatchBozza; righe: RigaFatturaInput[]; riepilogo: RiepilogoIva[]; scadenze: ScadenzaFatturaInput[]; now: Date }): Promise<Fattura>;
  /** Cambia stato/campi di emissione senza toccare le righe. */
  aggiornaStato(input: { sedeId: number; id: number; patch: PatchStato; now: Date }): Promise<Fattura>;
  aggiornaScadenza(input: { sedeId: number; fatturaId: number; numero: number; patch: Partial<Pick<ScadenzaFattura, "ficPaymentId" | "stato">> }): Promise<void>;
  appendEvento(evento: Omit<EventoFattura, "id" | "createdAt"> & { createdAt?: Date }): Promise<EventoFattura>;
  eventi(sedeId: number, fatturaId: number): Promise<EventoFattura[]>;    // cronologici
};
export function createMemoryFattureRepository(): FattureRepository;
export function createPostgresFattureRepository(sql: NonNullable<typeof kvSql>): FattureRepository;
export function getFattureRepository(): FattureRepository;
export function _resetFattureRepositoryForTests(): void;
```

Errori: `aggiornaBozza` con revisione diversa lancia `Error("CONFLITTO: la fattura è stata modificata da un'altra sessione, ricarica.")`; ogni metodo con `(sedeId, id)` che non trova la fattura **nella sede** restituisce `null` (letture) o lancia `Error("NOT_FOUND: Fattura non trovata.")` (scritture). L'immutabilità dagli stati ≠ `bozza` è del servizio (Task 6), non del repository.

DDL (dentro un unico `sql.begin`, ordine: config, fatture, righe, riepilogo, scadenze, eventi):

```sql
CREATE TABLE IF NOT EXISTS fatturazione_config (
  sede_id BIGINT PRIMARY KEY,
  iban TEXT, banca TEXT, intestatario TEXT,
  metodo_pagamento TEXT NOT NULL DEFAULT 'MP05',
  numerazione_fic TEXT, payment_account_id_fic BIGINT,
  vat_ids_fic JSONB NOT NULL DEFAULT '{"22":null,"10":null}'::jsonb,
  dicitura_footer TEXT,
  scope_scrittura_ok BOOLEAN NOT NULL DEFAULT FALSE, scope_verificato_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS fatture (
  id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, commessa_id BIGINT NOT NULL,
  computo_id BIGINT, hash_righe TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('fattura','nota_credito')), nota_credito_di BIGINT,
  stato TEXT NOT NULL CHECK (stato IN ('bozza','in_emissione','emessa','inviata','consegnata','scartata','rifiutata','mancata_consegna','annullata')),
  fic_document_id BIGINT, numero TEXT, data DATE,
  cliente_snapshot JSONB,
  pattuito_tipo TEXT NOT NULL CHECK (pattuito_tipo IN ('lordo','imponibile')), pattuito_cent BIGINT NOT NULL,
  imponibile_cent BIGINT NOT NULL DEFAULT 0, iva_cent BIGINT NOT NULL DEFAULT 0, totale_cent BIGINT NOT NULL DEFAULT 0,
  delta_pattuito_cent BIGINT NOT NULL DEFAULT 0, markup_cent BIGINT NOT NULL DEFAULT 0, storno_cent BIGINT NOT NULL DEFAULT 0,
  diciture JSONB NOT NULL DEFAULT '[]'::jsonb, note TEXT, intestazione_cantiere TEXT,
  detrazione_tipo TEXT NOT NULL DEFAULT 'nessuna' CHECK (detrazione_tipo IN ('nessuna','ecobonus','ristrutturazione')),
  pdf_storage_key TEXT, xml_storage_key TEXT, xml_sha256 TEXT, documento_id BIGINT,
  ei_status_fic TEXT, ei_errore TEXT, inviata_dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  scavalco_limiti BOOLEAN NOT NULL DEFAULT FALSE, scavalco_motivo TEXT,
  created_by BIGINT, emessa_da BIGINT, emessa_at TIMESTAMPTZ, revisione INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fatture_sede_commessa_idx ON fatture (sede_id, commessa_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS fatture_fic_document_idx ON fatture (sede_id, fic_document_id) WHERE fic_document_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS fattura_righe (
  id BIGSERIAL PRIMARY KEY, fattura_id BIGINT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE, ordine INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('intestazione','bene','servizio','markup','storno_bs','riaddebito_bs','nota')),
  descrizione TEXT NOT NULL, quantita NUMERIC(10,3) NOT NULL DEFAULT 1, prezzo_unit_cent BIGINT NOT NULL DEFAULT 0, importo_cent BIGINT NOT NULL DEFAULT 0,
  aliquota INTEGER CHECK (aliquota IN (22,10)), voce_computo_codice TEXT, riga_commessa_id BIGINT, limite_cent BIGINT,
  bene_significativo BOOLEAN NOT NULL DEFAULT FALSE, derivata BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS fattura_righe_fattura_idx ON fattura_righe (fattura_id, ordine);
CREATE TABLE IF NOT EXISTS fattura_riepilogo_iva (
  fattura_id BIGINT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE, aliquota INTEGER NOT NULL,
  imponibile_cent BIGINT NOT NULL, imposta_cent BIGINT NOT NULL, PRIMARY KEY (fattura_id, aliquota)
);
CREATE TABLE IF NOT EXISTS fattura_scadenze (
  id BIGSERIAL PRIMARY KEY, fattura_id BIGINT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE, numero INTEGER NOT NULL,
  quota_pct NUMERIC(6,2) NOT NULL, data DATE NOT NULL, importo_cent BIGINT NOT NULL, descrizione TEXT,
  fic_payment_id BIGINT, stato TEXT NOT NULL DEFAULT 'attesa' CHECK (stato IN ('attesa','pagata','stornata')),
  UNIQUE (fattura_id, numero)
);
CREATE TABLE IF NOT EXISTS fattura_eventi (
  id BIGSERIAL PRIMARY KEY, fattura_id BIGINT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE, sede_id BIGINT NOT NULL,
  tipo TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, actor_user_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fattura_eventi_fattura_idx ON fattura_eventi (fattura_id, id);
```

Mapper: `DATE` letti come `Date` dal driver → `instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10)` (lezione del piano 1); `NUMERIC` → `Number(...)`; `BIGINT` → `Number(...)`. `aggiornaBozza` in transazione: `UPDATE fatture SET … , revisione = revisione + 1 WHERE id = $id AND sede_id = $sede AND revisione = $attesa RETURNING *` → 0 righe = CONFLITTO (o NOT_FOUND se la fattura non esiste nella sede: distinguere con una SELECT precedente); poi `DELETE` + bulk `INSERT` di righe, riepilogo, scadenze (le scadenze conservano `fic_payment_id`/`stato` per `numero` se già presenti: leggere prima, riapplicare dopo). Ordinare `RETURNING` in memoria per `ordine`.

- [ ] **Step 1: Test in memoria (fallisce)**

```ts
// server/fatture/repository.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryFattureRepository, type FattureRepository } from "./repository";

const ora = new Date("2026-09-04T09:00:00Z");
const fattura = (sedeId = 1) => ({
  sedeId, commessaId: 10, computoId: null, hashRighe: "h", tipo: "fattura" as const, notaCreditoDi: null, stato: "bozza" as const,
  ficDocumentId: null, numero: null, data: null, clienteSnapshot: null, pattuitoTipo: "lordo" as const, pattuitoCent: 100000,
  imponibileCent: 0, ivaCent: 0, totaleCent: 0, deltaPattuitoCent: 0, markupCent: 0, stornoCent: 0, diciture: [], note: null,
  intestazioneCantiere: null, detrazioneTipo: "nessuna" as const, pdfStorageKey: null, xmlStorageKey: null, xmlSha256: null, documentoId: null,
  eiStatusFic: null, eiErrore: null, inviataDryRun: false, scavalcoLimiti: false, scavalcoMotivo: null, createdBy: 5, emessaDa: null, emessaAt: null,
});
const riga = (ordine: number) => ({ ordine, tipo: "bene" as const, descrizione: `r${ordine}`, quantita: 1, prezzoUnitCent: 100, importoCent: 100, aliquota: 22 as const, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: true, derivata: false });
const scadenza = (numero: number) => ({ numero, quotaPct: 50, data: "2026-09-04", importoCent: 50, descrizione: null });

describe("repository fatture (memoria)", () => {
  let repo: FattureRepository;
  beforeEach(() => { repo = createMemoryFattureRepository(); });

  it("crea, rilegge per id/commessa e isola la sede", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [riga(2), riga(1)], riepilogo: [{ aliquota: 22, imponibileCent: 200, impostaCent: 44 }], scadenze: [scadenza(1), scadenza(2)], now: ora });
    expect(f.id).toBeGreaterThan(0);
    expect(f.revisione).toBe(1);
    expect(f.righe.map(r => r.ordine)).toEqual([1, 2]);
    expect((await repo.perId(1, f.id))?.scadenze).toHaveLength(2);
    expect(await repo.perId(2, f.id)).toBeNull();
    expect(await repo.perCommessa(1, 10)).toHaveLength(1);
    expect(await repo.perCommessa(2, 10)).toHaveLength(0);
  });

  it("aggiornaBozza rispetta la revisione e conserva lo stato delle scadenze già collegate", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [riga(1)], riepilogo: [], scadenze: [scadenza(1)], now: ora });
    await repo.aggiornaScadenza({ sedeId: 1, fatturaId: f.id, numero: 1, patch: { ficPaymentId: 77, stato: "pagata" } });
    const g = await repo.aggiornaBozza({ sedeId: 1, id: f.id, revisioneAttesa: 1, patch: { note: "ok", totaleCent: 999 }, righe: [riga(1), riga(2)], riepilogo: [], scadenze: [scadenza(1), scadenza(2)], now: ora });
    expect(g.revisione).toBe(2);
    expect(g.note).toBe("ok");
    expect(g.righe).toHaveLength(2);
    expect(g.scadenze.find(s => s.numero === 1)?.ficPaymentId).toBe(77);
    expect(g.scadenze.find(s => s.numero === 1)?.stato).toBe("pagata");
    await expect(repo.aggiornaBozza({ sedeId: 1, id: f.id, revisioneAttesa: 1, patch: {}, righe: [], riepilogo: [], scadenze: [], now: ora })).rejects.toThrow(/^CONFLITTO/);
    await expect(repo.aggiornaBozza({ sedeId: 2, id: f.id, revisioneAttesa: 2, patch: {}, righe: [], riepilogo: [], scadenze: [], now: ora })).rejects.toThrow(/^NOT_FOUND/);
  });

  it("aggiornaStato, perFicDocumentId, daSondare, eventi", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    await repo.aggiornaStato({ sedeId: 1, id: f.id, patch: { stato: "emessa", ficDocumentId: 4242, numero: "12/2026", data: "2026-09-04", inviataDryRun: true }, now: ora });
    expect((await repo.perFicDocumentId(1, 4242))?.id).toBe(f.id);
    expect((await repo.daSondare()).map(x => x.id)).toEqual([f.id]);
    await repo.aggiornaStato({ sedeId: 1, id: f.id, patch: { stato: "consegnata" }, now: ora });
    expect(await repo.daSondare()).toHaveLength(0);
    await repo.appendEvento({ fatturaId: f.id, sedeId: 1, tipo: "creata_fic", payload: { ficDocumentId: 4242 }, actorUserId: 5 });
    const eventi = await repo.eventi(1, f.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creata_fic"]);
    expect(await repo.eventi(2, f.id)).toEqual([]);
  });

  it("config: default poi salvataggio per sede", async () => {
    const c = await repo.config(1);
    expect(c.metodoPagamento).toBe("MP05");
    expect(c.scopeScritturaOk).toBe(false);
    const salvata = await repo.salvaConfig({ ...c, iban: "IT00X", vatIdsFic: { 22: 3, 10: 4 } });
    expect((await repo.config(1)).vatIdsFic).toEqual({ 22: 3, 10: 4 });
    expect((await repo.config(2)).iban).toBeNull();
    expect(salvata.updatedAt).toBeInstanceOf(Date);
  });

  it("lista filtra per stato e tipo, più recente prima", async () => {
    const a = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    const b = await repo.crea({ fattura: { ...fattura(), tipo: "nota_credito", notaCreditoDi: a.id }, righe: [], riepilogo: [], scadenze: [], now: new Date(ora.getTime() + 1000) });
    expect((await repo.lista({ sedeId: 1 })).map(f => f.id)).toEqual([b.id, a.id]);
    expect((await repo.lista({ sedeId: 1, tipo: "nota_credito" })).map(f => f.id)).toEqual([b.id]);
    expect(await repo.lista({ sedeId: 1, stati: ["emessa"] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Test Postgres (stessi casi)**

`server/fatture/repository.pg.test.ts`: stessa suite con `describe.skipIf(!conDatabase)`, `createPostgresFattureRepository(kvSql!)`, `beforeAll(ensureSchema + DELETE FROM fatture/fatturazione_config WHERE sede_id IN (SEDE_A, SEDE_B))`, `afterAll` identico; `SEDE_A = 99410`, `SEDE_B = 99411` al posto di 1 e 2. Aggiungere il caso «due righe con `derivata` diverse e `aliquota` null tornano com'erano» (JSONB/NULL nel bulk insert) e «il DATE della scadenza torna come `YYYY-MM-DD`».

- [ ] **Step 3: Eseguire e vedere fallire**

Run: `pnpm vitest run server/fatture/repository.test.ts`
Expected: FAIL (modulo assente).

- [ ] **Step 4: Implementare**

Struttura di `server/fatture/repository.ts` (copiare i pattern indicati; il codice completo dell'implementazione in memoria usa `Map<number, Fattura>` + contatori; quello Postgres usa il DDL sopra):

```ts
import { kvSql } from "../_core/persistence";
import { FATTURAZIONE_CONFIG_DEFAULT, type EventoFattura, type Fattura, type FatturazioneConfig, type RiepilogoIva, type RigaFattura, type RigaFatturaInput, type ScadenzaFattura, type ScadenzaFatturaInput, type StatoFattura, type TipoFattura } from "@shared/fatturazione/tipi";

// … tipi FatturaPersist / PatchBozza / PatchStato / FiltroFatture / FattureRepository come nell'interfaccia …

export function createMemoryFattureRepository(): FattureRepository {
  const fatture = new Map<number, Fattura>();
  const eventi: EventoFattura[] = [];
  const config = new Map<number, FatturazioneConfig>();
  let prossimoId = 1; let prossimoRigaId = 1; let prossimoScadenzaId = 1; let prossimoEventoId = 1;
  const clona = <T>(x: T): T => structuredClone(x);
  const trova = (sedeId: number, id: number) => { const f = fatture.get(id); return f && f.sedeId === sedeId ? f : null; };
  const righeDa = (fatturaId: number, righe: RigaFatturaInput[]): RigaFattura[] =>
    [...righe].sort((a, b) => a.ordine - b.ordine).map(r => ({ ...r, id: prossimoRigaId++, fatturaId }));
  const scadenzeDa = (fatturaId: number, scadenze: ScadenzaFatturaInput[], precedenti: ScadenzaFattura[]): ScadenzaFattura[] =>
    [...scadenze].sort((a, b) => a.numero - b.numero).map(s => {
      const prima = precedenti.find(p => p.numero === s.numero);
      return { ...s, id: prossimoScadenzaId++, fatturaId, ficPaymentId: prima?.ficPaymentId ?? null, stato: prima?.stato ?? "attesa" };
    });
  return {
    async ensureSchema() {},
    async config(sedeId) { return clona(config.get(sedeId) ?? { ...FATTURAZIONE_CONFIG_DEFAULT, sedeId, updatedAt: new Date(0) }); },
    async salvaConfig(c) { const salvata = { ...clona(c), updatedAt: new Date() }; config.set(c.sedeId, salvata); return clona(salvata); },
    async crea({ fattura, righe, riepilogo, scadenze, now }) {
      const id = prossimoId++;
      const f: Fattura = { ...clona(fattura), id, revisione: 1, createdAt: now, updatedAt: now, righe: righeDa(id, righe), riepilogo: clona(riepilogo), scadenze: scadenzeDa(id, scadenze, []) };
      fatture.set(id, f); return clona(f);
    },
    async perId(sedeId, id) { const f = trova(sedeId, id); return f ? clona(f) : null; },
    async perCommessa(sedeId, commessaId) { return [...fatture.values()].filter(f => f.sedeId === sedeId && f.commessaId === commessaId).sort((a, b) => b.id - a.id).map(clona); },
    async perFicDocumentId(sedeId, ficDocumentId) { return clona([...fatture.values()].find(f => f.sedeId === sedeId && f.ficDocumentId === ficDocumentId) ?? null); },
    async lista({ sedeId, stati, tipo, limite }) {
      return [...fatture.values()].filter(f => f.sedeId === sedeId && (!stati || stati.includes(f.stato)) && (!tipo || f.tipo === tipo))
        .sort((a, b) => b.id - a.id).slice(0, limite ?? 200).map(f => ({ ...clona(f), righe: [], riepilogo: [], scadenze: [] }));
    },
    async daSondare() { return [...fatture.values()].filter(f => f.ficDocumentId != null && (f.stato === "inviata" || (f.stato === "emessa" && f.inviataDryRun))).map(f => ({ id: f.id, sedeId: f.sedeId, ficDocumentId: f.ficDocumentId, stato: f.stato, inviataDryRun: f.inviataDryRun })); },
    async aggiornaBozza({ sedeId, id, revisioneAttesa, patch, righe, riepilogo, scadenze, now }) {
      const f = trova(sedeId, id); if (!f) throw new Error("NOT_FOUND: Fattura non trovata.");
      if (f.revisione !== revisioneAttesa) throw new Error("CONFLITTO: la fattura è stata modificata da un'altra sessione, ricarica.");
      Object.assign(f, clona(patch), { revisione: f.revisione + 1, updatedAt: now, righe: righeDa(id, righe), riepilogo: clona(riepilogo), scadenze: scadenzeDa(id, scadenze, f.scadenze) });
      return clona(f);
    },
    async aggiornaStato({ sedeId, id, patch, now }) { const f = trova(sedeId, id); if (!f) throw new Error("NOT_FOUND: Fattura non trovata."); Object.assign(f, clona(patch), { updatedAt: now }); return clona(f); },
    async aggiornaScadenza({ sedeId, fatturaId, numero, patch }) { const f = trova(sedeId, fatturaId); if (!f) throw new Error("NOT_FOUND: Fattura non trovata."); const s = f.scadenze.find(x => x.numero === numero); if (s) Object.assign(s, patch); },
    async appendEvento(e) { const evento: EventoFattura = { ...clona(e), id: prossimoEventoId++, createdAt: e.createdAt ?? new Date() }; eventi.push(evento); return clona(evento); },
    async eventi(sedeId, fatturaId) { return eventi.filter(e => e.sedeId === sedeId && e.fatturaId === fatturaId).map(clona); },
  };
}

export function createPostgresFattureRepository(sql: NonNullable<typeof kvSql>): FattureRepository { /* DDL + query come descritto; bulk insert per righe/riepilogo/scadenze; RETURNING riordinato */ }

let singleton: FattureRepository | null = null;
export function getFattureRepository(): FattureRepository { singleton ??= kvSql ? createPostgresFattureRepository(kvSql) : createMemoryFattureRepository(); return singleton; }
export function _resetFattureRepositoryForTests(): void { singleton = null; }
```

Regola per `lista` in Postgres: una sola query su `fatture` (nessun join alle righe). `perId`/`perCommessa`: una query su `fatture` + tre query in blocco con `WHERE fattura_id = ANY(${ids})` (non una per fattura). `daSondare`: `WHERE fic_document_id IS NOT NULL AND (stato = 'inviata' OR (stato = 'emessa' AND inviata_dry_run))`.

- [ ] **Step 5: Test verdi (memoria e Postgres), commit**

Run: `pnpm vitest run server/fatture/repository.test.ts` e `DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test NODE_ENV=test pnpm vitest run server/fatture/repository.pg.test.ts` (serve il container `ruffino-test-pg`: `docker run -d --name ruffino-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=tars_test -p 55432:5432 postgres:16-alpine` se non c'è).
Expected: PASS entrambe.

```bash
git add server/fatture/repository.ts server/fatture/repository.test.ts server/fatture/repository.pg.test.ts
git commit -m "feat(fatture): repository di fatture, righe, scadenze, eventi e configurazione per sede"
```

---

### Task 6: Servizio della bozza — crea, leggi, aggiorna, verifica limiti, validazioni, immutabilità

**Files:**
- Create: `server/fatture/servizio.ts`
- Create: `server/fatture/cliente.ts` (snapshot del cliente + validazioni anagrafiche)
- Modify: `server/routers/clienti.ts:132-164` (campi `pec`, `codiceDestinatario`, `ficEntityId` in `creaClienteInput` e nell'`update`; D-G)
- Test: `server/fatture/servizio.test.ts`, `server/fatture/cliente.test.ts`

**Interfaces:**
- Consumes: Task 3–5; `leggiContratto` (`server/contratti/servizio.ts`), `ultimoComputo` (`server/computo/servizio.ts`), `getCommessaById` (`server/routers/commesse.ts`), `getClienteById` (`server/routers/clienti.ts`), `interruttoreAttivo`, `codiceFiscaleValido`, `partitaIvaValida`, `normalizzaProvincia`.
- Produces:

```ts
// server/fatture/cliente.ts
export function snapshotCliente(cliente: any | null, commessa: { cliente?: string | null; indirizzo?: string | null; citta?: string | null }): ClienteSnapshot;
export function controlliCliente(s: ClienteSnapshot, detrazioneTipo: Fattura["detrazioneTipo"]): Controllo[];

// server/fatture/servizio.ts
export type Controllo = { codice: string; esito: "ok" | "avviso" | "errore"; messaggio: string };
export type Dipendenze = { now?: () => Date; repository?: FattureRepository };
export async function creaBozza(input: { sedeId: number; commessaId: number; actorUserId: number | null } & Dipendenze): Promise<{ fattura: Fattura; avvertenze: string[] }>;
export async function leggiFattura(sedeId: number, id: number, dip?: Dipendenze): Promise<{ fattura: Fattura; controlli: Controllo[]; eventi: EventoFattura[] } | null>;
export async function fatturePerCommessa(sedeId: number, commessaId: number, dip?: Dipendenze): Promise<Fattura[]>;
export type ModificaBozza = {
  righe?: Array<{ ordine: number; importoCent: number; descrizione?: string }>; // solo bene/servizio non derivate, identificate per ordine
  scadenze?: ScadenzaFatturaInput[]; note?: string | null; diciture?: ChiaveDicitura[]; intestazioneCantiere?: string | null;
  riequilibraBeniAMarkupCent?: number;   // se presente: scala le righe bene finché markup = valore (Task 3 riequilibraBeni)
  scavalcoLimiti?: { attivo: boolean; motivo: string | null };
};
export async function aggiornaBozza(input: { sedeId: number; id: number; revisione: number; modifica: ModificaBozza; actorUserId: number | null } & Dipendenze): Promise<{ fattura: Fattura; controlli: Controllo[] }>;
export async function rigeneraBozza(input: { sedeId: number; id: number; revisione: number; actorUserId: number | null } & Dipendenze): Promise<{ fattura: Fattura; avvertenze: string[] }>; // ricrea righe/scadenze dal contratto+computo correnti
export function verificaLimiti(f: Fattura): Controllo[];
export async function validaPerEmissione(sedeId: number, id: number, dip?: Dipendenze): Promise<{ fattura: Fattura; controlli: Controllo[]; emettibile: boolean }>;
export async function annullaBozza(input: { sedeId: number; id: number; actorUserId: number | null; motivo: string | null } & Dipendenze): Promise<Fattura>; // solo bozza → annullata
```

Regole:

1. `creaBozza`: commessa nella sede (altrimenti `NOT_FOUND: Commessa non trovata.`); `leggiContratto` deve dare un contratto (altrimenti `PRECONDIZIONE: Manca il contratto strutturato.`); `ultimoComputo` → `computo` (anche non valido: la bozza nasce, con avvertenza `«Computo non aggiornato alle righe correnti: ricalcola i limiti.»`); se esiste già una bozza per la commessa → `PRECONDIZIONE: Esiste già una bozza per questa commessa (#id).`; se esiste una fattura `emessa`+ per la commessa → la nuova bozza è ammessa solo di tipo nota di credito (Task 11) → qui `PRECONDIZIONE: La commessa ha già la fattura #n: usa la nota di credito.`. Genera con `generaBozza` (Task 4), `pattuitoCent/Tipo` dal contratto, `detrazioneTipo` dal contratto, `clienteSnapshot` da `snapshotCliente`, `computoId = computo.valido ? computo.id : null`, `hashRighe = contratto.hashRighe`, riepilogo/totali dall'`esito`; salva; evento `creata` con `{ avvertenze }`.
2. `aggiornaBozza`: fattura in sede; `fatturaModificabile(stato)` altrimenti `FATTURA_IMMUTABILE: la fattura #n è in stato «…»: correggi con una nota di credito.`; applica la modifica alle righe non derivate (importi `≥ 0`, riga `servizio` con `importoCent > limiteCent` → resta ammesso ma segnalato); `riequilibraBeniAMarkupCent`: calcola `targetBeni = (P − N − S − markupDesiderato) …` → più semplice e corretto: iterare `riequilibraBeni` sulle sole righe `bene` significative con target `B' = B + (M − markupDesiderato)` **solo nel caso imponibile**; nel caso lordo il target di B si ricava dalla relazione del risolutore: `B' = (G − 0,98·(N + S + Mdes) ) / 1,22` se poi `B' > P'`, altrimenti `B' = G/1,10 − (N + S + Mdes)`; arrotondare e ricalcolare, quindi verificare con una seconda passata del risolutore (accettare scarto ≤ 3 cent sul markup). Poi `ricalcola` (Task 4) → righe derivate e totali; scadenze: se passate le usa (devono sommare al totale: altrimenti `VALIDAZIONE: le scadenze sommano X, il totale è Y.`), se assenti e il totale è cambiato → `scadenzeDaRate(contratto.rate, totale, data odierna)`; `aggiornaBozza` del repository con `revisioneAttesa = input.revisione`; evento `modificata` con `{ campi: Object.keys(modifica) }`; `scavalcoLimiti` → evento `scavalco_limiti` con `{ motivo }`.
3. `verificaLimiti(f)`: per ogni riga `servizio` con `limiteCent != null`: `importoCent > limiteCent` → `avviso` `«"descrizione" supera il limite di € X.»` con codice `limite_riga`; totale servizi (Σ `servizio` + `markup`) vs Σ limiti delle voci proposte: se supera → `errore` `limite_totale` a meno che `f.scavalcoLimiti` (allora `avviso` con «scavalcato: motivo»). Se `f.markupCent < 0` → `errore` `markup_negativo`.
4. `validaPerEmissione` (spec §7.4): `controlliCliente` (nome; indirizzo, cap, città, provincia; privato → CF valido; azienda/condominio/ente → P.IVA valida (condominio: CF 11 cifre ammesso); `codiceDestinatario` 7 caratteri o `pec`) + `detrazioneTipo ≠ nessuna` → CF obbligatorio, `intestazioneCantiere` obbligatoria, dicitura bonifico presente; computo: `computoId != null` **oppure** `scavalcoLimiti` (altrimenti `errore` `computo_non_valido`); scadenze: somma = totale, nessuna data prima di `data odierna` (avviso, non errore); configurazione: `iban`, `vatIdsFic[22]` e `[10]`, `paymentAccountIdFic`, `scopeScritturaOk` (ognuno `errore` con messaggio «Configura … in Impostazioni → Fatturazione»); `verificaLimiti`; `emettibile = nessun errore`.
5. Snapshot cliente: `tipo` da `cliente.tipo ?? "privato"`; `nome` = `ragioneSociale ?? "${cognome} ${nome}"` (convenzione Ragione sociale per aziende/condomini/enti: leggere come fa `commesse.ts` `clienteDisplay`); indirizzo/cap/città dal cliente (`indirizzo`, `cap`, `citta`) con fallback alla commessa; `provincia` = `normalizzaProvincia(citta)` oppure `""`; `codiceDestinatario` = `cliente.codiceDestinatario ?? "0000000"`; `pec = cliente.pec ?? null`; `ficEntityId = cliente.ficEntityId ?? null`.
6. `server/routers/clienti.ts`: `creaClienteInput` e lo schema di `update` accettano `pec: z.string().email().optional()`, `codiceDestinatario: z.string().regex(/^[A-Z0-9]{7}$/).optional()`, `ficEntityId: z.number().int().optional()`; `creaCliente` li copia nel record. Nessuna UI in questo task (il pannello cliente li mostrerà in un task successivo del piano: qui bastano i campi).

- [ ] **Step 1: Test (fallisce)**

```ts
// server/fatture/cliente.test.ts
import { describe, expect, it } from "vitest";
import { controlliCliente, snapshotCliente } from "./cliente";

describe("snapshotCliente", () => {
  it("privato senza PEC → codice destinatario 0000000, provincia dalla città", () => {
    const s = snapshotCliente({ id: 3, tipo: "privato", nome: "Mario", cognome: "Rossi", codiceFiscale: "RSSMRA85T10A562S", indirizzo: "Via Alta 80", cap: "19038", citta: "Sarzana (SP)" }, {});
    expect(s).toMatchObject({ clienteId: 3, nome: "Rossi Mario", provincia: "SP", codiceDestinatario: "0000000", pec: null, ficEntityId: null });
  });
  it("azienda con ragione sociale e P.IVA", () => {
    const s = snapshotCliente({ id: 4, tipo: "azienda", ragioneSociale: "Alfa Srl", nome: "", cognome: "", partitaIva: "01500270119", pec: "alfa@pec.it", codiceDestinatario: "ABC1234", citta: "La Spezia (SP)" }, { indirizzo: "Via X 1" });
    expect(s.nome).toBe("Alfa Srl");
    expect(s.indirizzo).toBe("Via X 1");
    expect(s.codiceDestinatario).toBe("ABC1234");
  });
});

describe("controlliCliente", () => {
  const base = { clienteId: 1, nome: "Rossi Mario", tipo: "privato" as const, codiceFiscale: "RSSMRA85T10A562S", partitaIva: null, indirizzo: "Via Alta 80", cap: "19038", citta: "Sarzana", provincia: "SP", email: null, pec: null, codiceDestinatario: "0000000", ficEntityId: null };
  it("privato completo: nessun errore", () => {
    expect(controlliCliente(base, "ristrutturazione").filter(c => c.esito === "errore")).toEqual([]);
  });
  it("CF sbagliato e provincia mancante sono errori", () => {
    const errori = controlliCliente({ ...base, codiceFiscale: "RSSMRA85T10A562T", provincia: "" }, "nessuna").filter(c => c.esito === "errore").map(c => c.codice);
    expect(errori).toEqual(expect.arrayContaining(["cliente_cf", "cliente_provincia"]));
  });
  it("azienda: P.IVA valida e recapito SdI", () => {
    const errori = controlliCliente({ ...base, tipo: "azienda", codiceFiscale: null, partitaIva: "01500270118", codiceDestinatario: "0000000", pec: null }, "nessuna").map(c => c.codice);
    expect(errori).toEqual(expect.arrayContaining(["cliente_piva", "cliente_sdi"]));
  });
});
```

```ts
// server/fatture/servizio.test.ts — schema dei casi (l'implementatore completa con i fixture del Task 4)
import { beforeEach, describe, expect, it, vi } from "vitest";
// Prepara: una commessa in memoria (server/routers/commesse.ts store) con cliente, un contratto salvato via salvaContratto,
// un computo eseguito via eseguiComputo (FLAG_LIMITI on nel test: NODE_ENV=test lo accende), repository fatture in memoria iniettato.
describe("creaBozza", () => {
  it("nasce dal contratto e dal computo, con snapshot cliente ed evento «creata»", async () => { /* fattura.righe con bene/servizio/markup/storno; fattura.computoId = computo.id; eventi[0].tipo === "creata" */ });
  it("rifiuta la seconda bozza e la commessa di altra sede", async () => { /* PRECONDIZIONE / NOT_FOUND */ });
  it("senza contratto: PRECONDIZIONE", async () => {});
});
describe("aggiornaBozza", () => {
  it("modifica un servizio, ricalcola markup e derivate, scadenze rifatte sul nuovo totale", async () => {});
  it("riequilibra i beni a markup 0 e poi a 100.000 cent: il risolutore torna al target (±3 cent)", async () => {});
  it("revisione vecchia → CONFLITTO; fattura emessa → FATTURA_IMMUTABILE", async () => {});
  it("scadenze che non sommano al totale → VALIDAZIONE", async () => {});
});
describe("validaPerEmissione", () => {
  it("elenca i controlli: computo, cliente, configurazione, limiti; emettibile solo senza errori", async () => {});
  it("servizio oltre il limite: avviso per riga, errore sul totale, avviso se scavalcato con motivo", async () => {});
});
describe("annullaBozza", () => {
  it("solo una bozza si annulla; evento «annullata»", async () => {});
});
```

Ogni `it` deve contenere asserzioni reali (nessun test vuoto): usare `salvaContratto`/`eseguiComputo` reali con le righe del caso 127 (`server/computo/__fixtures__/casi-reali.json`, caso `fattura-127-2026`) così i servizi proposti sono numeri veri.

- [ ] **Step 2: Eseguire e vedere fallire**

Run: `pnpm vitest run server/fatture/cliente.test.ts server/fatture/servizio.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementare**

`server/fatture/cliente.ts`:

```ts
import { codiceFiscaleValido, normalizzaProvincia, partitaIvaValida } from "@shared/fatturazione/fiscale";
import type { ClienteSnapshot, Fattura } from "@shared/fatturazione/tipi";
import type { Controllo } from "./servizio";

export function snapshotCliente(cliente: any | null, commessa: { cliente?: string | null; indirizzo?: string | null; citta?: string | null }): ClienteSnapshot {
  const tipo = (cliente?.tipo ?? "privato") as ClienteSnapshot["tipo"];
  const ragione = String(cliente?.ragioneSociale ?? "").trim();
  const nome = ragione || `${cliente?.cognome ?? ""} ${cliente?.nome ?? ""}`.trim() || String(commessa.cliente ?? "").trim();
  const citta = String(cliente?.citta ?? commessa.citta ?? "").trim();
  return {
    clienteId: cliente?.id ?? null, nome, tipo,
    codiceFiscale: cliente?.codiceFiscale ? String(cliente.codiceFiscale).trim().toUpperCase() : null,
    partitaIva: cliente?.partitaIva ? String(cliente.partitaIva).trim() : null,
    indirizzo: String(cliente?.indirizzo ?? commessa.indirizzo ?? "").trim(),
    cap: String(cliente?.cap ?? "").trim(),
    citta: citta.replace(/\s*\([A-Za-z]{2}\)\s*$/, ""),
    provincia: normalizzaProvincia(citta) ?? "",
    email: cliente?.email ?? null, pec: cliente?.pec ?? null,
    codiceDestinatario: String(cliente?.codiceDestinatario ?? "0000000").trim().toUpperCase(),
    ficEntityId: cliente?.ficEntityId ?? null,
  };
}

export function controlliCliente(s: ClienteSnapshot, detrazioneTipo: Fattura["detrazioneTipo"]): Controllo[] {
  const c: Controllo[] = [];
  const errore = (codice: string, messaggio: string) => c.push({ codice, esito: "errore", messaggio });
  if (!s.nome) errore("cliente_nome", "Cliente senza nome.");
  if (!s.indirizzo) errore("cliente_indirizzo", "Indirizzo del cliente mancante.");
  if (!/^\d{5}$/.test(s.cap)) errore("cliente_cap", "CAP del cliente mancante o non valido.");
  if (!s.citta) errore("cliente_citta", "Città del cliente mancante.");
  if (!/^[A-Z]{2}$/.test(s.provincia)) errore("cliente_provincia", "Provincia del cliente mancante (sigla di due lettere).");
  if (s.tipo === "privato") {
    if (!s.codiceFiscale || !codiceFiscaleValido(s.codiceFiscale)) errore("cliente_cf", "Codice fiscale mancante o non valido.");
  } else {
    const pivaOk = !!s.partitaIva && partitaIvaValida(s.partitaIva);
    const cfNumerico = !!s.codiceFiscale && /^\d{11}$/.test(s.codiceFiscale);
    if (!pivaOk && !(s.tipo === "condominio" && cfNumerico)) errore("cliente_piva", "Partita IVA mancante o non valida.");
    if (!(s.codiceDestinatario.length === 7 && s.codiceDestinatario !== "0000000") && !s.pec) errore("cliente_sdi", "Serve il codice destinatario SdI (7 caratteri) o la PEC.");
  }
  if (detrazioneTipo !== "nessuna" && !s.codiceFiscale) errore("cliente_cf_bonus", "Con la detrazione il codice fiscale è obbligatorio.");
  if (c.length === 0) c.push({ codice: "cliente", esito: "ok", messaggio: "Anagrafica completa per la fattura elettronica." });
  return c;
}
```

`server/fatture/servizio.ts`: implementare le regole 1–4 usando `generaBozza`, `ricalcola`, `scadenzeDaRate`, `riequilibraBeni`, il repository e gli eventi; prefissi d'errore `NOT_FOUND: `, `PRECONDIZIONE: `, `VALIDAZIONE: `, `FATTURA_IMMUTABILE: `, `CONFLITTO: ` (il router li mappa: Task 13). `leggiFattura` restituisce anche `controlli = [...controlliCliente, ...verificaLimiti]` (senza i controlli di configurazione, che sono di `validaPerEmissione`).

- [ ] **Step 4: Test verdi, `pnpm check`, commit**

Run: `pnpm vitest run server/fatture`
Expected: PASS.

```bash
git add server/fatture/servizio.ts server/fatture/servizio.test.ts server/fatture/cliente.ts server/fatture/cliente.test.ts server/routers/clienti.ts
git commit -m "feat(fatture): servizio della bozza con ricalcolo, limiti, validazioni e snapshot cliente"
```

---

### Task 7: Configurazione per sede e scope FiC di scrittura

**Files:**
- Create: `server/fatture/config.ts`
- Modify: `server/routers/fattureInCloud.ts:34-39` (scope), `:189-203` (`buildFicAuthUrl` con scope opzionali), `:962-984` (`status` + `scopeScrittura`), `:1021-1045` (`oauthStartUrl` con `{ scrittura?: boolean }`)
- Test: `server/fatture/config.test.ts`, estensione di `server/routers/fattureInCloud.oauth.test.ts`

**Interfaces:**
- Consumes: `getCfg`, `accessTokenFic`, `ficGet` (`fattureInCloud.ts`), repository Task 5.
- Produces:

```ts
// server/routers/fattureInCloud.ts
export const FIC_SCOPES_LETTURA = FIC_SCOPES; // valore attuale
export const FIC_SCOPES_SCRITTURA = "entity.clients:r entity.clients:a issued_documents.invoices:r issued_documents.invoices:a issued_documents.credit_notes:r issued_documents.credit_notes:a received_documents:r settings:r";
export function buildFicAuthUrl(redirectUri: string, state: string, scope?: string): string | null;
export type FicConfig = { …campi attuali…; scopeScrittura: boolean }; // true dopo un callback avviato con scrittura
// oauthStartUrl input: z.object({ scrittura: z.boolean().optional() }).optional(); lo `state` porta anche `scrittura` (issueFicOAuthState(sedeId, redirectUri, scrittura)); handleFicOAuthCallback salva cfg.scopeScrittura = scrittura.
// status aggiunge: scopeScrittura: cfg.scopeScrittura ?? false

// server/fatture/config.ts
export async function configFatturazione(sedeId: number): Promise<FatturazioneConfig>;
export async function salvaConfigFatturazione(input: { sedeId: number; patch: Partial<Pick<FatturazioneConfig, "iban" | "banca" | "intestatario" | "metodoPagamento" | "numerazioneFic" | "paymentAccountIdFic" | "dicituraFooter">> }): Promise<FatturazioneConfig>;
/** Chiama GET /c/{company}/issued_documents/info?type=invoice: se risponde, scopeScritturaOk=true e vat/conti/numerazioni in cache. */
export async function verificaScopeScrittura(input: { sedeId: number; ficGet?: typeof ficGetDefault }): Promise<{ ok: boolean; motivo: string | null; config: FatturazioneConfig; opzioni: { vatTypes: Array<{ id: number; value: number; description: string; eInvoice: boolean }>; paymentAccounts: Array<{ id: number; name: string }>; numerations: string[]; paymentMethods: Array<{ id: number; name: string }> } | null }>;
export function ibanValido(iban: string): boolean; // IT + 25 alfanumerici + controllo mod 97
```

Regole: `verificaScopeScrittura` legge `data.vat_types_list` (prende gli id con `value === 22` e `value === 10` e `e_invoice !== false`, preferendo `default`), `data.payment_accounts_list` (id/name), `data.numerations` (chiavi dell'oggetto), `data.payment_methods_list`; salva `vatIdsFic`, e se `paymentAccountIdFic` è null e c'è un solo conto lo imposta; `scopeScritturaOk = true`, `scopeVerificatoAt = now`. Un 401/403 → `ok: false`, `motivo: "Permessi FiC insufficienti: ri-autorizza con i permessi di scrittura."`, `scopeScritturaOk = false`. Nessun token nel log.

- [ ] **Step 1: Test (fallisce)**

```ts
// server/fatture/config.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetFattureRepositoryForTests } from "./repository";
import { configFatturazione, ibanValido, salvaConfigFatturazione, verificaScopeScrittura } from "./config";

vi.mock("../routers/fattureInCloud", async importOriginal => {
  const originale: any = await importOriginal();
  return { ...originale, getCfg: () => ({ id: 1, sedeId: 1, companyId: 77, authMode: "oauth", accessTokenCifrato: "x", refreshTokenCifrato: "y" }), accessTokenFic: async () => "a/token" };
});

describe("config fatturazione", () => {
  beforeEach(() => _resetFattureRepositoryForTests());
  it("ibanValido riconosce un IBAN italiano", () => {
    expect(ibanValido("IT60X0542811101000000123456")).toBe(true);
    expect(ibanValido("IT60X0542811101000000123457")).toBe(false);
    expect(ibanValido("IT60 X054 2811 1010 0000 0123 456")).toBe(true);
  });
  it("salva la patch e rifiuta un IBAN sbagliato", async () => {
    const c = await salvaConfigFatturazione({ sedeId: 1, patch: { iban: "IT60X0542811101000000123456", banca: "BPM" } });
    expect(c.banca).toBe("BPM");
    await expect(salvaConfigFatturazione({ sedeId: 1, patch: { iban: "IT00" } })).rejects.toThrow(/^VALIDAZIONE: IBAN/);
    expect((await configFatturazione(1)).iban).toBe("IT60X0542811101000000123456");
  });
  it("verificaScopeScrittura mette in cache id IVA, conti e numerazioni", async () => {
    const ficGet = vi.fn(async () => ({ data: {
      vat_types_list: [{ id: 3, value: 22, description: "22%", e_invoice: true, default: true }, { id: 9, value: 10, description: "10%", e_invoice: true }, { id: 12, value: 22, description: "22% escl.", e_invoice: false }],
      payment_accounts_list: [{ id: 5, name: "BPM" }], numerations: { "": {}, "/A": {} }, payment_methods_list: [{ id: 1, name: "Bonifico" }],
    } }));
    const esito = await verificaScopeScrittura({ sedeId: 1, ficGet });
    expect(esito.ok).toBe(true);
    expect(esito.config.vatIdsFic).toEqual({ 22: 3, 10: 9 });
    expect(esito.config.paymentAccountIdFic).toBe(5);
    expect(esito.config.scopeScritturaOk).toBe(true);
    expect(esito.opzioni?.numerations).toEqual(["", "/A"]);
    expect(ficGet.mock.calls[0][0]).toBe("/c/77/issued_documents/info?type=invoice");
  });
  it("403 → scope non ok con motivo, senza eccezione", async () => {
    const ficGet = vi.fn(async () => { throw new Error("Fatture in Cloud: permesso negato (403)"); });
    const esito = await verificaScopeScrittura({ sedeId: 1, ficGet });
    expect(esito.ok).toBe(false);
    expect(esito.motivo).toMatch(/ri-autorizza/);
    expect((await configFatturazione(1)).scopeScritturaOk).toBe(false);
  });
});
```

E in `server/routers/fattureInCloud.oauth.test.ts` aggiungere: «`oauthStartUrl({ scrittura: true })` produce un URL con `scope=` uguale a `FIC_SCOPES_SCRITTURA` (URL-encoded) e il callback salva `scopeScrittura: true`»; «senza `scrittura` lo scope resta quello di lettura».

- [ ] **Step 2: Eseguire e vedere fallire**

Run: `pnpm vitest run server/fatture/config.test.ts server/routers/fattureInCloud.oauth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementare**

`fattureInCloud.ts`: rinominare la costante attuale in `FIC_SCOPES_LETTURA` (mantenere `FIC_SCOPES` come alias esportato per compatibilità), aggiungere `FIC_SCOPES_SCRITTURA`; `buildFicAuthUrl(redirectUri, state, scope = FIC_SCOPES_LETTURA)`; lo stato OAuth in memoria porta `scrittura: boolean`; `handleFicOAuthCallback` scrive `cfg.scopeScrittura = stato.scrittura`; `status` espone `scopeScrittura`; `oauthStartUrl` accetta `{ scrittura?: boolean }` e passa lo scope giusto. `FicConfig` guadagna `scopeScrittura?: boolean` (backfill in `onLoad`: `false`).

`server/fatture/config.ts`:

```ts
import type { FatturazioneConfig } from "@shared/fatturazione/tipi";
import { accessTokenFic, getCfg, ficGet as ficGetDefault } from "../routers/fattureInCloud"; // esportare ficGet da fattureInCloud.ts
import { getFattureRepository } from "./repository";

export function ibanValido(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(s)) return false;
  const riordinato = s.slice(4) + s.slice(0, 4);
  const numerico = riordinato.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  let resto = 0;
  for (const cifra of numerico) resto = (resto * 10 + Number(cifra)) % 97;
  return resto === 1;
}

export async function configFatturazione(sedeId: number): Promise<FatturazioneConfig> {
  const repo = getFattureRepository(); await repo.ensureSchema(); return repo.config(sedeId);
}

export async function salvaConfigFatturazione(input: { sedeId: number; patch: Partial<Pick<FatturazioneConfig, "iban" | "banca" | "intestatario" | "metodoPagamento" | "numerazioneFic" | "paymentAccountIdFic" | "dicituraFooter">> }): Promise<FatturazioneConfig> {
  if (input.patch.iban != null && input.patch.iban !== "" && !ibanValido(input.patch.iban)) throw new Error("VALIDAZIONE: IBAN non valido.");
  if (input.patch.metodoPagamento != null && !/^MP\d{2}$/.test(input.patch.metodoPagamento)) throw new Error("VALIDAZIONE: metodo di pagamento non valido (es. MP05).");
  const repo = getFattureRepository(); await repo.ensureSchema();
  const attuale = await repo.config(input.sedeId);
  const iban = input.patch.iban == null ? attuale.iban : input.patch.iban.replace(/\s+/g, "").toUpperCase() || null;
  return repo.salvaConfig({ ...attuale, ...input.patch, iban, sedeId: input.sedeId });
}

export async function verificaScopeScrittura(input: { sedeId: number; ficGet?: typeof ficGetDefault; now?: Date }) {
  const repo = getFattureRepository(); await repo.ensureSchema();
  const attuale = await repo.config(input.sedeId);
  const cfg = getCfg(input.sedeId);
  const token = cfg.companyId ? await accessTokenFic(cfg) : null;
  if (!token || !cfg.companyId) {
    const config = await repo.salvaConfig({ ...attuale, scopeScritturaOk: false });
    return { ok: false, motivo: "Fatture in Cloud non è collegato per questa sede.", config, opzioni: null };
  }
  try {
    const risposta = await (input.ficGet ?? ficGetDefault)(`/c/${cfg.companyId}/issued_documents/info?type=invoice`, token);
    const d = risposta?.data ?? {};
    const vat = (d.vat_types_list ?? []) as Array<{ id: number; value: number; description: string; e_invoice?: boolean; default?: boolean }>;
    const scegli = (valore: number) => { const c = vat.filter(v => v.value === valore && v.e_invoice !== false); return (c.find(v => v.default) ?? c[0])?.id ?? null; };
    const conti = ((d.payment_accounts_list ?? []) as Array<{ id: number; name: string }>).map(c => ({ id: c.id, name: c.name }));
    const config = await repo.salvaConfig({
      ...attuale, vatIdsFic: { 22: scegli(22), 10: scegli(10) },
      paymentAccountIdFic: attuale.paymentAccountIdFic ?? (conti.length === 1 ? conti[0].id : null),
      scopeScritturaOk: true, scopeVerificatoAt: input.now ?? new Date(),
    });
    return { ok: true, motivo: null, config, opzioni: {
      vatTypes: vat.map(v => ({ id: v.id, value: v.value, description: v.description, eInvoice: v.e_invoice !== false })),
      paymentAccounts: conti, numerations: Object.keys(d.numerations ?? {}),
      paymentMethods: ((d.payment_methods_list ?? []) as Array<{ id: number; name: string }>).map(m => ({ id: m.id, name: m.name })),
    } };
  } catch (errore) {
    const config = await repo.salvaConfig({ ...attuale, scopeScritturaOk: false });
    const messaggio = String((errore as any)?.message ?? "");
    return { ok: false, motivo: /40[13]/.test(messaggio) || /permesso|autorizz/i.test(messaggio) ? "Permessi FiC insufficienti: ri-autorizza con i permessi di scrittura." : `Verifica non riuscita: ${messaggio}`, config, opzioni: null };
  }
}
```

- [ ] **Step 4: Test verdi, commit**

Run: `pnpm vitest run server/fatture/config.test.ts server/routers/fattureInCloud.oauth.test.ts`
Expected: PASS.

```bash
git add server/fatture/config.ts server/fatture/config.test.ts server/routers/fattureInCloud.ts server/routers/fattureInCloud.oauth.test.ts
git commit -m "feat(fatture): configurazione per sede e scope FiC di scrittura verificati con /issued_documents/info"
```

---

### Task 8: Client FiC di emissione e fake a copione

**Files:**
- Create: `server/fic/emissione.ts`
- Create: `server/fic/fake.ts`
- Test: `server/fic/emissione.test.ts`

**Interfaces:**
- Consumes: `fetchFicConTimeout`, `messaggioErroreFic`, `scaricaFatturaPdf` (da esportare in `fattureInCloud.ts` se non lo sono), `FIC` base URL.
- Produces:

```ts
export type ContestoFic = { companyId: number; token: string; signal?: AbortSignal };
export type ClienteFicInput = { name: string; type: "person" | "company"; first_name?: string; last_name?: string; tax_code?: string | null; vat_number?: string | null; address_street: string; address_postal_code: string; address_city: string; address_province: string; country: "Italia"; email?: string | null; certified_email?: string | null; ei_code: string; e_invoice: true };
export type DocumentoFicInput = {
  type: "invoice" | "credit_note"; entity: { id: number }; date: string; numeration?: string; subject?: string; visible_subject: string; notes: string;
  items_list: Array<{ name: string; description?: string; qty: number; net_price: number; vat: { id: number } }>;
  payments_list: Array<{ amount: number; due_date: string; status: "not_paid"; payment_account?: { id: number }; payment_terms?: { days: number; type: "standard" } }>;
  e_invoice: true; ei_data: { payment_method: string; bank_iban?: string; bank_name?: string; bank_beneficiary?: string };
  show_payments: true; show_payment_method: true;
};
export type DocumentoFicCreato = { id: number; number: number; numeration: string | null; date: string; amount_net: number; amount_vat: number; amount_gross: number; url: string | null; ei_status: string | null; payments_list: Array<{ id: number; amount: number; due_date: string }> };
export type ClientFicEmissione = {
  cercaClienti(ctx: ContestoFic, q: string): Promise<Array<{ id: number; name: string; tax_code: string | null; vat_number: string | null }>>;
  creaCliente(ctx: ContestoFic, cliente: ClienteFicInput): Promise<{ id: number }>;
  creaDocumento(ctx: ContestoFic, documento: DocumentoFicInput, opzioni: { fix_payments: boolean }): Promise<DocumentoFicCreato>;
  leggiDocumento(ctx: ContestoFic, documentId: number): Promise<DocumentoFicCreato & { ei_status: string | null }>;
  verificaXml(ctx: ContestoFic, documentId: number): Promise<{ success: boolean; errori: string[] }>;
  inviaEInvoice(ctx: ContestoFic, documentId: number, opzioni: { dry_run: boolean }): Promise<{ name: string | null; date: string | null }>;
  scaricaXml(ctx: ContestoFic, documentId: number): Promise<Buffer>;
  scaricaPdf(ctx: ContestoFic, documentId: number): Promise<Buffer>;
  motivoScarto(ctx: ContestoFic, documentId: number): Promise<string | null>;
};
export function creaClientFicEmissione(): ClientFicEmissione;    // reale, su fetch
// server/fic/fake.ts
export type ChiamataFic = { metodo: string; path: string; body: unknown };
export function creaClientFicFinto(copione: Partial<{ [K in keyof ClientFicEmissione]: (...args: Parameters<ClientFicEmissione[K]>) => ReturnType<ClientFicEmissione[K]> }>, registro?: ChiamataFic[]): ClientFicEmissione; // ogni metodo non nel copione lancia Error("FIC_FINTO: metodo non previsto <nome>")
```

Endpoint (FiC API v2, base `https://api-v2.fattureincloud.it`):

| Metodo | Percorso | Note |
|---|---|---|
| `cercaClienti` | `GET /c/{company}/entities/clients?q=<q>&fieldset=basic` | `q` = CF o P.IVA; risposta `data: Entity[]` |
| `creaCliente` | `POST /c/{company}/entities/clients` body `{ data: ClienteFicInput }` | risposta `data.id` |
| `creaDocumento` | `POST /c/{company}/issued_documents` body `{ data: DocumentoFicInput, options: { fix_payments } }` | risposta `data` con `id, number, numeration, date, amount_net, amount_vat, amount_gross, url, ei_status, payments_list` |
| `leggiDocumento` | `GET /c/{company}/issued_documents/{id}?fields=id,number,numeration,date,amount_net,amount_vat,amount_gross,url,ei_status,payments_list` | |
| `verificaXml` | `GET /c/{company}/issued_documents/{id}/e_invoice/xml_verify` | `data.success`; con errore HTTP 422 il body porta `error.validation_result.xml_errors[]` → `errori` |
| `inviaEInvoice` | `POST /c/{company}/issued_documents/{id}/e_invoice/send` body `{ data: {}, options: { dry_run } }` | `data.name`, `data.date` |
| `scaricaXml` | `GET /c/{company}/issued_documents/{id}/e_invoice/xml?include_attachment=false` con `Accept: text/xml` | testo → `Buffer` |
| `scaricaPdf` | riusa `scaricaFatturaPdf` di `fattureInCloud.ts` | |
| `motivoScarto` | `GET /c/{company}/issued_documents/{id}/e_invoice/error_reason` | `data.reason` o null |

Ogni funzione: `fetchFicConTimeout` con `Authorization: Bearer`, `Content-Type: application/json` per i POST, `!res.ok` → `Error(messaggioErroreFic(status, body))` con il testo del body **senza** token; nessun log del body oltre 300 caratteri.

- [ ] **Step 1: Test (fallisce)** — con `global.fetch = vi.fn()` (pattern `fattureInCloud.oauth.test.ts`), verificare per ogni metodo: URL esatto, metodo HTTP, header `authorization`, body JSON serializzato, parsing della risposta; `verificaXml` con 422 e `xml_errors` → `{ success: false, errori: [...] }`; `creaDocumento` con 401 → errore con messaggio in italiano e senza token; `scaricaXml` legge `text()` non `json()`. Test del fake: metodo non previsto → `FIC_FINTO`.

- [ ] **Step 2: Eseguire e vedere fallire** — `pnpm vitest run server/fic/emissione.test.ts`.

- [ ] **Step 3: Implementare** `server/fic/emissione.ts` e `server/fic/fake.ts` secondo la tabella; il fake registra ogni chiamata in `registro` (per asserire ordine e idempotenza nei test della pipeline).

- [ ] **Step 4: Test verdi, commit**

```bash
git add server/fic/emissione.ts server/fic/fake.ts server/fic/emissione.test.ts server/routers/fattureInCloud.ts
git commit -m "feat(fic): client di emissione (clienti, documenti, xml, invio SdI) con fake a copione"
```

---

### Task 9: `emettiFattura` — pipeline idempotente a passi, archiviazione, documento e timeline

**Files:**
- Create: `server/fatture/emissione.ts`
- Modify: `server/routers/preventiviContratti.ts` (nuova funzione esportata `registraDocumentoFatturaCrm`, accanto a `upsertDocumentoFic` r. 600-674)
- Test: `server/fatture/emissione.test.ts`

**Interfaces:**
- Consumes: Task 5–8; `sdiDryRun()`; `putFile`/`sha256Hex` (`server/_core/fileStorage.ts`); `allineaTimelineAlBoard` (`server/routers/timeline.ts`); `getCommessaById`; `getCfg`/`accessTokenFic` (`fattureInCloud.ts`); `DICITURE`.
- Produces:

```ts
export type DipendenzeEmissione = { client?: ClientFicEmissione; repository?: FattureRepository; now?: () => Date; dryRun?: () => boolean; storage?: { putFile: typeof putFile }; salvaFicEntityId?: (clienteId: number, ficEntityId: number) => void };
export async function emettiFattura(input: { sedeId: number; id: number; actorUserId: number | null; revisione: number } & DipendenzeEmissione): Promise<{ fattura: Fattura; passi: Array<{ passo: PassoEmissione; esito: "fatto" | "saltato" | "errore"; dettaglio: string | null }> }>;
export type PassoEmissione = "validazione" | "cliente_fic" | "documento_fic" | "confronto_totali" | "xml" | "invio" | "archivio" | "documento_fascicolo" | "timeline";
export function costruisciDocumentoFic(f: Fattura, config: FatturazioneConfig, ficEntityId: number, commessaCodice: string): DocumentoFicInput;
export function costruisciClienteFic(s: ClienteSnapshot): ClienteFicInput;
export function noteFattura(f: Fattura, config: FatturazioneConfig): string; // diciture + intestazioneCantiere + note + footer
// server/routers/preventiviContratti.ts
export async function registraDocumentoFatturaCrm(args: { sedeId: number; commessaId: number; fatturaId: number; numero: string; tipo: "fattura" | "nota_credito"; pdf: Buffer; createdBy: number | null }): Promise<Documento>; // nome "Fattura 127-2026.pdf" / "Nota di credito …", tipo docTipo, source "crm", sourceRef `crm:fattura:${fatturaId}`, upsert per sourceRef
```

Sequenza (ogni passo scrive un evento; un passo già fatto si salta leggendo lo stato salvato — **ripetizione sicura**):

1. `validazione`: `validaPerEmissione` → se non emettibile lancia `PRECONDIZIONE: <primo errore>` (stato invariato). Blocco ottimistico: `revisione` deve coincidere. Stato `bozza` → `in_emissione` (evento `emissione_avviata`, `emessaDa`, `revisione+1` via `aggiornaStato`). Da `in_emissione` (ripresa dopo errore) si prosegue dal primo passo mancante.
2. `cliente_fic`: `snapshot.ficEntityId` presente → salta. Altrimenti `cercaClienti(q = CF o P.IVA)`: risultato con lo stesso CF/P.IVA (normalizzati, maiuscolo) → usa `id`; nessuno → `creaCliente(costruisciClienteFic(snapshot))`. Salva `clienteSnapshot.ficEntityId` sulla fattura e (se `clienteId`) `salvaFicEntityId(clienteId, id)` sul cliente CRM (default: aggiorna il record in `clienti` store e `save`). Evento `cliente_fic` `{ ficEntityId, creato: boolean }`.
3. `documento_fic`: `f.ficDocumentId` presente → salta. `creaDocumento(costruisciDocumentoFic(...), { fix_payments: true })`. Salva `ficDocumentId`, `numero = numeration ? `${number}${numeration}` : `${number}/${anno}``, `data`, `scadenze[i].ficPaymentId = payments_list[i].id` (per indice). Evento `creata_fic` `{ ficDocumentId, numero, amount_gross }`. Stato resta `in_emissione` finché il confronto non passa.
4. `confronto_totali`: `Math.round(amount_net*100) === imponibileCent`, `amount_vat` ≈ `ivaCent`, `amount_gross` ≈ `totaleCent` (tolleranza 1 cent per campo); differenza → evento `errore_totali` `{ nostri, fic }`, `eiErrore = "Totali FiC diversi dai nostri: …"`, **stop** (stato `in_emissione`, `ficDocumentId` salvato: nessun secondo documento sarà creato alla ripresa). Uguali → stato `emessa`, `emessaAt`.
5. `xml`: `verificaXml` → `xml_ok` (evento) oppure `xml_errore` `{ errori }` + `eiErrore` e **stop** (stato `emessa`, niente invio).
6. `invio`: `inviaEInvoice({ dry_run: dryRun() })`: dry-run → stato resta `emessa`, `inviataDryRun = true`, evento `inviata` `{ dryRun: true }`; reale → stato `inviata`, evento `inviata` `{ dryRun: false, date }`.
7. `archivio`: `scaricaXml` → `putFile("fatture_xml", commessaId, fatturaId, `${numero}.xml`, buffer, "application/xml")` → `xmlStorageKey`, `xmlSha256 = sha256Hex(buffer)` (evento `xml_archiviato`); `scaricaPdf` → `putFile("fatture_pdf", …, "application/pdf")` → `pdfStorageKey` (evento `pdf_archiviato`). Errori qui **non** fermano la fattura (stato già `emessa`/`inviata`): evento con `errore` e `eiErrore` informativo; la sonda (Task 10) ritenta l'archivio quando manca.
8. `documento_fascicolo`: `registraDocumentoFatturaCrm` con il PDF → `documentoId` sulla fattura (soddisfa il gate documentale `fattura` di `fatture_pagamento`).
9. `timeline`: `allineaTimelineAlBoard(commessaId, commessa.stato, nomeAttore)` (completa «Fatturazione» se il board è già a `fatture_pagamento` o oltre; forward-only, idempotente).

`costruisciDocumentoFic`: `items_list` una voce per riga con `tipo ≠ "intestazione" | "nota"` (le intestazioni e le note vanno nel `name`/`description` della riga successiva? **No**: FiC non ha righe senza importo con IVA; regola: le righe `intestazione` diventano item con `qty: 1, net_price: 0, vat: { id: vat22 }` e `name` = testo — come nella fattura reale, dove le intestazioni compaiono come righe descrittive; le `nota` finiscono in `notes`), `name = descrizione` (prima riga), `description` = resto se multilinea, `qty: 1`, `net_price = centToEuro(importoCent)` (negativo per lo storno), `vat: { id: config.vatIdsFic[aliquota] }`; `payments_list` dalle scadenze (`amount = centToEuro(importoCent)`, `due_date`, `status: "not_paid"`, `payment_account: { id: paymentAccountIdFic }` se presente); `ei_data.payment_method = config.metodoPagamento`, `bank_iban/bank_name/bank_beneficiary` da config; `visible_subject = commessaCodice`; `numeration = config.numerazioneFic ?? undefined`; `date = f.data ?? oggi`; `notes = noteFattura(f, config)`; `type = f.tipo === "nota_credito" ? "credit_note" : "invoice"`.

`costruisciClienteFic`: privato → `type: "person"`, `first_name/last_name` dallo snapshot (`nome` = «Cognome Nome»: split al primo spazio: `last_name` = prima parola, `first_name` = resto), `tax_code`; azienda/condominio/ente → `type: "company"`, `vat_number`, `tax_code`; sempre `name`, indirizzo, `country: "Italia"`, `ei_code = codiceDestinatario`, `certified_email = pec`, `e_invoice: true`.

- [ ] **Step 1: Test (fallisce)** — con `creaClientFicFinto` e repository in memoria; casi: (a) percorso felice con dry-run: ordine delle chiamate `cercaClienti → creaCliente → creaDocumento → verificaXml → inviaEInvoice(dry_run true) → scaricaXml → scaricaPdf`, stato finale `emessa`+`inviataDryRun`, `numero` composto, `ficPaymentId` sulle scadenze, eventi in ordine, `documentoId` valorizzato, timeline chiamata; (b) cliente già su FiC (`cercaClienti` lo trova per CF) → nessun `creaCliente`; (c) totali diversi → `errore_totali`, stato `in_emissione`, seconda chiamata riprende **senza** `creaDocumento` (copione con `leggiDocumento` e totali giusti) e arriva a `emessa`; (d) `verificaXml` fallisce → `emessa` con `xml_errore`, nessun `inviaEInvoice`; (e) dry-run spento → stato `inviata`; (f) errore in `scaricaPdf` → fattura comunque `emessa/inviata`, evento con errore; (g) validazione fallita → `PRECONDIZIONE`, nessuna chiamata FiC; (h) revisione vecchia → `CONFLITTO`; (i) fattura di altra sede → `NOT_FOUND`; (j) `costruisciDocumentoFic` sulla bozza del caso 127: `items_list` con `net_price` −4798.59 per lo storno, `vat.id` giusti, `payments_list` che somma a 15496.52.

- [ ] **Step 2: Eseguire e vedere fallire** — `pnpm vitest run server/fatture/emissione.test.ts`.

- [ ] **Step 3: Implementare** `server/fatture/emissione.ts` (passi come sopra, ogni passo in `try/catch` che registra l'evento di errore e rilancia con prefisso `EMISSIONE: <passo>: <messaggio>` quando il passo è bloccante) e `registraDocumentoFatturaCrm` in `preventiviContratti.ts` (modello `upsertDocumentoFic`: cerca per `sourceRef`, `putFile("preventivi_documenti", …)`, aggiorna il record esistente o ne crea uno con `tipo`, `statoAtUpload = commessa.stato`, `origine: "automatico"`, `source: "crm"`; aggiungere `"crm"` all'unione di `Documento.source`).

- [ ] **Step 4: Test verdi, `pnpm check`, commit**

```bash
git add server/fatture/emissione.ts server/fatture/emissione.test.ts server/routers/preventiviContratti.ts
git commit -m "feat(fatture): emissione idempotente su Fatture in Cloud con archivio PDF/XML, documento nel fascicolo e timeline"
```

---

### Task 10: Sonda degli stati SdI e «Aggiorna stato»

**Files:**
- Create: `server/fatture/sonda.ts`
- Modify: `server/_core/index.ts:120-130` (avvio `startSondaFattureWorker()` dopo `startFicScheduler()`)
- Test: `server/fatture/sonda.test.ts`

**Interfaces:**
- Produces:

```ts
export function mappaEiStatus(ei: string | null): { stato: StatoFattura | null; avviso: string | null }; // null = non cambia
export async function aggiornaStatoFattura(input: { sedeId: number; id: number; actorUserId: number | null } & DipendenzeEmissione): Promise<{ fattura: Fattura; cambiato: boolean }>;
export async function giroSonda(dip?: DipendenzeEmissione): Promise<{ controllate: number; cambiate: number; errori: number }>;
export function startSondaFattureWorker(): void; // setInterval 15 min + inCorso + unref, come server/tars/followup/worker.ts; primo giro dopo 40 s; attivo solo se interruttoreAttivo("fatturazione")
```

Mappa (spec §7.5.8): `attempt|pending|sent|processing → inviata`; `delivered|accepted|manual_accepted → consegnata`; `discarded → scartata` (+ `motivoScarto` in `eiErrore`); `rejected|manual_rejected → rifiutata`; `not_delivered|no_response → mancata_consegna`; `error → inviata` con avviso «FiC segnala un errore di gestione: riprova l'invio o contatta il supporto»; `not_sent|missing|null → nessun cambio`. Ogni cambio = evento `stato_sdi` `{ da, a, eiStatus }` (`scarto` per `discarded`), `eiStatusFic` sempre aggiornato. `aggiornaStatoFattura` ritenta anche l'archivio mancante (`xmlStorageKey`/`pdfStorageKey` null con `ficDocumentId`) riusando i passi di Task 9. `giroSonda`: per ogni riga di `daSondare()`: `getCfg(sedeId)` + `accessTokenFic`; senza token salta con conteggio errori; una sede alla volta, errori isolati per fattura (log `[fatture] sonda fattura #id: …` senza token).

- [ ] **Step 1: Test (fallisce)** — `mappaEiStatus` tabella completa; `aggiornaStatoFattura` con fake `leggiDocumento` che dà `ei_status: "delivered"` → `consegnata` + evento; `discarded` → `scartata` con motivo da `motivoScarto`; `error` → stato invariato ma avviso; `giroSonda` su due fatture di cui una senza token → `{ controllate: 2, cambiate: 1, errori: 1 }`; `startSondaFattureWorker` idempotente (seconda chiamata non crea un secondo timer: `vi.useFakeTimers`).

- [ ] **Step 2: Eseguire e vedere fallire**, **Step 3: Implementare**, **Step 4: Test verdi e commit**

```bash
git add server/fatture/sonda.ts server/fatture/sonda.test.ts server/_core/index.ts
git commit -m "feat(fatture): sonda degli stati SdI ogni 15 minuti e aggiornamento a richiesta"
```

---

### Task 11: Nota di credito totale o parziale

**Files:**
- Create: `server/fatture/notaCredito.ts`
- Test: `server/fatture/notaCredito.test.ts`

**Interfaces:**
- Produces:

```ts
export async function creaNotaCredito(input: { sedeId: number; fatturaId: number; actorUserId: number | null; selezione: { tipo: "totale" } | { tipo: "parziale"; righe: Array<{ ordine: number; importoCent: number }> } } & Dipendenze): Promise<{ fattura: Fattura; avvertenze: string[] }>;
```

Regole: la fattura origine deve essere in stato `emessa|inviata|consegnata|rifiutata|mancata_consegna` nella sede (altrimenti `PRECONDIZIONE`); una sola nota di credito **in bozza** per origine. Totale: righe = specchio della fattura (stessi tipi, importi con segno **positivo**: FiC vuole la nota di credito con importi positivi e `type: "credit_note"`), stesse aliquote, `riepilogo` ricalcolato con `impostaCent` (senza risolutore: gli importi sono già decisi), `pattuitoCent = totaleCent`, `scadenze = [{ numero 1, 100 %, data odierna, importo totale, "storno" }]`, `notaCreditoDi = fatturaId`, `tipo = "nota_credito"`, diciture `["copia_ade"]`, note `«Nota di credito a storno della fattura n. X del Y»`. Parziale: solo le righe scelte (`bene`/`servizio`/`markup`) con l'importo indicato (`0 < importo ≤ importo originale`); lo storno/riaddebito dei beni significativi si ricalcola sulla parte stornata con la stessa regola (Q' = min(B', P')). Evento `nota_credito` sulla fattura origine `{ notaCreditoId }` e `creata` sulla nota. La nota di credito si emette con `emettiFattura` (Task 9) e la sonda la segue come una fattura. In `emettiFattura`, per `tipo = "nota_credito"`, `documento_fascicolo` registra `tipo: "nota_credito"` e il nome «Nota di credito N.pdf».

- [ ] **Step 1: Test (fallisce)** — totale: stessi importi e riepilogo dell'origine (caso 127: 22 % 4.048,87 / 10 % 9.597,18, totale 15.496,52), scadenza unica; parziale: storno di due servizi (120 + 85) → riepilogo solo 10 % e nessuno storno BS; origine in `bozza` → `PRECONDIZIONE`; seconda nota in bozza → `PRECONDIZIONE`; altra sede → `NOT_FOUND`.

- [ ] **Step 2–4: fallire, implementare, verdi, commit**

```bash
git add server/fatture/notaCredito.ts server/fatture/notaCredito.test.ts server/fatture/emissione.ts
git commit -m "feat(fatture): nota di credito totale o parziale sulla stessa pipeline di emissione"
```

---

### Task 12: Integrazione col sync FiC esistente (`commessaMatch: "crm"`)

**Files:**
- Modify: `server/routers/ficFatture.ts:52-61` (`CommessaMatchFic` + `"crm"`), `:259-330` (`upsertDocumentiEmessi`), `:493-582` (`collegaFattureAutomatiche` salta `"crm"`), `:681-732` (`scollegaFatturaDaCommessa`: rifiuta lo scollegamento di una fattura `"crm"` con `Error("PRECONDIZIONE: fattura emessa dal CRM: si corregge con una nota di credito.")`)
- Modify: `server/routers/ficAllegati.ts:145-180` (`ensureFicInvoiceAttachments` salta le fatture con `commessaMatch === "crm"` e le segna `pdfSync.stato = "archiviata"`)
- Test: `server/routers/ficFatture.crm.test.ts`

**Interfaces:**
- Consumes: `getFattureRepository().perFicDocumentId(sedeId, ficId)` (Task 5) — **lettura sincrona non disponibile**: `upsertDocumentiEmessi` è sincrona. Ruling: `upsertDocumentiEmessi` riceve un nuovo parametro opzionale `collegamentiCrm?: Map<number, { commessaId: number; fatturaId: number; totaleCent: number }>` (FiC id → fattura CRM) che `runFicSync` (`fattureInCloud.ts:~832`) costruisce prima con `await getFattureRepository().lista({ sedeId, stati: ["emessa","inviata","consegnata","scartata","rifiutata","mancata_consegna"] })` filtrando `ficDocumentId != null`.
- Produces: righe `fic_fatture` con `commessaMatch: "crm"`, `commessaId` della fattura CRM, `collegataAMano: false`; evento `stato_sdi`? no — **avviso**: se `|importoLordo·100 − totaleCent| > 100` → `appendEvento` sulla fattura CRM `{ tipo: "modificata", payload: { avviso: "Totale FiC diverso dal pattuito del contratto", ficLordo, totaleCent } }` (asincrono: `runFicSync` lo fa dopo l'upsert, usando `idsVariati`).

- [ ] **Step 1: Test (fallisce)** — `upsertDocumentiEmessi([{ id: 4242, … }], sede, null, new Map([[4242, { commessaId: 10, fatturaId: 1, totaleCent: 1549652 }]]))` → il record ha `commessaId 10`, `commessaMatch "crm"`, non entra in `collegaFattureAutomatiche` (spy: nessun cambio), `scollegaFatturaDaCommessa` rifiuta; una fattura FiC non CRM segue il percorso di sempre; `ensureFicInvoiceAttachments` non scarica il PDF di una `"crm"`.

- [ ] **Step 2–4: fallire, implementare, verdi, commit**

```bash
git add server/routers/ficFatture.ts server/routers/ficFatture.crm.test.ts server/routers/ficAllegati.ts server/routers/fattureInCloud.ts
git commit -m "feat(fic): le fatture emesse dal CRM nascono collegate nel sync, senza match automatico né secondo PDF"
```

---

### Task 12b: Adeguamenti dalle otto fatture reali del 04/09 (spese al 22 %, righe manuali, pratica edilizia)

Il 04/09/2026 la direzione ha fornito altre otto fatture 2026 (92, 99, 106, 107, 113, 119, 120, NDC-1). Confronto col piano (analisi del controller, testi mai nel repo):

| Fattura | Cosa mostra | Conseguenza |
|---|---|---|
| 92, 106 | «Spese professionali Bonus Casa» / «Spese per documentazione detrazione» € 150,00 **al 22 %**, sommate ai beni significativi nel riepilogo (22 % = B + 150 − P) | la voce `spese_professionali` non è un servizio al 10 %: è una riga al 22 % che entra in B |
| 106, 119 | maniglie/voci aggiunte a mano; «Manutenzione Straordinaria D.P.R. 380/2001 (art. 3, 1°comma, lettera b)» + riga «CILA N. … del …, rilasciata dal Comune di … e intestata a …» | righe manuali in bozza; dicitura straordinaria + pratica edilizia |
| 107, 113 | zanzariere: tutto al 10 %, posa inclusa, nessun markup, nessuna sezione limiti | già coperto (B = 0 → tutto al 10 %) |
| 119 | porte interne: maniglie contate tra i beni significativi, B ≤ P → tutto al 10 % | già coperto |
| 99, 120 | B2B: solo 22 %; nuova costruzione con **IVA 4 %** e «Documento privo di valenza fiscale…» | **fuori ambito v1** (fatture libere, D6/§12): documentato nel handoff |
| NDC-1 | nota di credito FiC con **importi negativi** in stampa; prima riga «Accredito su ns. fatt. N del … per …»; riga «Calcolo limite…» | il segno si verifica alla prima nota reale (runbook); la prima riga diventa `intestazione` |

**Files:**
- Modify: `shared/fatturazione/tipi.ts` (`FatturazioneConfig.speseDocumentazioneCent: number` default 15000; `ModificaBozza` cresce lato servizio), `shared/fatturazione/diciture.ts` (+ `intervento_straordinaria`, `pratica_edilizia` template)
- Modify: `server/fatture/repository.ts` (colonna additiva `spese_documentazione_cent BIGINT NOT NULL DEFAULT 15000` in `fatturazione_config`, mapper, memoria)
- Modify: `server/fatture/generatore.ts`, `server/fatture/servizio.ts`, `server/fatture/notaCredito.ts`, `server/fatture/config.ts`
- Test: `server/fatture/generatore.test.ts`, `server/fatture/servizio.test.ts`, `server/fatture/notaCredito.test.ts`, `server/fatture/repository.test.ts` (+ pg)

**Regole (ruling del controller):**

1. **R17 — spese professionali al 22 %**: quando `contratto.opzioniComputo.speseProfessionali` è vero il generatore emette una riga `bene` (non `servizio`) con descrizione «Spese per documentazione detrazione», `aliquota: 22`, `beneSignificativo: true`, `importoCent = config.speseDocumentazioneCent` (default 15000), `voceComputoCodice: "spese_professionali"`, `limiteCent` = limite della voce del computo; la voce `spese_professionali` NON compare più tra i servizi al 10 %. La dicitura `spese_professionali_escluse` resta solo quando l'opzione è falsa. Test: con l'opzione vera la riga è tra i beni, il riepilogo 22 % include i 150 €, nessun servizio `spese_professionali`.
2. **R18 — righe manuali**: `ModificaBozza` accetta `righeAggiunte?: Array<{ tipo: "bene" | "servizio"; descrizione: string; importoCent: number; aliquota: 22 | 10; beneSignificativo: boolean }>` (max 20; `bene` ⇒ aliquota 22; `servizio` ⇒ 10; descrizione 1–300; importo intero ≥ 0) e `righeRimosse?: number[]` (ordini di righe non derivate `bene`/`servizio` con `rigaCommessaId == null` e `voceComputoCodice == null`: le righe del contratto e del computo non si cancellano, si azzerano). Le righe aggiunte vanno in coda al gruppo del loro tipo (bene prima del markup; servizio prima di storno/riaddebito), poi `ricalcola`. Evento `modificata` con `{ righeAggiunte: n, righeRimosse: n }`. Test: aggiunta «N.6 Maniglie» 60000 @22 significativa → B cresce e il markup cala di conseguenza; rimozione di una riga manuale; rifiuto della rimozione di una riga del contratto.
3. **R19 — pratica edilizia**: `DICITURE.intervento_straordinaria = "Manutenzione Straordinaria\nD.P.R. 380/2001 (art. 3, 1°comma, lettera b)"`; `DICITURE.pratica_edilizia = "{tipo} N. {numero} del {data}, rilasciata dal Comune di {comune} e intestata a {intestatario}."`. Il generatore sceglie `intervento_straordinaria` al posto di `intervento_manutenzione` quando `cliente.praticaEdilizia ∈ {"cila","scia"}` (campo già presente sul cliente: leggerlo nello `ClienteSnapshot` come `praticaEdilizia: "nessuna"|"cil"|"cila"|"scia"`), e aggiunge in `note` il template `pratica_edilizia` con `{tipo}` = CILA/SCIA/CIL e gli altri segnaposto da compilare a mano (restano tra graffe finché l'operatore non li sostituisce: `validaPerEmissione` dà `avviso` `pratica_edilizia_incompleta` se `note` contiene ancora `{`). Test sul generatore e sulla validazione.
4. **R20 — nota di credito**: la prima riga della nota è un'`intestazione` «Accredito su ns. fattura n. X del Y» (+ motivo se passato: `creaNotaCredito` accetta `motivo?: string` ≤ 300 e lo accoda); gli importi restano positivi (FatturaPA TD04 li vuole positivi; FiC li stampa col segno): il runbook (Task 18) impone di verificare alla prima nota reale che FiC non la registri come una fattura positiva e, in caso, di passare a importi negativi con `type: credit_note`. Test: prima riga intestazione con numero/data dell'origine.
5. **R21 — fuori ambito dichiarato**: aliquota 4 %, fatture senza commessa/contratto (B2B di sola fornitura) e «documento privo di valenza fiscale» restano fuori dal piano 2; `ALIQUOTE` resta `[22, 10]`. Il handoff (Task 18) lo scrive con le fatture 99 e 120 come esempi.
6. `speseDocumentazioneCent` è modificabile dal pannello Fatturazione (Task 16: campo «Spese documentazione detrazione (€)»).

- [ ] **Step 1: Test (fallisce)** — i casi elencati nelle regole 1–4 (generatore, servizio, notaCredito, repository memoria + pg per la colonna nuova).
- [ ] **Step 2–4: fallire, implementare, verdi, commit**

```bash
git add shared/fatturazione server/fatture
git commit -m "feat(fatture): spese di documentazione al 22 %, righe manuali in bozza, pratica edilizia e intestazione della nota di credito"
```

---

### Task 13: Router tRPC `fatture` e `fatturazioneConfig`

**Files:**
- Create: `server/routers/fatture.ts`, `server/routers/fatturazioneConfig.ts`
- Modify: `server/routers.ts` (import + mount `fatture: fattureRouter`, `fatturazioneConfig: fatturazioneConfigRouter`, accanto a `tariffe`)
- Test: `server/routers/fatture.test.ts`, `server/routers/fatturazioneConfig.test.ts`

**Interfaces:**
- Consumes: Task 6, 7, 9, 10, 11; `procedureConInterruttore("fatturazione")`; `authorizeCoreOperation`; `effectiveCapabilitySet`; `erroreServizioComeTrpc` (da `server/routers/contratti.ts`, estesa ai prefissi `PRECONDIZIONE:` → `PRECONDITION_FAILED`, `FATTURA_IMMUTABILE:` → `PRECONDITION_FAILED`, `CONFLITTO:` → `CONFLICT`, `EMISSIONE:` → `BAD_GATEWAY`).
- Produces (tutte le procedure: `interruttoreAttivo("limiti")` altrimenti `NOT_FOUND`; `commessaInSede` come in `contratti.ts`; capability come indicato):

| Procedura | Input | Capability | Restituisce |
|---|---|---|---|
| `fatture.perCommessa` (query) | `{ commessaId }` | `fattura.read` | `{ fatture: Fattura[] (senza righe), puoDraft, puoEmettere, puoNotaCredito, dryRun: sdiDryRun() }` |
| `fatture.byId` (query) | `{ id }` | `fattura.read` | `{ fattura, controlli, eventi, dryRun }` (NOT_FOUND se altra sede) |
| `fatture.creaBozza` (mutation) | `{ commessaId }` | `fattura.draft` | `{ fattura, avvertenze }` |
| `fatture.aggiornaBozza` (mutation) | `{ id, revisione, modifica: ModificaBozza (zod) }` | `fattura.draft` | `{ fattura, controlli }` |
| `fatture.rigeneraBozza` (mutation) | `{ id, revisione }` | `fattura.draft` | `{ fattura, avvertenze }` |
| `fatture.validazioni` (query) | `{ id }` | `fattura.read` | `{ controlli, emettibile }` |
| `fatture.emetti` (mutation) | `{ id, revisione }` | `fattura.emit` | `{ fattura, passi }` |
| `fatture.aggiornaStato` (mutation) | `{ id }` | `fattura.read` | `{ fattura, cambiato }` |
| `fatture.notaCredito` (mutation) | `{ fatturaId, selezione }` | `fattura.credit_note` | `{ fattura, avvertenze }` |
| `fatture.annullaBozza` (mutation) | `{ id, motivo }` | `fattura.draft` | `Fattura` |
| `fatture.lista` (query) | `{ stati?, tipo?, limite? }` | `fattura.read` | `Fattura[]` (senza righe) + `commessaCodice`/`clienteNome` risolti |
| `fatture.documento` (query) | `{ id, tipo: "pdf" \| "xml" }` | `fattura.read` | `{ nome, mimeType, dataBase64 }` (legge da `getFile`; XML piccolo, PDF ≤ 10 MB) |
| `fatturazioneConfig.get` (query) | — | `fattura.read` | `{ config, dryRun, scopeScrittura: status FiC }` |
| `fatturazioneConfig.salva` (mutation) | `patch` (zod: iban stringa ≤ 34, banca ≤ 80, intestatario ≤ 120, metodoPagamento `^MP\d{2}$`, numerazioneFic ≤ 20, paymentAccountIdFic int, dicituraFooter ≤ 500) | `fattura.emit` | `FatturazioneConfig` |
| `fatturazioneConfig.verificaScope` (mutation) | — | `fattura.emit` | esito di `verificaScopeScrittura` |

Il router **non** contiene logica: valida con zod, autorizza, delega, mappa gli errori. `emetti` passa `actorUserId = ctx.user.id`; `dryRun` viene sempre restituito perché la UI lo dichiara.

- [ ] **Step 1: Test (fallisce)** — pattern di `server/routers/contratti.test.ts` (o del test router più vicino: `appRouter.createCaller(ctx)` con `ctx` finto per ruolo/sede): flag `fatturazione` off → `NOT_FOUND` anche per direzione; `commerciale` legge ma `creaBozza` → `FORBIDDEN`; `amministrazione` crea, aggiorna, emette (con `emettiFattura` mockato via `vi.mock("../fatture/emissione")`); commessa di altra sede → `NOT_FOUND` «Commessa non trovata.»; `aggiornaBozza` con revisione vecchia → `CONFLICT`; `fatturazioneConfig.salva` con IBAN errato → `BAD_REQUEST`.

- [ ] **Step 2–4: fallire, implementare, verdi, commit**

```bash
git add server/routers/fatture.ts server/routers/fatturazioneConfig.ts server/routers/fatture.test.ts server/routers/fatturazioneConfig.test.ts server/routers.ts server/routers/contratti.ts
git commit -m "feat(fatture): router tRPC di bozza, emissione, stati, nota di credito e configurazione"
```

---

### Task 14: Presentazione pura `client/src/lib/fatturaView.ts`

**Files:**
- Create: `client/src/lib/fatturaView.ts`
- Test: `client/src/lib/fatturaView.test.ts`

**Interfaces:**
- Consumes: `Fattura`, `RigaFattura`, `StatoFattura`, `RiepilogoIva`, `ScadenzaFattura` (`@shared/fatturazione/tipi`), `DICITURE`, `formatCent` (`client/src/lib/limitiView.ts`).
- Produces:

```ts
export function badgeStatoFattura(stato: StatoFattura, inviataDryRun: boolean): { testo: string; tono: "neutro" | "ok" | "attenzione" | "errore" };
// bozza → «Bozza» neutro; in_emissione → «In emissione» attenzione; emessa + dryRun → «Emessa (prova SdI)» attenzione; emessa → «Emessa» ok; inviata → «Inviata allo SdI» ok; consegnata → «Consegnata» ok; scartata → «Scartata dallo SdI» errore; rifiutata → «Rifiutata dal cliente» errore; mancata_consegna → «Mancata consegna» attenzione; annullata → «Annullata» neutro
export type GruppoRigheView = { chiave: "beni" | "servizi" | "derivate" | "note"; titolo: string; righe: RigaFattura[]; totaleCent: number };
export function raggruppaRighe(righe: RigaFattura[]): GruppoRigheView[]; // intestazioni restano dentro il gruppo che introducono
export function indicatoreLimite(r: RigaFattura): { stato: "ok" | "oltre" | "n_a"; testo: string }; // servizio con limite: «entro il limite (€ X)» / «oltre il limite di € Y»
export function riepilogoView(f: Pick<Fattura, "riepilogo" | "imponibileCent" | "ivaCent" | "totaleCent" | "deltaPattuitoCent" | "pattuitoCent" | "pattuitoTipo" | "markupCent">): Array<{ etichetta: string; valore: string; tono?: "attenzione" | "errore" }>;
export function riepilogoControlli(controlli: Array<{ esito: "ok" | "avviso" | "errore"; messaggio: string }>): { errori: string[]; avvisi: string[]; ok: number };
export function sommaScadenzeCent(s: ScadenzaFattura[]): number;
export function scadenzeQuadrano(s: ScadenzaFattura[], totaleCent: number): boolean;
export function testoDicitura(chiave: string): string; // DICITURE[chiave] ?? chiave
export function etichettaTabFattura(fatture: Array<Pick<Fattura, "stato" | "tipo" | "inviataDryRun">> | undefined): string; // «Fattura» / «Fattura · bozza» / «Fattura ✓» (emessa+) / «Fattura !» (scartata/rifiutata)
export function nomeFileFattura(f: Pick<Fattura, "numero" | "tipo">, estensione: "pdf" | "xml"): string;
```

- [ ] **Step 1: Test (fallisce)** — un caso per funzione con i numeri del caso 127 (riepilogo: «22 %: 4.048,87 / 890,75», «10 %: 9.597,18 / 959,72», «Δ pattuito» solo se ≠ 0 con tono attenzione; markup negativo → tono errore); `raggruppaRighe` con la sequenza `intestazione, bene, bene, markup, intestazione, servizio, storno_bs, riaddebito_bs, nota` → gruppi beni (3 righe: intestazione + 2 bene), derivate (markup, storno, riaddebito), servizi (intestazione + servizio), note; `indicatoreLimite`; `etichettaTabFattura` per i quattro casi; `scadenzeQuadrano`.

- [ ] **Step 2–4: fallire, implementare, verdi, commit**

```bash
git add client/src/lib/fatturaView.ts client/src/lib/fatturaView.test.ts
git commit -m "feat(fatture): presentazione pura della fattura (stati, gruppi, limiti, riepilogo)"
```

---

### Task 15: Tab «Fattura» della commessa

**Files:**
- Create: `client/src/components/fattura/FatturaTab.tsx`, `client/src/components/fattura/BozzaFatturaEditor.tsx`, `client/src/components/fattura/ScadenzeEditor.tsx`, `client/src/components/fattura/FatturaEmessaView.tsx`, `client/src/components/fattura/NotaCreditoDialog.tsx`
- Modify: `client/src/pages/CommessaDetail.tsx` (`:172` accanto a `limitiAttivi` → `const fatturazioneAttiva = Boolean(interruttori.data?.fatturazione) && limitiAttivi;` + query `fattureQ = trpc.fatture.perCommessa.useQuery({ commessaId }, { enabled: fatturazioneAttiva && statoUsaLimiti, retry: false })`; `TabsList` r. 1205-1232: dopo il trigger `limiti`, `{fatturazioneAttiva && <TabsTrigger value="fattura">{etichettaTabFattura(fattureQ.data?.fatture)}</TabsTrigger>}`; `TabsContent value="fattura"` con `<FatturaTab commessaId={commessaId} />`; `ContrattoStatoBanner` `onApri` accetta anche `"fattura"`)
- Modify: `client/src/components/contratto/ContrattoStatoBanner.tsx` (terzo pulsante «Fattura» quando `stato === "fatture_pagamento"` e il flag fatturazione è acceso; prop `fatturazioneAttiva: boolean`)

**Interfaces:**
- Consumes: router Task 13, `fatturaView.ts`, `formatEuroSimbolo`/`parseEuro` (`client/src/lib/euro.ts`), `ConfirmDialog`, `StickyActionBar`, `DataSurface`, `Table`, `Badge`, `Dialog`, `Input`, `Textarea`, `Button`, lucide (`FileText`, `Send`, `RefreshCw`, `Download`, `Scale`, `Undo2`).
- Produces: `FatturaTab({ commessaId })`.

Comportamento (spec §9, D-A, D-C, D-H):

- Senza fatture: `Genera bozza dai limiti` (disabilitato con motivo se `!puoDraft`; se il computo non è valido il pulsante resta attivo e la bozza nasce con l'avvertenza — è il server a dirlo). Sotto, elenco delle fatture della commessa (numero, stato badge, totale, data) se ce ne sono.
- Bozza (`BozzaFatturaEditor`): tabella righe per gruppo (`raggruppaRighe`): colonne tipo · descrizione · importo (input `€` solo per `bene`/`servizio` non derivate; derivate in sola lettura con badge «derivata») · aliquota · limite/indicatore (`indicatoreLimite`); `bene` mostra il toggle «bene significativo» in sola lettura (viene dal contratto). Riepilogo vivo (`riepilogoView`) in una card laterale (1440) / sotto (390) — i valori si aggiornano **dopo** `aggiornaBozza` (ricalcolo server): il form invia le modifiche con un `Salva bozza` esplicito (`StickyActionBar` con `dirty`), niente ricalcolo client. Pulsante «Riequilibra i beni» (dialog: markup desiderato, default 0 → `modifica.riequilibraBeniAMarkupCent`). `ScadenzeEditor`: righe numero · quota % · data · importo · descrizione, aggiungi/rimuovi, indicatore «le scadenze sommano X / totale Y» (`scadenzeQuadrano`). Diciture: checkbox per chiave con testo (`testoDicitura`), campo «intestazione cantiere», textarea note. Controlli: lista `riepilogoControlli` (errori in rosso, avvisi in ambra) da `fatture.validazioni` (query, `refetch` dopo ogni salvataggio). Scavalco limiti: se c'è l'errore `limite_totale`, checkbox «Procedi oltre i limiti» con motivo obbligatorio (solo `puoEmettere`) → `modifica.scavalcoLimiti`. `Emetti` (solo `puoEmettere`, disabilitato se `!emettibile` o `dirty`): `ConfirmDialog` con titolo «Emetti la fattura su Fatture in Cloud», descrizione che dichiara **sempre** il dry-run («Invio allo SdI in prova: il documento sarà numerato da FiC ma non spedito» oppure «Invio reale allo SdI»), `confirmLabel` «Emetti». Esito: toast con i passi falliti se ce ne sono; refetch. Errore `CONFLICT` → toast «modificata altrove, ricarica» + refetch. `Annulla bozza` in `secondary` con conferma.
- Emessa+ (`FatturaEmessaView`): testata numero · data · stato badge · «prova SdI» se dry-run · totali; righe in sola lettura; scadenze con stato; cronologia eventi (tipo, data, dettaglio da payload: numero, errori, stato SdI); pulsanti `Scarica PDF`/`Scarica XML` (via `fatture.documento` → `Blob` + link temporaneo, pattern di `downloadDocumento` in CommessaDetail), `Aggiorna stato` (`fatture.aggiornaStato`), `Nota di credito` (solo `puoNotaCredito`, `NotaCreditoDialog`: totale / parziale con selezione righe e importi). `eiErrore` in evidenza con tono errore.
- Mobile 390: righe come card (descrizione, importo, aliquota, indicatore), riepilogo sotto, `StickyActionBar` in basso; nessuno scroll orizzontale (`min-w-0`, `overflow-x-auto` sulla sola tabella).

- [ ] **Step 1: Implementare** (nessun test di componente: la logica è in `fatturaView.ts`; le funzioni di formato importi in `euro.ts`).
- [ ] **Step 2: Verifica in browser** sul demo (`.claude/launch.json` «Limiti demo (porta 5198)», riavviare il server dopo le modifiche server: `tsx` senza watch): commessa con contratto del caso 127 (righe in `server/computo/__fixtures__/casi-reali.json`), computo calcolato, cliente con CF valido e indirizzo completo; configurazione sede compilata dal pannello (Task 16) o via `fatturazioneConfig.salva` da console; **senza** FiC collegato l'emissione deve fermarsi con l'errore di configurazione (`scopeScritturaOk`) mostrato tra i controlli, non con un'eccezione. Screenshot 1440×900 e 390×844, console pulita, `pnpm check`.
- [ ] **Step 3: Commit**

```bash
git add client/src/components/fattura client/src/pages/CommessaDetail.tsx client/src/components/contratto/ContrattoStatoBanner.tsx
git commit -m "feat(fatture): tab Fattura della commessa — bozza modificabile, riequilibrio beni, emissione con conferma, vista emessa"
```

---

### Task 16: Impostazioni (scope FiC + pannello Fatturazione), /pagamenti e card Pagamenti

**Files:**
- Create: `client/src/components/fattura/FatturazioneConfigPanel.tsx`, `client/src/components/fattura/FattureEmesseSezione.tsx`
- Modify: `client/src/pages/Integrazioni.tsx:187-196` (dentro «Contabilità», dopo `<FattureInCloudCard />`: `{fatturazioneAttiva && <FatturazioneConfigPanel />}` con `fatturazioneAttiva = Boolean(interruttori.data?.fatturazione && interruttori.data?.limiti)`), `FattureInCloudCard` (r. 620+: riga «Permessi di scrittura fatture: autorizzati / non autorizzati» da `status.scopeScrittura` + pulsante «Ri-autorizza con permessi di scrittura» → `oauthStartUrl.mutate({ scrittura: true })` e redirect come il pulsante esistente)
- Modify: `client/src/pages/Pagamenti.tsx` (`PagamentiAutorizzata`, r. 127+: sezione `FattureEmesseSezione` in testa quando il flag è acceso)
- Modify: `client/src/pages/CommessaDetail.tsx` `PagamentiCard` (r. 2846+): terzo stato del badge «da fattura CRM» quando `fattureQ.data?.fatture` contiene una `emessa`+ (precedenza: FiC > fattura CRM > contratto), e `PianoRateSezione soloLettura` in quel caso

**Interfaces:**
- `FatturazioneConfigPanel`: query `fatturazioneConfig.get`; form IBAN (validazione locale `ibanValido` importata da `server/fatture/config`? **no**: il client non importa server; ripetere il controllo mod 97 in `client/src/lib/fatturaView.ts` come `ibanSembraValido`), banca, intestatario, metodo (select `MP05` bonifico / `MP01` contanti / `MP08` carta / `MP12` RIBA), numerazione (select dalle `opzioni.numerations` dopo la verifica scope, altrimenti input), conto FiC (select `paymentAccounts`), dicitura footer; badge dry-run: «Invio SdI in prova (FATTURAZIONE_SDI_DRY_RUN)» in ambra o «Invio SdI reale» in verde; pulsante «Verifica permessi e carica IVA/conti da FiC» → `verificaScope` con esito (ok: id IVA 22/10 trovati; ko: motivo + link al pulsante di ri-autorizzazione); `Salva`.
- `FattureEmesseSezione`: `fatture.lista({ limite: 50 })` in `DataSurface` «Fatture emesse dal CRM»: numero · data · cliente · commessa (link `/commesse/:id`) · totale · stato badge · dry-run; filtro stato (select) e tipo; vuoto: «Nessuna fattura emessa dal CRM in questa sede».

- [ ] **Step 1: Implementare**; **Step 2: verifica in browser** (Impostazioni: pannello visibile solo con i due flag, salvataggio config, verifica scope senza FiC → messaggio onesto; /pagamenti: sezione con la fattura del demo se emessa, altrimenti stato vuoto; card Pagamenti: badge) a 1440 e 390, console pulita; **Step 3: commit**

```bash
git add client/src/components/fattura/FatturazioneConfigPanel.tsx client/src/components/fattura/FattureEmesseSezione.tsx client/src/pages/Integrazioni.tsx client/src/pages/Pagamenti.tsx client/src/pages/CommessaDetail.tsx client/src/lib/fatturaView.ts
git commit -m "feat(fatture): pannello Fatturazione per sede, permessi FiC di scrittura, fatture emesse in Cassa"
```

---

### Task 17: Fascicolo Tars — la riga della fattura

**Files:**
- Modify: `server/tars/fascicoli.ts` (`fascicoloCommessa`, r. 183+: nuova sezione «Fatturazione» dopo quella del contratto/limiti se esiste, altrimenti in coda)
- Test: `server/tars/fascicoli.test.ts` (nuovo caso)

**Interfaces:**
- Consumes: `fatturePerCommessa(sedeId, commessaId)` (Task 6), `interruttoreAttivo("fatturazione")`.
- Produces: nel fascicolo della commessa una riga di testo: senza fatture → «Fattura: nessuna (bozza da generare dai limiti)» solo se lo stato è `fatture_pagamento`; bozza → «Fattura: bozza #id, totale € X, N controlli aperti»; emessa+ → «Fattura n. X del Y: <stato leggibile>[ · prova SdI][ · avviso: eiErrore]»; nota di credito → «Nota di credito n. X: <stato>». Con il flag spento la sezione non compare. La cache del fascicolo (chiave `fascicolo:commessa:${sedeId}:${commessaId}`) si invalida negli stessi punti in cui si invalida per un documento nuovo: `emettiFattura` e `aggiornaStatoFattura` chiamano la funzione di invalidazione già usata da `preventiviContratti.ts` (cercare `invalidaFascicolo` o equivalente in `server/tars/cache/entries.ts` e riusarla).

- [ ] **Step 1: Test (fallisce)** — fascicolo con una fattura emessa in dry-run contiene «prova SdI»; con flag spento non contiene «Fattura».
- [ ] **Step 2–4: fallire, implementare, verdi, commit**

```bash
git add server/tars/fascicoli.ts server/tars/fascicoli.test.ts server/fatture/emissione.ts server/fatture/sonda.ts
git commit -m "feat(tars): il fascicolo della commessa racconta la fattura e il suo stato SdI"
```

---

### Task 18: Documentazione, runbook e allineamento della spec

**Files:**
- Modify: `handoff.md` (nuova sezione «11-vicies quaterdecies. Fatturazione dal contratto — piano 2 (04/09/2026)» prima di «## 12.», e voce in §12 «Debito aperto prioritario»)
- Modify: `docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md` (§7.2: nota «beni modificabili, markup derivato, riequilibrio» con rimando a D-A; §7.3: capability `fattura.emit`; §10: nomi capability definitivi; §11: `FATTURAZIONE_SDI_DRY_RUN` come variabile, non interruttore; §7.5: `commessaMatch: "crm"`)
- Modify: `.env.example` (già dal Task 1: verificare), `docs/tars/matrice-azioni-tars.md` (una riga: nessuno strumento Tars per la fattura in v1, come da spec §10)

Contenuto della sezione handoff (in italiano, stile delle sezioni esistenti): cosa c'è (tabelle, servizi, router, UI), come si attiva (flag `FLAG_FATTURAZIONE` per deployment, `FLAG_LIMITI` necessario, ri-autorizzazione OAuth FiC con scope di scrittura da Impostazioni → Contabilità, «Verifica permessi» che carica id IVA e conti, IBAN e conto), il **runbook della prima fattura reale**: 1) sede di prova con dry-run acceso; 2) commessa reale già fatturata a mano nel 2026: contratto + computo + bozza → confronto **riga per riga** col PDF della fattura reale (beni, servizi, markup, storno, riepilogo IVA, scadenze) e riequilibrio dei beni ai valori della commercialista; 3) `Emetti` in dry-run → documento numerato su FiC (attenzione: **numera davvero**: usare la company di prova FiC consigliata dalla spec §11, oppure accettare il numero e poi stornarlo con nota di credito); 4) XML scaricato e verificato dal commercialista; 5) solo dopo, `FATTURAZIONE_SDI_DRY_RUN=off` sulla sede. Debito dichiarato: PEC/codice destinatario/ficEntityId senza UI cliente (si inseriscono dal form cliente esistente solo se il task 6 li ha esposti; altrimenti via `clienti.update`); fatture libere e acconti fuori ambito (D3, D6); un solo processo per la sonda; la sonda non ritenta l'invio; nessuno strumento Tars.

- [ ] **Step 1: Scrivere**; **Step 2: `pnpm check && pnpm test && pnpm build`**; **Step 3: commit**

```bash
git add handoff.md docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md docs/tars/matrice-azioni-tars.md .env.example
git commit -m "docs(fatture): handoff, runbook della prima fattura reale e spec allineata al piano 2"
```

---

## Note per il controller (auto-revisione del piano)

- **Copertura spec**: §4.4 → Task 2, 5; §7.1 → Task 4; §7.2 → Task 3 (+ D-A); §7.3 → Task 6 (`verificaLimiti`, scavalco registrato con evento e capability `fattura.emit`); §7.4 → Task 6 (`validaPerEmissione`) e Task 2 (validatori); §7.5 → Task 7 (scope, info), 8 (client), 9 (pipeline), 10 (sonda), 12 (sync); §7.6 → Task 11; §8 timeline «Fatturazione» → Task 9 passo 9; §9 → Task 15, 16 (banner: Task 15; Tars fascicolo: Task 17); §10 → Task 1; §11 → Task 1 (flag, dry-run), test in ogni task; §13 rischi → confronto totali (Task 9.4), idempotenza (Task 9), scope (Task 7), numerazione (nessuna bozza su FiC).
- **Fuori piano, dichiarato**: UI dei campi cliente `pec`/`codiceDestinatario` (solo campi server, Task 6); porte interne; fatture libere; strumenti Tars.
- **Coerenza dei nomi**: `fatturaModificabile`, `sdiDryRun`, `risolvi`, `ricalcola`, `generaBozza`, `scadenzeDaRate`, `riequilibraBeni`, `creaBozza`, `aggiornaBozza`, `validaPerEmissione`, `emettiFattura`, `aggiornaStatoFattura`, `giroSonda`, `creaNotaCredito`, `verificaScopeScrittura`, `creaClientFicEmissione`, `creaClientFicFinto`, `registraDocumentoFatturaCrm` — usati con lo stesso nome in ogni task.
- **Ordine di esecuzione**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18. I task 3–4 sono puri e possono essere revisionati con un modello economico; 9 e 12 richiedono il modello più capace.
