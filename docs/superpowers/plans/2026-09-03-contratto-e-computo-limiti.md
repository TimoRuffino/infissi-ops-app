# Contratto e computo limiti — piano di implementazione (piano 1 di 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare alla commessa un contratto strutturato (righe con misure, pattuito, parametri di cantiere, detrazione) e un computo automatico dei limiti di spesa DM MITE (CHECK1 Allegato A + CHECK2 DEI), con gate sulla transizione verso «Fatture pagamento» e due tab nuove nella pagina Commessa 360.

**Architecture:** Tabelle relazionali nuove (`commessa_contratti`, `commessa_righe`, `computi`, `computo_voci`) con repository Postgres + fallback in memoria come `server/reminders/repository.ts`; servizi di dominio in `server/contratti/` e `server/computo/`; motore di calcolo puro (`server/computo/motore.ts`) che riproduce le formule del foglio «CALCOLO NUOVI LIMITI.xlsx» con tariffe e coefficienti caricati da un seed JSON; router tRPC sottili dietro `procedureConInterruttore("limiti")`; UI come tab della commessa (`Contratto`, `Limiti`) e badge «da contratto» sulla card Pagamenti. Fatturazione (piano 2) e lettura del contratto PDF (piano 3) restano fuori.

**Tech Stack:** TypeScript 5.9, Node 20, Express + tRPC 11 + zod 4, postgres-js (`kvSql`), React 19 + shadcn/Radix + Tailwind 4, vitest 2. Python 3 + openpyxl solo per lo script una tantum di estrazione del seed.

**Spec:** `docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md` (sezioni 2, 3, 4.1–4.3, 5, 8, 9, 10, 11).

## Global Constraints

- Branch `feature/limiti-fatturazione`; **mai push su `main`** (push su main = deploy Railway).
- `sedeId` su ogni tabella, query e mutation; record di altra sede → `NOT_FOUND` con messaggio «… non trovato/a.», mai `FORBIDDEN`.
- Importi in **centesimi interi** (`BIGINT` / `number` intero) in tutte le tabelle nuove; conversione da/verso euro float solo in `shared/euroCent.ts` e nel confine con `commessa.importoTotale`.
- Nessun nuovo store `kv_store`; tabelle create con `CREATE TABLE IF NOT EXISTS` additive dentro `ensureSchema()`; fallback in memoria senza `DATABASE_URL`.
- Interruttore `FLAG_LIMITI` fail-closed (`server/platform/interruttori.ts`): acceso di default solo con `NODE_ENV` development/test.
- Capability nuove: `contratto.read`, `contratto.manage`, `computo.run`, `tariffe.manage`; autorizzazioni con `authorizeCoreOperation(..., legacyAllowed: "capability")`.
- Commenti e messaggi in italiano; commit in stile Conventional Commits italiano (`feat(contratti): …`), corpo che spiega il perché, chiuso da `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- UI: token semantici di `client/src/index.css`, nessun hex locale; `min-w-0` e vista mobile per ogni tabella; verifica 1440×900 e 390×844 prima di chiudere una modifica visuale.
- Ogni task chiude con `pnpm check` e `pnpm test` verdi; nessuna dipendenza npm nuova.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `shared/euroCent.ts` (+ test) | `euroToCent`, `centToEuro`, `sommaCent`: unico punto di conversione |
| `shared/limiti/tipi.ts` | tipi condivisi client/server: categorie, righe, contratto, computo, voci |
| `shared/limiti/tariffe-seed.json` | dati del foglio: massimali, DEI, controtelai, opere, coefficienti, detrazioni, default |
| `shared/limiti/comuni-zona.json` | Tabella A DPR 412/93: comune → zona, gradi giorno |
| `scripts/estrai-tariffe-limiti.py` | una tantum: xlsx → `tariffe-seed.json` |
| `scripts/importa-comuni-zona.py` | una tantum: CSV ENEA → `comuni-zona.json` |
| `server/platform/interruttori.ts` | + `limiti` |
| `server/authz/capabilities.ts` | + 4 capability e assegnazione ai ruoli |
| `server/contratti/repository.ts` (+ `.pg.test.ts`) | tabelle contratto/righe, memoria + Postgres |
| `server/contratti/hash.ts` (+ test) | hash canonico di righe e parametri |
| `server/contratti/servizio.ts` (+ test) | validazione, mq, zona, salvataggio atomico, specchio pattuito |
| `server/routers/contratti.ts` (+ test) | tRPC `contratti.get` / `contratti.salva` |
| `server/computo/tariffe.ts` (+ test) | carica il seed, tariffe valide a una data |
| `server/computo/zone.ts` (+ test) | comune → zona climatica |
| `server/computo/aggregati.ts` (+ test) | righe → conteggi, mq, larghezze, ore |
| `server/computo/motore.ts` (+ test) | CHECK1, CHECK2, limite, detrazione — puro |
| `server/computo/repository.ts` (+ `.pg.test.ts`) | tabelle computi/voci |
| `server/computo/servizio.ts` (+ test) | `eseguiComputo`, `computoValido`, `ultimoComputo` |
| `server/routers/computo.ts` (+ test) | tRPC `computo.ultimo` / `computo.esegui` |
| `server/commesse/transizioni.ts` (+ test) | gate computo sulla transizione verso `fatture_pagamento` |
| `server/routers/commesse.ts` | dipendenza `computoValido` + `applicaPattuitoDaContratto` |
| `client/src/lib/contrattoView.ts` (+ test) | presentazione pura righe/parametri |
| `client/src/lib/limitiView.ts` (+ test) | presentazione pura voci/esiti |
| `client/src/components/contratto/ContrattoTab.tsx` | tab Contratto |
| `client/src/components/computo/LimitiTab.tsx` | tab Limiti |
| `client/src/pages/CommessaDetail.tsx` | tab nuove, badge «da contratto» |
| `docs/…`, `handoff.md` | contratti e runbook |

---

### Task 1: Interruttore `limiti` e capability

**Files:**
- Modify: `server/platform/interruttori.ts`
- Modify: `server/authz/capabilities.ts`
- Test: `server/authz/capabilities.limiti.test.ts`

**Interfaces:**
- Produces: `Interruttore` include `"limiti"` (env `FLAG_LIMITI`); `Capability` include `"contratto.read" | "contratto.manage" | "computo.run" | "tariffe.manage"`.

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// server/authz/capabilities.limiti.test.ts
import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, capabilitiesForRoles } from "./capabilities";
import { interruttoreAttivo, statoInterruttori } from "../platform/interruttori";

describe("capability contratto/computo/tariffe", () => {
  it("esistono nel catalogo", () => {
    for (const c of ["contratto.read", "contratto.manage", "computo.run", "tariffe.manage"]) {
      expect(ALL_CAPABILITIES.has(c as any)).toBe(true);
    }
  });

  it("commerciale e amministrazione gestiscono il contratto e lanciano il computo", () => {
    for (const ruolo of ["commerciale", "amministrazione"]) {
      const caps = capabilitiesForRoles([ruolo]);
      expect(caps.has("contratto.read")).toBe(true);
      expect(caps.has("contratto.manage")).toBe(true);
      expect(caps.has("computo.run")).toBe(true);
      expect(caps.has("tariffe.manage")).toBe(false);
    }
  });

  it("tutti leggono il contratto, solo direzione gestisce le tariffe", () => {
    expect(capabilitiesForRoles(["squadra_posa"]).has("contratto.read")).toBe(true);
    expect(capabilitiesForRoles(["squadra_posa"]).has("contratto.manage")).toBe(false);
    expect(capabilitiesForRoles(["direzione"]).has("tariffe.manage")).toBe(true);
  });
});

describe("interruttore limiti", () => {
  it("è nel registro e segue FLAG_LIMITI", () => {
    expect(Object.keys(statoInterruttori())).toContain("limiti");
    process.env.FLAG_LIMITI = "off";
    expect(interruttoreAttivo("limiti")).toBe(false);
    process.env.FLAG_LIMITI = "on";
    expect(interruttoreAttivo("limiti")).toBe(true);
    delete process.env.FLAG_LIMITI;
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/authz/capabilities.limiti.test.ts`
Expected: FAIL — `ALL_CAPABILITIES.has("contratto.read")` è `false`; `statoInterruttori()` non contiene `limiti`.

- [ ] **Step 3: Aggiungere interruttore e capability**

In `server/platform/interruttori.ts`, dentro il tipo `Interruttore` (dopo `| "uiV2"`):

```ts
  // Contratto strutturato e computo limiti DM MITE (03/09/2026): tab
  // Contratto/Limiti, gate sulla transizione verso «Fatture pagamento».
  | "limiti";
```

In `VARIABILE`: `limiti: "FLAG_LIMITI",` — in `ETICHETTA`: `limiti: "Il contratto strutturato e il computo dei limiti di spesa",`.

Nel tipo di `tarsAttivo` (`Exclude<Interruttore, "documentIntelligence" | "proposte" | "ocr" | "uiV2">`) aggiungere `| "limiti"` all'elenco escluso.

In `server/authz/capabilities.ts`, dentro `CAPABILITIES` dopo `"economia.read",`:

```ts
  // Contratto strutturato e computo limiti (03/09/2026). `contratto.read` è
  // condivisa: le misure servono a chi rileva e a chi posa. `tariffe.manage`
  // è solo direzione (via CAPABILITIES completo).
  "contratto.read",
  "contratto.manage",
  "computo.run",
  "tariffe.manage",
```

In `SHARED_CAPABILITIES` aggiungere `"contratto.read",`. In `ROLE_CAPABILITIES.amministrazione` e `ROLE_CAPABILITIES.commerciale` aggiungere `"contratto.manage",` e `"computo.run",`.

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `pnpm vitest run server/authz/capabilities.limiti.test.ts && pnpm check`
Expected: PASS; typecheck verde (il nuovo membro dell'unione compare in tutti i `Record<Interruttore, …>`).

- [ ] **Step 5: Commit**

```bash
git add server/platform/interruttori.ts server/authz/capabilities.ts server/authz/capabilities.limiti.test.ts
git commit -m "feat(limiti): interruttore FLAG_LIMITI e capability contratto/computo/tariffe

Fail-closed come gli altri interruttori; il contratto è leggibile da tutti
i ruoli, gestito da commerciale e amministrazione, le tariffe solo da
direzione.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Tipi condivisi e centesimi

**Files:**
- Create: `shared/euroCent.ts`
- Create: `shared/limiti/tipi.ts`
- Test: `server/_core/euroCent.test.ts`

**Interfaces:**
- Produces: `euroToCent(euro: number): number`, `centToEuro(cent: number): number`, `sommaCent(...valori: Array<number | null | undefined>): number`; tutti i tipi di `shared/limiti/tipi.ts` elencati sotto (usati da ogni task successivo).

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// server/_core/euroCent.test.ts
import { describe, expect, it } from "vitest";
import { centToEuro, euroToCent, sommaCent } from "@shared/euroCent";

describe("euroCent", () => {
  it("arrotonda half-up al centesimo e torna indietro senza deriva", () => {
    expect(euroToCent(15395)).toBe(1539500);
    expect(euroToCent(8247.46)).toBe(824746);
    expect(euroToCent(0.005)).toBe(1);
    expect(euroToCent(1.005)).toBe(101);
    expect(centToEuro(824746)).toBe(8247.46);
  });
  it("rifiuta valori non finiti", () => {
    expect(() => euroToCent(Number.NaN)).toThrow("IMPORTO_NON_VALIDO");
    expect(() => euroToCent(Number.POSITIVE_INFINITY)).toThrow("IMPORTO_NON_VALIDO");
  });
  it("somma ignorando i vuoti e resta intera", () => {
    expect(sommaCent(100, null, undefined, 250)).toBe(350);
    expect(() => sommaCent(1.5)).toThrow("CENT_NON_INTERI");
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/_core/euroCent.test.ts`
Expected: FAIL — modulo `@shared/euroCent` inesistente.

- [ ] **Step 3: Scrivere `shared/euroCent.ts` e `shared/limiti/tipi.ts`**

```ts
// shared/euroCent.ts
// Unico punto di conversione euro ↔ centesimi. Le tabelle nuove (contratto,
// computo, fatture) tengono interi in centesimi: le somme sono esatte e
// l'arrotondamento avviene una volta, qui, half-up come richiede FatturaPA.
// Il resto del CRM parla ancora in euro float (`commessa.importoTotale`):
// si converte SOLO al confine, mai si sommano le due forme.

export function euroToCent(euro: number): number {
  if (typeof euro !== "number" || !Number.isFinite(euro)) {
    throw new Error("IMPORTO_NON_VALIDO");
  }
  // +Number.EPSILON evita 1.005 → 100 per la rappresentazione binaria.
  return Math.round((euro + Number.EPSILON) * 100);
}

export function centToEuro(cent: number): number {
  if (!Number.isInteger(cent)) throw new Error("CENT_NON_INTERI");
  return cent / 100;
}

export function sommaCent(
  ...valori: Array<number | null | undefined>
): number {
  let totale = 0;
  for (const v of valori) {
    if (v == null) continue;
    if (!Number.isInteger(v)) throw new Error("CENT_NON_INTERI");
    totale += v;
  }
  return totale;
}
```

```ts
// shared/limiti/tipi.ts
// Tipi del contratto strutturato e del computo limiti, condivisi tra
// server e client. Nessuna logica: solo forme. Le regole vivono nei servizi.

export const CATEGORIE_RIGA = [
  "serramento_pvc",
  "serramento_alluminio",
  "serramento_legno",
  "serramento_legno_alluminio",
  "cassonetto",
  "tapparella",
  "persiana",
  "scuro",
  "schermatura",
  "zanzariera",
  "tenda",
  "pergola",
  "porta_blindata",
  "portoncino",
  "porta_interna",
  "controtelaio",
  "accessorio",
  "altro",
] as const;
export type CategoriaRiga = (typeof CATEGORIE_RIGA)[number];

/** Oscurante venduto insieme al serramento (foglio: SerrTapp/SerrPers/SerrScuri). */
export const OSCURANTI_INTEGRATI = ["tapparella", "persiana", "scuro"] as const;
export type OscuranteIntegrato = (typeof OSCURANTI_INTEGRATI)[number];

export const TIPOLOGIE_SERRAMENTO = [
  "fisso",
  "finestra_1_anta",
  "finestra_2_ante",
  "portafinestra_1_anta",
  "portafinestra_2_ante",
  "scorrevole_complanare_finestra",
  "scorrevole_complanare_portafinestra",
  "scorrevole_alzante",
] as const;
export type TipologiaSerramento = (typeof TIPOLOGIE_SERRAMENTO)[number];

export type AccessorioRiga = { codice: string; quantita: number };

export type RigaContratto = {
  id: number;
  sedeId: number;
  commessaId: number;
  ordine: number;
  categoria: CategoriaRiga;
  /** Per i serramenti una TipologiaSerramento; per i controtelai il codice variante DEI (es. "C15145-a"). */
  tipologia: string | null;
  oscuranteIntegrato: OscuranteIntegrato | null;
  descrizione: string;
  quantita: number;
  larghezzaMm: number | null;
  altezzaMm: number | null;
  /** mq totali della riga (L×H/10⁶ × quantità), calcolati dal servizio. */
  mq: number;
  /** Solo controtelai: misura DEI dichiarata (mq, m o pezzi secondo la variante). */
  misuraDei: number | null;
  prezzoUnitCent: number | null;
  prezzoTotCent: number | null;
  beneSignificativo: boolean;
  accessori: AccessorioRiga[];
  note: string | null;
  origine: "estrazione" | "manuale" | "prodotto_legacy";
  evidenza: { pagina: number; frammento: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RigaContrattoInput = Omit<
  RigaContratto,
  "id" | "sedeId" | "commessaId" | "mq" | "createdAt" | "updatedAt" | "ordine"
> & { id?: number | null };

export const PATTUITO_TIPI = ["lordo", "imponibile"] as const;
export type PattuitoTipo = (typeof PATTUITO_TIPI)[number];
export const DETRAZIONE_TIPI = ["nessuna", "ecobonus", "ristrutturazione"] as const;
export type DetrazioneTipo = (typeof DETRAZIONE_TIPI)[number];
export const DETRAZIONE_IMMOBILI = ["prima_casa", "altro"] as const;
export type DetrazioneImmobile = (typeof DETRAZIONE_IMMOBILI)[number];
export const ZONE_CLIMATICHE = ["A", "B", "C", "D", "E", "F"] as const;
export type ZonaClimatica = (typeof ZONE_CLIMATICHE)[number];

export type RataContratto = {
  numero: number;
  quotaPct: number;
  /** Giorni dalla data fattura oppure data assoluta ISO; uno dei due. */
  giorni: number | null;
  data: string | null;
  descrizione: string | null;
};

export type Contratto = {
  commessaId: number;
  sedeId: number;
  pattuitoCent: number;
  pattuitoTipo: PattuitoTipo;
  posaInclusa: boolean;
  notePosa: string | null;
  comuneCantiere: string | null;
  codiceIstat: string | null;
  zonaClimatica: ZonaClimatica | null;
  zonaManuale: boolean;
  piano: number | null;
  distanzaKm: number | null;
  detrazioneTipo: DetrazioneTipo;
  detrazioneImmobile: DetrazioneImmobile | null;
  detrazionePct: number | null;
  dataFirma: string | null;
  rate: RataContratto[];
  hashRighe: string;
  hashParametri: string;
  origine: "estrazione" | "manuale";
  documentoId: number | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ContrattoInput = Omit<
  Contratto,
  | "commessaId" | "sedeId" | "hashRighe" | "hashParametri" | "zonaClimatica"
  | "codiceIstat" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt"
> & { zonaClimatica?: ZonaClimatica | null };

export type GruppoVoce = "prodotti" | "controtelai" | "opere" | "eventuali";

export type VoceComputo = {
  gruppo: GruppoVoce;
  codice: string;
  descrizione: string;
  codiceDei: string | null;
  unita: string;
  prezzoUnitCent: number;
  quantita: number;
  limiteCent: number;
  /** Input della formula, per spiegare il numero in UI. */
  dettaglio: Record<string, number | string | boolean>;
  ordine: number;
};

export type EsitoComputo = "ok" | "incompleto";

export type Computo = {
  id: number;
  sedeId: number;
  commessaId: number;
  hashRighe: string;
  hashParametri: string;
  tariffeAl: string;
  zona: ZonaClimatica | null;
  esito: EsitoComputo;
  check1Cent: number;
  check2Cent: number | null;
  limiteCent: number;
  detraibileCent: number | null;
  detrazioneStimataCent: number | null;
  avvertenze: string[];
  voci: VoceComputo[];
  createdBy: number | null;
  createdAt: Date;
};
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `pnpm vitest run server/_core/euroCent.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/euroCent.ts shared/limiti/tipi.ts server/_core/euroCent.test.ts
git commit -m "feat(limiti): tipi condivisi del contratto strutturato e helper centesimi

Le tabelle nuove tengono interi in centesimi; la conversione con gli euro
float del resto del CRM avviene solo qui, half-up, mai sommando le due forme.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Seed delle tariffe dal foglio e caricatore

**Files:**
- Create: `scripts/estrai-tariffe-limiti.py`
- Create: `shared/limiti/tariffe-seed.json` (generato dallo script, committato)
- Create: `server/computo/tariffe.ts`
- Test: `server/computo/tariffe.test.ts`

**Interfaces:**
- Produces: `type Tariffe = { versione: string; validoDal: string; massimali: Massimale[]; dei: VoceDei[]; controtelai: VoceControtelaio[]; opere: VoceOpera[]; coefficienti: Coefficienti; detrazioni: RegolaDetrazione[]; beneSignificativoDefault: Record<CategoriaRiga, boolean> }`; `tariffeAttive(alla?: Date): Tariffe`; `massimaleEuroMq(t: Tariffe, gruppo: "A"|"B"|"C", zona: ZonaClimatica): number`; `voceDeiPer(t: Tariffe, categoria: CategoriaRiga, tipologia: string | null): VoceDei | null`; `percentualeDetrazione(t: Tariffe, tipo, immobile, anno): number | null`.

- [ ] **Step 1: Scrivere lo script di estrazione**

```python
#!/usr/bin/env python3
# scripts/estrai-tariffe-limiti.py — una tantum.
# Legge «CALCOLO NUOVI LIMITI.xlsx» (valori, non formule) e scrive
# shared/limiti/tariffe-seed.json. Le formule del foglio vivono nel motore
# (server/computo/motore.ts); qui escono SOLO i dati: massimali, listino DEI,
# controtelai, prezzi delle opere, coefficienti e regole. Il foglio NON va nel
# repository (13 MB, dati aziendali).
#
# Uso: python3 scripts/estrai-tariffe-limiti.py "<percorso>/CALCOLO NUOVI LIMITI .xlsx"
import json, re, sys, warnings
from datetime import date
warnings.filterwarnings("ignore")
import openpyxl

if len(sys.argv) < 2:
    sys.exit("uso: estrai-tariffe-limiti.py <file.xlsx>")
wb = openpyxl.load_workbook(sys.argv[1], data_only=True, read_only=True)

def celle(nome, r1, r2, c1, c2):
    ws = wb[nome]
    out = {}
    for i, row in enumerate(ws.iter_rows(min_row=r1, max_row=r2, min_col=c1, max_col=c2, values_only=True), r1):
        for j, v in zip(range(c1, c2 + 1), row):
            if v not in (None, ""):
                out[(openpyxl.utils.get_column_letter(j), i)] = v
    return out

def num(v):
    return round(float(v), 2) if isinstance(v, (int, float)) else None

# ── Massimali Allegato A: 'Calcolo Automatici' B3:D26 → gruppo (A/B/C) × zona
ca = celle("Calcolo Automatici", 3, 26, 2, 4)
massimali = []
for r in range(3, 27):
    etichetta = str(ca.get(("B", r), ""))
    gruppo = etichetta.strip()[:1]  # "A)", "B)", "C)", "D)"
    if gruppo == "D":
        gruppo = "C"  # schermature solari: stesso massimale degli oscuranti (CHECK1 riga 8)
    zona = ca.get(("C", r))
    prezzo = num(ca.get(("D", r)))
    if gruppo in ("A", "B", "C") and zona and prezzo:
        massimali.append({"gruppo": gruppo, "zona": str(zona), "euroMq": prezzo})
# dedup (D e C coincidono)
visti = set(); massimali = [m for m in massimali if not ((m["gruppo"], m["zona"]) in visti or visti.add((m["gruppo"], m["zona"])))]
assert len(massimali) == 18, len(massimali)

# ── Listino DEI serramenti: foglio DEI righe 2..85
dei_celle = celle("DEI", 2, 85, 1, 6)
def categoria_di(desc):
    d = desc.upper()
    if "LEGNO" in d and "ALLUMINIO" in d: return "serramento_legno_alluminio"
    if "LEGNO" in d: return "serramento_legno"
    if "ALLUMINIO" in d: return "serramento_alluminio"
    if "PVC" in d: return "serramento_pvc"
    return None
def tipologia_di(desc):
    d = desc.lower()
    if "alzante" in d: return "scorrevole_alzante"
    if "scorrevole" in d and "portafinestra" in d: return "scorrevole_complanare_portafinestra"
    if "scorrevole" in d: return "scorrevole_complanare_finestra"
    if "fisso" in d: return "fisso"
    if "portafinestra" in d and "2 ante" in d: return "portafinestra_2_ante"
    if "portafinestra" in d: return "portafinestra_1_anta"
    if "finestra" in d and "2 ante" in d: return "finestra_2_ante"
    if "finestra" in d: return "finestra_1_anta"
    return None
dei = []
for r in range(2, 86):
    desc = dei_celle.get(("A", r)); codice = dei_celle.get(("C", r)); prezzo = num(dei_celle.get(("E", r)))
    if not desc or not codice or prezzo is None: continue
    desc = str(desc).strip(); codice = str(codice).strip()
    note = str(dei_celle.get(("F", r)) or "").strip()
    sovrapprezzo = desc.upper().startswith("SOVRAPPREZZO")
    dei.append({
        "codice": codice,
        "descrizione": desc,
        "unita": str(dei_celle.get(("D", r)) or "").strip(),
        "prezzo": prezzo,
        "note": note or None,
        "minimoMq": 1 if "minimo di fatturazione 1 mq" in note.lower() else None,
        "minimoZone": re.findall(r"zone?\s+([A-F](?:\s*-\s*[A-F])?)", note)[0].replace(" ", "") if "zone" in note.lower() else None,
        "categoria": None if sovrapprezzo else categoria_di(desc),
        "tipologia": None if sovrapprezzo else tipologia_di(desc),
        "sovrapprezzo": sovrapprezzo,
    })
assert len(dei) >= 80, len(dei)

# ── Accessori (sovrapprezzi DEI): codice stabile dalla descrizione, per le righe del contratto
SLUG = [("pellicolat", "pellicolatura"), ("incollaggio", "incollaggio_strutturale"),
        ("soglia ribassata per portefinestre", "soglia_ribassata_portafinestra"),
        ("soglia ribassata per portoncini", "soglia_ribassata_portoncino"),
        ("doppia maniglia", "doppia_maniglia"), ("coprifili da 80", "coprifili_80"),
        ("coprifili da 100", "coprifili_100"), ("traverso", "traverso"), ("anta a ribalta", "ribalta"),
        ("anodizzazione naturale", "anodizzazione_naturale"), ("anodizzazione elettrocolore", "anodizzazione_elettrocolore"),
        ("colori speciali", "verniciatura_speciale"), ("effetto legno", "verniciatura_effetto_legno")]
accessori = []
for v in dei:
    if not v["sovrapprezzo"]: continue
    d = v["descrizione"].lower()
    slug = next((s for k, s in SLUG if k in d), None)
    if not slug or any(a["codice"] == slug for a in accessori): continue
    accessori.append({"codice": slug, "descrizione": v["descrizione"], "codiceDei": v["codice"],
                      "unita": v["unita"], "valore": v["prezzo"]})
if not any(a["codice"] == "ribalta" for a in accessori):
    # Nel foglio il sovrapprezzo ribalta vive in «Calcolo Automatici A» (Y5 = 70, Z5 = C25126)
    accessori.append({"codice": "ribalta", "descrizione": "Per ciascuna anta a ribalta", "codiceDei": "C25126", "unita": "cad", "valore": 70})
assert len(accessori) >= 8, len(accessori)

# ── Controtelai: 'Calcolo Automatici' L344:N374 (famiglia = riga senza prezzo)
ct = celle("Calcolo Automatici", 344, 374, 12, 14)
controtelai, famiglia, unita = [], None, None
UNITA = {"acciaio": "mq", "acciaio e legno": "mq", "alluminio": "cad", "legno": "m"}
for r in range(344, 375):
    l, m, n = ct.get(("L", r)), ct.get(("M", r)), num(ct.get(("N", r)))
    if l and n is None:
        famiglia = str(l).strip()
        chiave = next((k for k in UNITA if k in famiglia.lower()), "legno")
        unita = UNITA[chiave]
    elif l and n is not None:
        controtelai.append({"codice": str(l).replace(" ", ""), "famiglia": famiglia, "variante": str(m).strip(), "unita": unita, "prezzo": n, "minimoMq": 1.2 if unita == "mq" else None})
assert len(controtelai) == 22, len(controtelai)

# ── Prezzi delle opere: CHECK1 E22:E43 con codice DEI in N
ck = celle("CHECK1", 22, 43, 2, 14)
OPERE = [
    (22, "rilievo_pezzo", "h"), (23, "rilievo_foro", "h"), (24, "progettazione", "h"),
    (25, "sviluppo_ordine", "h"), (26, "protezione", "h"), (27, "rimozione_serramenti", "mq"),
    (28, "rimozione_tapparelle", "mq"), (29, "smaltimento", "fisso"), (30, "trasporto", "km"),
    (31, "tiro_piano", "h"), (32, "assistenza_muraria", "m"), (33, "posa", "h"),
    (34, "pulizia", "h"), (35, "spese_professionali", "fisso"),
    (39, "altri_servizi", "%"), (40, "assistenze_murarie_eventuali", "h"),
    (41, "dime", "mq"), (42, "piattaforma", "giornata"), (43, "permessi_suolo", "giornata"),
]
opere = []
for r, codice, unita in OPERE:
    prezzo = num(ck.get(("E", r)))
    if r == 42: prezzo = round(64.74 * 8, 2)
    opere.append({
        "codice": codice,
        "gruppo": "eventuali" if r >= 39 else "opere",
        "descrizione": str(ck.get(("B", r)) or "").strip(),
        "codiceDei": str(ck.get(("N", r)) or "").split("\n")[0].strip() or None,
        "unita": unita,
        "prezzo": prezzo,
    })

# ── Coefficienti: trascritti dalle formule del foglio (CHECK1 H22:H43, Tempi)
coefficienti = {
    "oreTiro": {"serramento": 0.5, "cassonetto": 0.25, "tapparella": 0.25, "persiana": 0.25,
                "scuro": 0.25, "porta_blindata": 0.5, "portoncino": 0.5, "schermatura": 0.25,
                "zanzariera": 0.25, "tenda": 1, "pergola": 2, "materialiPosa": 1 / 3},
    "orePosa": {"serramento": 3, "cassonetto": 1, "oscurante": 1.5, "schermatura": 1.5,
                "zanzariera": 1.5, "tenda": 4, "pergola": 16, "porta_blindata": 3, "portoncino": 3},
    "oreGiornata": 8, "euroKm": 0.7, "installatori": 2, "maggiorazionePianoOltre": 4,
    "maggiorazionePiano": 1.3, "puliziaFissoEuro": 50, "smaltimentoBaseEuro": 150,
    "smaltimentoEuroMc": 104.69, "smaltimentoEuroOnere": 100,
    "speseProfessionaliPct": 0.04, "speseProfessionaliMinEuro": 600, "altriServiziPct": 0.02,
    "controtelaiMinMq": 1.2,
}
detrazioni = [
    {"tipo": "ristrutturazione", "immobile": "prima_casa", "anno": 2026, "pct": 50},
    {"tipo": "ristrutturazione", "immobile": "altro", "anno": 2026, "pct": 36},
    {"tipo": "ecobonus", "immobile": "prima_casa", "anno": 2026, "pct": 50},
    {"tipo": "ecobonus", "immobile": "altro", "anno": 2026, "pct": 36},
]
bene_default = {c: True for c in ["serramento_pvc", "serramento_alluminio", "serramento_legno",
    "serramento_legno_alluminio", "cassonetto", "tapparella", "persiana", "scuro", "schermatura",
    "zanzariera", "tenda", "pergola", "porta_blindata", "portoncino", "porta_interna", "accessorio"]}
bene_default.update({"controtelaio": False, "altro": False})

seed = {"versione": date.today().isoformat(), "fonte": "CALCOLO NUOVI LIMITI.xlsx", "validoDal": "2022-04-15",
        "massimali": massimali, "dei": dei, "accessori": accessori, "controtelai": controtelai, "opere": opere,
        "coefficienti": coefficienti, "detrazioni": detrazioni, "beneSignificativoDefault": bene_default}
with open("shared/limiti/tariffe-seed.json", "w", encoding="utf-8") as f:
    json.dump(seed, f, ensure_ascii=False, indent=1)
print({k: (len(v) if isinstance(v, list) else "ok") for k, v in seed.items()})
```

- [ ] **Step 2: Generare il seed**

Run: `python3 scripts/estrai-tariffe-limiti.py "/Users/timmy/Library/Mobile Documents/com~apple~CloudDocs/Downloads/CALCOLO NUOVI LIMITI .xlsx"`
Expected: stampa `{'massimali': 18, 'dei': 8x, 'controtelai': 22, 'opere': 19, …}` e crea `shared/limiti/tariffe-seed.json`. Aprire il JSON e controllare a mano: `massimali` contiene `A/D=780`, `B/E=900`, `C/A=276`; `dei[0].codice == "C25077"`; `opere` con `rilievo_pezzo` 60.17 e `piattaforma` 517.92.

- [ ] **Step 3: Scrivere il test del caricatore**

```ts
// server/computo/tariffe.test.ts
import { describe, expect, it } from "vitest";
import {
  massimaleEuroMq,
  percentualeDetrazione,
  tariffeAttive,
  voceDeiPer,
  voceOpera,
} from "./tariffe";

describe("tariffe limiti", () => {
  const t = tariffeAttive(new Date("2026-09-03"));
  it("carica il seed con le tre tabelle di massimali complete", () => {
    expect(t.massimali).toHaveLength(18);
    expect(massimaleEuroMq(t, "A", "E")).toBe(780);
    expect(massimaleEuroMq(t, "A", "B")).toBe(660);
    expect(massimaleEuroMq(t, "B", "D")).toBe(900);
    expect(massimaleEuroMq(t, "C", "F")).toBe(276);
  });
  it("trova la voce DEI per categoria e tipologia", () => {
    const v = voceDeiPer(t, "serramento_pvc", "portafinestra_2_ante");
    expect(v?.codice).toBe("C25077");
    expect(v?.prezzo).toBe(665.15);
    expect(voceDeiPer(t, "serramento_pvc", "inesistente")).toBeNull();
    expect(voceDeiPer(t, "tapparella", null)).toBeNull();
  });
  it("espone opere e coefficienti trascritti dal foglio", () => {
    expect(voceOpera(t, "posa").prezzo).toBe(36.5);
    expect(voceOpera(t, "piattaforma").prezzo).toBe(517.92);
    expect(t.coefficienti.orePosa.serramento).toBe(3);
    expect(t.coefficienti.oreTiro.serramento).toBe(0.5);
    expect(() => voceOpera(t, "non_esiste" as any)).toThrow("OPERA_SCONOSCIUTA");
  });
  it("dà la percentuale di detrazione per tipo, immobile e anno", () => {
    expect(percentualeDetrazione(t, "ristrutturazione", "prima_casa", 2026)).toBe(50);
    expect(percentualeDetrazione(t, "ecobonus", "altro", 2026)).toBe(36);
    expect(percentualeDetrazione(t, "nessuna", "altro", 2026)).toBeNull();
  });
});
```

- [ ] **Step 4: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/computo/tariffe.test.ts`
Expected: FAIL — `./tariffe` non esiste.

- [ ] **Step 5: Scrivere `server/computo/tariffe.ts`**

```ts
// server/computo/tariffe.ts
// Tariffe del computo limiti: massimali Allegato A, listino DEI, controtelai,
// prezzi delle opere, coefficienti e regole di detrazione. Sono DATI con una
// validità, letti dal seed generato dal foglio; il motore non contiene mai
// un prezzo. Piano 1: solo seed; la tabella `tariffe` modificabile da
// direzione arriva con la UI Impostazioni (Task 15).
import seed from "@shared/limiti/tariffe-seed.json";
import type {
  CategoriaRiga,
  DetrazioneImmobile,
  DetrazioneTipo,
  ZonaClimatica,
} from "@shared/limiti/tipi";

export type Massimale = { gruppo: "A" | "B" | "C"; zona: ZonaClimatica; euroMq: number };
export type VoceDei = {
  codice: string;
  descrizione: string;
  unita: string;
  prezzo: number;
  note: string | null;
  minimoMq: number | null;
  minimoZone: string | null;
  categoria: CategoriaRiga | null;
  tipologia: string | null;
  sovrapprezzo: boolean;
};
export type VoceAccessorio = {
  codice: string;
  descrizione: string;
  codiceDei: string;
  /** "%" = percentuale del prezzo DEI della riga; "cad" e "m" moltiplicano la quantità dell'accessorio. */
  unita: string;
  valore: number;
};
export type VoceControtelaio = {
  codice: string;
  famiglia: string;
  variante: string;
  unita: "mq" | "m" | "cad";
  prezzo: number;
  minimoMq: number | null;
};
export const CODICI_OPERA = [
  "rilievo_pezzo", "rilievo_foro", "progettazione", "sviluppo_ordine", "protezione",
  "rimozione_serramenti", "rimozione_tapparelle", "smaltimento", "trasporto", "tiro_piano",
  "assistenza_muraria", "posa", "pulizia", "spese_professionali", "altri_servizi",
  "assistenze_murarie_eventuali", "dime", "piattaforma", "permessi_suolo",
] as const;
export type CodiceOpera = (typeof CODICI_OPERA)[number];
export type VoceOpera = {
  codice: CodiceOpera;
  gruppo: "opere" | "eventuali";
  descrizione: string;
  codiceDei: string | null;
  unita: string;
  prezzo: number;
};
export type Coefficienti = {
  oreTiro: Record<string, number>;
  orePosa: Record<string, number>;
  oreGiornata: number;
  euroKm: number;
  installatori: number;
  maggiorazionePianoOltre: number;
  maggiorazionePiano: number;
  puliziaFissoEuro: number;
  smaltimentoBaseEuro: number;
  smaltimentoEuroMc: number;
  smaltimentoEuroOnere: number;
  speseProfessionaliPct: number;
  speseProfessionaliMinEuro: number;
  altriServiziPct: number;
  controtelaiMinMq: number;
};
export type RegolaDetrazione = {
  tipo: DetrazioneTipo;
  immobile: DetrazioneImmobile;
  anno: number;
  pct: number;
};
export type Tariffe = {
  versione: string;
  validoDal: string;
  massimali: Massimale[];
  dei: VoceDei[];
  accessori: VoceAccessorio[];
  controtelai: VoceControtelaio[];
  opere: VoceOpera[];
  coefficienti: Coefficienti;
  detrazioni: RegolaDetrazione[];
  beneSignificativoDefault: Record<CategoriaRiga, boolean>;
};

const SEED = seed as unknown as Tariffe;

/** Tariffe valide alla data indicata. Un solo seed oggi: la data serve al contratto della funzione. */
export function tariffeAttive(alla: Date = new Date()): Tariffe {
  if (alla.toISOString().slice(0, 10) < SEED.validoDal) {
    // Prima del DM 14/02/2022 non esiste un massimale: lo diciamo, non
    // inventiamo un listino precedente.
    throw new Error(`TARIFFE_NON_DISPONIBILI: nessuna tariffa prima del ${SEED.validoDal}`);
  }
  return SEED;
}

export function massimaleEuroMq(
  t: Tariffe,
  gruppo: "A" | "B" | "C",
  zona: ZonaClimatica
): number {
  const trovato = t.massimali.find(m => m.gruppo === gruppo && m.zona === zona);
  if (!trovato) throw new Error(`MASSIMALE_MANCANTE: ${gruppo}/${zona}`);
  return trovato.euroMq;
}

export function voceDeiPer(
  t: Tariffe,
  categoria: CategoriaRiga,
  tipologia: string | null
): VoceDei | null {
  if (!tipologia) return null;
  return (
    t.dei.find(
      v => !v.sovrapprezzo && v.categoria === categoria && v.tipologia === tipologia
    ) ?? null
  );
}

export function voceControtelaio(t: Tariffe, codice: string): VoceControtelaio | null {
  return t.controtelai.find(c => c.codice === codice) ?? null;
}

export function voceAccessorio(t: Tariffe, codice: string): VoceAccessorio | null {
  return t.accessori.find(a => a.codice === codice) ?? null;
}

export function voceOpera(t: Tariffe, codice: CodiceOpera): VoceOpera {
  const trovata = t.opere.find(o => o.codice === codice);
  if (!trovata) throw new Error(`OPERA_SCONOSCIUTA: ${codice}`);
  return trovata;
}

export function percentualeDetrazione(
  t: Tariffe,
  tipo: DetrazioneTipo,
  immobile: DetrazioneImmobile | null,
  anno: number
): number | null {
  if (tipo === "nessuna") return null;
  const candidati = t.detrazioni.filter(
    d => d.tipo === tipo && d.immobile === (immobile ?? "altro") && d.anno <= anno
  );
  if (candidati.length === 0) return null;
  return candidati.sort((a, b) => b.anno - a.anno)[0].pct;
}
```

Se `tsconfig.json` non ha `resolveJsonModule: true`, aggiungerlo in `compilerOptions` (verificare con `grep resolveJsonModule tsconfig.json`).

- [ ] **Step 6: Eseguire il test e verificare che passi**

Run: `pnpm vitest run server/computo/tariffe.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/estrai-tariffe-limiti.py shared/limiti/tariffe-seed.json server/computo/tariffe.ts server/computo/tariffe.test.ts tsconfig.json
git commit -m "feat(computo): tariffe dei limiti dal foglio come seed con caricatore

Massimali Allegato A per gruppo e zona, listino DEI con categoria e
tipologia, controtelai, prezzi delle opere e coefficienti trascritti dalle
formule: dati con validità, mai prezzi nel motore.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Comuni e zona climatica

**Files:**
- Create: `scripts/importa-comuni-zona.py`
- Create: `shared/limiti/comuni-zona.json`
- Create: `server/computo/zone.ts`
- Test: `server/computo/zone.test.ts`

**Interfaces:**
- Produces: `type ComuneZona = { codiceIstat: string; nome: string; provincia: string; regione: string; zona: ZonaClimatica; gradiGiorno: number }`; `zonaPerComune(nome: string, provincia?: string | null): ComuneZona | null`; `normalizzaNomeComune(nome: string): string`.

- [ ] **Step 1: Procurare la Tabella A e scrivere lo script**

Fonte: Tabella A del DPR 412/93 aggiornata (ENEA, «Gradi-Giorni», file TXT/XLS) oppure l'export CSV di BibLus/POROTON. Salvare il file fuori dal repo (es. `~/Downloads/zone-climatiche.csv`) con intestazioni riconoscibili: comune, provincia (sigla), regione, zona, gradi giorno, codice ISTAT (facoltativo).

```python
#!/usr/bin/env python3
# scripts/importa-comuni-zona.py — una tantum.
# CSV (ENEA/BibLus/POROTON, separatore ; o ,) → shared/limiti/comuni-zona.json
# Uso: python3 scripts/importa-comuni-zona.py ~/Downloads/zone-climatiche.csv
import csv, json, sys, unicodedata

if len(sys.argv) < 2:
    sys.exit("uso: importa-comuni-zona.py <file.csv>")

def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(s.lower().replace("'", " ").replace("-", " ").split())

def colonna(intestazioni, *alias):
    for a in alias:
        for i, h in enumerate(intestazioni):
            if a in norm(h):
                return i
    return None

with open(sys.argv[1], encoding="utf-8-sig", newline="") as f:
    campione = f.read(4096); f.seek(0)
    sep = ";" if campione.count(";") > campione.count(",") else ","
    righe = list(csv.reader(f, delimiter=sep))
intest = righe[0]
iC = colonna(intest, "comune", "denominazione"); iP = colonna(intest, "prov", "sigla")
iR = colonna(intest, "regione"); iZ = colonna(intest, "zona"); iG = colonna(intest, "gradi", "gg")
iI = colonna(intest, "istat", "codice")
assert None not in (iC, iP, iZ, iG), f"colonne non riconosciute: {intest}"
out, visti = [], set()
for r in righe[1:]:
    if len(r) <= max(iC, iP, iZ, iG): continue
    zona = str(r[iZ]).strip().upper()[:1]
    if zona not in "ABCDEF": continue
    chiave = (norm(r[iC]), norm(r[iP]))
    if chiave in visti: continue
    visti.add(chiave)
    out.append({"codiceIstat": (str(r[iI]).strip().zfill(6) if iI is not None and r[iI] else None),
                "nome": str(r[iC]).strip(), "provincia": str(r[iP]).strip().upper(),
                "regione": str(r[iR]).strip() if iR is not None else "",
                "zona": zona, "gradiGiorno": int(float(str(r[iG]).replace(".", "").replace(",", ".")))})
assert len(out) > 7000, len(out)
with open("shared/limiti/comuni-zona.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(len(out), "comuni")
```

Run: `python3 scripts/importa-comuni-zona.py ~/Downloads/zone-climatiche.csv`
Expected: `> 7000 comuni`, file `shared/limiti/comuni-zona.json` (~700 KB). Controllare a mano che «La Spezia», «Sarzana», «Lerici» compaiano con provincia `SP`.

- [ ] **Step 2: Scrivere il test che fallisce**

```ts
// server/computo/zone.test.ts
import { describe, expect, it } from "vitest";
import { normalizzaNomeComune, zonaPerComune } from "./zone";

describe("zona climatica per comune", () => {
  it("normalizza accenti, apostrofi e maiuscole", () => {
    expect(normalizzaNomeComune("  Forlì ")).toBe("forli");
    expect(normalizzaNomeComune("Sant'Angelo Lodigiano")).toBe("sant angelo lodigiano");
  });
  it("trova comuni noti con la zona attesa", () => {
    expect(zonaPerComune("Palermo")?.zona).toBe("B");
    expect(zonaPerComune("Cortina d'Ampezzo")?.zona).toBe("F");
    expect(zonaPerComune("Milano")?.zona).toBe("E");
    expect(zonaPerComune("La Spezia", "SP")?.provincia).toBe("SP");
  });
  it("disambigua per provincia e risponde null se non trova", () => {
    expect(zonaPerComune("Castello", "XX")).toBeNull();
    expect(zonaPerComune("Comune Inventato")).toBeNull();
  });
});
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/computo/zone.test.ts`
Expected: FAIL — `./zone` non esiste.

- [ ] **Step 4: Scrivere `server/computo/zone.ts`**

```ts
// server/computo/zone.ts
// Zona climatica dal comune del cantiere (DPR 412/93, Tabella A). Il foglio
// la faceva digitare a mano in INIZIO!H11: una lettera sbagliata spostava il
// massimale da 780 a 660 in silenzio. Qui si deriva dal comune; l'override
// manuale resta possibile ma è registrato (`zonaManuale`).
import comuni from "@shared/limiti/comuni-zona.json";
import type { ZonaClimatica } from "@shared/limiti/tipi";

export type ComuneZona = {
  codiceIstat: string | null;
  nome: string;
  provincia: string;
  regione: string;
  zona: ZonaClimatica;
  gradiGiorno: number;
};

const ELENCO = comuni as ComuneZona[];

export function normalizzaNomeComune(nome: string): string {
  return nome
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const INDICE = new Map<string, ComuneZona[]>();
for (const c of ELENCO) {
  const chiave = normalizzaNomeComune(c.nome);
  const lista = INDICE.get(chiave) ?? [];
  lista.push(c);
  INDICE.set(chiave, lista);
}

/**
 * Comune per nome (e provincia, se nota). Con omonimi e provincia assente
 * restituisce null: meglio chiedere che scegliere a caso.
 */
export function zonaPerComune(
  nome: string,
  provincia?: string | null
): ComuneZona | null {
  const candidati = INDICE.get(normalizzaNomeComune(nome)) ?? [];
  if (candidati.length === 0) return null;
  if (provincia) {
    return candidati.find(c => c.provincia === provincia.trim().toUpperCase()) ?? null;
  }
  return candidati.length === 1 ? candidati[0] : null;
}
```

- [ ] **Step 5: Eseguire il test e verificare che passi**

Run: `pnpm vitest run server/computo/zone.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/importa-comuni-zona.py shared/limiti/comuni-zona.json server/computo/zone.ts server/computo/zone.test.ts
git commit -m "feat(computo): zona climatica derivata dal comune (Tabella A DPR 412/93)

La zona non si digita più: viene dal comune del cantiere, con override
registrato. Omonimi senza provincia restano null invece di indovinare.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Repository del contratto (memoria + Postgres)

**Files:**
- Create: `server/contratti/repository.ts`
- Test: `server/contratti/repository.test.ts` (memoria), `server/contratti/repository.pg.test.ts` (Postgres, skip senza `DATABASE_URL`)

**Interfaces:**
- Produces:
  ```ts
  type ContrattoPersist = Omit<Contratto, "createdAt" | "updatedAt">;
  type RigaPersist = Omit<RigaContratto, "id" | "createdAt" | "updatedAt">;
  type ContrattiRepository = {
    ensureSchema(): Promise<void>;
    getContratto(sedeId: number, commessaId: number): Promise<Contratto | null>;
    listRighe(sedeId: number, commessaId: number): Promise<RigaContratto[]>;
    salva(input: { contratto: ContrattoPersist; righe: RigaPersist[]; now: Date }): Promise<{ contratto: Contratto; righe: RigaContratto[] }>;
  };
  getContrattiRepository(): ContrattiRepository;
  createMemoryContrattiRepository(): ContrattiRepository;
  createPostgresContrattiRepository(sql): ContrattiRepository;
  ```
- `salva` è atomico: upsert del contratto + sostituzione completa delle righe della commessa (gli `id` delle righe cambiano a ogni salvataggio; la UI ricarica).

- [ ] **Step 1: Scrivere il test in memoria che fallisce**

```ts
// server/contratti/repository.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryContrattiRepository } from "./repository";
import type { ContrattoPersist, RigaPersist } from "./repository";

const NOW = new Date("2026-09-03T10:00:00.000Z");
function contratto(sedeId = 1, commessaId = 10): ContrattoPersist {
  return {
    commessaId, sedeId, pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true,
    notePosa: null, comuneCantiere: "Sarzana", codiceIstat: null, zonaClimatica: "D",
    zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione",
    detrazioneImmobile: "prima_casa", detrazionePct: 50, dataFirma: "2026-08-20",
    rate: [{ numero: 1, quotaPct: 50, giorni: 0, data: null, descrizione: "all'ordine" }],
    hashRighe: "h1", hashParametri: "p1", origine: "manuale", documentoId: null,
    createdBy: 7, updatedBy: 7,
  };
}
function riga(commessaId = 10, ordine = 1): RigaPersist {
  return {
    sedeId: 1, commessaId, ordine, categoria: "serramento_pvc", tipologia: "portafinestra_2_ante",
    oscuranteIntegrato: null, descrizione: "Portafinestra 2 ante", quantita: 3,
    larghezzaMm: 1900, altezzaMm: 2400, mq: 13.68, misuraDei: null, prezzoUnitCent: null,
    prezzoTotCent: 824746, beneSignificativo: true, accessori: [{ codice: "ribalta", quantita: 3 }],
    note: null, origine: "manuale", evidenza: null,
  };
}

describe("repository contratti (memoria)", () => {
  it("salva e rilegge contratto e righe nell'ordine dichiarato", async () => {
    const repo = createMemoryContrattiRepository();
    const esito = await repo.salva({ contratto: contratto(), righe: [riga(10, 2), riga(10, 1)], now: NOW });
    expect(esito.contratto.createdAt).toEqual(NOW);
    expect(esito.righe.map(r => r.ordine)).toEqual([1, 2]);
    expect(esito.righe[0].id).toBeGreaterThan(0);
    expect(await repo.getContratto(1, 10)).toMatchObject({ pattuitoCent: 1539500, zonaClimatica: "D" });
    expect((await repo.listRighe(1, 10)).map(r => r.accessori)).toEqual([[{ codice: "ribalta", quantita: 3 }], [{ codice: "ribalta", quantita: 3 }]]);
  });
  it("sostituisce le righe a ogni salvataggio e aggiorna il contratto", async () => {
    const repo = createMemoryContrattiRepository();
    await repo.salva({ contratto: contratto(), righe: [riga(), riga(10, 2)], now: NOW });
    const dopo = new Date("2026-09-04T10:00:00.000Z");
    const esito = await repo.salva({ contratto: { ...contratto(), pattuitoCent: 1600000 }, righe: [riga()], now: dopo });
    expect(esito.righe).toHaveLength(1);
    expect(esito.contratto.createdAt).toEqual(NOW);
    expect(esito.contratto.updatedAt).toEqual(dopo);
    expect(esito.contratto.pattuitoCent).toBe(1600000);
  });
  it("isola le sedi: la sede 2 non vede la commessa della sede 1", async () => {
    const repo = createMemoryContrattiRepository();
    await repo.salva({ contratto: contratto(1, 10), righe: [riga()], now: NOW });
    expect(await repo.getContratto(2, 10)).toBeNull();
    expect(await repo.listRighe(2, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/contratti/repository.test.ts`
Expected: FAIL — modulo `./repository` inesistente.

- [ ] **Step 3: Scrivere `server/contratti/repository.ts`**

```ts
// server/contratti/repository.ts
// Contratto strutturato della commessa: tabelle vere, centesimi, sede su
// ogni riga. Stesso pattern di server/reminders/repository.ts: memoria
// senza DATABASE_URL (test e sviluppo), Postgres altrimenti. Il salvataggio
// è atomico e sostituisce le righe: una lista è più semplice da tenere
// coerente che un diff riga per riga, e la UI ricarica comunque.
import { kvSql } from "../_core/persistence";
import type { Contratto, RigaContratto } from "@shared/limiti/tipi";

export type ContrattoPersist = Omit<Contratto, "createdAt" | "updatedAt">;
export type RigaPersist = Omit<RigaContratto, "id" | "createdAt" | "updatedAt">;

export type ContrattiRepository = {
  ensureSchema(): Promise<void>;
  getContratto(sedeId: number, commessaId: number): Promise<Contratto | null>;
  listRighe(sedeId: number, commessaId: number): Promise<RigaContratto[]>;
  salva(input: {
    contratto: ContrattoPersist;
    righe: RigaPersist[];
    now: Date;
  }): Promise<{ contratto: Contratto; righe: RigaContratto[] }>;
};

function ordina(righe: RigaContratto[]): RigaContratto[] {
  return [...righe].sort((a, b) => a.ordine - b.ordine || a.id - b.id);
}

export function createMemoryContrattiRepository(): ContrattiRepository {
  const contratti = new Map<string, Contratto>();
  const righe: RigaContratto[] = [];
  let nextId = 1;
  const chiave = (sedeId: number, commessaId: number) => `${sedeId}:${commessaId}`;
  return {
    async ensureSchema() {},
    async getContratto(sedeId, commessaId) {
      const c = contratti.get(chiave(sedeId, commessaId));
      return c ? structuredClone(c) : null;
    },
    async listRighe(sedeId, commessaId) {
      return ordina(
        righe.filter(r => r.sedeId === sedeId && r.commessaId === commessaId)
      ).map(r => structuredClone(r));
    },
    async salva({ contratto, righe: nuove, now }) {
      const k = chiave(contratto.sedeId, contratto.commessaId);
      const precedente = contratti.get(k);
      const salvato: Contratto = {
        ...structuredClone(contratto),
        createdAt: precedente?.createdAt ?? now,
        updatedAt: now,
      };
      contratti.set(k, salvato);
      for (let i = righe.length - 1; i >= 0; i--) {
        if (righe[i].sedeId === contratto.sedeId && righe[i].commessaId === contratto.commessaId) {
          righe.splice(i, 1);
        }
      }
      const inserite = nuove.map(r => ({
        ...structuredClone(r),
        id: nextId++,
        createdAt: now,
        updatedAt: now,
      }));
      righe.push(...inserite);
      return { contratto: structuredClone(salvato), righe: ordina(inserite) };
    },
  };
}

function rowToContratto(row: any): Contratto {
  return {
    commessaId: Number(row.commessa_id),
    sedeId: Number(row.sede_id),
    pattuitoCent: Number(row.pattuito_cent),
    pattuitoTipo: row.pattuito_tipo,
    posaInclusa: Boolean(row.posa_inclusa),
    notePosa: row.note_posa ?? null,
    comuneCantiere: row.comune_cantiere ?? null,
    codiceIstat: row.codice_istat ?? null,
    zonaClimatica: row.zona_climatica ?? null,
    zonaManuale: Boolean(row.zona_manuale),
    piano: row.piano == null ? null : Number(row.piano),
    distanzaKm: row.distanza_km == null ? null : Number(row.distanza_km),
    detrazioneTipo: row.detrazione_tipo,
    detrazioneImmobile: row.detrazione_immobile ?? null,
    detrazionePct: row.detrazione_pct == null ? null : Number(row.detrazione_pct),
    dataFirma: row.data_firma ? String(row.data_firma).slice(0, 10) : null,
    rate: Array.isArray(row.rate) ? row.rate : [],
    hashRighe: row.hash_righe,
    hashParametri: row.hash_parametri,
    origine: row.origine,
    documentoId: row.documento_id == null ? null : Number(row.documento_id),
    createdBy: row.created_by == null ? null : Number(row.created_by),
    updatedBy: row.updated_by == null ? null : Number(row.updated_by),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToRiga(row: any): RigaContratto {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    commessaId: Number(row.commessa_id),
    ordine: Number(row.ordine),
    categoria: row.categoria,
    tipologia: row.tipologia ?? null,
    oscuranteIntegrato: row.oscurante_integrato ?? null,
    descrizione: row.descrizione,
    quantita: Number(row.quantita),
    larghezzaMm: row.larghezza_mm == null ? null : Number(row.larghezza_mm),
    altezzaMm: row.altezza_mm == null ? null : Number(row.altezza_mm),
    mq: Number(row.mq),
    misuraDei: row.misura_dei == null ? null : Number(row.misura_dei),
    prezzoUnitCent: row.prezzo_unit_cent == null ? null : Number(row.prezzo_unit_cent),
    prezzoTotCent: row.prezzo_tot_cent == null ? null : Number(row.prezzo_tot_cent),
    beneSignificativo: Boolean(row.bene_significativo),
    accessori: Array.isArray(row.accessori) ? row.accessori : [],
    note: row.note ?? null,
    origine: row.origine,
    evidenza: row.evidenza ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createPostgresContrattiRepository(
  sql: NonNullable<typeof kvSql>
): ContrattiRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS commessa_contratti (
          commessa_id BIGINT PRIMARY KEY,
          sede_id BIGINT NOT NULL,
          pattuito_cent BIGINT NOT NULL CHECK (pattuito_cent >= 0),
          pattuito_tipo TEXT NOT NULL CHECK (pattuito_tipo IN ('lordo','imponibile')),
          posa_inclusa BOOLEAN NOT NULL DEFAULT TRUE,
          note_posa TEXT,
          comune_cantiere TEXT,
          codice_istat TEXT,
          zona_climatica TEXT CHECK (zona_climatica IN ('A','B','C','D','E','F')),
          zona_manuale BOOLEAN NOT NULL DEFAULT FALSE,
          piano INTEGER,
          distanza_km NUMERIC(6,1),
          detrazione_tipo TEXT NOT NULL DEFAULT 'nessuna' CHECK (detrazione_tipo IN ('nessuna','ecobonus','ristrutturazione')),
          detrazione_immobile TEXT CHECK (detrazione_immobile IN ('prima_casa','altro')),
          detrazione_pct NUMERIC(5,2),
          data_firma DATE,
          rate JSONB NOT NULL DEFAULT '[]'::jsonb,
          hash_righe TEXT NOT NULL,
          hash_parametri TEXT NOT NULL,
          origine TEXT NOT NULL CHECK (origine IN ('estrazione','manuale')),
          documento_id BIGINT,
          created_by BIGINT,
          updated_by BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS commessa_contratti_sede_idx
          ON commessa_contratti (sede_id, commessa_id)`;
        await tx`CREATE TABLE IF NOT EXISTS commessa_righe (
          id BIGSERIAL PRIMARY KEY,
          sede_id BIGINT NOT NULL,
          commessa_id BIGINT NOT NULL,
          ordine INTEGER NOT NULL,
          categoria TEXT NOT NULL,
          tipologia TEXT,
          oscurante_integrato TEXT CHECK (oscurante_integrato IN ('tapparella','persiana','scuro')),
          descrizione TEXT NOT NULL,
          quantita INTEGER NOT NULL CHECK (quantita > 0),
          larghezza_mm INTEGER,
          altezza_mm INTEGER,
          mq NUMERIC(10,3) NOT NULL DEFAULT 0,
          misura_dei NUMERIC(10,3),
          prezzo_unit_cent BIGINT,
          prezzo_tot_cent BIGINT,
          bene_significativo BOOLEAN NOT NULL DEFAULT TRUE,
          accessori JSONB NOT NULL DEFAULT '[]'::jsonb,
          note TEXT,
          origine TEXT NOT NULL CHECK (origine IN ('estrazione','manuale','prodotto_legacy')),
          evidenza JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS commessa_righe_commessa_idx
          ON commessa_righe (sede_id, commessa_id, ordine)`;
      })
      .then(() => undefined)
      .catch(error => {
        schemaPromise = null;
        throw error;
      });
    return schemaPromise;
  };

  return {
    ensureSchema,
    async getContratto(sedeId, commessaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM commessa_contratti
        WHERE sede_id = ${sedeId} AND commessa_id = ${commessaId}`;
      return rows[0] ? rowToContratto(rows[0]) : null;
    },
    async listRighe(sedeId, commessaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM commessa_righe
        WHERE sede_id = ${sedeId} AND commessa_id = ${commessaId}
        ORDER BY ordine, id`;
      return rows.map(rowToRiga);
    },
    async salva({ contratto: c, righe, now }) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows = await tx`INSERT INTO commessa_contratti (
          commessa_id, sede_id, pattuito_cent, pattuito_tipo, posa_inclusa, note_posa,
          comune_cantiere, codice_istat, zona_climatica, zona_manuale, piano, distanza_km,
          detrazione_tipo, detrazione_immobile, detrazione_pct, data_firma, rate,
          hash_righe, hash_parametri, origine, documento_id, created_by, updated_by,
          created_at, updated_at
        ) VALUES (
          ${c.commessaId}, ${c.sedeId}, ${c.pattuitoCent}, ${c.pattuitoTipo}, ${c.posaInclusa},
          ${c.notePosa}, ${c.comuneCantiere}, ${c.codiceIstat}, ${c.zonaClimatica},
          ${c.zonaManuale}, ${c.piano}, ${c.distanzaKm}, ${c.detrazioneTipo},
          ${c.detrazioneImmobile}, ${c.detrazionePct}, ${c.dataFirma},
          ${tx.json(c.rate as any)}, ${c.hashRighe}, ${c.hashParametri}, ${c.origine},
          ${c.documentoId}, ${c.createdBy}, ${c.updatedBy}, ${now}, ${now}
        ) ON CONFLICT (commessa_id) DO UPDATE SET
          pattuito_cent = EXCLUDED.pattuito_cent, pattuito_tipo = EXCLUDED.pattuito_tipo,
          posa_inclusa = EXCLUDED.posa_inclusa, note_posa = EXCLUDED.note_posa,
          comune_cantiere = EXCLUDED.comune_cantiere, codice_istat = EXCLUDED.codice_istat,
          zona_climatica = EXCLUDED.zona_climatica, zona_manuale = EXCLUDED.zona_manuale,
          piano = EXCLUDED.piano, distanza_km = EXCLUDED.distanza_km,
          detrazione_tipo = EXCLUDED.detrazione_tipo, detrazione_immobile = EXCLUDED.detrazione_immobile,
          detrazione_pct = EXCLUDED.detrazione_pct, data_firma = EXCLUDED.data_firma,
          rate = EXCLUDED.rate, hash_righe = EXCLUDED.hash_righe,
          hash_parametri = EXCLUDED.hash_parametri, origine = EXCLUDED.origine,
          documento_id = EXCLUDED.documento_id, updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
        WHERE commessa_contratti.sede_id = EXCLUDED.sede_id
        RETURNING *`;
        if (!rows[0]) throw new Error("NOT_FOUND: Commessa non trovata.");
        await tx`DELETE FROM commessa_righe
          WHERE sede_id = ${c.sedeId} AND commessa_id = ${c.commessaId}`;
        const inserite: RigaContratto[] = [];
        for (const r of righe) {
          const ins = await tx`INSERT INTO commessa_righe (
            sede_id, commessa_id, ordine, categoria, tipologia, oscurante_integrato,
            descrizione, quantita, larghezza_mm, altezza_mm, mq, misura_dei,
            prezzo_unit_cent, prezzo_tot_cent, bene_significativo, accessori, note,
            origine, evidenza, created_at, updated_at
          ) VALUES (
            ${r.sedeId}, ${r.commessaId}, ${r.ordine}, ${r.categoria}, ${r.tipologia},
            ${r.oscuranteIntegrato}, ${r.descrizione}, ${r.quantita}, ${r.larghezzaMm},
            ${r.altezzaMm}, ${r.mq}, ${r.misuraDei}, ${r.prezzoUnitCent}, ${r.prezzoTotCent},
            ${r.beneSignificativo}, ${tx.json(r.accessori as any)}, ${r.note}, ${r.origine},
            ${r.evidenza == null ? null : tx.json(r.evidenza as any)}, ${now}, ${now}
          ) RETURNING *`;
          inserite.push(rowToRiga(ins[0]));
        }
        return { contratto: rowToContratto(rows[0]), righe: ordina(inserite) };
      });
    },
  };
}

let singleton: ContrattiRepository | null = null;
export function getContrattiRepository(): ContrattiRepository {
  singleton ??= kvSql
    ? createPostgresContrattiRepository(kvSql)
    : createMemoryContrattiRepository();
  return singleton;
}

/** Solo test: ripristina il repository in memoria tra una suite e l'altra. */
export function _resetContrattiRepositoryForTests(): void {
  singleton = null;
}
```

- [ ] **Step 4: Eseguire il test in memoria e verificare che passi**

Run: `pnpm vitest run server/contratti/repository.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 5: Scrivere il test Postgres (stessi casi, saltato senza database)**

```ts
// server/contratti/repository.pg.test.ts
// Richiede DATABASE_URL di test; senza, la suite è dichiarata skipped.
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test pnpm vitest run server/contratti/repository.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { createPostgresContrattiRepository } from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

describe.skipIf(!conDatabase)("repository contratti (PostgreSQL)", () => {
  const sql = kvSql!;
  const SEDE = 99310;
  const repo = createPostgresContrattiRepository(sql);
  beforeAll(async () => {
    await repo.ensureSchema();
    await sql`DELETE FROM commessa_righe WHERE sede_id = ${SEDE}`;
    await sql`DELETE FROM commessa_contratti WHERE sede_id = ${SEDE}`;
  });
  afterAll(async () => {
    await sql`DELETE FROM commessa_righe WHERE sede_id = ${SEDE}`;
    await sql`DELETE FROM commessa_contratti WHERE sede_id = ${SEDE}`;
  });

  it("upsert del contratto e sostituzione delle righe nella stessa transazione", async () => {
    const now = new Date("2026-09-03T10:00:00.000Z");
    const base = {
      commessaId: 991001, sedeId: SEDE, pattuitoCent: 1539500, pattuitoTipo: "lordo" as const,
      posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", codiceIstat: null,
      zonaClimatica: "D" as const, zonaManuale: false, piano: 2, distanzaKm: 18,
      detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
      detrazionePct: 50, dataFirma: "2026-08-20", rate: [], hashRighe: "h", hashParametri: "p",
      origine: "manuale" as const, documentoId: null, createdBy: 1, updatedBy: 1,
    };
    const riga = {
      sedeId: SEDE, commessaId: 991001, ordine: 1, categoria: "serramento_pvc" as const,
      tipologia: "finestra_2_ante", oscuranteIntegrato: null, descrizione: "Finestra", quantita: 2,
      larghezzaMm: 1660, altezzaMm: 1540, mq: 5.113, misuraDei: null, prezzoUnitCent: null,
      prezzoTotCent: 300000, beneSignificativo: true, accessori: [{ codice: "ribalta", quantita: 2 }],
      note: null, origine: "manuale" as const, evidenza: null,
    };
    const primo = await repo.salva({ contratto: base, righe: [riga, { ...riga, ordine: 2 }], now });
    expect(primo.righe).toHaveLength(2);
    const secondo = await repo.salva({ contratto: { ...base, pattuitoCent: 1600000 }, righe: [riga], now: new Date("2026-09-04T10:00:00.000Z") });
    expect(secondo.righe).toHaveLength(1);
    expect(secondo.contratto.pattuitoCent).toBe(1600000);
    expect(secondo.contratto.createdAt).toEqual(now);
    expect(secondo.contratto.dataFirma).toBe("2026-08-20");
    expect((await repo.listRighe(SEDE, 991001))[0].accessori).toEqual([{ codice: "ribalta", quantita: 2 }]);
    expect(await repo.getContratto(SEDE + 1, 991001)).toBeNull();
  });

  it("rifiuta un upsert da un'altra sede sulla stessa commessa", async () => {
    const now = new Date();
    const c = {
      commessaId: 991002, sedeId: SEDE, pattuitoCent: 100, pattuitoTipo: "imponibile" as const,
      posaInclusa: false, notePosa: null, comuneCantiere: null, codiceIstat: null, zonaClimatica: null,
      zonaManuale: false, piano: null, distanzaKm: null, detrazioneTipo: "nessuna" as const,
      detrazioneImmobile: null, detrazionePct: null, dataFirma: null, rate: [], hashRighe: "h",
      hashParametri: "p", origine: "manuale" as const, documentoId: null, createdBy: null, updatedBy: null,
    };
    await repo.salva({ contratto: c, righe: [], now });
    await expect(repo.salva({ contratto: { ...c, sedeId: SEDE + 1 }, righe: [], now })).rejects.toThrow("NOT_FOUND");
  });
});
```

Run: `DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test pnpm vitest run server/contratti/repository.pg.test.ts` (o senza `DATABASE_URL`: deve risultare *skipped*, non fallito).
Expected: PASS (o skipped).

- [ ] **Step 6: Commit**

```bash
git add server/contratti/repository.ts server/contratti/repository.test.ts server/contratti/repository.pg.test.ts
git commit -m "feat(contratti): repository del contratto strutturato, memoria e Postgres

Tabelle commessa_contratti e commessa_righe con sede su ogni riga e importi
in centesimi; salvataggio atomico che sostituisce le righe.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Hash e servizio del contratto

**Files:**
- Create: `server/contratti/hash.ts`
- Create: `server/contratti/servizio.ts`
- Modify: `server/routers/commesse.ts` (aggiunta `applicaPattuitoDaContratto`)
- Test: `server/contratti/hash.test.ts`, `server/contratti/servizio.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // hash.ts
  hashRighe(righe: ReadonlyArray<Pick<RigaPersist, "ordine"|"categoria"|"tipologia"|"oscuranteIntegrato"|"quantita"|"larghezzaMm"|"altezzaMm"|"misuraDei"|"prezzoTotCent"|"beneSignificativo"|"accessori">>): string;
  hashParametri(c: Pick<Contratto, "pattuitoCent"|"pattuitoTipo"|"posaInclusa"|"zonaClimatica"|"piano"|"distanzaKm"|"detrazioneTipo"|"detrazioneImmobile"|"detrazionePct">): string;
  // servizio.ts
  contrattoInputSchema, rigaInputSchema (zod);
  mqRiga(r: { quantita: number; larghezzaMm: number | null; altezzaMm: number | null }): number;
  salvaContratto(input: { sedeId: number; commessaId: number; contratto: ContrattoInput; righe: RigaContrattoInput[]; actorUserId: number | null; now?: Date }): Promise<{ contratto: Contratto; righe: RigaContratto[]; avvertenze: string[] }>;
  leggiContratto(sedeId: number, commessaId: number): Promise<{ contratto: Contratto | null; righe: RigaContratto[]; righeLegacy: RigaLegacy[] }>;
  type RigaLegacy = { id: number; nome: string; tipologia: string | null; quantita: number; dimensioni: string | null; note: string | null };
  // commesse.ts
  applicaPattuitoDaContratto(commessaId: number, input: { importoTotale: number; rate: RataContratto[] }): { applicato: boolean; motivo: string | null };
  ```
- Errori del servizio come stringhe con prefisso: `NOT_FOUND: Commessa non trovata.`, `VALIDAZIONE: <messaggio>`.

- [ ] **Step 1: Scrivere i test di hash che falliscono**

```ts
// server/contratti/hash.test.ts
import { describe, expect, it } from "vitest";
import { hashParametri, hashRighe } from "./hash";

const riga = {
  ordine: 1, categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null,
  quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null, prezzoTotCent: 300000,
  beneSignificativo: true, accessori: [{ codice: "ribalta", quantita: 2 }, { codice: "coprifili_80", quantita: 12 }],
};

describe("hash del contratto", () => {
  it("è stabile rispetto all'ordine degli accessori e delle righe", () => {
    const a = hashRighe([riga, { ...riga, ordine: 2, quantita: 1 }]);
    const b = hashRighe([{ ...riga, ordine: 2, quantita: 1 }, { ...riga, accessori: [...riga.accessori].reverse() }]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("cambia quando cambia una misura o un prezzo, non quando cambia la descrizione", () => {
    const base = hashRighe([riga]);
    expect(hashRighe([{ ...riga, altezzaMm: 1541 }])).not.toBe(base);
    expect(hashRighe([{ ...riga, prezzoTotCent: 300001 }])).not.toBe(base);
    expect(hashRighe([{ ...riga, note: "x" } as any])).toBe(base);
  });
  it("i parametri hanno un hash proprio", () => {
    const p = { pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, zonaClimatica: "D" as const, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const, detrazionePct: 50 };
    expect(hashParametri(p)).toBe(hashParametri({ ...p }));
    expect(hashParametri({ ...p, piano: 5 })).not.toBe(hashParametri(p));
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `pnpm vitest run server/contratti/hash.test.ts`
Expected: FAIL — `./hash` non esiste.

- [ ] **Step 3: Scrivere `server/contratti/hash.ts`**

```ts
// server/contratti/hash.ts
// Versione del contratto: computo e (piano 2) fattura salvano l'hash delle
// righe e dei parametri da cui nascono; se cambia una misura, una quantità,
// un prezzo o un parametro del cantiere, l'hash cambia e il derivato risulta
// «superato». La descrizione e le note NON entrano: correggere un refuso
// non invalida un computo. Stesso principio di server/tars/versioni.ts.
import { createHash } from "node:crypto";
import type { Contratto, RigaContratto } from "@shared/limiti/tipi";

type RigaPerHash = Pick<
  RigaContratto,
  | "ordine" | "categoria" | "tipologia" | "oscuranteIntegrato" | "quantita"
  | "larghezzaMm" | "altezzaMm" | "misuraDei" | "prezzoTotCent"
  | "beneSignificativo" | "accessori"
>;

function sha(testo: string): string {
  return createHash("sha256").update(testo).digest("hex");
}

export function hashRighe(righe: ReadonlyArray<RigaPerHash>): string {
  const canoniche = righe
    .map(r => [
      r.ordine,
      r.categoria,
      r.tipologia ?? "",
      r.oscuranteIntegrato ?? "",
      r.quantita,
      r.larghezzaMm ?? "",
      r.altezzaMm ?? "",
      r.misuraDei ?? "",
      r.prezzoTotCent ?? "",
      r.beneSignificativo ? 1 : 0,
      [...r.accessori]
        .map(a => `${a.codice}=${a.quantita}`)
        .sort()
        .join(","),
    ].join("|"))
    .sort();
  return sha(canoniche.join("\n"));
}

export function hashParametri(
  c: Pick<
    Contratto,
    | "pattuitoCent" | "pattuitoTipo" | "posaInclusa" | "zonaClimatica" | "piano"
    | "distanzaKm" | "detrazioneTipo" | "detrazioneImmobile" | "detrazionePct"
  >
): string {
  return sha(
    [
      c.pattuitoCent, c.pattuitoTipo, c.posaInclusa ? 1 : 0, c.zonaClimatica ?? "",
      c.piano ?? "", c.distanzaKm ?? "", c.detrazioneTipo, c.detrazioneImmobile ?? "",
      c.detrazionePct ?? "",
    ].join("|")
  );
}
```

- [ ] **Step 4: Eseguire i test di hash e verificare che passino**

Run: `pnpm vitest run server/contratti/hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Scrivere i test del servizio che falliscono**

```ts
// server/contratti/servizio.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { _resetContrattiRepositoryForTests } from "./repository";
import { leggiContratto, mqRiga, salvaContratto } from "./servizio";
import { creaCommessa, getCommessaById } from "../routers/commesse";
import { getClientiStore } from "../routers/clienti";
import type { TrpcContext } from "../_core/context";

const SEDE = 1;
function ctx(): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> {
  return {
    user: { id: 5, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Test" } as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}
async function commessaDiProva(): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9001 + clienti.length, sedeId: SEDE, nome: "Elena", cognome: "Bianchi", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(ctx(), { clienteId: cliente.id } as any);
  return (c as any).commessa?.id ?? (c as any).id;
}
const righe = [
  { categoria: "serramento_pvc" as const, tipologia: "portafinestra_2_ante", oscuranteIntegrato: null, descrizione: "Portafinestra 2 ante", quantita: 3, larghezzaMm: 1900, altezzaMm: 2400, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale" as const, evidenza: null },
  { categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null, descrizione: "Finestra 2 ante", quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 324746, beneSignificativo: true, accessori: [{ codice: "ribalta", quantita: 2 }], note: null, origine: "manuale" as const, evidenza: null },
];
const contratto = {
  pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null,
  comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18,
  detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
  detrazionePct: null, dataFirma: "2026-08-20", rate: [
    { numero: 1, quotaPct: 50, giorni: 0, data: null, descrizione: "all'ordine" },
    { numero: 2, quotaPct: 40, giorni: 60, data: null, descrizione: "merce pronta" },
    { numero: 3, quotaPct: 10, giorni: 75, data: null, descrizione: "posa ultimata" },
  ], origine: "manuale" as const, documentoId: null,
};

describe("servizio contratto", () => {
  beforeEach(() => _resetContrattiRepositoryForTests());

  it("calcola i mq da L×H×quantità con tre decimali", () => {
    expect(mqRiga({ quantita: 3, larghezzaMm: 1900, altezzaMm: 2400 })).toBe(13.68);
    expect(mqRiga({ quantita: 2, larghezzaMm: 1660, altezzaMm: 1540 })).toBe(5.113);
    expect(mqRiga({ quantita: 1, larghezzaMm: null, altezzaMm: 1540 })).toBe(0);
  });

  it("salva righe e parametri, deriva zona e percentuale, specchia il pattuito sulla commessa", async () => {
    const commessaId = await commessaDiProva();
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto, righe, actorUserId: 5 });
    expect(esito.contratto.zonaClimatica).toBe("D");
    expect(esito.contratto.detrazionePct).toBe(50);
    expect(esito.contratto.hashRighe).toMatch(/^[0-9a-f]{64}$/);
    expect(esito.righe.map(r => r.mq)).toEqual([13.68, 5.113]);
    expect(esito.righe.map(r => r.ordine)).toEqual([1, 2]);
    const commessa: any = getCommessaById(commessaId);
    expect(commessa.importoTotale).toBe(15395);
    expect(commessa.pianoRate).toHaveLength(3);
    expect(commessa.pianoRate[1]).toMatchObject({ importo: 6158, origine: "manuale" });
    const letto = await leggiContratto(SEDE, commessaId);
    expect(letto.righe).toHaveLength(2);
  });

  it("segnala il comune non risolto e lascia la zona a null senza bloccare", async () => {
    const commessaId = await commessaDiProva();
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto: { ...contratto, comuneCantiere: "Comune Inventato" }, righe, actorUserId: 5 });
    expect(esito.contratto.zonaClimatica).toBeNull();
    expect(esito.avvertenze.join(" ")).toMatch(/zona climatica/i);
  });

  it("rispetta la zona manuale e le rate che non sommano a 100 sono rifiutate", async () => {
    const commessaId = await commessaDiProva();
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto: { ...contratto, zonaManuale: true, zonaClimatica: "E" }, righe, actorUserId: 5 });
    expect(esito.contratto.zonaClimatica).toBe("E");
    await expect(salvaContratto({ sedeId: SEDE, commessaId, contratto: { ...contratto, rate: [{ numero: 1, quotaPct: 60, giorni: 0, data: null, descrizione: null }] }, righe, actorUserId: 5 })).rejects.toThrow("VALIDAZIONE");
  });

  it("un'altra sede ottiene NOT_FOUND", async () => {
    const commessaId = await commessaDiProva();
    await expect(salvaContratto({ sedeId: 2, commessaId, contratto, righe, actorUserId: 5 })).rejects.toThrow("NOT_FOUND");
    expect((await leggiContratto(2, commessaId)).contratto).toBeNull();
  });
});
```

Nota: `creaCommessa` accetta `clienteId` e campi opzionali (v. `creaCommessaInput` in `server/routers/commesse.ts`); se la firma restituisce l'oggetto commessa direttamente, adattare `commessaDiProva` leggendo `.id`.

- [ ] **Step 6: Eseguire i test e verificare che falliscano**

Run: `pnpm vitest run server/contratti/servizio.test.ts`
Expected: FAIL — `./servizio` non esiste.

- [ ] **Step 7: Aggiungere `applicaPattuitoDaContratto` in `server/routers/commesse.ts`**

Dopo `azzeraPattuitoDerivato` (sezione «Pattuito e piano rate»):

```ts
/**
 * Il contratto strutturato è la fonte del pattuito PRIMA della fattura
 * (decisione 03/09/2026): scrive importo e piano rate come se li avesse
 * digitati l'operatore (origine `manuale`), così Economia, board e
 * notifiche non cambiano. Quando una fattura FiC è collegata la fonte
 * resta FiC e qui non si tocca nulla: la verifica «fattura = contratto» è
 * del piano 2.
 */
export function applicaPattuitoDaContratto(
  commessaId: number,
  input: { importoTotale: number; rate: RataContratto[] }
): { applicato: boolean; motivo: string | null } {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa) return { applicato: false, motivo: "Commessa non trovata." };
  if (!pattuitoModificabileAMano(commessa)) {
    return { applicato: false, motivo: MOTIVO_PATTUITO_BLOCCATO };
  }
  const now = new Date();
  commessa.importoTotale = input.importoTotale;
  commessa.pattuitoFonte = "manuale";
  const dataFattura = commessa.dataApertura ? new Date(`${commessa.dataApertura}T00:00:00`) : now;
  commessa.pianoRate = input.rate.map((rata, i): RataCommessa => {
    const scadenza = rata.data
      ?? (rata.giorni == null
        ? null
        : new Date(dataFattura.getTime() + rata.giorni * 86_400_000).toISOString().slice(0, 10));
    return {
      id: i + 1,
      numero: rata.numero,
      importo: Math.round(input.importoTotale * rata.quotaPct) / 100,
      scadenza,
      descrizione: rata.descrizione,
      origine: "manuale",
      ficDocumentoId: null,
      ficRataId: null,
      ficSourceKey: null,
      stato: "attesa",
      dataPagamento: null,
      createdAt: now,
      updatedAt: null,
    };
  });
  commessa.pattuitoAggiornatoAt = now;
  commessa.updatedAt = now;
  _store.save();
  return { applicato: true, motivo: null };
}
```

Aggiungere `import type { RataContratto } from "@shared/limiti/tipi";` in testa al file.

- [ ] **Step 8: Scrivere `server/contratti/servizio.ts`**

```ts
// server/contratti/servizio.ts
// Servizio di dominio del contratto: valida, calcola i mq, deriva zona e
// percentuale di detrazione, firma con gli hash, salva in modo atomico e
// specchia il pattuito sulla commessa. È l'unico percorso di scrittura:
// router tRPC oggi, lettura del contratto (piano 3) e Tars domani passano
// tutti di qui.
import { z } from "zod";
import { centToEuro } from "@shared/euroCent";
import {
  CATEGORIE_RIGA,
  DETRAZIONE_IMMOBILI,
  DETRAZIONE_TIPI,
  OSCURANTI_INTEGRATI,
  PATTUITO_TIPI,
  ZONE_CLIMATICHE,
  type Contratto,
  type ContrattoInput,
  type RigaContratto,
  type RigaContrattoInput,
} from "@shared/limiti/tipi";
import { percentualeDetrazione, tariffeAttive } from "../computo/tariffe";
import { zonaPerComune } from "../computo/zone";
import {
  applicaPattuitoDaContratto,
  getCommessaById,
} from "../routers/commesse";
import { getClienteById } from "../routers/clienti";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { hashParametri, hashRighe } from "./hash";
import { getContrattiRepository, type RigaPersist } from "./repository";

export const rigaInputSchema = z.object({
  id: z.number().int().nullable().optional(),
  categoria: z.enum(CATEGORIE_RIGA),
  tipologia: z.string().trim().max(80).nullable(),
  oscuranteIntegrato: z.enum(OSCURANTI_INTEGRATI).nullable(),
  descrizione: z.string().trim().min(1).max(300),
  quantita: z.number().int().min(1).max(999),
  larghezzaMm: z.number().int().min(100).max(6000).nullable(),
  altezzaMm: z.number().int().min(100).max(6000).nullable(),
  misuraDei: z.number().min(0).max(9999).nullable(),
  prezzoUnitCent: z.number().int().min(0).nullable(),
  prezzoTotCent: z.number().int().min(0).nullable(),
  beneSignificativo: z.boolean(),
  accessori: z.array(z.object({ codice: z.string().trim().min(1).max(60), quantita: z.number().min(0).max(9999) })).max(60),
  note: z.string().trim().max(500).nullable(),
  origine: z.enum(["estrazione", "manuale", "prodotto_legacy"]),
  evidenza: z.object({ pagina: z.number().int().min(1), frammento: z.string().max(300) }).nullable(),
});

export const contrattoInputSchema = z.object({
  pattuitoCent: z.number().int().min(0),
  pattuitoTipo: z.enum(PATTUITO_TIPI),
  posaInclusa: z.boolean(),
  notePosa: z.string().trim().max(500).nullable(),
  comuneCantiere: z.string().trim().max(120).nullable(),
  zonaClimatica: z.enum(ZONE_CLIMATICHE).nullable().optional(),
  zonaManuale: z.boolean(),
  piano: z.number().int().min(-2).max(60).nullable(),
  distanzaKm: z.number().min(0).max(2000).nullable(),
  detrazioneTipo: z.enum(DETRAZIONE_TIPI),
  detrazioneImmobile: z.enum(DETRAZIONE_IMMOBILI).nullable(),
  detrazionePct: z.number().min(0).max(100).nullable(),
  dataFirma: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  rate: z.array(z.object({
    numero: z.number().int().min(1),
    quotaPct: z.number().min(0).max(100),
    giorni: z.number().int().min(0).max(730).nullable(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    descrizione: z.string().trim().max(120).nullable(),
  })).max(12),
  origine: z.enum(["estrazione", "manuale"]),
  documentoId: z.number().int().nullable(),
});

export type RigaLegacy = {
  id: number;
  nome: string;
  tipologia: string | null;
  quantita: number;
  dimensioni: string | null;
  note: string | null;
};

export function mqRiga(r: {
  quantita: number;
  larghezzaMm: number | null;
  altezzaMm: number | null;
}): number {
  if (r.larghezzaMm == null || r.altezzaMm == null) return 0;
  return Math.round((r.larghezzaMm * r.altezzaMm * r.quantita) / 1_000_000 * 1000) / 1000;
}

function commessaInSede(sedeId: number, commessaId: number): any {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new Error("NOT_FOUND: Commessa non trovata.");
  }
  return commessa;
}

function validaRate(rate: ContrattoInput["rate"]): void {
  if (rate.length === 0) return;
  const somma = rate.reduce((s, r) => s + r.quotaPct, 0);
  if (Math.abs(somma - 100) > 0.01) {
    throw new Error(`VALIDAZIONE: le rate sommano al ${somma}% invece che al 100%.`);
  }
  for (const r of rate) {
    if (r.giorni == null && r.data == null) {
      throw new Error(`VALIDAZIONE: la rata ${r.numero} non ha né giorni né data.`);
    }
  }
}

export async function salvaContratto(input: {
  sedeId: number;
  commessaId: number;
  contratto: ContrattoInput;
  righe: RigaContrattoInput[];
  actorUserId: number | null;
  now?: Date;
}): Promise<{ contratto: Contratto; righe: RigaContratto[]; avvertenze: string[] }> {
  const now = input.now ?? new Date();
  const commessa = commessaInSede(input.sedeId, input.commessaId);
  const parametri = contrattoInputSchema.parse(input.contratto);
  const righeValide = input.righe.map(r => rigaInputSchema.parse(r));
  validaRate(parametri.rate);
  const avvertenze: string[] = [];

  // Zona: dal comune, salvo override dichiarato.
  let zona = parametri.zonaManuale ? (parametri.zonaClimatica ?? null) : null;
  let codiceIstat: string | null = null;
  if (!parametri.zonaManuale) {
    const cliente: any = commessa.clienteId ? getClienteById(commessa.clienteId) : null;
    const comune = parametri.comuneCantiere ?? cliente?.cittaLavoro ?? cliente?.citta ?? null;
    const trovato = comune ? zonaPerComune(comune) : null;
    if (trovato) {
      zona = trovato.zona;
      codiceIstat = trovato.codiceIstat;
    } else {
      avvertenze.push(
        comune
          ? `Zona climatica non derivabile dal comune «${comune}»: indicarla a mano.`
          : "Comune del cantiere mancante: la zona climatica resta vuota."
      );
    }
  }
  if (parametri.zonaManuale && !zona) {
    throw new Error("VALIDAZIONE: zona manuale senza zona indicata.");
  }

  // Percentuale di detrazione: fotografata alla data firma (o oggi).
  const anno = Number((parametri.dataFirma ?? now.toISOString().slice(0, 10)).slice(0, 4));
  const pct =
    parametri.detrazioneTipo === "nessuna"
      ? null
      : parametri.detrazionePct ??
        percentualeDetrazione(tariffeAttive(now), parametri.detrazioneTipo, parametri.detrazioneImmobile, anno);
  if (parametri.detrazioneTipo !== "nessuna" && pct == null) {
    avvertenze.push("Percentuale di detrazione non trovata nelle tariffe: indicarla a mano.");
  }

  const righePersist: RigaPersist[] = righeValide.map((r, i) => ({
    sedeId: input.sedeId,
    commessaId: input.commessaId,
    ordine: i + 1,
    categoria: r.categoria,
    tipologia: r.tipologia,
    oscuranteIntegrato: r.oscuranteIntegrato,
    descrizione: r.descrizione,
    quantita: r.quantita,
    larghezzaMm: r.larghezzaMm,
    altezzaMm: r.altezzaMm,
    mq: mqRiga(r),
    misuraDei: r.misuraDei,
    prezzoUnitCent: r.prezzoUnitCent,
    prezzoTotCent: r.prezzoTotCent ?? (r.prezzoUnitCent == null ? null : r.prezzoUnitCent * r.quantita),
    beneSignificativo: r.beneSignificativo,
    accessori: r.accessori,
    note: r.note,
    origine: r.origine,
    evidenza: r.evidenza,
  }));
  if (righePersist.some(r => r.mq === 0 && r.categoria !== "controtelaio" && r.categoria !== "accessorio" && r.categoria !== "altro")) {
    avvertenze.push("Alcune righe non hanno misure: il computo le conterà senza mq.");
  }

  const precedente = await getContrattiRepository().getContratto(input.sedeId, input.commessaId);
  const contrattoPersist = {
    commessaId: input.commessaId,
    sedeId: input.sedeId,
    ...parametri,
    zonaClimatica: zona,
    codiceIstat,
    detrazionePct: pct,
    hashRighe: hashRighe(righePersist),
    hashParametri: "",
    createdBy: precedente?.createdBy ?? input.actorUserId,
    updatedBy: input.actorUserId,
  };
  contrattoPersist.hashParametri = hashParametri({ ...contrattoPersist, zonaClimatica: zona, detrazionePct: pct });

  const esito = await getContrattiRepository().salva({
    contratto: contrattoPersist,
    righe: righePersist,
    now,
  });

  const specchio = applicaPattuitoDaContratto(input.commessaId, {
    importoTotale: centToEuro(parametri.pattuitoCent),
    rate: parametri.rate,
  });
  if (!specchio.applicato && specchio.motivo) avvertenze.push(specchio.motivo);

  return { ...esito, avvertenze };
}

export async function leggiContratto(
  sedeId: number,
  commessaId: number
): Promise<{ contratto: Contratto | null; righe: RigaContratto[]; righeLegacy: RigaLegacy[] }> {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    return { contratto: null, righe: [], righeLegacy: [] };
  }
  const repo = getContrattiRepository();
  const [contratto, righe] = await Promise.all([
    repo.getContratto(sedeId, commessaId),
    repo.listRighe(sedeId, commessaId),
  ]);
  const righeLegacy: RigaLegacy[] = (Array.isArray(commessa.prodotti) ? commessa.prodotti : []).map((p: any) => ({
    id: Number(p.id),
    nome: String(p.nome ?? ""),
    tipologia: p.tipologia ?? null,
    quantita: Number(p.quantita ?? 1),
    dimensioni: p.dimensioni ?? null,
    note: p.note ?? null,
  }));
  return { contratto, righe, righeLegacy };
}
```

- [ ] **Step 9: Eseguire i test e verificare che passino**

Run: `pnpm vitest run server/contratti && pnpm check`
Expected: PASS. Se `creaCommessa` in test richiede campi diversi, correggere solo `commessaDiProva`, non il servizio.

- [ ] **Step 10: Commit**

```bash
git add server/contratti/hash.ts server/contratti/hash.test.ts server/contratti/servizio.ts server/contratti/servizio.test.ts server/routers/commesse.ts
git commit -m "feat(contratti): servizio del contratto con hash, zona derivata e specchio del pattuito

Il contratto è la fonte del pattuito prima della fattura: importo e rate
finiscono sulla commessa come manuali, il sync FiC resta la verifica.
L'hash di righe e parametri è la versione che computo e fattura citano.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Router tRPC `contratti`

**Files:**
- Create: `server/routers/contratti.ts`
- Modify: `server/routers.ts` (import + `contratti: contrattiRouter,` subito prima di `proposte: proposteRouter,`)
- Test: `server/routers/contratti.test.ts`

**Interfaces:**
- Produces: `contratti.get({ commessaId })` → `{ contratto, righe, righeLegacy, puoModificare: boolean }`; `contratti.salva({ commessaId, contratto: ContrattoInput, righe: RigaContrattoInput[] })` → `{ contratto, righe, avvertenze }`. Entrambe dietro `procedureConInterruttore("limiti")`.

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// server/routers/contratti.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { creaCommessa } from "./commesse";
import { getClientiStore } from "./clienti";

function context(sedeId: number, userId: number, ruoli: string[]): TrpcContext {
  return {
    user: { id: userId, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "T" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}
async function commessaDiProva(sedeId = 1): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9101 + clienti.length, sedeId, nome: "Elena", cognome: "Bianchi", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(context(sedeId, 1, ["direzione"]), { clienteId: cliente.id } as any);
  return (c as any).commessa?.id ?? (c as any).id;
}
const contratto = {
  pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null,
  comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18,
  detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
  detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale" as const, documentoId: null,
};
const riga = {
  categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null,
  descrizione: "Finestra", quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null,
  prezzoUnitCent: null, prezzoTotCent: 300000, beneSignificativo: true, accessori: [], note: null,
  origine: "manuale" as const, evidenza: null,
};

describe("router contratti", () => {
  beforeEach(() => _resetContrattiRepositoryForTests());

  it("il commerciale salva e rilegge; la squadra di posa legge soltanto", async () => {
    const commessaId = await commessaDiProva();
    const commerciale = appRouter.createCaller(context(1, 11, ["commerciale"]));
    const esito = await commerciale.contratti.salva({ commessaId, contratto, righe: [riga] });
    expect(esito.righe).toHaveLength(1);
    const posa = appRouter.createCaller(context(1, 12, ["squadra_posa"]));
    const letto = await posa.contratti.get({ commessaId });
    expect(letto.contratto?.pattuitoCent).toBe(1539500);
    expect(letto.puoModificare).toBe(false);
    await expect(posa.contratti.salva({ commessaId, contratto, righe: [riga] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un'altra sede riceve NOT_FOUND, non FORBIDDEN", async () => {
    const commessaId = await commessaDiProva(1);
    const altra = appRouter.createCaller(context(2, 13, ["direzione"]));
    await expect(altra.contratti.get({ commessaId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(altra.contratti.salva({ commessaId, contratto, righe: [riga] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gli errori di validazione arrivano come BAD_REQUEST leggibili", async () => {
    const commessaId = await commessaDiProva();
    const caller = appRouter.createCaller(context(1, 14, ["direzione"]));
    await expect(caller.contratti.salva({ commessaId, contratto: { ...contratto, rate: [{ numero: 1, quotaPct: 30, giorni: 0, data: null, descrizione: null }] }, righe: [riga] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/routers/contratti.test.ts`
Expected: FAIL — `appRouter.contratti` non esiste.

- [ ] **Step 3: Scrivere il router e registrarlo**

```ts
// server/routers/contratti.ts
// Contratto strutturato della commessa: il router valida e autorizza, il
// servizio decide (server/contratti/servizio.ts). Ogni procedura nasce
// dietro FLAG_LIMITI. Sede isolata: NOT_FOUND, mai dettagli.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedureConInterruttore, router } from "../_core/trpc";
import { authorizeCoreOperation, effectiveCapabilitySet } from "../authz/enforcement";
import {
  contrattoInputSchema,
  leggiContratto,
  rigaInputSchema,
  salvaContratto,
} from "../contratti/servizio";
import { getCommessaById } from "./commesse";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("limiti");

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

function commessaInSede(commessaId: number, sedeId: number): void {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata." });
  }
}

/** Gli errori del servizio hanno un prefisso: qui diventano codici tRPC. */
export function erroreServizioComeTrpc(errore: unknown): never {
  const messaggio = String((errore as any)?.message ?? "Operazione non riuscita.");
  if (messaggio.startsWith("NOT_FOUND: ")) {
    throw new TRPCError({ code: "NOT_FOUND", message: messaggio.slice("NOT_FOUND: ".length) });
  }
  if (messaggio.startsWith("VALIDAZIONE: ")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: messaggio.slice("VALIDAZIONE: ".length) });
  }
  if ((errore as any)?.name === "ZodError") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Dati del contratto non validi." });
  }
  throw errore;
}

export const contrattiRouter = router({
  get: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "contratti.get",
        capability: "contratto.read",
        resourceType: "contratto",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const caps = await effectiveCapabilitySet(ctx, ["contratto.manage"]);
      const letto = await leggiContratto(sedeId, input.commessaId);
      return { ...letto, puoModificare: caps.has("contratto.manage") };
    }),

  salva: procedura
    .input(
      z.object({
        commessaId: z.number().int(),
        contratto: contrattoInputSchema,
        righe: z.array(rigaInputSchema).max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "contratti.salva",
        capability: "contratto.manage",
        resourceType: "contratto",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await salvaContratto({
          sedeId,
          commessaId: input.commessaId,
          contratto: input.contratto,
          righe: input.righe,
          actorUserId: ctx.user?.id ?? null,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),
});
```

In `server/routers.ts`: `import { contrattiRouter } from "./routers/contratti";` e, nell'oggetto `appRouter`, `contratti: contrattiRouter,` prima di `proposte: proposteRouter,`.

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `pnpm vitest run server/routers/contratti.test.ts && pnpm check`
Expected: PASS. Se `authorizeCoreOperation` in modalità legacy lascia passare la squadra di posa, verificare che `legacyAllowed: "capability"` sia presente: è ciò che rende la matrice valida in ogni `policyMode`.

- [ ] **Step 5: Commit**

```bash
git add server/routers/contratti.ts server/routers/contratti.test.ts server/routers.ts
git commit -m "feat(contratti): router tRPC get/salva dietro FLAG_LIMITI

Validazione e autorizzazione nel router, decisioni nel servizio; altra
sede = NOT_FOUND, validazione = BAD_REQUEST leggibile.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Aggregati del computo (righe → conteggi, mq, larghezze, ore)

**Files:**
- Create: `server/computo/aggregati.ts`
- Test: `server/computo/aggregati.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ChiaveAggregato = "serramenti" | "cassonetti" | "porteBlindate" | "portoncini" | "serrTapp" | "serrPers" | "serrScuri" | "portoncinoPers" | "tapparelle" | "persiane" | "scuri" | "veneziane" | "tende" | "pergole" | "zanzariere" | "legno" | "legnoTapp" | "legnoPers" | "legnoScuri";
  type Aggregati = { n: Record<ChiaveAggregato, number>; mq: Record<ChiaveAggregato, number>; larghezzaM: number; oreTiro: number; orePosa: number; giornatePosa: number; nTotale: number; mqTotale: number; righeSenzaMisure: number };
  aggrega(righe: ReadonlyArray<RigaAggregabile>, coeff: Coefficienti): Aggregati;
  type RigaAggregabile = Pick<RigaContratto, "categoria" | "oscuranteIntegrato" | "quantita" | "larghezzaMm" | "mq">;
  ```
- Le chiavi rispecchiano le celle del foglio (`L7`=serramenti, `T7`=serrTapp, `AB7`=tapparelle, `AI7`=veneziane, `AP7`=legno, `AX7`=legnoTapp …) così ogni formula del motore si confronta riga per riga con l'originale.

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// server/computo/aggregati.test.ts
import { describe, expect, it } from "vitest";
import { aggrega } from "./aggregati";
import { tariffeAttive } from "./tariffe";

const coeff = tariffeAttive(new Date("2026-09-03")).coefficienti;
const r = (categoria: any, quantita: number, l: number | null, h: number | null, oscuranteIntegrato: any = null) => ({
  categoria, oscuranteIntegrato, quantita, larghezzaMm: l,
  mq: l && h ? Math.round((l * h * quantita) / 1_000_000 * 1000) / 1000 : 0,
});

describe("aggregati del computo", () => {
  it("riproduce la fattura 127: 6 serramenti PVC, 20,56 mq, larghezza 10,17 m", () => {
    const a = aggrega([r("serramento_pvc", 3, 1900, 2400), r("serramento_pvc", 2, 1660, 1540), r("serramento_pvc", 1, 1150, 1540)], coeff);
    expect(a.n.serramenti).toBe(6);
    expect(a.mq.serramenti).toBeCloseTo(20.564, 3);
    expect(a.larghezzaM).toBeCloseTo(10.17, 2);
    expect(a.nTotale).toBe(6);
    // Tempi: 6 × 0,5 h + 1/3 h materiali = 3,33 h tiro; 6 × 3 h = 18 h posa → 3 giornate
    expect(a.oreTiro).toBeCloseTo(3.333, 3);
    expect(a.orePosa).toBe(18);
    expect(a.giornatePosa).toBe(3);
    expect(a.righeSenzaMisure).toBe(0);
  });

  it("smista gli oscuranti integrati e quelli soli nelle chiavi del foglio", () => {
    const a = aggrega([
      r("serramento_alluminio", 2, 1200, 1400, "tapparella"),
      r("serramento_legno", 1, 1200, 1400, "persiana"),
      r("persiana", 3, 800, 1400),
      r("cassonetto", 2, 1200, 300),
      r("portoncino", 1, 1000, 2200, "persiana"),
      r("pergola", 1, 4000, 3000),
      r("controtelaio", 2, null, null),
    ], coeff);
    expect(a.n.serrTapp).toBe(2);
    expect(a.n.legnoPers).toBe(1);
    expect(a.n.persiane).toBe(3);
    expect(a.n.cassonetti).toBe(2);
    expect(a.n.portoncinoPers).toBe(1);
    expect(a.n.pergole).toBe(1);
    expect(a.n.serramenti).toBe(0);
    // larghezza: solo i serramenti (con o senza oscurante), non cassonetti/persiane sole/pergole
    expect(a.larghezzaM).toBeCloseTo(3.6, 2);
    // tiro: serramenti 3×0,5 + tapparelle (2 serrTapp + 2 cassonetti)×0,25 + persiane (1 legnoPers + 3 + 1 portoncinoPers)×0,25 + portoncino 1×0,5 + pergola 1×2 + 1/3
    expect(a.oreTiro).toBeCloseTo(1.5 + 1 + 1.25 + 0.5 + 2 + 1 / 3, 3);
    // posa: serramenti 3×3 + cassonetti 2×1 + oscuranti (2+1+3+1)×1,5 + pergola 16 + portoncino 1×3
    expect(a.orePosa).toBeCloseTo(9 + 2 + 10.5 + 16 + 3, 3);
    expect(a.righeSenzaMisure).toBe(1);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/computo/aggregati.test.ts`
Expected: FAIL — `./aggregati` non esiste.

- [ ] **Step 3: Scrivere `server/computo/aggregati.ts`**

```ts
// server/computo/aggregati.ts
// Dalle righe del contratto ai numeri che il foglio tiene in «Calcolo
// Automatici» (conteggi e mq per gruppo) e in «Tempi» (ore di tiro al
// piano e di posa). Le chiavi portano il nome della cella d'origine nei
// commenti: ogni formula del motore si confronta con l'originale.
import type { RigaContratto } from "@shared/limiti/tipi";
import type { Coefficienti } from "./tariffe";

export type ChiaveAggregato =
  | "serramenti"      // L7/R7   block A, PVC/alluminio senza oscurante
  | "cassonetti"      // L8/R8 (+T9/Z9)
  | "porteBlindate"   // L9/R9
  | "portoncini"      // L10/R10
  | "serrTapp"        // T7/Z7
  | "serrPers"        // T8/Z8
  | "serrScuri"       // T10/Z10
  | "portoncinoPers"  // T11/Z11
  | "tapparelle"      // AB7/AG7
  | "persiane"        // AB8/AG8
  | "scuri"           // AB9/AG9
  | "veneziane"       // AI7/AN7  schermature (veneziane, frangisole)
  | "tende"           // AI8/AN8
  | "pergole"         // AI9/AN9
  | "zanzariere"      // AI10/AN10
  | "legno"           // AP7/AV7  legno e legno-alluminio senza oscurante
  | "legnoTapp"       // AX7/BD7
  | "legnoPers"       // AX8/BD8
  | "legnoScuri";     // AX9/BD9

export type RigaAggregabile = Pick<
  RigaContratto,
  "categoria" | "oscuranteIntegrato" | "quantita" | "larghezzaMm" | "mq"
>;

export type Aggregati = {
  n: Record<ChiaveAggregato, number>;
  mq: Record<ChiaveAggregato, number>;
  larghezzaM: number;
  oreTiro: number;
  orePosa: number;
  giornatePosa: number;
  nTotale: number;
  mqTotale: number;
  righeSenzaMisure: number;
};

const CHIAVI: ChiaveAggregato[] = [
  "serramenti", "cassonetti", "porteBlindate", "portoncini", "serrTapp", "serrPers",
  "serrScuri", "portoncinoPers", "tapparelle", "persiane", "scuri", "veneziane", "tende",
  "pergole", "zanzariere", "legno", "legnoTapp", "legnoPers", "legnoScuri",
];

const SERRAMENTO_NON_LEGNO = new Set(["serramento_pvc", "serramento_alluminio"]);
const SERRAMENTO_LEGNO = new Set(["serramento_legno", "serramento_legno_alluminio"]);

/** La chiave del foglio per una riga, o null se la riga non entra negli aggregati. */
export function chiaveDi(r: RigaAggregabile): ChiaveAggregato | null {
  const o = r.oscuranteIntegrato;
  if (SERRAMENTO_NON_LEGNO.has(r.categoria)) {
    return o === "tapparella" ? "serrTapp" : o === "persiana" ? "serrPers" : o === "scuro" ? "serrScuri" : "serramenti";
  }
  if (SERRAMENTO_LEGNO.has(r.categoria)) {
    return o === "tapparella" ? "legnoTapp" : o === "persiana" ? "legnoPers" : o === "scuro" ? "legnoScuri" : "legno";
  }
  switch (r.categoria) {
    case "cassonetto": return "cassonetti";
    case "porta_blindata": return "porteBlindate";
    case "portoncino": return o === "persiana" ? "portoncinoPers" : "portoncini";
    case "tapparella": return "tapparelle";
    case "persiana": return "persiane";
    case "scuro": return "scuri";
    case "schermatura": return "veneziane";
    case "tenda": return "tende";
    case "pergola": return "pergole";
    case "zanzariera": return "zanzariere";
    default: return null; // controtelaio, porta_interna, accessorio, altro
  }
}

export function aggrega(
  righe: ReadonlyArray<RigaAggregabile>,
  coeff: Coefficienti
): Aggregati {
  const n = Object.fromEntries(CHIAVI.map(k => [k, 0])) as Record<ChiaveAggregato, number>;
  const mq = Object.fromEntries(CHIAVI.map(k => [k, 0])) as Record<ChiaveAggregato, number>;
  let larghezzaM = 0;
  let righeSenzaMisure = 0;
  for (const r of righe) {
    const k = chiaveDi(r);
    if (!k) continue;
    n[k] += r.quantita;
    mq[k] += r.mq;
    if (r.mq === 0) righeSenzaMisure += 1;
    // Q13: larghezza dei soli serramenti (blocchi A, B, E, F).
    const serramento = SERRAMENTO_NON_LEGNO.has(r.categoria) || SERRAMENTO_LEGNO.has(r.categoria);
    if (serramento && r.larghezzaMm != null) larghezzaM += (r.larghezzaMm * r.quantita) / 1000;
  }

  // Tempi!C4..C13 → ore di tiro al piano (F14)
  const serramentiTutti = n.serramenti + n.serrTapp + n.serrPers + n.serrScuri + n.legno + n.legnoTapp + n.legnoPers + n.legnoScuri;
  const tapparelleECassonetti = n.serrTapp + n.cassonetti + n.tapparelle + n.legnoTapp;
  const persianeTutte = n.serrPers + n.persiane + n.legnoPers + n.portoncinoPers;
  const scuriTutti = n.serrScuri + n.scuri + n.legnoScuri;
  const oreTiro =
    serramentiTutti * coeff.oreTiro.serramento +
    tapparelleECassonetti * coeff.oreTiro.tapparella +
    persianeTutte * coeff.oreTiro.persiana +
    scuriTutti * coeff.oreTiro.scuro +
    coeff.oreTiro.materialiPosa +
    n.porteBlindate * coeff.oreTiro.porta_blindata +
    (n.portoncini + n.portoncinoPers) * coeff.oreTiro.portoncino +
    (n.veneziane + n.zanzariere) * coeff.oreTiro.schermatura +
    n.tende * coeff.oreTiro.tenda +
    n.pergole * coeff.oreTiro.pergola;

  // Tempi!L4..L11 → ore di posa (O12)
  const oscurantiTutti = n.tapparelle + n.persiane + n.scuri + n.serrTapp + n.serrPers + n.serrScuri + n.legnoTapp + n.legnoPers + n.legnoScuri + n.portoncinoPers;
  const orePosa =
    serramentiTutti * coeff.orePosa.serramento +
    n.cassonetti * coeff.orePosa.cassonetto +
    oscurantiTutti * coeff.orePosa.oscurante +
    (n.veneziane + n.zanzariere) * coeff.orePosa.schermatura +
    n.tende * coeff.orePosa.tenda +
    n.pergole * coeff.orePosa.pergola +
    n.porteBlindate * coeff.orePosa.porta_blindata +
    (n.portoncini + n.portoncinoPers) * coeff.orePosa.portoncino;

  const nTotale = CHIAVI.reduce((s, k) => s + n[k], 0);
  const mqTotale = CHIAVI.reduce((s, k) => s + mq[k], 0);
  return {
    n,
    mq,
    larghezzaM,
    oreTiro,
    orePosa,
    giornatePosa: Math.ceil(orePosa / coeff.oreGiornata),
    nTotale,
    mqTotale,
    righeSenzaMisure,
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `pnpm vitest run server/computo/aggregati.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/computo/aggregati.ts server/computo/aggregati.test.ts
git commit -m "feat(computo): aggregati per gruppo e ore di tiro/posa dalle righe

Chiavi con il nome delle celle del foglio: ogni formula del motore si
confronta con l'originale riga per riga.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Motore del computo (CHECK1, CHECK2, limite, detrazione) — funzione pura

**Files:**
- Create: `server/computo/motore.ts`
- Test: `server/computo/motore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type RigaMotore = Pick<RigaContratto, "categoria" | "tipologia" | "oscuranteIntegrato" | "descrizione" | "quantita" | "larghezzaMm" | "altezzaMm" | "mq" | "misuraDei" | "prezzoTotCent" | "beneSignificativo" | "accessori">;
  type ParametriMotore = { zona: ZonaClimatica | null; piano: number | null; distanzaKm: number | null; pattuitoCent: number; pattuitoTipo: PattuitoTipo; detrazioneTipo: DetrazioneTipo; detrazionePct: number | null };
  type EsitoMotore = { voci: VoceComputo[]; check1Cent: number; check2Cent: number | null; limiteCent: number; esito: EsitoComputo; avvertenze: string[]; detraibileCent: number | null; detrazioneStimataCent: number | null };
  calcolaLimiti(righe: RigaMotore[], parametri: ParametriMotore, tariffe: Tariffe): EsitoMotore;
  ```
- Ogni voce porta in `dettaglio` gli input della formula (ore, mq, km, giornate, coefficiente) per il popover «perché» della UI.

- [ ] **Step 1: Scrivere il test che fallisce (valori derivati a mano dal foglio)**

```ts
// server/computo/motore.test.ts
// Valori calcolati a mano dalle formule di CHECK1 H22:H43 e dal foglio Tempi
// per la commessa della fattura 127/2026 (6 serramenti PVC, zona D, 2° piano,
// 18 km). Da sostituire/affiancare con le fixture dei fogli reali compilati
// (test d'oro) appena la direzione li fornisce.
import { describe, expect, it } from "vitest";
import { calcolaLimiti } from "./motore";
import { tariffeAttive } from "./tariffe";

const t = tariffeAttive(new Date("2026-09-03"));
const riga = (tipologia: string, quantita: number, l: number, h: number, prezzoTotCent: number, accessori: any[] = []) => ({
  categoria: "serramento_pvc" as const, tipologia, oscuranteIntegrato: null,
  descrizione: tipologia, quantita, larghezzaMm: l, altezzaMm: h,
  mq: Math.round((l * h * quantita) / 1_000_000 * 1000) / 1000, misuraDei: null,
  prezzoTotCent, beneSignificativo: true, accessori,
});
const righe127 = [
  riga("portafinestra_2_ante", 3, 1900, 2400, 500000),
  riga("finestra_2_ante", 2, 1660, 1540, 224746),
  riga("finestra_2_ante", 1, 1150, 1540, 100000),
];
const parametri = {
  zona: "D" as const, piano: 2, distanzaKm: 18, pattuitoCent: 1539500, pattuitoTipo: "lordo" as const,
  detrazioneTipo: "ristrutturazione" as const, detrazionePct: 50,
};
const voce = (esito: ReturnType<typeof calcolaLimiti>, codice: string) => {
  const v = esito.voci.find(x => x.codice === codice);
  if (!v) throw new Error(`voce mancante: ${codice}`);
  return v;
};

describe("motore limiti — fattura 127", () => {
  const e = calcolaLimiti(righe127, parametri, t);

  it("CHECK1: massimale A in zona D su 20,564 mq", () => {
    expect(voce(e, "massimale_A").limiteCent).toBe(1603992); // 780 × 20,564
    expect(voce(e, "massimale_B").limiteCent).toBe(0);
    expect(voce(e, "massimale_C").limiteCent).toBe(0);
  });

  it("opere complementari con le formule del foglio", () => {
    expect(voce(e, "rilievo_pezzo").limiteCent).toBe(10530);       // 60,17 × (6/8 + 1)
    expect(voce(e, "rilievo_foro").limiteCent).toBe(18051);        // 60,17 × (6/3 + 1)
    expect(voce(e, "progettazione").limiteCent).toBe(8952);        // 29,84 × 6/2
    expect(voce(e, "sviluppo_ordine").limiteCent).toBe(9026);      // 60,17 × (6/6 + 1/2)
    expect(voce(e, "protezione").limiteCent).toBe(10950);          // 36,5 × 0,5 × 6
    expect(voce(e, "rimozione_serramenti").limiteCent).toBe(41580); // 20,22 × 20,564
    expect(voce(e, "rimozione_tapparelle").limiteCent).toBe(0);
    expect(voce(e, "smaltimento").limiteCent).toBe(41669);         // 150 + 104,69×2,0564 + 100×0,5141
    expect(voce(e, "trasporto").limiteCent).toBe(7560);            // 2 × 18 × 0,7 × 3 giornate
    expect(voce(e, "tiro_piano").limiteCent).toBe(24333);          // 2 × 36,5 × 3,333 h, piano ≤ 4
    expect(voce(e, "assistenza_muraria").limiteCent).toBe(44880);  // 44,13 × 10,17 m
    expect(voce(e, "posa").limiteCent).toBe(131400);               // 18 h × 2 × 36,5
    expect(voce(e, "pulizia").limiteCent).toBe(17167);             // 50 + 3,333 × 36,5
    // max(600; 4 % di beni 8.247,46 + opere 3.660,98 + eventuali 3.278,40) = 607,47
    expect(voce(e, "spese_professionali").limiteCent).toBe(60747);
  });

  it("servizi eventuali", () => {
    expect(voce(e, "altri_servizi").limiteCent).toBe(16495);       // 2 % × 8.247,46
    expect(voce(e, "assistenze_murarie_eventuali").limiteCent).toBe(38616); // 32,18 × 2 × 6
    expect(voce(e, "dime").limiteCent).toBe(190937);               // 92,85 × 20,564
    expect(voce(e, "piattaforma").limiteCent).toBe(51792);
    expect(voce(e, "permessi_suolo").limiteCent).toBe(30000);
  });

  it("CHECK2 con il listino DEI per riga è il minore e diventa il limite", () => {
    // 665,15 × 13,68 + 574,72 × 5,113 + 574,72 × 1,771 = 13.055,62
    expect(voce(e, "dei_riga_1").limiteCent).toBe(909925);
    expect(voce(e, "dei_riga_2").limiteCent).toBe(293854);
    expect(voce(e, "dei_riga_3").limiteCent).toBe(101783);
    const opere = e.voci.filter(v => v.gruppo === "opere" || v.gruppo === "eventuali").reduce((s, v) => s + v.limiteCent, 0);
    expect(e.check1Cent).toBe(1603992 + opere);
    expect(e.check2Cent).toBe(909925 + 293854 + 101783 + opere);
    expect(e.limiteCent).toBe(e.check2Cent);
    expect(e.esito).toBe("ok");
  });

  it("detraibile e detrazione stimata sull'imponibile stimato del pattuito lordo", () => {
    // 15.395 / 1,10 = 13.995,45 < limite → detraibile = 13.995,45; 50 % = 6.997,73
    expect(e.detraibileCent).toBe(1399545);
    expect(e.detrazioneStimataCent).toBe(699773);
  });
});

describe("motore limiti — casi limite", () => {
  it("senza zona: massimali a zero, esito incompleto, avvertenza esplicita", () => {
    const e = calcolaLimiti(righe127, { ...parametri, zona: null }, t);
    expect(voce(e, "massimale_A").limiteCent).toBe(0);
    expect(e.esito).toBe("incompleto");
    expect(e.avvertenze.join(" ")).toMatch(/zona/i);
  });
  it("oltre il 4° piano il tiro costa il 30 % in più; senza km il trasporto è zero con avvertenza", () => {
    const e = calcolaLimiti(righe127, { ...parametri, piano: 5, distanzaKm: null }, t);
    expect(voce(e, "tiro_piano").limiteCent).toBe(31633); // 243,33 × 1,3
    expect(voce(e, "trasporto").limiteCent).toBe(0);
    expect(e.avvertenze.join(" ")).toMatch(/distanza/i);
  });
  it("minimo di fatturazione 1 mq in zona E e accessori DEI sulla riga", () => {
    const e = calcolaLimiti(
      [riga("finestra_1_anta", 1, 600, 800, 50000, [{ codice: "ribalta", quantita: 1 }, { codice: "coprifili_80", quantita: 4 }])],
      { ...parametri, zona: "E" },
      t
    );
    // 586,47 × max(0,48; 1) = 586,47 + ribalta 70 + coprifili 4 × 1,65 = 663,07
    expect(voce(e, "dei_riga_1").limiteCent).toBe(66307);
  });
  it("controtelaio in acciaio sotto 1,2 mq è fatturato a 1,2 mq; tipologia ignota = avvertenza", () => {
    const controtelaio = { categoria: "controtelaio" as const, tipologia: "C15145-a", oscuranteIntegrato: null, descrizione: "Controtelaio acciaio", quantita: 2, larghezzaMm: null, altezzaMm: null, mq: 0, misuraDei: 1, prezzoTotCent: null, beneSignificativo: false, accessori: [] };
    const e = calcolaLimiti([...righe127, controtelaio], parametri, t);
    expect(voce(e, "controtelaio_1").limiteCent).toBe(6662); // 55,52 × 1,2
    const e2 = calcolaLimiti([...righe127, { ...controtelaio, tipologia: "XX" }], parametri, t);
    expect(e2.avvertenze.join(" ")).toMatch(/controtelaio/i);
  });
  it("una riga senza voce DEI rende CHECK2 non calcolabile: limite = CHECK1", () => {
    const e = calcolaLimiti([...righe127, { ...righe127[0], tipologia: "sconosciuta" }], parametri, t);
    expect(e.check2Cent).toBeNull();
    expect(e.limiteCent).toBe(e.check1Cent);
    expect(e.esito).toBe("incompleto");
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/computo/motore.test.ts`
Expected: FAIL — `./motore` non esiste.

- [ ] **Step 3: Scrivere `server/computo/motore.ts`**

```ts
// server/computo/motore.ts
// Il computo dei limiti di spesa (DM MITE 14/02/2022) come funzione pura:
// righe + parametri + tariffe → voci con limite. Nessun I/O, nessun prezzo
// nel codice. Ogni formula cita la cella del foglio «CALCOLO NUOVI
// LIMITI.xlsx» da cui è trascritta: quella è la specifica, e i test d'oro
// con i fogli reali sono il giudice.
//
// CHECK1 (Allegato A): massimali €/mq per gruppo e zona sui prodotti +
// controtelai + opere complementari ed eventuali. CHECK2 (opere compiute):
// listino DEI per riga + le stesse opere. Limite = il minore. Se una riga
// non ha voce DEI, CHECK2 non è calcolabile e lo diciamo (fail-closed):
// limite = CHECK1, esito «incompleto».
import { euroToCent } from "@shared/euroCent";
import type {
  DetrazioneTipo,
  EsitoComputo,
  PattuitoTipo,
  RigaContratto,
  VoceComputo,
  ZonaClimatica,
} from "@shared/limiti/tipi";
import { aggrega, type Aggregati } from "./aggregati";
import {
  massimaleEuroMq,
  voceAccessorio,
  voceControtelaio,
  voceDeiPer,
  voceOpera,
  type CodiceOpera,
  type Tariffe,
} from "./tariffe";

export type RigaMotore = Pick<
  RigaContratto,
  | "categoria" | "tipologia" | "oscuranteIntegrato" | "descrizione" | "quantita"
  | "larghezzaMm" | "altezzaMm" | "mq" | "misuraDei" | "prezzoTotCent"
  | "beneSignificativo" | "accessori"
>;

export type ParametriMotore = {
  zona: ZonaClimatica | null;
  piano: number | null;
  distanzaKm: number | null;
  pattuitoCent: number;
  pattuitoTipo: PattuitoTipo;
  detrazioneTipo: DetrazioneTipo;
  detrazionePct: number | null;
};

export type EsitoMotore = {
  voci: VoceComputo[];
  check1Cent: number;
  check2Cent: number | null;
  limiteCent: number;
  esito: EsitoComputo;
  avvertenze: string[];
  detraibileCent: number | null;
  detrazioneStimataCent: number | null;
};

const arrotonda = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function calcolaLimiti(
  righe: RigaMotore[],
  p: ParametriMotore,
  t: Tariffe
): EsitoMotore {
  const coeff = t.coefficienti;
  const a = aggrega(righe, coeff);
  const voci: VoceComputo[] = [];
  const avvertenze: string[] = [];
  let ordine = 0;
  let incompleto = false;
  const aggiungi = (v: Omit<VoceComputo, "ordine">) => voci.push({ ...v, ordine: ++ordine });

  // ── Prodotti: CHECK1 righe 6–8 — massimale(zona) × mq del gruppo ──────────
  // H6 = E6 × (SERRAMENTI!H59 + EU59): blocco A + legno; H7 = E7 × (AM59 + GJ59);
  // H8 = E8 × (CW59 + EK59): oscuranti soli + schermature.
  const mqA = a.mq.serramenti + a.mq.cassonetti + a.mq.porteBlindate + a.mq.portoncini + a.mq.legno;
  const mqB = a.mq.serrTapp + a.mq.serrPers + a.mq.serrScuri + a.mq.portoncinoPers + a.mq.legnoTapp + a.mq.legnoPers + a.mq.legnoScuri;
  const mqC = a.mq.tapparelle + a.mq.persiane + a.mq.scuri + a.mq.veneziane + a.mq.tende + a.mq.pergole + a.mq.zanzariere;
  if (!p.zona) {
    incompleto = true;
    avvertenze.push("Zona climatica mancante: i massimali Allegato A valgono zero finché non è indicata.");
  }
  const gruppi: Array<["A" | "B" | "C", string, number]> = [
    ["A", "Serramenti, cassonetti, porte blindate (Allegato A)", mqA],
    ["B", "Serramenti + sistemi oscuranti (Allegato A)", mqB],
    ["C", "Oscuranti e schermature solari (Allegato A)", mqC],
  ];
  for (const [gruppo, descrizione, mq] of gruppi) {
    const euroMq = p.zona ? massimaleEuroMq(t, gruppo, p.zona) : 0;
    aggiungi({
      gruppo: "prodotti", codice: `massimale_${gruppo}`, descrizione, codiceDei: null, unita: "€/mq",
      prezzoUnitCent: euroToCent(euroMq), quantita: arrotonda(mq), limiteCent: euroToCent(euroMq * mq),
      dettaglio: { zona: p.zona ?? "", mq: arrotonda(mq), euroMq },
    });
  }
  if (a.righeSenzaMisure > 0) {
    avvertenze.push(`${a.righeSenzaMisure} righe senza misure: contate nei pezzi ma non nei mq.`);
  }

  // ── Controtelai: CHECK1 righe 11–18 — prezzo DEI × misura (min 1,2 mq acciaio/misto)
  let nControtelaio = 0;
  for (const r of righe) {
    if (r.categoria !== "controtelaio") continue;
    nControtelaio += 1;
    const v = r.tipologia ? voceControtelaio(t, r.tipologia) : null;
    if (!v) {
      incompleto = true;
      avvertenze.push(`Controtelaio «${r.descrizione}»: variante DEI non riconosciuta (${r.tipologia ?? "vuota"}).`);
      continue;
    }
    let misura = v.unita === "cad" ? r.quantita : (r.misuraDei ?? 0);
    if (v.unita === "mq" && misura > 0 && misura < coeff.controtelaiMinMq) misura = coeff.controtelaiMinMq; // H13/H14
    aggiungi({
      gruppo: "controtelai", codice: `controtelaio_${nControtelaio}`, descrizione: `${v.famiglia} — ${v.variante}`,
      codiceDei: v.codice, unita: v.unita, prezzoUnitCent: euroToCent(v.prezzo), quantita: arrotonda(misura),
      limiteCent: euroToCent(v.prezzo * misura), dettaglio: { misuraDichiarata: r.misuraDei ?? r.quantita, misuraFatturata: arrotonda(misura) },
    });
  }

  // ── Opere complementari: CHECK1 H22:H35 ──────────────────────────────────
  const n = a.n, mq = a.mq;
  const nA = n.serramenti + n.cassonetti + n.porteBlindate + n.portoncini;          // SERRAMENTI!C59
  const nE = n.legno;                                                                 // EP59
  const nC = n.tapparelle + n.persiane + n.scuri;                                     // CR59
  const nD = n.veneziane + n.tende + n.pergole + n.zanzariere;                        // EF59
  const serramentiTutti = n.serramenti + n.legno + n.serrTapp + n.serrPers + n.serrScuri + n.legnoTapp + n.legnoPers + n.legnoScuri;
  const oreRilievoPezzo = nA / 8 + nE / 8 + n.serrTapp / 4 + n.legnoTapp / 4 + n.serrPers / 4 + n.legnoPers / 4 + n.legnoScuri / 4 + n.serrScuri / 8 + nC / 8 + nD / 8 + n.portoncinoPers / 8 + 1; // H22
  const oreRilievoForo = serramentiTutti / 3 + 1;                                      // H23
  const oreProgettazione = a.nTotale / 2;                                             // H24
  const oreSviluppo = a.nTotale / 6 + 1 / 2;                                          // H25
  const oreProtezione = 0.5 * (n.serramenti + n.legno + n.serrTapp + n.serrPers + n.serrScuri + n.porteBlindate + n.portoncini + n.tapparelle + n.persiane + n.scuri + n.legnoTapp + n.legnoPers + n.legnoScuri + n.portoncinoPers); // H26
  const mqRimozioneSerr = mq.serramenti + mq.legno + 2 * mq.serrPers + mq.serrTapp + mq.serrScuri + mq.persiane + mq.scuri + mq.tapparelle + mq.porteBlindate + mq.portoncini + 2 * mq.legnoPers + mq.legnoTapp + mq.legnoScuri + 2 * mq.portoncinoPers; // H27
  const mqRimozioneTapp = mq.serrTapp + mq.cassonetti + mq.tapparelle + mq.legnoTapp; // H28 (R8 e Z9 sono la stessa riga da noi)
  const mqSerrSmalt = mq.serramenti + mq.legno + mq.serrTapp + mq.serrPers + mq.serrScuri + mq.legnoTapp + mq.legnoPers + mq.legnoScuri + mq.porteBlindate + mq.portoncini + mq.portoncinoPers;
  const mqOscSmalt = mq.serrTapp + mq.serrPers + mq.serrScuri + mq.tapparelle + mq.persiane + mq.scuri;
  const mqSerrOneri = mq.serramenti + mq.legno + mq.serrTapp + mq.serrPers + mq.serrScuri + mq.porteBlindate + mq.portoncini + mq.portoncinoPers;
  const mqOscOneri = mqOscSmalt + mq.legnoTapp + mq.legnoPers + mq.legnoScuri;
  const smaltimento =
    coeff.smaltimentoBaseEuro +
    coeff.smaltimentoEuroMc * (mqSerrSmalt * 0.1 + mq.cassonetti * 0.35 + mqOscSmalt * 0.05) +
    coeff.smaltimentoEuroOnere * (mqSerrOneri * 0.025 + mq.cassonetti * 0.015 + mqOscOneri * 0.0125); // H29
  const maggiorazione = p.piano != null && p.piano > coeff.maggiorazionePianoOltre ? coeff.maggiorazionePiano : 1; // H31
  if (p.distanzaKm == null) avvertenze.push("Distanza dal magazzino mancante: il limite del trasporto è zero.");

  const opera = (codice: CodiceOpera, quantita: number, euro: number, dettaglio: VoceComputo["dettaglio"]) => {
    const v = voceOpera(t, codice);
    aggiungi({
      gruppo: v.gruppo, codice, descrizione: v.descrizione, codiceDei: v.codiceDei, unita: v.unita,
      prezzoUnitCent: euroToCent(v.prezzo), quantita: arrotonda(quantita), limiteCent: euroToCent(Math.max(0, euro)), dettaglio,
    });
    return Math.max(0, euro);
  };
  const prezzo = (c: CodiceOpera) => voceOpera(t, c).prezzo;
  let totOpere = 0;
  totOpere += opera("rilievo_pezzo", oreRilievoPezzo, prezzo("rilievo_pezzo") * oreRilievoPezzo, { ore: arrotonda(oreRilievoPezzo) });
  totOpere += opera("rilievo_foro", oreRilievoForo, prezzo("rilievo_foro") * oreRilievoForo, { ore: arrotonda(oreRilievoForo) });
  totOpere += opera("progettazione", oreProgettazione, prezzo("progettazione") * oreProgettazione, { ore: arrotonda(oreProgettazione) });
  totOpere += opera("sviluppo_ordine", oreSviluppo, prezzo("sviluppo_ordine") * oreSviluppo, { ore: arrotonda(oreSviluppo) });
  totOpere += opera("protezione", oreProtezione, prezzo("protezione") * oreProtezione, { ore: arrotonda(oreProtezione) });
  totOpere += opera("rimozione_serramenti", mqRimozioneSerr, prezzo("rimozione_serramenti") * mqRimozioneSerr, { mq: arrotonda(mqRimozioneSerr) });
  totOpere += opera("rimozione_tapparelle", mqRimozioneTapp, prezzo("rimozione_tapparelle") * mqRimozioneTapp, { mq: arrotonda(mqRimozioneTapp) });
  totOpere += opera("smaltimento", 1, smaltimento, { mc: arrotonda(mqSerrSmalt * 0.1 + mq.cassonetti * 0.35 + mqOscSmalt * 0.05), base: coeff.smaltimentoBaseEuro });
  totOpere += opera("trasporto", p.distanzaKm ?? 0, p.distanzaKm == null ? 0 : 2 * p.distanzaKm * coeff.euroKm * a.giornatePosa, { km: p.distanzaKm ?? 0, giornate: a.giornatePosa, orePosa: arrotonda(a.orePosa) }); // H30
  totOpere += opera("tiro_piano", a.oreTiro, coeff.installatori * prezzo("tiro_piano") * a.oreTiro * maggiorazione, { ore: arrotonda(a.oreTiro), piano: p.piano ?? 0, maggiorazione }); // H31
  totOpere += opera("assistenza_muraria", a.larghezzaM, prezzo("assistenza_muraria") * a.larghezzaM, { metri: arrotonda(a.larghezzaM) }); // H32
  totOpere += opera("posa", a.orePosa, a.orePosa * coeff.installatori * prezzo("posa"), { ore: arrotonda(a.orePosa), installatori: coeff.installatori }); // H33
  totOpere += opera("pulizia", a.oreTiro, coeff.puliziaFissoEuro + a.oreTiro * prezzo("pulizia"), { ore: arrotonda(a.oreTiro), fisso: coeff.puliziaFissoEuro }); // H34

  // ── Servizi eventuali: CHECK1 H39:H43 ────────────────────────────────────
  const beniEuro = righe.filter(r => r.categoria !== "controtelaio").reduce((s, r) => s + (r.prezzoTotCent ?? 0), 0) / 100;
  let totEventuali = 0;
  totEventuali += opera("altri_servizi", beniEuro, beniEuro * coeff.altriServiziPct, { beni: beniEuro, pct: coeff.altriServiziPct }); // H39
  totEventuali += opera("assistenze_murarie_eventuali", 2 * a.nTotale, prezzo("assistenze_murarie_eventuali") * 2 * a.nTotale, { ore: 2 * a.nTotale }); // H40
  totEventuali += opera("dime", a.mqTotale, prezzo("dime") * a.mqTotale, { mq: arrotonda(a.mqTotale) }); // H41
  totEventuali += opera("piattaforma", 1, prezzo("piattaforma"), { giornate: 1 }); // H42
  totEventuali += opera("permessi_suolo", 1, prezzo("permessi_suolo"), { giornate: 1 }); // H43

  // Spese professionali: H35 = max(600; 4 % della fattura). Prima della
  // fattura la base è beni + controtelai + opere + eventuali (stima).
  const totControtelai = voci.filter(v => v.gruppo === "controtelai").reduce((s, v) => s + v.limiteCent, 0) / 100;
  const baseSpese = beniEuro + totControtelai + totOpere + totEventuali;
  totOpere += opera("spese_professionali", 1, Math.max(coeff.speseProfessionaliMinEuro, coeff.speseProfessionaliPct * baseSpese), { base: arrotonda(baseSpese, 2), pct: coeff.speseProfessionaliPct, minimo: coeff.speseProfessionaliMinEuro, stima: true }); // H35

  // ── CHECK2: listino DEI opere compiute per riga (T6) ─────────────────────
  let check2Prodotti: number | null = 0;
  let iRiga = 0;
  for (const r of righe) {
    if (r.categoria === "controtelaio") continue;
    iRiga += 1;
    const v = voceDeiPer(t, r.categoria, r.tipologia);
    if (!v) {
      if (["accessorio", "altro", "porta_interna"].includes(r.categoria)) continue;
      check2Prodotti = null;
      avvertenze.push(`Riga ${iRiga} «${r.descrizione}»: nessuna voce DEI per ${r.categoria}/${r.tipologia ?? "tipologia vuota"} — CHECK2 non calcolabile.`);
      continue;
    }
    let mqEff = r.mq;
    if (v.minimoMq && p.zona && (v.minimoZone ?? "").includes(p.zona)) {
      mqEff = Math.max(mqEff, v.minimoMq * r.quantita);
    }
    let euro = v.prezzo * mqEff;
    const dettaglio: VoceComputo["dettaglio"] = { prezzoDei: v.prezzo, mq: arrotonda(mqEff) };
    for (const acc of r.accessori) {
      const va = voceAccessorio(t, acc.codice);
      if (!va) { avvertenze.push(`Riga ${iRiga}: accessorio «${acc.codice}» senza sovrapprezzo DEI, ignorato nel CHECK2.`); continue; }
      const extra = va.unita === "%" ? (v.prezzo * mqEff * va.valore) / 100 : va.valore * acc.quantita;
      euro += extra;
      dettaglio[`accessorio_${acc.codice}`] = arrotonda(extra, 2);
    }
    if (check2Prodotti != null) check2Prodotti += euro;
    aggiungi({
      gruppo: "prodotti", codice: `dei_riga_${iRiga}`, descrizione: `${r.descrizione} — ${v.descrizione}`, codiceDei: v.codice,
      unita: "mq", prezzoUnitCent: euroToCent(v.prezzo), quantita: arrotonda(mqEff), limiteCent: euroToCent(euro), dettaglio,
    });
  }

  // ── Totali ───────────────────────────────────────────────────────────────
  const somma = (filtro: (v: VoceComputo) => boolean) => voci.filter(filtro).reduce((s, v) => s + v.limiteCent, 0);
  const massimali = somma(v => v.codice.startsWith("massimale_"));
  const controtelai = somma(v => v.gruppo === "controtelai");
  const opereEventuali = somma(v => v.gruppo === "opere" || v.gruppo === "eventuali");
  const check1Cent = massimali + controtelai + opereEventuali;
  const check2Cent = check2Prodotti == null ? null : euroToCent(check2Prodotti) + controtelai + opereEventuali;
  if (check2Cent == null) incompleto = true;
  const limiteCent = check2Cent == null ? check1Cent : Math.min(check1Cent, check2Cent);

  // Detrazione: stima dell'imponibile dal pattuito (tutto al 10 % se lordo);
  // il valore esatto arriva con la fattura (piano 2).
  let detraibileCent: number | null = null;
  let detrazioneStimataCent: number | null = null;
  if (p.detrazioneTipo !== "nessuna" && p.detrazionePct != null) {
    const imponibileStimato = p.pattuitoTipo === "lordo" ? Math.round(p.pattuitoCent / 1.1) : p.pattuitoCent;
    detraibileCent = Math.min(imponibileStimato, limiteCent);
    detrazioneStimataCent = Math.round((detraibileCent * p.detrazionePct) / 100);
  }

  return {
    voci, check1Cent, check2Cent, limiteCent, esito: incompleto ? "incompleto" : "ok",
    avvertenze, detraibileCent, detrazioneStimataCent,
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `pnpm vitest run server/computo/motore.test.ts && pnpm check`
Expected: PASS. Se un valore a centesimo differisce di 1 per l'arrotondamento binario, verificare prima la formula contro la cella citata; solo dopo correggere il test.

- [ ] **Step 5: Commit**

```bash
git add server/computo/motore.ts server/computo/motore.test.ts
git commit -m "feat(computo): motore dei limiti CHECK1/CHECK2 come funzione pura

Ogni formula cita la cella del foglio da cui è trascritta; prezzi e
coefficienti vengono dalle tariffe. Senza zona o senza voce DEI il computo
si dichiara incompleto invece di inventare un numero.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Repository e servizio del computo

**Files:**
- Create: `server/computo/repository.ts`
- Create: `server/computo/servizio.ts`
- Test: `server/computo/repository.test.ts`, `server/computo/repository.pg.test.ts`, `server/computo/servizio.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ComputoPersist = Omit<Computo, "id" | "createdAt">;
  type ComputiRepository = {
    ensureSchema(): Promise<void>;
    salva(input: { computo: ComputoPersist; now: Date }): Promise<Computo>;
    ultimo(sedeId: number, commessaId: number): Promise<Computo | null>;
  };
  getComputiRepository(): ComputiRepository; createMemoryComputiRepository(); createPostgresComputiRepository(sql);
  // servizio
  eseguiComputo(input: { sedeId: number; commessaId: number; actorUserId: number | null; now?: Date }): Promise<Computo>;
  ultimoComputo(sedeId: number, commessaId: number): Promise<{ computo: Computo | null; valido: boolean; motivo: string | null }>;
  computoValido(sedeId: number, commessaId: number): Promise<boolean>;
  ```
- «Valido» = esiste un computo con `hashRighe` e `hashParametri` uguali a quelli del contratto corrente **e** `esito === "ok"`.

- [ ] **Step 1: Scrivere i test del repository in memoria che falliscono**

```ts
// server/computo/repository.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryComputiRepository, type ComputoPersist } from "./repository";

const NOW = new Date("2026-09-03T10:00:00.000Z");
const computo = (commessaId = 10, hashRighe = "h1"): ComputoPersist => ({
  sedeId: 1, commessaId, hashRighe, hashParametri: "p1", tariffeAl: "2026-09-03", zona: "D",
  esito: "ok", check1Cent: 2000000, check2Cent: 1800000, limiteCent: 1800000, detraibileCent: 1399545,
  detrazioneStimataCent: 699773, avvertenze: [], createdBy: 5,
  voci: [{ gruppo: "prodotti", codice: "massimale_A", descrizione: "A", codiceDei: null, unita: "€/mq", prezzoUnitCent: 78000, quantita: 20.564, limiteCent: 1603992, dettaglio: { zona: "D" }, ordine: 1 }],
});

describe("repository computi (memoria)", () => {
  it("salva con id progressivo e restituisce l'ultimo per commessa e sede", async () => {
    const repo = createMemoryComputiRepository();
    const primo = await repo.salva({ computo: computo(), now: NOW });
    const secondo = await repo.salva({ computo: computo(10, "h2"), now: new Date("2026-09-04T10:00:00.000Z") });
    expect(secondo.id).toBeGreaterThan(primo.id);
    expect((await repo.ultimo(1, 10))?.hashRighe).toBe("h2");
    expect((await repo.ultimo(1, 10))?.voci[0].codice).toBe("massimale_A");
    expect(await repo.ultimo(2, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `pnpm vitest run server/computo/repository.test.ts`
Expected: FAIL — `./repository` non esiste.

- [ ] **Step 3: Scrivere `server/computo/repository.ts`**

```ts
// server/computo/repository.ts
// Fotografie del computo limiti: ogni esecuzione è una riga nuova con le sue
// voci; «l'ultimo» per commessa è quello che la UI mostra e il gate
// confronta con gli hash del contratto. Nessun aggiornamento in place: un
// computo è un fatto datato, non uno stato.
import { kvSql } from "../_core/persistence";
import type { Computo, VoceComputo } from "@shared/limiti/tipi";

export type ComputoPersist = Omit<Computo, "id" | "createdAt">;

export type ComputiRepository = {
  ensureSchema(): Promise<void>;
  salva(input: { computo: ComputoPersist; now: Date }): Promise<Computo>;
  ultimo(sedeId: number, commessaId: number): Promise<Computo | null>;
};

export function createMemoryComputiRepository(): ComputiRepository {
  const computi: Computo[] = [];
  let nextId = 1;
  return {
    async ensureSchema() {},
    async salva({ computo, now }) {
      const salvato: Computo = { ...structuredClone(computo), id: nextId++, createdAt: now };
      computi.push(salvato);
      return structuredClone(salvato);
    },
    async ultimo(sedeId, commessaId) {
      const trovati = computi.filter(c => c.sedeId === sedeId && c.commessaId === commessaId);
      const u = trovati[trovati.length - 1];
      return u ? structuredClone(u) : null;
    },
  };
}

function rowToComputo(row: any, voci: VoceComputo[]): Computo {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    commessaId: Number(row.commessa_id),
    hashRighe: row.hash_righe,
    hashParametri: row.hash_parametri,
    tariffeAl: String(row.tariffe_al).slice(0, 10),
    zona: row.zona ?? null,
    esito: row.esito,
    check1Cent: Number(row.check1_cent),
    check2Cent: row.check2_cent == null ? null : Number(row.check2_cent),
    limiteCent: Number(row.limite_cent),
    detraibileCent: row.detraibile_cent == null ? null : Number(row.detraibile_cent),
    detrazioneStimataCent: row.detrazione_stimata_cent == null ? null : Number(row.detrazione_stimata_cent),
    avvertenze: Array.isArray(row.avvertenze) ? row.avvertenze : [],
    voci,
    createdBy: row.created_by == null ? null : Number(row.created_by),
    createdAt: new Date(row.created_at),
  };
}

function rowToVoce(row: any): VoceComputo {
  return {
    gruppo: row.gruppo,
    codice: row.codice,
    descrizione: row.descrizione,
    codiceDei: row.codice_dei ?? null,
    unita: row.unita,
    prezzoUnitCent: Number(row.prezzo_unit_cent),
    quantita: Number(row.quantita),
    limiteCent: Number(row.limite_cent),
    dettaglio: row.dettaglio ?? {},
    ordine: Number(row.ordine),
  };
}

export function createPostgresComputiRepository(
  sql: NonNullable<typeof kvSql>
): ComputiRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS computi (
          id BIGSERIAL PRIMARY KEY,
          sede_id BIGINT NOT NULL,
          commessa_id BIGINT NOT NULL,
          hash_righe TEXT NOT NULL,
          hash_parametri TEXT NOT NULL,
          tariffe_al DATE NOT NULL,
          zona TEXT CHECK (zona IN ('A','B','C','D','E','F')),
          esito TEXT NOT NULL CHECK (esito IN ('ok','incompleto')),
          check1_cent BIGINT NOT NULL,
          check2_cent BIGINT,
          limite_cent BIGINT NOT NULL,
          detraibile_cent BIGINT,
          detrazione_stimata_cent BIGINT,
          avvertenze JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS computi_commessa_idx
          ON computi (sede_id, commessa_id, id DESC)`;
        await tx`CREATE TABLE IF NOT EXISTS computo_voci (
          id BIGSERIAL PRIMARY KEY,
          computo_id BIGINT NOT NULL REFERENCES computi(id) ON DELETE CASCADE,
          ordine INTEGER NOT NULL,
          gruppo TEXT NOT NULL CHECK (gruppo IN ('prodotti','controtelai','opere','eventuali')),
          codice TEXT NOT NULL,
          descrizione TEXT NOT NULL,
          codice_dei TEXT,
          unita TEXT NOT NULL,
          prezzo_unit_cent BIGINT NOT NULL,
          quantita NUMERIC(12,3) NOT NULL,
          limite_cent BIGINT NOT NULL,
          dettaglio JSONB NOT NULL DEFAULT '{}'::jsonb
        )`;
        await tx`CREATE INDEX IF NOT EXISTS computo_voci_computo_idx
          ON computo_voci (computo_id, ordine)`;
      })
      .then(() => undefined)
      .catch(error => {
        schemaPromise = null;
        throw error;
      });
    return schemaPromise;
  };

  return {
    ensureSchema,
    async salva({ computo: c, now }) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows = await tx`INSERT INTO computi (
          sede_id, commessa_id, hash_righe, hash_parametri, tariffe_al, zona, esito,
          check1_cent, check2_cent, limite_cent, detraibile_cent, detrazione_stimata_cent,
          avvertenze, created_by, created_at
        ) VALUES (
          ${c.sedeId}, ${c.commessaId}, ${c.hashRighe}, ${c.hashParametri}, ${c.tariffeAl},
          ${c.zona}, ${c.esito}, ${c.check1Cent}, ${c.check2Cent}, ${c.limiteCent},
          ${c.detraibileCent}, ${c.detrazioneStimataCent}, ${tx.json(c.avvertenze as any)},
          ${c.createdBy}, ${now}
        ) RETURNING *`;
        const id = Number(rows[0].id);
        const voci: VoceComputo[] = [];
        for (const v of c.voci) {
          const ins = await tx`INSERT INTO computo_voci (
            computo_id, ordine, gruppo, codice, descrizione, codice_dei, unita,
            prezzo_unit_cent, quantita, limite_cent, dettaglio
          ) VALUES (
            ${id}, ${v.ordine}, ${v.gruppo}, ${v.codice}, ${v.descrizione}, ${v.codiceDei},
            ${v.unita}, ${v.prezzoUnitCent}, ${v.quantita}, ${v.limiteCent}, ${tx.json(v.dettaglio as any)}
          ) RETURNING *`;
          voci.push(rowToVoce(ins[0]));
        }
        return rowToComputo(rows[0], voci);
      });
    },
    async ultimo(sedeId, commessaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM computi
        WHERE sede_id = ${sedeId} AND commessa_id = ${commessaId}
        ORDER BY id DESC LIMIT 1`;
      if (!rows[0]) return null;
      const voci = await sql`SELECT * FROM computo_voci
        WHERE computo_id = ${rows[0].id} ORDER BY ordine`;
      return rowToComputo(rows[0], voci.map(rowToVoce));
    },
  };
}

let singleton: ComputiRepository | null = null;
export function getComputiRepository(): ComputiRepository {
  singleton ??= kvSql
    ? createPostgresComputiRepository(kvSql)
    : createMemoryComputiRepository();
  return singleton;
}
export function _resetComputiRepositoryForTests(): void {
  singleton = null;
}
```

- [ ] **Step 4: Eseguire il test in memoria e verificare che passi**

Run: `pnpm vitest run server/computo/repository.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 5: Test Postgres (saltato senza database)**

```ts
// server/computo/repository.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { createPostgresComputiRepository } from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

describe.skipIf(!conDatabase)("repository computi (PostgreSQL)", () => {
  const sql = kvSql!;
  const SEDE = 99320;
  const repo = createPostgresComputiRepository(sql);
  beforeAll(async () => {
    await repo.ensureSchema();
    await sql`DELETE FROM computi WHERE sede_id = ${SEDE}`;
  });
  afterAll(async () => {
    await sql`DELETE FROM computi WHERE sede_id = ${SEDE}`;
  });
  it("salva computo e voci, rilegge l'ultimo con le voci in ordine", async () => {
    const base = {
      sedeId: SEDE, commessaId: 992001, hashRighe: "h", hashParametri: "p", tariffeAl: "2026-09-03",
      zona: "D" as const, esito: "ok" as const, check1Cent: 10, check2Cent: 8, limiteCent: 8,
      detraibileCent: null, detrazioneStimataCent: null, avvertenze: ["a"], createdBy: 1,
      voci: [
        { gruppo: "opere" as const, codice: "posa", descrizione: "Posa", codiceDei: "M01024", unita: "h", prezzoUnitCent: 3650, quantita: 18, limiteCent: 131400, dettaglio: { ore: 18 }, ordine: 2 },
        { gruppo: "prodotti" as const, codice: "massimale_A", descrizione: "A", codiceDei: null, unita: "€/mq", prezzoUnitCent: 78000, quantita: 20.564, limiteCent: 1603992, dettaglio: {}, ordine: 1 },
      ],
    };
    await repo.salva({ computo: { ...base, hashRighe: "vecchio" }, now: new Date("2026-09-01T00:00:00Z") });
    const nuovo = await repo.salva({ computo: base, now: new Date("2026-09-03T00:00:00Z") });
    const letto = await repo.ultimo(SEDE, 992001);
    expect(letto?.id).toBe(nuovo.id);
    expect(letto?.voci.map(v => v.codice)).toEqual(["massimale_A", "posa"]);
    expect(letto?.voci[1].dettaglio).toEqual({ ore: 18 });
    expect(letto?.avvertenze).toEqual(["a"]);
    expect(await repo.ultimo(SEDE + 1, 992001)).toBeNull();
  });
});
```

Run: `DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test pnpm vitest run server/computo/repository.pg.test.ts`
Expected: PASS (o skipped senza database).

- [ ] **Step 6: Scrivere i test del servizio che falliscono**

```ts
// server/computo/servizio.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { salvaContratto } from "../contratti/servizio";
import { _resetComputiRepositoryForTests } from "./repository";
import { computoValido, eseguiComputo, ultimoComputo } from "./servizio";
import { creaCommessa } from "../routers/commesse";
import { getClientiStore } from "../routers/clienti";
import type { TrpcContext } from "../_core/context";

const SEDE = 1;
const ctx = (): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> => ({
  user: { id: 5, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "T" } as any,
  sedeId: SEDE,
  sediIds: [SEDE],
});
async function commessaConContratto(): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9201 + clienti.length, sedeId: SEDE, nome: "E", cognome: "B", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(ctx(), { clienteId: cliente.id } as any);
  const commessaId = (c as any).commessa?.id ?? (c as any).id;
  await salvaContratto({
    sedeId: SEDE, commessaId, actorUserId: 5,
    contratto: { pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione", detrazioneImmobile: "prima_casa", detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale", documentoId: null },
    righe: [{ categoria: "serramento_pvc", tipologia: "portafinestra_2_ante", oscuranteIntegrato: null, descrizione: "PF", quantita: 3, larghezzaMm: 1900, altezzaMm: 2400, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale", evidenza: null }],
  });
  return commessaId;
}

describe("servizio computo", () => {
  beforeEach(() => {
    _resetContrattiRepositoryForTests();
    _resetComputiRepositoryForTests();
  });

  it("esegue il computo dal contratto e lo dichiara valido finché le righe non cambiano", async () => {
    const commessaId = await commessaConContratto();
    expect(await computoValido(SEDE, commessaId)).toBe(false);
    const computo = await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    expect(computo.zona).toBe("D");
    expect(computo.esito).toBe("ok");
    expect(computo.voci.find(v => v.codice === "massimale_A")?.limiteCent).toBe(1067040); // 780 × 13,68
    expect(await computoValido(SEDE, commessaId)).toBe(true);
    const stato = await ultimoComputo(SEDE, commessaId);
    expect(stato.valido).toBe(true);
    // cambia una misura → superato
    await salvaContratto({
      sedeId: SEDE, commessaId, actorUserId: 5,
      contratto: { pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione", detrazioneImmobile: "prima_casa", detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale", documentoId: null },
      righe: [{ categoria: "serramento_pvc", tipologia: "portafinestra_2_ante", oscuranteIntegrato: null, descrizione: "PF", quantita: 3, larghezzaMm: 1900, altezzaMm: 2500, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale", evidenza: null }],
    });
    const dopo = await ultimoComputo(SEDE, commessaId);
    expect(dopo.valido).toBe(false);
    expect(dopo.motivo).toMatch(/righe/i);
  });

  it("senza contratto il computo rifiuta con NOT_FOUND", async () => {
    await expect(eseguiComputo({ sedeId: SEDE, commessaId: 424242, actorUserId: 5 })).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 7: Scrivere `server/computo/servizio.ts`**

```ts
// server/computo/servizio.ts
// Orchestrazione del computo: legge contratto e righe, carica le tariffe,
// invoca il motore puro, salva la fotografia. «Valido» è una domanda sugli
// hash: se righe o parametri sono cambiati dopo l'ultimo computo, il gate
// e la UI lo dicono e chiedono di ricalcolare.
import { leggiContratto } from "../contratti/servizio";
import type { Computo } from "@shared/limiti/tipi";
import { calcolaLimiti } from "./motore";
import { getComputiRepository } from "./repository";
import { tariffeAttive } from "./tariffe";

export async function eseguiComputo(input: {
  sedeId: number;
  commessaId: number;
  actorUserId: number | null;
  now?: Date;
}): Promise<Computo> {
  const now = input.now ?? new Date();
  const { contratto, righe } = await leggiContratto(input.sedeId, input.commessaId);
  if (!contratto) {
    throw new Error("NOT_FOUND: Contratto non trovato per questa commessa.");
  }
  const tariffe = tariffeAttive(now);
  const esito = calcolaLimiti(
    righe,
    {
      zona: contratto.zonaClimatica,
      piano: contratto.piano,
      distanzaKm: contratto.distanzaKm,
      pattuitoCent: contratto.pattuitoCent,
      pattuitoTipo: contratto.pattuitoTipo,
      detrazioneTipo: contratto.detrazioneTipo,
      detrazionePct: contratto.detrazionePct,
    },
    tariffe
  );
  return getComputiRepository().salva({
    now,
    computo: {
      sedeId: input.sedeId,
      commessaId: input.commessaId,
      hashRighe: contratto.hashRighe,
      hashParametri: contratto.hashParametri,
      tariffeAl: tariffe.versione,
      zona: contratto.zonaClimatica,
      esito: esito.esito,
      check1Cent: esito.check1Cent,
      check2Cent: esito.check2Cent,
      limiteCent: esito.limiteCent,
      detraibileCent: esito.detraibileCent,
      detrazioneStimataCent: esito.detrazioneStimataCent,
      avvertenze: esito.avvertenze,
      voci: esito.voci,
      createdBy: input.actorUserId,
    },
  });
}

export async function ultimoComputo(
  sedeId: number,
  commessaId: number
): Promise<{ computo: Computo | null; valido: boolean; motivo: string | null }> {
  const [{ contratto }, computo] = await Promise.all([
    leggiContratto(sedeId, commessaId),
    getComputiRepository().ultimo(sedeId, commessaId),
  ]);
  if (!contratto) return { computo, valido: false, motivo: "Manca il contratto." };
  if (!computo) return { computo: null, valido: false, motivo: "Nessun computo eseguito." };
  if (computo.hashRighe !== contratto.hashRighe) {
    return { computo, valido: false, motivo: "Le righe del contratto sono cambiate dopo il computo." };
  }
  if (computo.hashParametri !== contratto.hashParametri) {
    return { computo, valido: false, motivo: "I parametri del contratto sono cambiati dopo il computo." };
  }
  if (computo.esito !== "ok") {
    return { computo, valido: false, motivo: "Il computo è incompleto: " + computo.avvertenze.join(" ") };
  }
  return { computo, valido: true, motivo: null };
}

export async function computoValido(sedeId: number, commessaId: number): Promise<boolean> {
  return (await ultimoComputo(sedeId, commessaId)).valido;
}
```

- [ ] **Step 8: Eseguire i test e verificare che passino**

Run: `pnpm vitest run server/computo && pnpm check`
Expected: PASS (il caso «senza contratto» lancia `NOT_FOUND: Contratto non trovato…`).

- [ ] **Step 9: Commit**

```bash
git add server/computo/repository.ts server/computo/repository.test.ts server/computo/repository.pg.test.ts server/computo/servizio.ts server/computo/servizio.test.ts
git commit -m "feat(computo): fotografie del computo con voci e validità per hash

Ogni esecuzione è una riga datata; l'ultimo computo è valido solo se
righe e parametri del contratto hanno ancora gli stessi hash ed esito ok.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Router tRPC `computo`

**Files:**
- Create: `server/routers/computo.ts`
- Modify: `server/routers.ts` (`computo: computoRouter,` dopo `contratti`)
- Test: `server/routers/computo.test.ts`

**Interfaces:**
- Produces: `computo.ultimo({ commessaId })` → `{ computo: Computo | null; valido: boolean; motivo: string | null; puoEseguire: boolean }`; `computo.esegui({ commessaId })` → `Computo`.

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// server/routers/computo.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { _resetComputiRepositoryForTests } from "../computo/repository";
import { creaCommessa } from "./commesse";
import { getClientiStore } from "./clienti";

function context(sedeId: number, userId: number, ruoli: string[]): TrpcContext {
  return {
    user: { id: userId, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "T" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}
const contratto = {
  pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null,
  comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18,
  detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
  detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale" as const, documentoId: null,
};
const riga = {
  categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null,
  descrizione: "Finestra", quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null,
  prezzoUnitCent: null, prezzoTotCent: 300000, beneSignificativo: true, accessori: [], note: null,
  origine: "manuale" as const, evidenza: null,
};
async function commessaDiProva(sedeId = 1): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9301 + clienti.length, sedeId, nome: "E", cognome: "B", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(context(sedeId, 1, ["direzione"]), { clienteId: cliente.id } as any);
  return (c as any).commessa?.id ?? (c as any).id;
}

describe("router computo", () => {
  beforeEach(() => {
    _resetContrattiRepositoryForTests();
    _resetComputiRepositoryForTests();
  });

  it("il commerciale esegue e rilegge; la squadra di posa legge soltanto", async () => {
    const commessaId = await commessaDiProva();
    const commerciale = appRouter.createCaller(context(1, 21, ["commerciale"]));
    await commerciale.contratti.salva({ commessaId, contratto, righe: [riga] });
    const prima = await commerciale.computo.ultimo({ commessaId });
    expect(prima.computo).toBeNull();
    expect(prima.puoEseguire).toBe(true);
    const computo = await commerciale.computo.esegui({ commessaId });
    expect(computo.esito).toBe("ok");
    const posa = appRouter.createCaller(context(1, 22, ["squadra_posa"]));
    const letto = await posa.computo.ultimo({ commessaId });
    expect(letto.valido).toBe(true);
    expect(letto.puoEseguire).toBe(false);
    await expect(posa.computo.esegui({ commessaId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("senza contratto: PRECONDITION_FAILED; altra sede: NOT_FOUND", async () => {
    const commessaId = await commessaDiProva();
    const caller = appRouter.createCaller(context(1, 23, ["direzione"]));
    await expect(caller.computo.esegui({ commessaId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const altra = appRouter.createCaller(context(2, 24, ["direzione"]));
    await expect(altra.computo.ultimo({ commessaId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/routers/computo.test.ts`
Expected: FAIL — `appRouter.computo` non esiste.

- [ ] **Step 3: Scrivere il router e registrarlo**

```ts
// server/routers/computo.ts
// Computo limiti della commessa: lettura per chi legge il contratto,
// esecuzione per chi lo gestisce. Dietro FLAG_LIMITI; sede isolata.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedureConInterruttore, router } from "../_core/trpc";
import { authorizeCoreOperation, effectiveCapabilitySet } from "../authz/enforcement";
import { eseguiComputo, ultimoComputo } from "../computo/servizio";
import { getCommessaById } from "./commesse";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("limiti");

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

function commessaInSede(commessaId: number, sedeId: number): void {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata." });
  }
}

export const computoRouter = router({
  ultimo: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx, endpoint: "computo.ultimo", capability: "contratto.read",
        resourceType: "computo", resource: { sedeId }, legacyAllowed: "capability",
      });
      const caps = await effectiveCapabilitySet(ctx, ["computo.run"]);
      const stato = await ultimoComputo(sedeId, input.commessaId);
      return { ...stato, puoEseguire: caps.has("computo.run") };
    }),

  esegui: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx, endpoint: "computo.esegui", capability: "computo.run",
        resourceType: "computo", resource: { sedeId }, legacyAllowed: "capability",
      });
      try {
        return await eseguiComputo({ sedeId, commessaId: input.commessaId, actorUserId: ctx.user?.id ?? null });
      } catch (errore: any) {
        const messaggio = String(errore?.message ?? "");
        if (messaggio.startsWith("NOT_FOUND: Contratto")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Prima serve il contratto: inserisci o leggi le righe." });
        }
        if (messaggio.startsWith("NOT_FOUND: ")) {
          throw new TRPCError({ code: "NOT_FOUND", message: messaggio.slice("NOT_FOUND: ".length) });
        }
        if (messaggio.startsWith("TARIFFE_NON_DISPONIBILI")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tariffe non disponibili per la data del contratto." });
        }
        throw errore;
      }
    }),
});
```

In `server/routers.ts`: `import { computoRouter } from "./routers/computo";` e `computo: computoRouter,` dopo `contratti: contrattiRouter,`.

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `pnpm vitest run server/routers/computo.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/computo.ts server/routers/computo.test.ts server/routers.ts
git commit -m "feat(computo): router tRPC ultimo/esegui dietro FLAG_LIMITI

Senza contratto l'esecuzione risponde PRECONDITION_FAILED con l'azione da
fare, non un errore generico.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Gate «computo valido» sulla transizione verso «Fatture pagamento»

**Files:**
- Modify: `server/commesse/transizioni.ts`
- Modify: `server/routers/commesse.ts` (`dipendenzeTransizioniCommesse`)
- Test: `server/commesse/transizioni.computo.test.ts`

**Interfaces:**
- Consumes: `computoValido(sedeId, commessaId): Promise<boolean>` (Task 10); `interruttoreAttivo("limiti")` (Task 1).
- Produces: `DipendenzeTransizioneCommessa.computoValido?: (commessaId: number) => Promise<boolean> | boolean`; `verificaTransizioneCommessa({ …, computoValido?: boolean | null })` con `gate.computo: { richiesto: boolean; valido: boolean | null }`; `RegistroTransizione.gateScavalcato: "documentale" | "computo" | null`. Il messaggio d'errore conserva il prefisso `DOC_GATE_BLOCKED:` così Board e Timeline riusano il dialog «Procedi comunque» senza modifiche.

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// server/commesse/transizioni.computo.test.ts
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import {
  eseguiTransizioneCommessa,
  storeTransizioniCommessa,
  verificaTransizioneCommessa,
} from "./transizioni";

const SEDE = 98501;
function ctx(): TrpcContext {
  return {
    user: { id: 98511, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}
function commessa(stato = "aggiornamento_contratto") {
  return { id: 98531, sedeId: SEDE, stato, updatedAt: new Date("2026-09-01T10:00:00Z"), dataConsegnaConfermata: null, dataChiusura: null } as any;
}
function dipendenze(c: any, computoValido: boolean) {
  return {
    trovaCommessa: (id: number) => (id === c.id ? c : null),
    eseguiStatoEAuditAtomico: async (operazione: any) => operazione(async () => {}),
    haDocumentoRichiesto: () => true,
    documentiRichiesti: () => [],
    etichettaDocumento: (tipo: string) => tipo,
    allineaTimeline: async () => {},
    computoValido: async () => computoValido,
    ora: () => new Date("2026-09-03T12:00:00.000Z"),
  };
}

describe("gate computo sulla transizione aggiornamento_contratto → fatture_pagamento", () => {
  it("la verifica blocca solo quel passaggio in avanti e solo con computo non valido", () => {
    const base = { commessa: commessa(), haDocumentoRichiesto: () => true, documentiRichiesti: () => [] as string[] };
    const bloccata = verificaTransizioneCommessa({ ...base, nuovoStato: "fatture_pagamento", computoValido: false });
    expect(bloccata.consentita).toBe(false);
    expect(bloccata.gate.bloccante).toBe(true);
    expect(bloccata.gate.computo).toEqual({ richiesto: true, valido: false });
    expect(bloccata.motivo).toMatch(/computo/i);
    const ok = verificaTransizioneCommessa({ ...base, nuovoStato: "fatture_pagamento", computoValido: true });
    expect(ok.consentita).toBe(true);
    const indietro = verificaTransizioneCommessa({ ...base, nuovoStato: "misure_esecutive", computoValido: false });
    expect(indietro.consentita).toBe(true);
    expect(indietro.gate.computo.richiesto).toBe(false);
    const sconosciuto = verificaTransizioneCommessa({ ...base, nuovoStato: "fatture_pagamento" });
    expect(sconosciuto.gate.computo).toEqual({ richiesto: true, valido: null });
    expect(sconosciuto.consentita).toBe(true);
  });

  it("l'esecuzione rifiuta con DOC_GATE_BLOCKED e testo sul computo; lo scavalco viene registrato", async () => {
    const c = commessa();
    await expect(
      eseguiTransizioneCommessa({ ctx: ctx(), commessaId: c.id, nuovoStato: "fatture_pagamento", origine: "router" }, dipendenze(c, false))
    ).rejects.toThrow(/^DOC_GATE_BLOCKED: .*computo dei limiti/i);
    expect(c.stato).toBe("aggiornamento_contratto");
    const esito = await eseguiTransizioneCommessa(
      { ctx: ctx(), commessaId: c.id, nuovoStato: "fatture_pagamento", origine: "router", bypassGateDocumentale: true },
      dipendenze(c, false)
    );
    expect(esito.a).toBe("fatture_pagamento");
    const registro = storeTransizioniCommessa.items.find(r => r.id === esito.transizioneId);
    expect(registro?.bypassGateDocumentale).toBe(true);
    expect((registro as any)?.gateScavalcato).toBe("computo");
  });

  it("con computo valido passa senza scavalco", async () => {
    const c = commessa();
    const esito = await eseguiTransizioneCommessa(
      { ctx: ctx(), commessaId: c.id, nuovoStato: "fatture_pagamento", origine: "router" },
      dipendenze(c, true)
    );
    const registro = storeTransizioniCommessa.items.find(r => r.id === esito.transizioneId);
    expect((registro as any)?.gateScavalcato).toBeNull();
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/commesse/transizioni.computo.test.ts`
Expected: FAIL — `gate.computo` è `undefined`; nessun blocco.

- [ ] **Step 3: Estendere `server/commesse/transizioni.ts`**

1. Nel tipo `RegistroTransizione` aggiungere `gateScavalcato: "documentale" | "computo" | null;` e nel callback di `persistedStore` il backfill:
   ```ts
   if ((riga as any).gateScavalcato === undefined) {
     (riga as any).gateScavalcato = null;
   }
   ```
2. In `DipendenzeTransizioneCommessa` aggiungere:
   ```ts
     /**
      * Gate computo limiti (03/09/2026): true se l'ultimo computo copre le
      * righe e i parametri correnti del contratto. Assente = gate non
      * attivo (flag spento o dipendenze legacy).
      */
     computoValido?: (commessaId: number) => Promise<boolean> | boolean;
   ```
3. In `VerificaTransizioneCommessa.gate` aggiungere `computo: { richiesto: boolean; valido: boolean | null };`.
4. In `verificaTransizioneCommessa` aggiungere all'input `computoValido?: boolean | null;` e, subito dopo il calcolo di `gateSoddisfatto`:
   ```ts
     // Gate computo: vale SOLO per il passo in avanti da «Aggiornamento
     // contratto» a «Fatture pagamento». null = non verificato (flag spento,
     // lettura senza dipendenza): non blocca, ma la UI lo mostra come ignoto.
     const computoRichiesto =
       commessa.stato === "aggiornamento_contratto" &&
       input.nuovoStato === "fatture_pagamento";
     const computoValido = computoRichiesto ? (input.computoValido ?? null) : null;
     const computoBloccante = computoRichiesto && computoValido === false;
     const gateComputo = { richiesto: computoRichiesto, valido: computoValido };
   ```
   Ogni `return` che costruisce `gate: { richiesti, soddisfatto, bloccante }` aggiunge `computo: gateComputo`. Nel ramo finale:
   ```ts
     const gateBloccante = (avanti && richiesti.length > 0 && !gateSoddisfatto) || computoBloccante;
     …
     motivo: gateBloccante
       ? [
           avanti && richiesti.length > 0 && !gateSoddisfatto ? `Manca ${richiesti.join(" o ")}.` : null,
           computoBloccante ? "Il computo dei limiti non è aggiornato: ricalcolalo dalla tab Limiti." : null,
         ].filter(Boolean).join(" ")
       : null,
   ```
   Nei rami «nessuno stato» e «stesso stato» `bloccante` resta com'è (il computo non si valuta senza uno stato di arrivo).
5. In `applicaTransizioneCommessa`, prima di `const verifica = verificaTransizioneCommessa({…})`:
   ```ts
     const computoOk =
       dipendenze.computoValido &&
       commessa.stato === "aggiornamento_contratto" &&
       input.nuovoStato === "fatture_pagamento"
         ? await dipendenze.computoValido(commessa.id)
         : null;
   ```
   e passare `computoValido: computoOk` alla verifica. Nel ramo `else if (verifica.gate.bloccante)` costruire il messaggio:
   ```ts
       const soloComputo = verifica.gate.computo.valido === false && (verifica.gate.richiesti.length === 0 || dipendenze.haDocumentoRichiesto(commessa.id, commessa.stato));
       const labels = verifica.gate.richiesti.map(tipo => dipendenze.etichettaDocumento(tipo)).join(" o ");
       throw new Error(
         soloComputo
           ? `DOC_GATE_BLOCKED: Il computo dei limiti non è aggiornato per lo stato "${commessa.stato.replace(/_/g, " ")}". Procedere comunque?`
           : `DOC_GATE_BLOCKED: Non è stato caricato il file "${labels}" per lo stato "${commessa.stato.replace(/_/g, " ")}". Procedere comunque?`
       );
   ```
6. Dove viene creato il record del registro (`bypassGateDocumentale: Boolean(input.bypassGateDocumentale),`) aggiungere:
   ```ts
       gateScavalcato:
         verifica.gate.bloccante && input.bypassGateDocumentale
           ? verifica.gate.computo.valido === false ? "computo" : "documentale"
           : null,
   ```
   (se `verifica` non è in scope in quel punto, conservarla in una variabile prima dell'`Object.assign`).
7. `grep -n "verificaTransizioneCommessa(" server/` — negli altri chiamanti (router `commesse`, `server/tars/fascicoli.ts`) non passare `computoValido`: restano su `null` («non verificato»). Dove il router espone la verifica alla UI, se esiste una procedura di verifica esplicita, passare `computoValido: await dipendenze.computoValido?.(id) ?? null` così il board sa in anticipo.

- [ ] **Step 4: Collegare la dipendenza reale in `server/routers/commesse.ts`**

Dentro `dipendenzeTransizioniCommesse()` aggiungere:

```ts
    computoValido: async commessaId => {
      const { interruttoreAttivo } = await import("../platform/interruttori");
      if (!interruttoreAttivo("limiti")) return true;
      const commessa: any = getCommessaById(commessaId);
      if (!commessa) return false;
      // Import dinamico: computo → contratti → routers/commesse è un ciclo.
      const { computoValido } = await import("../computo/servizio");
      return computoValido(commessa.sedeId ?? DEFAULT_SEDE_ID, commessaId);
    },
```

- [ ] **Step 5: Eseguire tutti i test delle transizioni e verificare che passino**

Run: `pnpm vitest run server/commesse server/routers/commesse.test.ts server/tars/t5Azioni.test.ts && pnpm check`
Expected: PASS — i test esistenti restano verdi (le loro dipendenze non hanno `computoValido` → `null` → nessun blocco).

- [ ] **Step 6: Commit**

```bash
git add server/commesse/transizioni.ts server/commesse/transizioni.computo.test.ts server/routers/commesse.ts
git commit -m "feat(commesse): gate computo limiti verso «Fatture pagamento»

Stesso dialog «Procedi comunque» dei gate documentali, stesso prefisso
d'errore; lo scavalco è registrato come gateScavalcato=computo. Flag
spento o dipendenza assente = gate non valutato, mai bloccante.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Tab «Contratto» nella pagina commessa

**Files:**
- Create: `client/src/lib/contrattoView.ts`
- Create: `client/src/components/contratto/ContrattoTab.tsx`
- Modify: `server/routers/contratti.ts` (`get` restituisce anche `catalogo`)
- Modify: `client/src/pages/CommessaDetail.tsx` (tab «Prodotti» → «Contratto», wiring)
- Test: `client/src/lib/contrattoView.test.ts`

**Interfaces:**
- Consumes: `contratti.get`, `contratti.salva` (Task 7); `formatEuro`, `parseEuroNonNegativo` da `client/src/lib/euro.ts`; `useOperationalContext().capabilities`; `platform.interruttori`.
- Produces (`contrattoView.ts`):
  ```ts
  type RigaForm = RigaContrattoInput & { chiave: string };
  rigaVuota(categoria?: CategoriaRiga): RigaForm;
  mqRigaForm(r: Pick<RigaForm, "quantita" | "larghezzaMm" | "altezzaMm">): number;   // stessa formula del server
  totaleRigheCent(righe: ReadonlyArray<Pick<RigaForm, "prezzoTotCent">>): number;
  etichettaCategoria(c: CategoriaRiga): string; etichettaTipologia(t: string | null): string;
  rateDefault(): RataContratto[];   // 50/40/10 all'ordine, merce pronta, posa ultimata
  riepilogoContratto(c: Pick<Contratto, "pattuitoCent" | "pattuitoTipo" | "zonaClimatica"> | null, nRighe: number): string;
  erroriForm(parametri: ContrattoInput, righe: ReadonlyArray<RigaForm>): string[];
  rigaDaLegacy(p: RigaLegacy): RigaForm;
  ```
- `contratti.get` aggiunge `catalogo: { accessori: Array<{ codice: string; descrizione: string; unita: string }>; controtelai: Array<{ codice: string; famiglia: string; variante: string; unita: string }> }` letto dalle tariffe.

- [ ] **Step 1: Scrivere i test di presentazione che falliscono**

```ts
// client/src/lib/contrattoView.test.ts
import { describe, expect, it } from "vitest";
import {
  erroriForm,
  etichettaCategoria,
  mqRigaForm,
  rateDefault,
  riepilogoContratto,
  rigaDaLegacy,
  rigaVuota,
  totaleRigheCent,
} from "./contrattoView";

describe("contrattoView", () => {
  it("una riga nuova è un serramento PVC, bene significativo, senza misure", () => {
    const r = rigaVuota();
    expect(r.categoria).toBe("serramento_pvc");
    expect(r.beneSignificativo).toBe(true);
    expect(r.quantita).toBe(1);
    expect(r.chiave).toMatch(/^r-/);
  });
  it("mq e totali come il server", () => {
    expect(mqRigaForm({ quantita: 3, larghezzaMm: 1900, altezzaMm: 2400 })).toBe(13.68);
    expect(totaleRigheCent([{ prezzoTotCent: 500000 }, { prezzoTotCent: null }, { prezzoTotCent: 324746 }])).toBe(824746);
  });
  it("etichette leggibili e rate 50/40/10", () => {
    expect(etichettaCategoria("serramento_legno_alluminio")).toBe("Serramento legno-alluminio");
    expect(rateDefault().map(r => r.quotaPct)).toEqual([50, 40, 10]);
    expect(rateDefault().reduce((s, r) => s + r.quotaPct, 0)).toBe(100);
  });
  it("il riepilogo per il banner", () => {
    expect(riepilogoContratto({ pattuitoCent: 1539500, pattuitoTipo: "lordo", zonaClimatica: "D" }, 6)).toBe("6 righe · pattuito € 15.395,00 lordo · zona D");
    expect(riepilogoContratto(null, 0)).toBe("Contratto non ancora inserito");
  });
  it("gli errori del form anticipano quelli del server", () => {
    const parametri = { pattuitoCent: 0, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null, comuneCantiere: null, zonaManuale: true, zonaClimatica: null, piano: null, distanzaKm: null, detrazioneTipo: "nessuna" as const, detrazioneImmobile: null, detrazionePct: null, dataFirma: null, rate: [{ numero: 1, quotaPct: 60, giorni: 0, data: null, descrizione: null }], origine: "manuale" as const, documentoId: null };
    const errori = erroriForm(parametri, [{ ...rigaVuota(), descrizione: "" }]);
    expect(errori).toEqual(expect.arrayContaining([
      expect.stringMatching(/pattuito/i),
      expect.stringMatching(/zona/i),
      expect.stringMatching(/rate/i),
      expect.stringMatching(/descrizione/i),
    ]));
  });
  it("un prodotto legacy diventa una riga da completare", () => {
    const r = rigaDaLegacy({ id: 3, nome: "Finestra cucina", tipologia: "PVC", quantita: 2, dimensioni: "120x140", note: null });
    expect(r.descrizione).toBe("Finestra cucina");
    expect(r.quantita).toBe(2);
    expect(r.origine).toBe("prodotto_legacy");
    expect(r.note).toBe("120x140");
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `pnpm vitest run client/src/lib/contrattoView.test.ts`
Expected: FAIL — `./contrattoView` non esiste.

- [ ] **Step 3: Scrivere `client/src/lib/contrattoView.ts`**

```ts
// client/src/lib/contrattoView.ts
// Presentazione pura della tab Contratto: forme vuote, formule di
// visualizzazione (mq, totali), etichette, validazione anticipata. Nessun
// React, nessuna chiamata: testabile a tavolino. La regola vera resta nel
// servizio server; qui si evita solo di mandare un form che verrà rifiutato.
import type {
  CategoriaRiga,
  Contratto,
  ContrattoInput,
  RataContratto,
  RigaContrattoInput,
} from "@shared/limiti/tipi";
import { formatEuro } from "./euro";

export type RigaForm = RigaContrattoInput & { chiave: string };
export type RigaLegacy = {
  id: number;
  nome: string;
  tipologia: string | null;
  quantita: number;
  dimensioni: string | null;
  note: string | null;
};

let contatore = 0;
const nuovaChiave = () => `r-${Date.now().toString(36)}-${(contatore++).toString(36)}`;

export function rigaVuota(categoria: CategoriaRiga = "serramento_pvc"): RigaForm {
  return {
    chiave: nuovaChiave(),
    categoria,
    tipologia: null,
    oscuranteIntegrato: null,
    descrizione: "",
    quantita: 1,
    larghezzaMm: null,
    altezzaMm: null,
    misuraDei: null,
    prezzoUnitCent: null,
    prezzoTotCent: null,
    beneSignificativo: categoria !== "controtelaio" && categoria !== "altro",
    accessori: [],
    note: null,
    origine: "manuale",
    evidenza: null,
  };
}

export function mqRigaForm(r: {
  quantita: number;
  larghezzaMm: number | null;
  altezzaMm: number | null;
}): number {
  if (r.larghezzaMm == null || r.altezzaMm == null) return 0;
  return Math.round((r.larghezzaMm * r.altezzaMm * r.quantita) / 1_000_000 * 1000) / 1000;
}

export function totaleRigheCent(
  righe: ReadonlyArray<{ prezzoTotCent: number | null }>
): number {
  return righe.reduce((s, r) => s + (r.prezzoTotCent ?? 0), 0);
}

const CATEGORIE: Record<CategoriaRiga, string> = {
  serramento_pvc: "Serramento PVC",
  serramento_alluminio: "Serramento alluminio",
  serramento_legno: "Serramento legno",
  serramento_legno_alluminio: "Serramento legno-alluminio",
  cassonetto: "Cassonetto",
  tapparella: "Tapparella",
  persiana: "Persiana",
  scuro: "Scuro",
  schermatura: "Schermatura solare",
  zanzariera: "Zanzariera",
  tenda: "Tenda da sole",
  pergola: "Pergola",
  porta_blindata: "Porta blindata",
  portoncino: "Portoncino",
  porta_interna: "Porta interna",
  controtelaio: "Controtelaio",
  accessorio: "Accessorio",
  altro: "Altro",
};
export function etichettaCategoria(c: CategoriaRiga): string {
  return CATEGORIE[c] ?? c;
}

const TIPOLOGIE: Record<string, string> = {
  fisso: "Fisso",
  finestra_1_anta: "Finestra 1 anta",
  finestra_2_ante: "Finestra 2 ante",
  portafinestra_1_anta: "Portafinestra 1 anta",
  portafinestra_2_ante: "Portafinestra 2 ante",
  scorrevole_complanare_finestra: "Scorrevole complanare (finestra)",
  scorrevole_complanare_portafinestra: "Scorrevole complanare (portafinestra)",
  scorrevole_alzante: "Scorrevole alzante",
};
export function etichettaTipologia(t: string | null): string {
  if (!t) return "—";
  return TIPOLOGIE[t] ?? t;
}

export function rateDefault(): RataContratto[] {
  return [
    { numero: 1, quotaPct: 50, giorni: 0, data: null, descrizione: "All'ordine" },
    { numero: 2, quotaPct: 40, giorni: 60, data: null, descrizione: "Arrivo merce pronta" },
    { numero: 3, quotaPct: 10, giorni: 75, data: null, descrizione: "Posa in opera ultimata" },
  ];
}

export function riepilogoContratto(
  c: Pick<Contratto, "pattuitoCent" | "pattuitoTipo" | "zonaClimatica"> | null,
  nRighe: number
): string {
  if (!c) return "Contratto non ancora inserito";
  const parti = [
    `${nRighe} ${nRighe === 1 ? "riga" : "righe"}`,
    `pattuito € ${formatEuro(c.pattuitoCent / 100)} ${c.pattuitoTipo}`,
  ];
  if (c.zonaClimatica) parti.push(`zona ${c.zonaClimatica}`);
  return parti.join(" · ");
}

export function erroriForm(
  parametri: ContrattoInput,
  righe: ReadonlyArray<RigaForm>
): string[] {
  const errori: string[] = [];
  if (!(parametri.pattuitoCent > 0)) errori.push("Il pattuito deve essere maggiore di zero.");
  if (parametri.zonaManuale && !parametri.zonaClimatica) errori.push("Zona manuale: indica la zona climatica.");
  if (parametri.rate.length > 0) {
    const somma = parametri.rate.reduce((s, r) => s + r.quotaPct, 0);
    if (Math.abs(somma - 100) > 0.01) errori.push(`Le rate sommano al ${somma}%: devono fare 100%.`);
  }
  righe.forEach((r, i) => {
    if (!r.descrizione.trim()) errori.push(`Riga ${i + 1}: descrizione mancante.`);
    if (r.quantita < 1) errori.push(`Riga ${i + 1}: quantità non valida.`);
    if ((r.larghezzaMm == null) !== (r.altezzaMm == null)) errori.push(`Riga ${i + 1}: indica sia larghezza sia altezza.`);
  });
  return errori;
}

export function rigaDaLegacy(p: RigaLegacy): RigaForm {
  return {
    ...rigaVuota("altro"),
    descrizione: p.nome,
    tipologia: p.tipologia,
    quantita: Math.max(1, p.quantita),
    note: [p.dimensioni, p.note].filter(Boolean).join(" · ") || null,
    origine: "prodotto_legacy",
  };
}
```

- [ ] **Step 4: Eseguire i test di presentazione e verificare che passino**

Run: `pnpm vitest run client/src/lib/contrattoView.test.ts`
Expected: PASS.

- [ ] **Step 5: Estendere `contratti.get` con il catalogo**

In `server/routers/contratti.ts`, in `get`, dopo `leggiContratto`:

```ts
      const tariffe = tariffeAttive();
      return {
        ...letto,
        puoModificare: caps.has("contratto.manage"),
        catalogo: {
          accessori: tariffe.accessori.map(a => ({ codice: a.codice, descrizione: a.descrizione, unita: a.unita })),
          controtelai: tariffe.controtelai.map(c => ({ codice: c.codice, famiglia: c.famiglia, variante: c.variante, unita: c.unita })),
        },
      };
```

con `import { tariffeAttive } from "../computo/tariffe";`. In `server/routers/contratti.test.ts` aggiungere nell'asserzione di lettura: `expect(letto.catalogo.accessori.length).toBeGreaterThan(5);`.

Run: `pnpm vitest run server/routers/contratti.test.ts` → PASS.

- [ ] **Step 6: Scrivere `client/src/components/contratto/ContrattoTab.tsx`**

```tsx
// client/src/components/contratto/ContrattoTab.tsx
// Tab «Contratto» della commessa: parametri del contratto e righe strutturate.
// Sostituisce la tab «Prodotti»: i prodotti legacy restano visibili come
// righe «da completare». Salvataggio esplicito; il server ricalcola mq,
// zona, hash e specchia il pattuito sulla card Pagamenti.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatEuro, parseEuroNonNegativo } from "@/lib/euro";
import {
  erroriForm,
  etichettaCategoria,
  etichettaTipologia,
  mqRigaForm,
  rateDefault,
  rigaDaLegacy,
  rigaVuota,
  totaleRigheCent,
  type RigaForm,
} from "@/lib/contrattoView";
import {
  CATEGORIE_RIGA,
  DETRAZIONE_TIPI,
  OSCURANTI_INTEGRATI,
  TIPOLOGIE_SERRAMENTO,
  ZONE_CLIMATICHE,
  type ContrattoInput,
} from "@shared/limiti/tipi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Save, Trash2 } from "lucide-react";

const SERRAMENTI = new Set(["serramento_pvc", "serramento_alluminio", "serramento_legno", "serramento_legno_alluminio"]);

function parametriVuoti(): ContrattoInput {
  return {
    pattuitoCent: 0, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null, comuneCantiere: null,
    zonaClimatica: null, zonaManuale: false, piano: null, distanzaKm: null, detrazioneTipo: "nessuna",
    detrazioneImmobile: null, detrazionePct: null, dataFirma: null, rate: rateDefault(),
    origine: "manuale", documentoId: null,
  };
}

export default function ContrattoTab({ commessaId }: { commessaId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.contratti.get.useQuery({ commessaId }, { retry: false });
  const [parametri, setParametri] = useState<ContrattoInput>(parametriVuoti);
  const [righe, setRighe] = useState<RigaForm[]>([]);
  const [pattuitoTesto, setPattuitoTesto] = useState("");
  const [sporco, setSporco] = useState(false);

  // Il form si allinea al server finché l'operatore non tocca qualcosa.
  useEffect(() => {
    if (!q.data || sporco) return;
    const c = q.data.contratto;
    if (c) {
      const { commessaId: _c, sedeId: _s, hashRighe: _h, hashParametri: _p, codiceIstat: _i, createdBy: _cb, updatedBy: _ub, createdAt: _ca, updatedAt: _ua, ...resto } = c as any;
      setParametri({ ...parametriVuoti(), ...resto });
      setPattuitoTesto(formatEuro(c.pattuitoCent / 100));
    }
    setRighe(q.data.righe.map(r => ({ ...r, chiave: `r-${r.id}` })));
  }, [q.data, sporco]);

  const salva = trpc.contratti.salva.useMutation({
    onSuccess: esito => {
      setSporco(false);
      utils.contratti.get.invalidate({ commessaId });
      utils.computo.ultimo.invalidate({ commessaId });
      utils.commesse.invalidate();
      toast.success("Contratto salvato");
      esito.avvertenze.forEach(a => toast.warning(a));
    },
    onError: e => toast.error(e.message),
  });

  const errori = useMemo(() => erroriForm(parametri, righe), [parametri, righe]);
  const totale = totaleRigheCent(righe);
  const puoModificare = q.data?.puoModificare ?? false;

  const aggiornaRiga = (chiave: string, patch: Partial<RigaForm>) => {
    setSporco(true);
    setRighe(prev => prev.map(r => (r.chiave === chiave ? { ...r, ...patch } : r)));
  };
  const aggiornaParametri = (patch: Partial<ContrattoInput>) => {
    setSporco(true);
    setParametri(prev => ({ ...prev, ...patch }));
  };

  if (q.isLoading) return <p className="text-sm text-muted-foreground py-6">Caricamento contratto…</p>;
  if (q.error) return <p className="text-sm text-danger py-6">{q.error.message}</p>;

  return (
    <div className="space-y-4 mt-4 min-w-0">
      {/* Parametri */}
      <section aria-label="Parametri del contratto" className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="pattuito" className="text-xs text-text-3">Pattuito €</Label>
          <Input id="pattuito" inputMode="decimal" value={pattuitoTesto} disabled={!puoModificare}
            onChange={e => {
              setPattuitoTesto(e.target.value);
              const n = parseEuroNonNegativo(e.target.value);
              if (n != null) aggiornaParametri({ pattuitoCent: Math.round(n * 100) });
            }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Il pattuito è</Label>
          <Select value={parametri.pattuitoTipo} disabled={!puoModificare} onValueChange={v => aggiornaParametri({ pattuitoTipo: v as any })}>
            <SelectTrigger aria-label="Tipo di pattuito"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lordo">Lordo, IVA inclusa</SelectItem>
              <SelectItem value="imponibile">Imponibile, IVA esclusa</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="comune" className="text-xs text-text-3">Comune del cantiere</Label>
          <Input id="comune" value={parametri.comuneCantiere ?? ""} disabled={!puoModificare} onChange={e => aggiornaParametri({ comuneCantiere: e.target.value || null })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Zona climatica</Label>
          <div className="flex items-center gap-2 h-9">
            {parametri.zonaManuale ? (
              <Select value={parametri.zonaClimatica ?? ""} disabled={!puoModificare} onValueChange={v => aggiornaParametri({ zonaClimatica: v as any })}>
                <SelectTrigger aria-label="Zona climatica" className="w-20"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{ZONE_CLIMATICHE.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Badge variant="outline">{q.data?.contratto?.zonaClimatica ?? "dal comune"}</Badge>
            )}
            <Label className="flex items-center gap-1 text-xs"><Switch checked={parametri.zonaManuale} disabled={!puoModificare} onCheckedChange={v => aggiornaParametri({ zonaManuale: v, zonaClimatica: v ? parametri.zonaClimatica : null })} aria-label="Zona a mano" /> a mano</Label>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="piano" className="text-xs text-text-3">Piano</Label>
          <Input id="piano" type="number" value={parametri.piano ?? ""} disabled={!puoModificare} onChange={e => aggiornaParametri({ piano: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="km" className="text-xs text-text-3">Distanza dal magazzino (km)</Label>
          <Input id="km" type="number" step="0.5" value={parametri.distanzaKm ?? ""} disabled={!puoModificare} onChange={e => aggiornaParametri({ distanzaKm: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Detrazione</Label>
          <Select value={parametri.detrazioneTipo} disabled={!puoModificare} onValueChange={v => aggiornaParametri({ detrazioneTipo: v as any, detrazioneImmobile: v === "nessuna" ? null : (parametri.detrazioneImmobile ?? "prima_casa") })}>
            <SelectTrigger aria-label="Tipo di detrazione"><SelectValue /></SelectTrigger>
            <SelectContent>{DETRAZIONE_TIPI.map(t => <SelectItem key={t} value={t}>{t === "nessuna" ? "Nessuna" : t === "ecobonus" ? "Ecobonus" : "Ristrutturazione"}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Immobile</Label>
          <Select value={parametri.detrazioneImmobile ?? ""} disabled={!puoModificare || parametri.detrazioneTipo === "nessuna"} onValueChange={v => aggiornaParametri({ detrazioneImmobile: v as any })}>
            <SelectTrigger aria-label="Tipo di immobile"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prima_casa">Prima casa</SelectItem>
              <SelectItem value="altro">Altro immobile</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="firma" className="text-xs text-text-3">Data firma</Label>
          <Input id="firma" type="date" value={parametri.dataFirma ?? ""} disabled={!puoModificare} onChange={e => aggiornaParametri({ dataFirma: e.target.value || null })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-3">Posa</Label>
          <Label className="flex items-center gap-2 h-9 text-sm"><Switch checked={parametri.posaInclusa} disabled={!puoModificare} onCheckedChange={v => aggiornaParametri({ posaInclusa: v })} aria-label="Posa inclusa" /> inclusa nel prezzo</Label>
        </div>
      </section>

      {/* Rate */}
      <section aria-label="Piano rate del contratto" className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Rate</span>
          <span className="text-xs text-muted-foreground">{parametri.rate.reduce((s, r) => s + r.quotaPct, 0)}% del pattuito</span>
          {puoModificare && (
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => aggiornaParametri({ rate: [...parametri.rate, { numero: parametri.rate.length + 1, quotaPct: 0, giorni: 0, data: null, descrizione: null }] })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Rata
            </Button>
          )}
        </div>
        {parametri.rate.map((rata, i) => (
          <div key={rata.numero} className="grid grid-cols-[3rem_5rem_5rem_1fr_2rem] gap-2 items-center text-sm">
            <span className="tabular-nums">{rata.numero}ª</span>
            <Input inputMode="decimal" aria-label={`Quota rata ${rata.numero}`} value={rata.quotaPct} disabled={!puoModificare} onChange={e => aggiornaParametri({ rate: parametri.rate.map((r, j) => (j === i ? { ...r, quotaPct: Number(e.target.value) || 0 } : r)) })} />
            <Input type="number" aria-label={`Giorni rata ${rata.numero}`} value={rata.giorni ?? ""} disabled={!puoModificare} onChange={e => aggiornaParametri({ rate: parametri.rate.map((r, j) => (j === i ? { ...r, giorni: e.target.value === "" ? null : Number(e.target.value) } : r)) })} />
            <Input aria-label={`Descrizione rata ${rata.numero}`} value={rata.descrizione ?? ""} disabled={!puoModificare} onChange={e => aggiornaParametri({ rate: parametri.rate.map((r, j) => (j === i ? { ...r, descrizione: e.target.value || null } : r)) })} />
            {puoModificare && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-danger" aria-label={`Rimuovi rata ${rata.numero}`} onClick={() => aggiornaParametri({ rate: parametri.rate.filter((_, j) => j !== i).map((r, j) => ({ ...r, numero: j + 1 })) })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </section>

      {/* Righe */}
      <section aria-label="Righe del contratto" className="space-y-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">Righe ({righe.length})</span>
          <span className="text-xs text-muted-foreground">beni € {formatEuro(totale / 100)}</span>
          {puoModificare && (
            <Button size="sm" className="ml-auto h-7" onClick={() => { setSporco(true); setRighe(prev => [...prev, rigaVuota()]); }}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Riga
            </Button>
          )}
        </div>
        {righe.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">Nessuna riga — leggi il contratto caricato o aggiungi a mano.</p>
        )}
        <div className="space-y-2">
          {righe.map((r, i) => (
            <div key={r.chiave} className="rounded-lg border border-border p-2 grid gap-2 md:grid-cols-[2rem_9rem_10rem_1fr_4rem_5rem_5rem_4rem_6rem_2rem_2rem] items-center text-sm">
              <span className="tabular-nums text-muted-foreground">{i + 1}</span>
              <Select value={r.categoria} disabled={!puoModificare} onValueChange={v => aggiornaRiga(r.chiave, { categoria: v as any, tipologia: null, oscuranteIntegrato: null })}>
                <SelectTrigger aria-label={`Categoria riga ${i + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIE_RIGA.map(c => <SelectItem key={c} value={c}>{etichettaCategoria(c)}</SelectItem>)}</SelectContent>
              </Select>
              {SERRAMENTI.has(r.categoria) ? (
                <Select value={r.tipologia ?? ""} disabled={!puoModificare} onValueChange={v => aggiornaRiga(r.chiave, { tipologia: v })}>
                  <SelectTrigger aria-label={`Tipologia riga ${i + 1}`}><SelectValue placeholder="Tipologia" /></SelectTrigger>
                  <SelectContent>{TIPOLOGIE_SERRAMENTO.map(t => <SelectItem key={t} value={t}>{etichettaTipologia(t)}</SelectItem>)}</SelectContent>
                </Select>
              ) : r.categoria === "controtelaio" ? (
                <Select value={r.tipologia ?? ""} disabled={!puoModificare} onValueChange={v => aggiornaRiga(r.chiave, { tipologia: v })}>
                  <SelectTrigger aria-label={`Variante controtelaio riga ${i + 1}`}><SelectValue placeholder="Variante DEI" /></SelectTrigger>
                  <SelectContent>{(q.data?.catalogo.controtelai ?? []).map(c => <SelectItem key={c.codice} value={c.codice}>{c.famiglia} — {c.variante}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input aria-label={`Tipologia riga ${i + 1}`} placeholder="Tipologia" value={r.tipologia ?? ""} disabled={!puoModificare} onChange={e => aggiornaRiga(r.chiave, { tipologia: e.target.value || null })} />
              )}
              <Input aria-label={`Descrizione riga ${i + 1}`} placeholder="Descrizione" value={r.descrizione} disabled={!puoModificare} onChange={e => aggiornaRiga(r.chiave, { descrizione: e.target.value })} />
              <Input type="number" min={1} aria-label={`Quantità riga ${i + 1}`} value={r.quantita} disabled={!puoModificare} onChange={e => aggiornaRiga(r.chiave, { quantita: Math.max(1, Number(e.target.value) || 1) })} />
              <Input type="number" aria-label={`Larghezza mm riga ${i + 1}`} placeholder="L mm" value={r.larghezzaMm ?? ""} disabled={!puoModificare} onChange={e => aggiornaRiga(r.chiave, { larghezzaMm: e.target.value === "" ? null : Number(e.target.value) })} />
              <Input type="number" aria-label={`Altezza mm riga ${i + 1}`} placeholder="H mm" value={r.altezzaMm ?? ""} disabled={!puoModificare} onChange={e => aggiornaRiga(r.chiave, { altezzaMm: e.target.value === "" ? null : Number(e.target.value) })} />
              <span className="tabular-nums text-xs text-muted-foreground">{mqRigaForm(r).toFixed(2)} mq</span>
              <Input inputMode="decimal" aria-label={`Prezzo riga ${i + 1}`} placeholder="€" defaultValue={r.prezzoTotCent == null ? "" : formatEuro(r.prezzoTotCent / 100)} disabled={!puoModificare} onBlur={e => { const n = parseEuroNonNegativo(e.target.value); aggiornaRiga(r.chiave, { prezzoTotCent: n == null ? null : Math.round(n * 100) }); }} />
              <Switch checked={r.beneSignificativo} disabled={!puoModificare} aria-label={`Bene significativo riga ${i + 1}`} onCheckedChange={v => aggiornaRiga(r.chiave, { beneSignificativo: v })} />
              {puoModificare && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-danger" aria-label={`Rimuovi riga ${i + 1}`} onClick={() => { setSporco(true); setRighe(prev => prev.filter(x => x.chiave !== r.chiave)); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              {SERRAMENTI.has(r.categoria) && (
                <div className="md:col-span-full flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-muted-foreground">Oscurante integrato:</span>
                  <Select value={r.oscuranteIntegrato ?? "nessuno"} disabled={!puoModificare} onValueChange={v => aggiornaRiga(r.chiave, { oscuranteIntegrato: v === "nessuno" ? null : (v as any) })}>
                    <SelectTrigger aria-label={`Oscurante integrato riga ${i + 1}`} className="h-7 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nessuno">Nessuno</SelectItem>
                      {OSCURANTI_INTEGRATI.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">Accessori:</span>
                  {r.accessori.map(a => (
                    <Badge key={a.codice} variant="secondary" className="gap-1">
                      {a.codice} ×{a.quantita}
                      {puoModificare && <button type="button" aria-label={`Rimuovi ${a.codice}`} onClick={() => aggiornaRiga(r.chiave, { accessori: r.accessori.filter(x => x.codice !== a.codice) })}>×</button>}
                    </Badge>
                  ))}
                  {puoModificare && (
                    <Select value="" onValueChange={codice => aggiornaRiga(r.chiave, { accessori: [...r.accessori.filter(x => x.codice !== codice), { codice, quantita: r.quantita }] })}>
                      <SelectTrigger aria-label={`Aggiungi accessorio riga ${i + 1}`} className="h-7 w-44"><SelectValue placeholder="+ accessorio" /></SelectTrigger>
                      <SelectContent>{(q.data?.catalogo.accessori ?? []).map(a => <SelectItem key={a.codice} value={a.codice}>{a.descrizione}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
              )}
              {r.categoria === "controtelaio" && (
                <div className="md:col-span-full flex items-center gap-2 text-xs">
                  <Label htmlFor={`misura-${r.chiave}`} className="text-muted-foreground">Misura DEI (mq / m)</Label>
                  <Input id={`misura-${r.chiave}`} type="number" step="0.01" className="h-7 w-28" value={r.misuraDei ?? ""} disabled={!puoModificare} onChange={e => aggiornaRiga(r.chiave, { misuraDei: e.target.value === "" ? null : Number(e.target.value) })} />
                </div>
              )}
            </div>
          ))}
        </div>

        {(q.data?.righeLegacy.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Prodotti inseriti prima del contratto strutturato:</p>
            {q.data!.righeLegacy.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-sm rounded-md border border-dashed border-border px-2 py-1">
                <span className="truncate">{p.nome}</span>
                <Badge variant="outline" className="text-[10px]">x{p.quantita}</Badge>
                <Badge variant="outline" className="text-[10px] text-warning">misure mancanti</Badge>
                {puoModificare && (
                  <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => { setSporco(true); setRighe(prev => [...prev, rigaDaLegacy(p)]); }}>
                    Converti in riga
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {errori.length > 0 && sporco && (
        <ul className="text-xs text-warning list-disc pl-4" aria-live="polite">
          {errori.map(e => <li key={e}>{e}</li>)}
        </ul>
      )}

      {puoModificare && (
        <div className="flex justify-end gap-2">
          <Button
            disabled={!sporco || errori.length > 0 || salva.isPending}
            onClick={() => salva.mutate({ commessaId, contratto: parametri, righe: righe.map(({ chiave: _k, ...resto }) => resto) })}
          >
            <Save className="h-4 w-4 mr-1" /> {salva.isPending ? "Salvataggio…" : "Salva contratto"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

Nota UI: la griglia è `md:grid-cols-[…]` sopra 768 px e si impila sotto (una colonna): nessun `min-width` che allarghi la pagina, ogni riga è una card su mobile. I `Select` shadcn senza valore vuoto: usare `value=""` con `placeholder` come sopra, oppure `value={x ?? undefined}` se la versione installata rifiuta la stringa vuota — verificare a runtime.

- [ ] **Step 7: Montare la tab in `client/src/pages/CommessaDetail.tsx`**

1. `import ContrattoTab from "@/components/contratto/ContrattoTab";`
2. Nella `TabsList` sostituire la trigger «Prodotti» con:
   ```tsx
   <TabsTrigger value="prodotti">
     {interruttori.data?.limiti ? "Contratto" : `Prodotti (${c.prodotti?.length ?? 0})`}
   </TabsTrigger>
   ```
   (`interruttori` è già la query `platform.interruttori` usata per Tars nella stessa pagina; se il tipo non conosce `limiti`, usare `(interruttori.data as any)?.limiti` finché il router `platform.interruttori` non espone il nuovo interruttore — verificare `statoInterruttori()` in `server/routers/platform.ts`: se restituisce `Record<Interruttore, boolean>` il campo c'è già).
3. Nel `TabsContent value="prodotti"`: con `interruttori.data?.limiti` renderizzare `<ContrattoTab commessaId={commessaId} />`, altrimenti il contenuto attuale (invariato).

- [ ] **Step 8: Verifica nel browser**

Run: `pnpm check && pnpm vitest run client/src/lib` → PASS. Poi avviare la demo (`preview_start` «Promo Capture (demo data)» con `FLAG_LIMITI=on` nell'env del launch, o `pnpm dev`), aprire una commessa, tab Contratto: inserire 2 righe con misure, pattuito 15.395 lordo, comune Sarzana, salvare → toast «Contratto salvato», badge zona «D», card Pagamenti con pattuito 15.395,00. Screenshot 1440×900 e 390×844 senza scroll orizzontale, console senza errori.

- [ ] **Step 9: Commit**

```bash
git add client/src/lib/contrattoView.ts client/src/lib/contrattoView.test.ts client/src/components/contratto/ContrattoTab.tsx client/src/pages/CommessaDetail.tsx server/routers/contratti.ts server/routers/contratti.test.ts
git commit -m "feat(contratti): tab Contratto nella commessa al posto di Prodotti

Parametri, rate e righe strutturate con misure, prezzo, bene significativo
e accessori; i prodotti legacy restano visibili come righe da completare.
Presentazione pura testata; il server resta l'unico confine.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Tab «Limiti», badge «da contratto» e riga di stato

**Files:**
- Create: `client/src/lib/limitiView.ts`
- Create: `client/src/components/computo/LimitiTab.tsx`
- Create: `client/src/components/contratto/ContrattoStatoBanner.tsx`
- Modify: `client/src/pages/CommessaDetail.tsx` (tab Limiti, Tabs controllate, banner, PagamentiCard)
- Test: `client/src/lib/limitiView.test.ts`

**Interfaces:**
- Consumes: `computo.ultimo`, `computo.esegui` (Task 11); `contratti.get` (Task 7/13); `riepilogoContratto` (Task 13).
- Produces (`limitiView.ts`):
  ```ts
  type StatoComputoView = { computo: Computo | null; valido: boolean; motivo: string | null };
  etichettaGruppo(g: GruppoVoce): string;
  raggruppaVoci(voci: VoceComputo[]): Array<{ gruppo: GruppoVoce; etichetta: string; voci: VoceComputo[]; totaleCent: number }>;
  spiegaVoce(v: VoceComputo): string;            // "1,75 h × € 60,17" oppure "20,564 mq × € 780,00"
  badgeStato(s: StatoComputoView): { testo: string; tono: "success" | "warning" | "muted" };
  etichettaTabLimiti(s: StatoComputoView | undefined): string;  // "Limiti", "Limiti ✓", "Limiti · da rifare"
  formatCent(cent: number | null | undefined): string;          // "€ 1.603,99"
  ```

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
// client/src/lib/limitiView.test.ts
import { describe, expect, it } from "vitest";
import { badgeStato, etichettaTabLimiti, formatCent, raggruppaVoci, spiegaVoce } from "./limitiView";

const voce = (gruppo: any, codice: string, limiteCent: number, extra: any = {}) => ({
  gruppo, codice, descrizione: codice, codiceDei: null, unita: "h", prezzoUnitCent: 6017, quantita: 1.75, limiteCent, dettaglio: { ore: 1.75 }, ordine: 1, ...extra,
});

describe("limitiView", () => {
  it("raggruppa le voci nell'ordine prodotti → controtelai → opere → eventuali con i totali", () => {
    const gruppi = raggruppaVoci([voce("opere", "posa", 131400), voce("prodotti", "massimale_A", 1603992), voce("eventuali", "dime", 190937)]);
    expect(gruppi.map(g => g.gruppo)).toEqual(["prodotti", "opere", "eventuali"]);
    expect(gruppi[0].totaleCent).toBe(1603992);
    expect(gruppi[0].etichetta).toBe("Prodotti (Allegato A e DEI)");
  });
  it("spiega una voce con i suoi input", () => {
    expect(spiegaVoce(voce("opere", "rilievo_pezzo", 10530))).toBe("1,75 h × € 60,17");
    expect(spiegaVoce(voce("prodotti", "massimale_A", 1603992, { unita: "€/mq", prezzoUnitCent: 78000, quantita: 20.564, dettaglio: { zona: "D", mq: 20.564, euroMq: 780 } }))).toBe("20,564 mq × € 780,00 (zona D)");
  });
  it("badge ed etichetta della tab seguono la validità", () => {
    expect(badgeStato({ computo: null, valido: false, motivo: "Nessun computo eseguito." })).toEqual({ testo: "Non eseguito", tono: "muted" });
    expect(badgeStato({ computo: {} as any, valido: true, motivo: null })).toEqual({ testo: "Aggiornato", tono: "success" });
    expect(badgeStato({ computo: {} as any, valido: false, motivo: "Le righe del contratto sono cambiate dopo il computo." })).toEqual({ testo: "Da rifare", tono: "warning" });
    expect(etichettaTabLimiti(undefined)).toBe("Limiti");
    expect(etichettaTabLimiti({ computo: {} as any, valido: true, motivo: null })).toBe("Limiti ✓");
    expect(etichettaTabLimiti({ computo: {} as any, valido: false, motivo: "x" })).toBe("Limiti · da rifare");
  });
  it("formatta i centesimi", () => {
    expect(formatCent(1603992)).toBe("€ 16.039,92");
    expect(formatCent(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `pnpm vitest run client/src/lib/limitiView.test.ts`
Expected: FAIL — `./limitiView` non esiste.

- [ ] **Step 3: Scrivere `client/src/lib/limitiView.ts`**

```ts
// client/src/lib/limitiView.ts
// Presentazione pura della tab Limiti: raggruppamento delle voci, spiegazione
// di ogni numero con i suoi input, badge di validità. Niente calcoli di
// dominio: i limiti arrivano già fatti dal server.
import type { Computo, GruppoVoce, VoceComputo } from "@shared/limiti/tipi";
import { formatEuro } from "./euro";

export type StatoComputoView = {
  computo: Computo | null;
  valido: boolean;
  motivo: string | null;
};

const ORDINE: GruppoVoce[] = ["prodotti", "controtelai", "opere", "eventuali"];
const ETICHETTE: Record<GruppoVoce, string> = {
  prodotti: "Prodotti (Allegato A e DEI)",
  controtelai: "Controtelai",
  opere: "Opere complementari",
  eventuali: "Servizi eventuali",
};

export function etichettaGruppo(g: GruppoVoce): string {
  return ETICHETTE[g];
}

export function formatCent(cent: number | null | undefined): string {
  if (cent == null) return "—";
  return `€ ${formatEuro(cent / 100)}`;
}

export function raggruppaVoci(voci: VoceComputo[]) {
  return ORDINE.flatMap(gruppo => {
    const mie = voci.filter(v => v.gruppo === gruppo).sort((a, b) => a.ordine - b.ordine);
    if (mie.length === 0) return [];
    return [{ gruppo, etichetta: ETICHETTE[gruppo], voci: mie, totaleCent: mie.reduce((s, v) => s + v.limiteCent, 0) }];
  });
}

const numero = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 3 });

export function spiegaVoce(v: VoceComputo): string {
  const unita = v.unita === "€/mq" ? "mq" : v.unita;
  const base = `${numero(v.quantita)} ${unita} × ${formatCent(v.prezzoUnitCent)}`;
  const zona = typeof v.dettaglio.zona === "string" && v.dettaglio.zona ? ` (zona ${v.dettaglio.zona})` : "";
  return base + zona;
}

export function badgeStato(s: StatoComputoView): { testo: string; tono: "success" | "warning" | "muted" } {
  if (!s.computo) return { testo: "Non eseguito", tono: "muted" };
  if (s.valido) return { testo: "Aggiornato", tono: "success" };
  return { testo: "Da rifare", tono: "warning" };
}

export function etichettaTabLimiti(s: StatoComputoView | undefined): string {
  if (!s || !s.computo) return "Limiti";
  return s.valido ? "Limiti ✓" : "Limiti · da rifare";
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `pnpm vitest run client/src/lib/limitiView.test.ts`
Expected: PASS.

- [ ] **Step 5: Scrivere `LimitiTab.tsx` e `ContrattoStatoBanner.tsx`**

```tsx
// client/src/components/computo/LimitiTab.tsx
// Tab «Limiti»: l'ultimo computo con esito, totali e voci raggruppate; ogni
// voce spiega il proprio numero. «Ricalcola» quando righe o parametri sono
// cambiati. Nessun calcolo qui: il server è l'unico confine.
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { badgeStato, formatCent, raggruppaVoci, spiegaVoce } from "@/lib/limitiView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Calculator, Info } from "lucide-react";

const TONO: Record<"success" | "warning" | "muted", string> = {
  success: "text-success",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

export default function LimitiTab({ commessaId }: { commessaId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.computo.ultimo.useQuery({ commessaId }, { retry: false });
  const esegui = trpc.computo.esegui.useMutation({
    onSuccess: () => {
      utils.computo.ultimo.invalidate({ commessaId });
      toast.success("Limiti ricalcolati");
    },
    onError: e => toast.error(e.message),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground py-6">Caricamento limiti…</p>;
  if (q.error) return <p className="text-sm text-danger py-6">{q.error.message}</p>;
  const stato = q.data!;
  const badge = badgeStato(stato);
  const c = stato.computo;

  return (
    <div className="space-y-4 mt-4 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">Computo dei limiti di spesa</span>
        <Badge variant="outline" className={TONO[badge.tono]}>{badge.testo}</Badge>
        {stato.motivo && <span className="text-xs text-muted-foreground">{stato.motivo}</span>}
        {stato.puoEseguire && (
          <Button size="sm" className="ml-auto h-7" disabled={esegui.isPending} onClick={() => esegui.mutate({ commessaId })}>
            <Calculator className="h-3.5 w-3.5 mr-1" /> {c ? "Ricalcola" : "Calcola i limiti"}
          </Button>
        )}
      </div>

      {!c && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nessun computo. Compila il contratto e premi «Calcola i limiti».
        </p>
      )}

      {c && (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm" aria-label="Riepilogo limiti">
            {[
              ["CHECK 1 · Allegato A", formatCent(c.check1Cent)],
              ["CHECK 2 · DEI", formatCent(c.check2Cent)],
              ["Limite (il minore)", formatCent(c.limiteCent)],
              ["Detraibile", formatCent(c.detraibileCent)],
              ["Detrazione stimata", formatCent(c.detrazioneStimataCent)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border p-2">
                <dt className="eyebrow">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          {c.avvertenze.length > 0 && (
            <ul className="text-xs text-warning space-y-0.5" aria-label="Avvertenze del computo">
              {c.avvertenze.map(a => <li key={a} className="flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{a}</li>)}
            </ul>
          )}

          {raggruppaVoci(c.voci).map(g => (
            <section key={g.gruppo} aria-label={g.etichetta} className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-medium">{g.etichetta}</h3>
                <span className="ml-auto text-sm tabular-nums font-semibold">{formatCent(g.totaleCent)}</span>
              </div>
              <ul className="divide-y divide-border">
                {g.voci.map(v => (
                  <li key={v.codice} className="grid grid-cols-[1fr_auto_auto] gap-2 py-1.5 text-sm items-center">
                    <div className="min-w-0">
                      <p className="truncate">{v.descrizione}</p>
                      <p className="text-xs text-muted-foreground">{v.codiceDei ?? ""} {spiegaVoce(v)}</p>
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Perché ${v.descrizione}`}><Info className="h-3.5 w-3.5" /></Button>
                      </PopoverTrigger>
                      <PopoverContent className="text-xs space-y-1 w-64">
                        {Object.entries(v.dettaglio).map(([k, val]) => <p key={k}><span className="text-muted-foreground">{k}:</span> {String(val)}</p>)}
                      </PopoverContent>
                    </Popover>
                    <span className="tabular-nums font-medium">{formatCent(v.limiteCent)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-[11px] text-muted-foreground">Tariffe al {c.tariffeAl} · computo del {new Date(c.createdAt).toLocaleString("it-IT")}</p>
        </>
      )}
    </div>
  );
}
```

```tsx
// client/src/components/contratto/ContrattoStatoBanner.tsx
// Una riga sotto il banner dei documenti: dove siamo con contratto e limiti,
// visibile senza aprire le tab. Solo negli stati in cui conta.
import { trpc } from "@/lib/trpc";
import { riepilogoContratto } from "@/lib/contrattoView";
import { badgeStato } from "@/lib/limitiView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSignature } from "lucide-react";

export default function ContrattoStatoBanner({
  commessaId,
  stato,
  onApri,
}: {
  commessaId: number;
  stato: string;
  onApri: (tab: "prodotti" | "limiti") => void;
}) {
  const mostra = stato === "aggiornamento_contratto" || stato === "fatture_pagamento";
  const contratto = trpc.contratti.get.useQuery({ commessaId }, { enabled: mostra, retry: false });
  const computo = trpc.computo.ultimo.useQuery({ commessaId }, { enabled: mostra, retry: false });
  if (!mostra || !contratto.data || !computo.data) return null;
  const badge = badgeStato(computo.data);
  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap text-sm rounded-lg border border-border px-3 py-2">
      <FileSignature className="h-4 w-4 shrink-0" />
      <span>{riepilogoContratto(contratto.data.contratto, contratto.data.righe.length)}</span>
      <Badge variant="outline">Limiti: {badge.testo}</Badge>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onApri("prodotti")}>Contratto</Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onApri("limiti")}>Limiti</Button>
    </div>
  );
}
```

- [ ] **Step 6: Montare tutto in `CommessaDetail.tsx`**

1. Import: `LimitiTab`, `ContrattoStatoBanner`, `etichettaTabLimiti`.
2. Tabs controllate: `const [tab, setTab] = useState("preventivi");` e `<Tabs value={tab} onValueChange={setTab}>` al posto di `<Tabs defaultValue="preventivi">`.
3. `const limitiAttivi = Boolean((interruttori.data as any)?.limiti);` e `const computoQ = trpc.computo.ultimo.useQuery({ commessaId }, { enabled: limitiAttivi, retry: false });`
4. Nella `TabsList`, dopo la tab Contratto: `{limitiAttivi && <TabsTrigger value="limiti">{etichettaTabLimiti(computoQ.data)}</TabsTrigger>}` e `{limitiAttivi && <TabsContent value="limiti"><LimitiTab commessaId={commessaId} /></TabsContent>}`.
5. Sotto il banner «Mancano N documenti» (la `Card` che mostra `Manca…`): `{limitiAttivi && <ContrattoStatoBanner commessaId={commessaId} stato={c.stato} onApri={setTab} />}`.
6. In `PagamentiCard` (stesso file, ~riga 2790): aggiungere
   ```tsx
   const interruttoriQ = trpc.platform.interruttori.useQuery(undefined, { staleTime: 300_000 });
   const contrattoQ = trpc.contratti.get.useQuery({ commessaId }, { enabled: Boolean((interruttoriQ.data as any)?.limiti), retry: false });
   const daContratto = !pattuitoDaFic && Boolean(contrattoQ.data?.contratto);
   ```
   e nel render del pattuito: mostrare il ramo di sola lettura (`<p …>€ …</p>`) quando `pattuitoDaFic || daContratto`; accanto all'etichetta, `{daContratto && <Badge variant="outline" className="h-4 px-1 text-[10px]">da contratto · {contrattoQ.data!.contratto!.pattuitoTipo}</Badge>}` (stesso pattern del badge «da FiC»). Il pulsante «Rata» resta nascosto quando `daContratto` (le rate vengono dal contratto): `PianoRateSezione` riceve `soloLettura={pattuitoDaFic || daContratto}` — se la prop non esiste, aggiungerla e usarla per nascondere `Aggiungi`.

- [ ] **Step 7: Verifica nel browser (1440×900 e 390×844)**

Run: `pnpm check && pnpm vitest run client/src/lib`. Nella demo con `FLAG_LIMITI=on`: tab Limiti vuota → «Calcola i limiti» → riepilogo con cinque numeri, voci raggruppate, popover «perché»; modificare una misura nella tab Contratto e salvare → tab «Limiti · da rifare», banner «Limiti: Da rifare»; ricalcolare → «Limiti ✓». Card Pagamenti: pattuito in sola lettura con badge «da contratto · lordo». Nessuno scroll orizzontale a 390 px, console pulita.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/limitiView.ts client/src/lib/limitiView.test.ts client/src/components/computo/LimitiTab.tsx client/src/components/contratto/ContrattoStatoBanner.tsx client/src/pages/CommessaDetail.tsx
git commit -m "feat(computo): tab Limiti con voci spiegate, badge da contratto e riga di stato

Cinque numeri in testa (CHECK1, CHECK2, limite, detraibile, detrazione),
voci raggruppate con il perché di ogni cifra, ricalcolo quando il
contratto cambia. Il pattuito da contratto è in sola lettura come quello
da FiC.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Impostazioni → pannello «Tariffe limiti» (sola lettura, direzione)

**Files:**
- Create: `server/routers/tariffe.ts`
- Modify: `server/routers.ts` (`tariffe: tariffeRouter,`)
- Create: `client/src/components/computo/TariffeLimitiPanel.tsx`
- Modify: `client/src/pages/Integrazioni.tsx` (sezione nuova dopo «Contabilità»)
- Test: `server/routers/tariffe.test.ts`

**Interfaces:**
- Produces: `tariffe.limiti()` → `Tariffe` (Task 3) per chi ha `tariffe.manage`; la modifica con validità arriva con il piano 2 (tabella `tariffe`), qui si vede cosa vale oggi e da quando.

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// server/routers/tariffe.test.ts
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";

function context(ruoli: string[]): TrpcContext {
  return {
    user: { id: 31, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "T" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: 1,
    sediIds: [1],
  };
}

describe("router tariffe", () => {
  it("la direzione legge le tariffe dei limiti; gli altri no", async () => {
    const t = await appRouter.createCaller(context(["direzione"])).tariffe.limiti();
    expect(t.massimali).toHaveLength(18);
    expect(t.validoDal).toBe("2022-04-15");
    await expect(appRouter.createCaller(context(["commerciale"])).tariffe.limiti()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm vitest run server/routers/tariffe.test.ts`
Expected: FAIL — `appRouter.tariffe` non esiste.

- [ ] **Step 3: Router e pannello**

```ts
// server/routers/tariffe.ts
// Tariffe del computo limiti in lettura per la direzione. La modifica con
// validità (tabella `tariffe`) è nel piano 2: intanto chi decide vede cosa
// vale oggi e da quando, invece di fidarsi di un foglio.
import { procedureConInterruttore, router } from "../_core/trpc";
import { authorizeCoreOperation } from "../authz/enforcement";
import { tariffeAttive } from "../computo/tariffe";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("limiti");

export const tariffeRouter = router({
  limiti: procedura.query(async ({ ctx }) => {
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    await authorizeCoreOperation({
      ctx, endpoint: "tariffe.limiti", capability: "tariffe.manage",
      resourceType: "tariffe", resource: { sedeId }, legacyAllowed: "capability",
    });
    return tariffeAttive();
  }),
});
```

```tsx
// client/src/components/computo/TariffeLimitiPanel.tsx
// Impostazioni → Tariffe limiti: massimali, DEI, opere e coefficienti in
// vigore, con la data di validità. Sola lettura in questa fase.
import { trpc } from "@/lib/trpc";
import { formatEuro } from "@/lib/euro";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function TariffeLimitiPanel() {
  const q = trpc.tariffe.limiti.useQuery(undefined, { retry: false, staleTime: 300_000 });
  if (q.error) return null;
  if (!q.data) return <p className="text-sm text-muted-foreground">Caricamento tariffe…</p>;
  const t = q.data;
  return (
    <Card>
      <CardContent className="p-4 space-y-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-semibold">Tariffe limiti di spesa</p>
          <span className="text-xs text-muted-foreground">DM MITE 14/02/2022 · valide dal {t.validoDal} · seed {t.versione}</span>
        </div>
        <Tabs defaultValue="massimali">
          <TabsList className="h-auto w-full justify-start overflow-x-auto">
            <TabsTrigger value="massimali">Massimali</TabsTrigger>
            <TabsTrigger value="dei">Listino DEI ({t.dei.length})</TabsTrigger>
            <TabsTrigger value="opere">Opere ({t.opere.length})</TabsTrigger>
            <TabsTrigger value="coefficienti">Coefficienti</TabsTrigger>
            <TabsTrigger value="detrazioni">Detrazioni</TabsTrigger>
          </TabsList>
          <TabsContent value="massimali">
            <table className="w-full text-sm tabular-nums"><thead><tr className="text-left text-xs text-muted-foreground"><th>Gruppo</th>{["A", "B", "C", "D", "E", "F"].map(z => <th key={z} className="text-right">Zona {z}</th>)}</tr></thead>
              <tbody>{(["A", "B", "C"] as const).map(g => (
                <tr key={g} className="border-t border-border"><td>{g}</td>{["A", "B", "C", "D", "E", "F"].map(z => <td key={z} className="text-right">{formatEuro(t.massimali.find(m => m.gruppo === g && m.zona === z)?.euroMq ?? 0)} €/mq</td>)}</tr>
              ))}</tbody></table>
          </TabsContent>
          <TabsContent value="dei">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm"><tbody>{t.dei.map(v => (
                <tr key={`${v.codice}-${v.descrizione}`} className="border-t border-border"><td className="text-xs text-muted-foreground pr-2 whitespace-nowrap">{v.codice}</td><td className="min-w-0">{v.descrizione}</td><td className="text-right tabular-nums whitespace-nowrap">{formatEuro(v.prezzo)} /{v.unita}</td></tr>
              ))}</tbody></table>
            </div>
          </TabsContent>
          <TabsContent value="opere">
            <table className="w-full text-sm"><tbody>{t.opere.map(o => (
              <tr key={o.codice} className="border-t border-border"><td className="text-xs text-muted-foreground pr-2 whitespace-nowrap">{o.codiceDei ?? "—"}</td><td className="min-w-0">{o.descrizione}</td><td className="text-right tabular-nums whitespace-nowrap">{formatEuro(o.prezzo)} /{o.unita}</td></tr>
            ))}</tbody></table>
          </TabsContent>
          <TabsContent value="coefficienti">
            <dl className="grid md:grid-cols-3 gap-x-4 text-sm">
              {Object.entries(t.coefficienti).flatMap(([k, v]) =>
                typeof v === "object"
                  ? Object.entries(v as Record<string, number>).map(([k2, v2]) => [`${k}.${k2}`, v2] as const)
                  : [[k, v as number] as const]
              ).map(([k, v]) => <div key={k} className="flex justify-between border-t border-border py-1"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{Number(v).toLocaleString("it-IT", { maximumFractionDigits: 4 })}</dd></div>)}
            </dl>
          </TabsContent>
          <TabsContent value="detrazioni">
            <table className="w-full text-sm"><tbody>{t.detrazioni.map(d => (
              <tr key={`${d.tipo}-${d.immobile}-${d.anno}`} className="border-t border-border"><td>{d.tipo}</td><td>{d.immobile}</td><td className="tabular-nums">{d.anno}</td><td className="text-right tabular-nums">{d.pct}%</td></tr>
            ))}</tbody></table>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
```

In `client/src/pages/Integrazioni.tsx`, dopo la sezione «Contabilità» (cercare il commento `// ── Fatture in Cloud → contabilità`), aggiungere una sezione «Limiti di spesa» visibile solo a direzione (la pagina ha già `isDirezione`) e con `platform.interruttori` `limiti` acceso, che renderizza `<TariffeLimitiPanel />`. Registrare `tariffe: tariffeRouter` in `server/routers.ts`.

- [ ] **Step 4: Eseguire test e typecheck**

Run: `pnpm vitest run server/routers/tariffe.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/tariffe.ts server/routers/tariffe.test.ts server/routers.ts client/src/components/computo/TariffeLimitiPanel.tsx client/src/pages/Integrazioni.tsx
git commit -m "feat(computo): pannello Tariffe limiti in Impostazioni (direzione, sola lettura)

Massimali, listino DEI, opere, coefficienti e detrazioni in vigore con la
data di validità: chi decide vede i numeri, non un foglio.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Documentazione, verifica completa e chiusura del piano 1

**Files:**
- Modify: `handoff.md` (sezione nuova «Contratto strutturato e computo limiti (piano 1)», voce in «Debito aperto prioritario»)
- Modify: `docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md` (§8 e §11: gate registrato come `gateScavalcato`, flag `FLAG_LIMITI` separato da `FLAG_FATTURAZIONE`)
- Modify: `.env.example` (`FLAG_LIMITI=off` con commento)
- Modify: `.claude/launch.json` (env `FLAG_LIMITI: "on"` nella configurazione «Promo Capture (demo data)»)

- [ ] **Step 1: Aggiornare la spec sui due punti divergenti**

In §8: sostituire `bypassGateComputo` con «lo stesso `bypassGateDocumentale` del dialog, con `gateScavalcato: "documentale" | "computo"` nel registro». In §11: «Interruttori: `FLAG_LIMITI` (contratto, computo, gate — piano 1), `FLAG_FATTURAZIONE` (piano 2), `FLAG_CONTRATTO_ESTRAZIONE` (piano 3), `FATTURAZIONE_SDI_DRY_RUN`».

- [ ] **Step 2: Scrivere la sezione di handoff**

Aggiungere a `handoff.md`, prima di «## 12. Debito aperto prioritario», una sezione con: cosa esiste (tabelle `commessa_contratti`, `commessa_righe`, `computi`, `computo_voci`; servizi `server/contratti/`, `server/computo/`; router `contratti`, `computo`, `tariffe`; flag `FLAG_LIMITI` spento in produzione; capability nuove e ruoli), come si usa (tab Contratto → Calcola i limiti → gate), cosa manca (piano 2 fatturazione, piano 3 lettura del contratto, tariffe modificabili, test d'oro con i fogli reali — **da chiedere alla direzione**), runbook di attivazione (`FLAG_LIMITI=on` per sede di prova, seed comuni caricato, verifica su una commessa reale con computo confrontato col foglio). In «Debito aperto prioritario» aggiungere: «Fixture d'oro del computo: 2–3 fogli compilati reali; finché mancano, il gate resta un avviso da confermare».

- [ ] **Step 3: Verifica completa**

Run:
```bash
pnpm check && pnpm test && pnpm build
```
Expected: tutto verde; `pnpm build` produce `dist/` senza avvisi nuovi. Poi la demo con `FLAG_LIMITI=on`: percorso completo (commessa → tab Contratto → salva → Limiti → Calcola → Avanza a «Fatture pagamento» con computo aggiornato = nessun dialog; con righe modificate = dialog «Il computo dei limiti non è aggiornato… Procedere comunque?»). Screenshot 1440×900 e 390×844 di Contratto e Limiti; console senza errori.

- [ ] **Step 4: Commit e branch**

```bash
git add handoff.md docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md .env.example .claude/launch.json
git commit -m "docs(limiti): handoff del piano 1, flag FLAG_LIMITI documentato, spec allineata

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline main..HEAD
```

Nessun push su `main`. Il branch `feature/limiti-fatturazione` resta aperto per il piano 2 (fatturazione FiC); la revisione finale segue `superpowers:finishing-a-development-branch`.

---

## Autoverifica del piano (eseguita in scrittura)

- **Copertura della spec (piano 1)**: §4.1 contratto/righe → Task 2, 5, 6; §4.2 computi → Task 10; §4.3 tariffe e comuni → Task 3, 4, 15; §5 motore → Task 8, 9; §8 gate → Task 12; §9 UI (Contratto, Limiti, badge Pagamenti, banner, Impostazioni) → Task 13, 14, 15; §10 capability → Task 1, 7, 11; §11 flag e test → Task 1 e ogni task; §14 fogli reali → Task 16 (richiesta alla direzione). Fuori dal piano 1 per scelta: fatturazione (§4.4, §7), lettura del contratto (§6), fascicolo Tars, tariffe modificabili — piani 2 e 3.
- **Placeholder**: nessun «TBD/TODO»; ogni step ha codice o comando.
- **Coerenza dei nomi**: `RigaContrattoInput`/`RigaForm` (client aggiunge `chiave`), `ContrattoInput`, `Computo.voci: VoceComputo[]`, `ultimoComputo → { computo, valido, motivo }` + `puoEseguire` dal router, `computoValido(sedeId, commessaId)`, `eseguiComputo({ sedeId, commessaId, actorUserId })`, `salvaContratto({ sedeId, commessaId, contratto, righe, actorUserId })`, `leggiContratto(sedeId, commessaId)`, `tariffeAttive(alla)`, `voceDeiPer`, `voceOpera`, `voceControtelaio`, `voceAccessorio`, `massimaleEuroMq`, `percentualeDetrazione`, `aggrega`, `calcolaLimiti`, `hashRighe`, `hashParametri`, `applicaPattuitoDaContratto`, interruttore `limiti`, capability `contratto.read|contratto.manage|computo.run|tariffe.manage`.
- **Punti da verificare a runtime** (dichiarati nei task): firma di `creaCommessa` nei test; `resolveJsonModule` in `tsconfig.json`; `Select` shadcn con valore vuoto; campo `limiti` nel tipo di `platform.interruttori`.
