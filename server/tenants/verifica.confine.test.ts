// server/tenants/verifica.confine.test.ts
// Guardia STRUTTURALE degli insiemi di esenzione di `pnpm tenant verifica`
// (Task 13, spec §7.2, decisione R18), sul modello di tabelle.test.ts e di
// _core/storeGlobali.test.ts: `verificaStore` esenta alcune famiglie da
// alcuni conteggi in base a due proprietà del record.
//   1. L'AMBITO — `{ ambito: "globale" }` nella dichiarazione, letto dai
//      sorgenti con `dichiarazioniPersistedStore`: una famiglia globale non
//      ha un tenant confrontabile → esente da senzaTenant/tenantDiscorde.
//   2. La FORMA — il record porta `sedeId`, oppure la sede si legge da un
//      altro riferimento (commessaId, ticketId, userId…): senza `sedeId` sul
//      record → esente da sedeSconosciuta.
// Le tre costanti di verifica.ts sono tre delle quattro celle della griglia:
//   FAMIGLIE_GLOBALI            = globale ∧ senza sedeId
//   FAMIGLIE_GLOBALI_PER_SEDE   = globale ∧ con sedeId
//   FAMIGLIE_SENZA_SEDE_DIRETTA = tenant  ∧ senza sedeId
//   (nessuna esenzione)         = tenant  ∧ con sedeId
// L'ambito si ricava dai sorgenti da solo. La forma no: tredici famiglie sono
// `persistedStore<any>` e il loro record prende forma nel codice, non in un
// tipo. Quindi la forma è una CLASSIFICAZIONE A MANO (`FORMA_DEL_RECORD`),
// verificata sui sorgenti il 07/09/2026, che questo file tiene onesta in tre
// modi:
//   - l'inventario: ogni famiglia dichiarata nei sorgenti deve comparire
//     nella classificazione — una famiglia nuova fa fallire il test finché
//     qualcuno non decide che forma ha (e, se serve, la aggiunge anche a
//     verifica.ts);
//   - il tipo: dove la dichiarazione ha un tipo (`persistedStore<T>`), il
//     corpo di T deve avere, o non avere, il campo `sedeId` come dichiarato
//     qui;
//   - il comportamento: per OGNI famiglia `verificaStore` deve esentare
//     esattamente i conteggi che ambito e forma prevedono, nei due versi
//     (una famiglia con sedeId messa fra le esenti nasconderebbe anomalie
//     vere; una senza sedeId lasciata fuori le inventerebbe a ogni giro).
// Senza questa guardia una famiglia nuova senza `sedeId` diretto farebbe
// segnalare a `pnpm tenant verifica` ogni sua riga, a ogni giro, per sempre,
// e lo si scoprirebbe solo su un database vero: è successo con timeline_steps.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dichiarazioniPersistedStore,
  fileSorgente,
  RADICE,
  type DichiarazioneStore,
} from "../_core/sorgentiDiProva";
import { verificaStore } from "./verifica";

/** Come si arriva alla sede di un record: `sedeId` diretto, oppure il riferimento da risalire. */
type Forma = "sedeId" | "commessaId" | "userId" | "ticketId" | "sediIds" | "nessuna";

// Le 51 famiglie del 07/09/2026, a mano. Solo "sedeId" è la forma diretta;
// il resto dice attraverso quale campo si risale alla sede, o che una sede
// non c'è ("nessuna": famiglie globali senza sede — o che SONO la sede).
// Chi aggiunge una famiglia la mette qui (l'inventario sotto lo pretende) e,
// se non porta `sedeId`, anche in FAMIGLIE_SENZA_SEDE_DIRETTA di verifica.ts.
const FORMA_DEL_RECORD: Record<string, Forma> = {
  // — globali senza sede (FAMIGLIE_GLOBALI) —
  sedi: "nessuna", // il record È la sede
  utenti: "sediIds", // array, mai un sedeId singolare (persistedStore<any>)
  // — globali per sede (FAMIGLIE_GLOBALI_PER_SEDE) —
  platform_feature_flags: "sedeId",
  platform_feature_flag_audit: "sedeId",
  // — per tenant senza sedeId diretto (FAMIGLIE_SENZA_SEDE_DIRETTA) —
  backup_config: "nessuna", // per azienda dal WS3: il backup non ha sede
  backup_log: "nessuna",
  backup_oauth: "nessuna",
  onboarding_integrazioni: "nessuna",
  notifiche_read: "userId", // riga { id, userId, readIds } costruita in notifiche.ts (any)
  timeline_steps: "commessaId",
  preventivi_documenti: "commessaId",
  aperture: "commessaId", // record { id, ...input, stato } costruito in aperture.ts (any)
  ticket_allegati: "ticketId",
  // — per tenant con sedeId: nessuna esenzione —
  anomalie: "sedeId",
  business_event_assignment_fingerprints: "sedeId",
  calendar_tokens: "sedeId",
  caselle_email: "sedeId",
  clienti: "sedeId",
  commesse: "sedeId",
  commesse_transizioni: "sedeId",
  comunicazioni_regole_filtro: "sedeId",
  conoscenza_aziendale: "sedeId",
  costi_fissi_manuali: "sedeId",
  documenti_analisi: "sedeId",
  documenti_collegamenti_ordini: "sedeId",
  external_calendars: "sedeId",
  fic_config: "sedeId",
  fic_costi: "sedeId",
  fic_fatture: "sedeId",
  fic_pagamenti_links: "sedeId",
  fic_regole_costi: "sedeId",
  fornitori: "sedeId", // `sedeId?:` nel tipo, ma onLoad lo riempie con 1
  fornitori_archivio: "sedeId", // pagina Fornitori (fusione di `main` del 07/09)
  fornitori_listini: "sedeId", // idem
  fornitori_ordini: "sedeId", // idem
  garanzie: "sedeId",
  impostazioni_pareggio: "sedeId",
  interventi: "sedeId",
  magazzino_prodotti: "sedeId",
  produzione_distinte: "sedeId", // `sedeId?:` nel tipo, ma onLoad lo riempie con 1
  produzione_fasi: "sedeId", // idem
  produzione_nc: "sedeId", // idem
  proposte_azioni: "sedeId",
  reclami: "sedeId",
  rifacimenti: "sedeId",
  squadre: "sedeId",
  tars_memoria: "sedeId",
  tickets: "sedeId",
  verbali: "sedeId",
  whatsapp_app: "sedeId",
  whatsapp_config: "sedeId",
  whatsapp_conversation_aliases: "sedeId",
};

const { dichiarazioni, chiamate } = dichiarazioniPersistedStore();
const NOMI = dichiarazioni.map(d => d.nome).sort();
const ambitoDi = new Map(dichiarazioni.map(d => [d.nome, d.ambito]));
const globale = (nome: string) => ambitoDi.get(nome) === "globale";
const conSedeId = (nome: string) => FORMA_DEL_RECORD[nome] === "sedeId";
const cella = (nome: string) => `${globale(nome) ? "globale" : "tenant"}, ${conSedeId(nome) ? "con" : "senza"} sedeId`;

describe("inventario delle famiglie", () => {
  it("ogni chiamata persistedStore ha il nome come letterale stringa: il conteggio grezzo coincide", () => {
    expect(dichiarazioni).toHaveLength(chiamate);
  });

  it("nessuna famiglia dichiarata due volte", () => {
    expect(new Set(NOMI).size).toBe(NOMI.length);
  });

  it("la classificazione a mano copre esattamente le famiglie dichiarate nei sorgenti", () => {
    // Fallisce mostrando la differenza: chi aggiunge, toglie o rinomina una
    // famiglia decide qui che forma ha.
    expect(Object.keys(FORMA_DEL_RECORD).sort()).toEqual(NOMI);
  });

  it("sono 52 l'08/09/2026: 4 globali (2 con sedeId) e 48 per tenant (9 senza sedeId)", () => {
    // I tre store del backup sono passati per azienda col WS3: fino a ieri
    // le globali erano 7 e le famiglie per tenant senza sedeId 5. Il WS5
    // aggiunge `onboarding_integrazioni`, per azienda e senza sede.
    expect(NOMI).toHaveLength(52);
    expect(NOMI.filter(n => globale(n))).toHaveLength(4);
    expect(NOMI.filter(n => globale(n) && conSedeId(n))).toHaveLength(2);
    expect(NOMI.filter(n => !globale(n) && !conSedeId(n))).toHaveLength(9);
  });
});

describe("gli insiemi di verifica.ts sono le celle della griglia ambito × forma", () => {
  // Le tre costanti non sono esportate (verifica.ts non ha motivo di
  // offrirle a nessuno): si leggono dal sorgente, come fanno le altre guardie
  // strutturali. Se la forma `const FAMIGLIE_X = new Set<string>([...])`
  // cambia, il primo test lo dice e questa lettura va adeguata.
  const sorgente = readFileSync(join(RADICE, "server", "tenants", "verifica.ts"), "utf8");
  const insiemi = new Map<string, string[]>();
  for (const m of sorgente.matchAll(/const (FAMIGLIE_[A-Z_]+) = new Set<string>\(\[([\s\S]*?)\]\)/g)) {
    insiemi.set(m[1], [...m[2].matchAll(/"([a-z0-9_]+)"/g)].map(x => x[1]).sort());
  }
  // Un nome che non è (più) una famiglia dei sorgenti non compare fra gli
  // attesi: l'uguaglianza fallisce mostrandolo.
  const attesi = (nella: (nome: string) => boolean) => NOMI.filter(nella);

  it("verifica.ts dichiara esattamente le tre costanti", () => {
    expect([...insiemi.keys()].sort()).toEqual(["FAMIGLIE_GLOBALI", "FAMIGLIE_GLOBALI_PER_SEDE", "FAMIGLIE_SENZA_SEDE_DIRETTA"]);
  });

  it("FAMIGLIE_GLOBALI = ambito globale, senza sedeId", () => {
    expect(insiemi.get("FAMIGLIE_GLOBALI")).toEqual(attesi(n => globale(n) && !conSedeId(n)));
  });

  it("FAMIGLIE_GLOBALI_PER_SEDE = ambito globale, con sedeId", () => {
    expect(insiemi.get("FAMIGLIE_GLOBALI_PER_SEDE")).toEqual(attesi(n => globale(n) && conSedeId(n)));
  });

  it("FAMIGLIE_SENZA_SEDE_DIRETTA = per tenant, senza sedeId", () => {
    expect(insiemi.get("FAMIGLIE_SENZA_SEDE_DIRETTA")).toEqual(attesi(n => !globale(n) && !conSedeId(n)));
  });
});

describe("verificaStore esenta esattamente ciò che ambito e forma prevedono", () => {
  // Due record che fanno scattare ogni conteggio possibile: il primo senza
  // tenantId, il secondo con il tenantId di un altro tenant, entrambi con un
  // sedeId che non esiste. Un'esenzione si vede perché il conteggio resta 0.
  const sedi = new Map<number, number>([[1, 1]]);
  const record = [
    { id: 1, sedeId: 999 },
    { id: 2, tenantId: 99, sedeId: 999 },
  ];

  it.each(NOMI.map((nome): [string, string] => [nome, cella(nome)]))("%s (%s)", nome => {
    const r = verificaStore(nome, record, sedi);
    const attesoTenant = globale(nome) ? 0 : 1;
    expect(r.senzaTenant, "senzaTenant").toBe(attesoTenant);
    expect(r.tenantDiscorde, "tenantDiscorde").toBe(attesoTenant);
    expect(r.sedeSconosciuta, "sedeSconosciuta").toBe(conSedeId(nome) ? 2 : 0);
    expect(r.record).toBe(2);
  });
});

describe("la forma dichiarata corrisponde al tipo del record", () => {
  // Dove la dichiarazione ha un tipo (`persistedStore<T>`), il corpo di T si
  // legge dal sorgente: dal `{` di `type T = {` / `interface T {` alla prima
  // `}` a inizio riga. Regge perché i tipi del repo stanno a livello di modulo
  // e sono indentati (confrontato con un vero bilanciamento delle graffe su
  // tutte le famiglie tipizzate il 07/09/2026). Le `persistedStore<any>` non
  // hanno un tipo: per loro la forma resta la lettura del codice annotata in
  // FORMA_DEL_RECORD.
  const tipizzate = dichiarazioni.filter(d => d.tipo && d.tipo !== "any");
  const letti = new Map<string, string>();
  const testo = (f: string) => {
    if (!letti.has(f)) letti.set(f, readFileSync(f, "utf8"));
    return letti.get(f)!;
  };
  const altri = fileSorgente(["server", "shared"]).filter(f => !/\.test\.ts$/.test(f));
  const corpoDelTipo = (d: DichiarazioneStore): string => {
    const re = new RegExp(`\\b(?:type|interface)\\s+${d.tipo}\\b[^{\\n]*\\{([\\s\\S]*?)\\n\\}`);
    for (const f of [join(RADICE, d.file), ...altri]) {
      const m = re.exec(testo(f));
      if (m) return m[1];
    }
    throw new Error(`tipo ${d.tipo} di "${d.nome}" non trovato: adeguare corpoDelTipo in verifica.confine.test.ts`);
  };
  const haIlCampo = (corpo: string, campo: string) =>
    new RegExp(`^\\s*(?:readonly\\s+)?${campo}\\??\\s*:`, "m").test(corpo);

  it.each(tipizzate.map((d): [string, string, Forma, DichiarazioneStore] => [d.nome, d.tipo!, FORMA_DEL_RECORD[d.nome], d]))(
    "%s: il tipo %s ha la forma «%s»",
    (_nome, _tipo, forma, d) => {
      const corpo = corpoDelTipo(d);
      expect(haIlCampo(corpo, "sedeId"), "campo sedeId").toBe(forma === "sedeId");
      if (forma !== "sedeId" && forma !== "nessuna") expect(haIlCampo(corpo, forma), `campo ${forma}`).toBe(true);
    }
  );
});
