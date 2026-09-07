// server/tenants/verifica.ts
// Rapporto in sola lettura di `pnpm tenant verifica` (Task 13, design WS2
// §7.2). PURA: nessun import di persistence.ts né del database. Lo script
// (scripts/tenant.ts) legge i dati con `leggiBlobDaDb`/`elencaChiaviDaDb` e
// con una query sulle tabelle per sede, e li passa qui per il conteggio e la
// stampa — così la logica si testa senza Postgres.
import { TENANT_PREDEFINITO_ID } from "./costanti";

export type RapportoStore = {
  chiave: string;
  tenantId: number;
  nome: string;
  record: number;
  senzaTenant: number;
  tenantDiscorde: number;
  sedeSconosciuta: number;
  idDoppi: number;
  /** true se lo script ha trovato la chiave ma il blob non è un array valido (`leggiBlobDaDb` → null). Conta come 1 anomalia. */
  blobNonValido: boolean;
};

export type RapportoTabella = {
  tabella: string;
  presente: boolean;
  conColonna: boolean;
  righe: number;
  sedeSconosciuta: number;
  tenantNullo: number;
  tenantDiscorde: number;
};

export type Rapporto = {
  store: RapportoStore[];
  tabelle: RapportoTabella[];
  anomalie: number;
};

const RE_CHIAVE_TENANT = /^tenant:(\d+):(.+)$/;

/** "clienti" → tenant 1 (alias, chiavi di oggi); "tenant:2:clienti" → tenant 2. */
export function tenantDellaChiave(key: string): { tenantId: number; nome: string } {
  const m = RE_CHIAVE_TENANT.exec(key);
  if (m) return { tenantId: Number(m[1]), nome: m[2] };
  return { tenantId: TENANT_PREDEFINITO_ID, nome: key };
}

/**
 * Famiglie con `ambito: "globale"` (design WS2 §3.1) SENZA alcun riferimento
 * di sede utilizzabile: UNA sola istanza per tutta l'installazione, sempre
 * sotto la chiave nuda (mai `tenant:n:*`). Esenti da senzaTenant,
 * tenantDiscorde E sedeSconosciuta:
 *  - `sedi`/`utenti` portano già un `tenantId` proprio (backfill WS1), ma la
 *    STESSA chiave contiene per costruzione righe di tenant diversi: non ha
 *    senso confrontarle con il tenant (di comodo) della chiave; `utenti`
 *    referenzia le sedi con `sediIds` (array), mai `sedeId`, quindi neppure
 *    sedeSconosciuta è calcolabile su di essa;
 *  - `backup_config`/`backup_log`/`backup_oauth` sono globali fino al WS3:
 *    niente `tenantId`, niente `sedeId`.
 * Applicare i conteggi "grezzi" qui segnalerebbe un'anomalia su ogni riga a
 * ogni giro — rumore, non un bug. `idDoppi` resta comunque significativo
 * (un id ripetuto è un problema indipendentemente dall'ambito) e continua a
 * contarsi anche per queste famiglie.
 */
const FAMIGLIE_GLOBALI = new Set<string>(["sedi", "utenti", "backup_config", "backup_log", "backup_oauth"]);

/**
 * Famiglie `ambito: "globale"` che PERÒ portano un `sedeId` vero e proprio
 * su ogni record (`server/platform/featureFlags.ts`: `FeatureFlagRecord` e
 * `FeatureFlagAudit` hanno entrambi `sedeId: number`, una riga per sede).
 * Non hanno mai avuto un campo `tenantId` (sono per sede, non per tenant):
 * senzaTenant/tenantDiscorde restano esenti come le famiglie totalmente
 * globali. Ma `sedeSconosciuta` qui è un controllo reale e va tenuto attivo
 * — un `sedeId` che non esiste più in `sedi` è un'anomalia vera, non rumore
 * strutturale (Fix round 1, Task 13: la revisione aveva trovato che
 * `FAMIGLIE_GLOBALI` esentava anche queste due famiglie da sedeSconosciuta,
 * un'esenzione non giustificata dal loro schema).
 */
const FAMIGLIE_GLOBALI_PER_SEDE = new Set<string>(["platform_feature_flags", "platform_feature_flag_audit"]);

/**
 * Famiglie PER TENANT (`tenantId` arriva col backfill come per tutte le
 * altre, e `tenantDiscorde`/`senzaTenant` restano significativi) ma il cui
 * record non porta un `sedeId` proprio: l'ambito di sede si legge
 * attraverso un altro riferimento, che `verificaStore` non ha modo di
 * risalire senza aprire un secondo store (fuori dal suo perimetro puro).
 * Verificato sui sorgenti il 07/09/2026 (Task 13):
 *  - `notifiche_read` è per `userId`, non per sede;
 *  - `timeline_steps`/`preventivi_documenti`/`aperture` sono per
 *    `commessaId` (`commessaInSede` risale alla sede DELLA commessa);
 *  - `ticket_allegati` è per `ticketId` (`ticketInSede`, stesso schema).
 * Un controllo "grezzo" su `sedeId` qui segnalerebbe TUTTI i record come
 * sede sconosciuta a ogni giro: non è un bug, è la forma del record. Chi
 * aggiunge una famiglia con questa stessa forma aggiorna questa lista;
 * altrimenti `pnpm tenant verifica` ne segnala ogni riga da quel momento.
 */
const FAMIGLIE_SENZA_SEDE_DIRETTA = new Set<string>([
  "notifiche_read",
  "timeline_steps",
  "preventivi_documenti",
  "aperture",
  "ticket_allegati",
]);

type RecordGrezzo = { id?: unknown; tenantId?: unknown; sedeId?: unknown };

/** `sedi`: sedeId → tenantId (dal blob `sedi`, § script). */
export function verificaStore(chiave: string, record: unknown[], sedi: Map<number, number>): RapportoStore {
  const { tenantId, nome } = tenantDellaChiave(chiave);
  // Esenti da senzaTenant/tenantDiscorde: sia le famiglie totalmente globali
  // (niente tenantId significativo) sia quelle globali-per-sede (hanno
  // sedeId ma non hanno mai avuto tenantId — v. FAMIGLIE_GLOBALI_PER_SEDE).
  const esenteDaControlliTenant = FAMIGLIE_GLOBALI.has(nome) || FAMIGLIE_GLOBALI_PER_SEDE.has(nome);
  // Esenti da sedeSconosciuta: solo le famiglie totalmente globali (nessun
  // sedeId significativo) e quelle per tenant senza sedeId diretto. Le
  // globali-per-sede hanno un sedeId vero e restano soggette al controllo.
  const esenteDaSedeSconosciuta = FAMIGLIE_GLOBALI.has(nome) || FAMIGLIE_SENZA_SEDE_DIRETTA.has(nome);

  let senzaTenant = 0;
  let tenantDiscorde = 0;
  let sedeSconosciuta = 0;
  let idDoppi = 0;
  const idVisti = new Set<unknown>();

  for (const grezzo of record) {
    const r = (grezzo ?? {}) as RecordGrezzo;
    if (!esenteDaControlliTenant) {
      if (typeof r.tenantId !== "number") senzaTenant++;
      else if (r.tenantId !== tenantId) tenantDiscorde++;
    }
    if (!esenteDaSedeSconosciuta && (typeof r.sedeId !== "number" || !sedi.has(r.sedeId))) sedeSconosciuta++;
    if (r.id !== undefined) {
      if (idVisti.has(r.id)) idDoppi++;
      else idVisti.add(r.id);
    }
  }

  return {
    chiave,
    tenantId,
    nome,
    record: record.length,
    senzaTenant,
    tenantDiscorde,
    sedeSconosciuta,
    idDoppi,
    blobNonValido: false,
  };
}

/**
 * Lo script chiama questa quando `elencaChiaviDaDb` elenca `chiave` ma
 * `leggiBlobDaDb(chiave)` torna `null`: la riga esiste in `kv_store` ma la
 * colonna `data` non è un array JSON valido (Fix round 1, Task 13, R16). Un
 * `?? []` silenzioso la tratterebbe come zero record — un blob corrotto
 * sparirebbe dal rapporto invece di comparirci come l'anomalia che è.
 * Conteggi tutti a zero (non c'è nulla da contare) ma `blobNonValido: true`
 * vale 1 anomalia in `riassumi`.
 */
export function rapportoBlobNonValido(chiave: string): RapportoStore {
  const { tenantId, nome } = tenantDellaChiave(chiave);
  return {
    chiave,
    tenantId,
    nome,
    record: 0,
    senzaTenant: 0,
    tenantDiscorde: 0,
    sedeSconosciuta: 0,
    idDoppi: 0,
    blobNonValido: true,
  };
}

/**
 * Anomalie di una singola riga di store: le 4 già esistenti + 1 se il blob
 * non era un array valido (`blobNonValido`, Fix round 1, R16). Condivisa fra
 * `riassumi` e `formattaRapporto` così le due formule non possono divergere.
 */
function anomalieDiStore(s: RapportoStore): number {
  return s.senzaTenant + s.tenantDiscorde + s.sedeSconosciuta + s.idDoppi + (s.blobNonValido ? 1 : 0);
}

/** Le anomalie: v. design WS2 §7.2. Le tabelle senza colonna non contano ancora. */
export function riassumi(store: RapportoStore[], tabelle: RapportoTabella[]): Rapporto {
  const anomalieStore = store.reduce((tot, s) => tot + anomalieDiStore(s), 0);
  const anomalieTabelle = tabelle
    .filter(t => t.presente && t.conColonna)
    .reduce((tot, t) => tot + t.sedeSconosciuta + t.tenantNullo + t.tenantDiscorde, 0);
  return { store, tabelle, anomalie: anomalieStore + anomalieTabelle };
}

/** `testo` allargato a `larghezza`, con almeno uno spazio di distacco dalla colonna successiva. */
function colonna(testo: string, larghezza: number): string {
  return testo.length >= larghezza ? `${testo} ` : testo.padEnd(larghezza);
}

function intestazioneStore(): string {
  return (
    colonna("chiave", 26) +
    colonna("tenant", 7) +
    colonna("nome", 22) +
    colonna("record", 7) +
    colonna("senzaTenant", 12) +
    colonna("discorde", 9) +
    colonna("sedeIgnota", 11) +
    "idDoppi"
  );
}

function rigaStore(s: RapportoStore): string {
  const base =
    colonna(s.chiave, 26) +
    colonna(String(s.tenantId), 7) +
    colonna(s.nome, 22) +
    colonna(String(s.record), 7) +
    colonna(String(s.senzaTenant), 12) +
    colonna(String(s.tenantDiscorde), 9) +
    colonna(String(s.sedeSconosciuta), 11) +
    String(s.idDoppi);
  // Blob non valido: i conteggi sono tutti a zero (non c'è nulla da leggere),
  // quindi senza un marcatore esplicito la riga sparirebbe fra quelle pulite.
  return s.blobNonValido ? `${base}  ← BLOB NON VALIDO (data non è un array)` : base;
}

function intestazioneTabelle(): string {
  return (
    colonna("tabella", 26) +
    colonna("presente", 9) +
    colonna("colonna", 8) +
    colonna("righe", 8) +
    colonna("sedeIgnota", 11) +
    colonna("tenantNullo", 12) +
    "discorde"
  );
}

function rigaTabella(t: RapportoTabella): string {
  return (
    colonna(t.tabella, 26) +
    colonna(t.presente ? "sì" : "no", 9) +
    colonna(t.conColonna ? "sì" : "no", 8) +
    colonna(String(t.righe), 8) +
    colonna(String(t.sedeSconosciuta), 11) +
    colonna(String(t.tenantNullo), 12) +
    String(t.tenantDiscorde)
  );
}

/** Tabella leggibile per la console, con i totali di ogni sezione e il totale generale. */
export function formattaRapporto(r: Rapporto): string {
  const righe: string[] = ["═══ pnpm tenant verifica (sola lettura) ═══"];

  righe.push("", "Store per tenant (kv_store):", intestazioneStore());
  for (const s of r.store) righe.push(rigaStore(s));
  const recordTotali = r.store.reduce((tot, s) => tot + s.record, 0);
  const anomalieStore = r.store.reduce((tot, s) => tot + anomalieDiStore(s), 0);
  righe.push(`Totale: ${r.store.length} chiavi, ${recordTotali} record, ${anomalieStore} anomalie`);

  righe.push("", "Tabelle per sede (Postgres):", intestazioneTabelle());
  for (const t of r.tabelle) righe.push(rigaTabella(t));
  const presenti = r.tabelle.filter(t => t.presente).length;
  const anomalieTabelle = r.tabelle
    .filter(t => t.presente && t.conColonna)
    .reduce((tot, t) => tot + t.sedeSconosciuta + t.tenantNullo + t.tenantDiscorde, 0);
  righe.push(`Totale: ${r.tabelle.length} tabelle (${presenti} presenti), ${anomalieTabelle} anomalie`);

  righe.push("", `Anomalie totali: ${r.anomalie}`);
  return righe.join("\n");
}
