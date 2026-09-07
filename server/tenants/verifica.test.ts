// server/tenants/verifica.test.ts
// Logica PURA di `pnpm tenant verifica` (Task 13, design WS2 §7.2): niente
// database, niente persistence.ts. Lo script (scripts/tenant.ts) legge i dati
// con leggiBlobDaDb/elencaChiaviDaDb e li passa qui.
import { describe, expect, it } from "vitest";
import {
  formattaRapporto,
  riassumi,
  tenantDellaChiave,
  verificaStore,
  type RapportoStore,
  type RapportoTabella,
} from "./verifica";

describe("tenantDellaChiave", () => {
  it("una chiave legacy è del tenant 1 (alias)", () => {
    expect(tenantDellaChiave("clienti")).toEqual({ tenantId: 1, nome: "clienti" });
  });

  it("tenant:<n>:<nome> è del tenant n", () => {
    expect(tenantDellaChiave("tenant:2:clienti")).toEqual({ tenantId: 2, nome: "clienti" });
    expect(tenantDellaChiave("tenant:12:garanzie")).toEqual({ tenantId: 12, nome: "garanzie" });
  });

  it("un prefisso tenant: malformato resta un nome legacy (tenant 1)", () => {
    expect(tenantDellaChiave("tenant:abc:clienti")).toEqual({ tenantId: 1, nome: "tenant:abc:clienti" });
  });
});

describe("verificaStore su una famiglia per tenant", () => {
  // sedeId → tenantId: sede 1 e 2 del tenant 1, sede 7 del tenant 2.
  const sedi = new Map<number, number>([
    [1, 1],
    [2, 1],
    [7, 2],
  ]);

  it("conta senzaTenant, tenantDiscorde, sedeSconosciuta e idDoppi separatamente", () => {
    const record = [
      { id: 1, tenantId: 1, sedeId: 1 }, // pulito
      { id: 2, sedeId: 1 }, // senza tenantId
      { id: 3, tenantId: 2, sedeId: 1 }, // tenantId discorde (la chiave è del tenant 1)
      { id: 4, tenantId: 1, sedeId: 999 }, // sede sconosciuta (non in mappa)
      { id: 5, tenantId: 1 }, // sedeId assente
      { id: 1, tenantId: 1, sedeId: 1 }, // id doppio (ripete l'id 1)
    ];
    const r = verificaStore("clienti", record, sedi);
    expect(r).toEqual<RapportoStore>({
      chiave: "clienti",
      tenantId: 1,
      nome: "clienti",
      record: 6,
      senzaTenant: 1,
      tenantDiscorde: 1,
      sedeSconosciuta: 2,
      idDoppi: 1,
    });
  });

  it("una chiave tenant:n: confronta col tenant n, non con 1", () => {
    const record = [
      { id: 1, tenantId: 2, sedeId: 7 }, // pulito per il tenant 2
      { id: 2, tenantId: 1, sedeId: 7 }, // discorde: la chiave è del tenant 2
    ];
    const r = verificaStore("tenant:2:clienti", record, sedi);
    expect(r.tenantId).toBe(2);
    expect(r.nome).toBe("clienti");
    expect(r.senzaTenant).toBe(0);
    expect(r.tenantDiscorde).toBe(1);
    expect(r.sedeSconosciuta).toBe(0);
  });

  it("una chiave senza record noti resta a zero senza esplodere", () => {
    const r = verificaStore("qualcosa", [], sedi);
    expect(r).toEqual<RapportoStore>({
      chiave: "qualcosa",
      tenantId: 1,
      nome: "qualcosa",
      record: 0,
      senzaTenant: 0,
      tenantDiscorde: 0,
      sedeSconosciuta: 0,
      idDoppi: 0,
    });
  });

  it("tre id uguali contano due doppioni, non uno", () => {
    const record = [
      { id: 9, tenantId: 1, sedeId: 1 },
      { id: 9, tenantId: 1, sedeId: 1 },
      { id: 9, tenantId: 1, sedeId: 1 },
    ];
    expect(verificaStore("clienti", record, sedi).idDoppi).toBe(2);
  });

  it("un record senza id non va in idDoppi anche se altri record non hanno id", () => {
    const record = [{ tenantId: 1, sedeId: 1 }, { tenantId: 1, sedeId: 1 }];
    expect(verificaStore("clienti", record, sedi).idDoppi).toBe(0);
  });
});

describe("verificaStore sulle famiglie globali", () => {
  // Le famiglie `{ ambito: "globale" }` (sedi, utenti, platform_feature_flags,
  // platform_feature_flag_audit, backup_config, backup_log, backup_oauth)
  // sono UNA sola istanza per tutta l'installazione: la stessa chiave "sedi"
  // contiene per costruzione righe di tenant diversi (ogni sede porta il
  // proprio tenantId), quindi confrontarle con il (finto) tenant della
  // chiave non ha senso. `utenti`/`backup_*`/le due `platform_feature_flag*`
  // in più non hanno mai avuto un campo `sedeId` singolare (utenti usa
  // `sediIds`, i backup_* nessuno dei due) o mai un `tenantId` (i flag di
  // piattaforma sono per sede, non per tenant): un conteggio "grezzo"
  // segnalerebbe un'anomalia su OGNI riga a OGNI giro, sempre.
  const sedi = new Map<number, number>([[1, 1]]);

  it.each([
    "sedi",
    "utenti",
    "platform_feature_flags",
    "platform_feature_flag_audit",
    "backup_config",
    "backup_log",
    "backup_oauth",
  ])("%s non conta senzaTenant, tenantDiscorde né sedeSconosciuta", nome => {
    const record = [
      { id: 1, tenantId: 2 }, // "discorde" solo se la famiglia non fosse globale
      { id: 2 }, // "senzaTenant" solo se la famiglia non fosse globale
      { id: 3, tenantId: 1, sedeId: 999 }, // "sedeSconosciuta" solo se non globale
    ];
    const r = verificaStore(nome, record, sedi);
    expect(r.senzaTenant).toBe(0);
    expect(r.tenantDiscorde).toBe(0);
    expect(r.sedeSconosciuta).toBe(0);
    expect(r.record).toBe(3);
  });

  it("una famiglia globale continua a contare gli id doppi", () => {
    const record = [{ id: 4 }, { id: 4 }];
    expect(verificaStore("sedi", record, sedi).idDoppi).toBe(1);
  });
});

describe("verificaStore sulle famiglie senza sedeId diretto", () => {
  // Scoperto contro il database di prova (Task 13): `timeline_steps` ha
  // `commessaId`, non `sedeId` — la sede si legge risalendo alla commessa
  // (commessaInSede). Stessa forma per `notifiche_read` (userId),
  // `preventivi_documenti`/`aperture` (commessaId), `ticket_allegati`
  // (ticketId). Sono famiglie PER TENANT vere (non globali): il backfill le
  // timbra comunque con `tenantId`, quindi senzaTenant/tenantDiscorde
  // restano significativi. Solo sedeSconosciuta va a zero: un controllo
  // "grezzo" su un campo che il record non ha mai avuto segnalerebbe ogni
  // riga a ogni giro.
  const sedi = new Map<number, number>([[1, 1]]);

  it.each(["notifiche_read", "timeline_steps", "preventivi_documenti", "aperture", "ticket_allegati"])(
    "%s: sedeSconosciuta resta 0 anche senza sedeId, ma senzaTenant/tenantDiscorde restano attivi",
    nome => {
      const record = [
        { id: 1, commessaId: 42 }, // senzaTenant vero (manca tenantId)
        { id: 2, commessaId: 42, tenantId: 2 }, // tenantDiscorde vero (chiave del tenant 1)
        { id: 3, commessaId: 42, tenantId: 1 }, // pulito, pur senza sedeId
      ];
      const r = verificaStore(nome, record, sedi);
      expect(r.sedeSconosciuta).toBe(0);
      expect(r.senzaTenant).toBe(1);
      expect(r.tenantDiscorde).toBe(1);
      expect(r.record).toBe(3);
    }
  );
});

describe("riassumi", () => {
  it("somma le quattro anomalie di ogni store", () => {
    const store: RapportoStore[] = [
      { chiave: "clienti", tenantId: 1, nome: "clienti", record: 10, senzaTenant: 1, tenantDiscorde: 2, sedeSconosciuta: 3, idDoppi: 4 },
      { chiave: "tenant:2:clienti", tenantId: 2, nome: "clienti", record: 5, senzaTenant: 0, tenantDiscorde: 0, sedeSconosciuta: 0, idDoppi: 0 },
    ];
    const r = riassumi(store, []);
    expect(r.anomalie).toBe(10); // 1+2+3+4
    expect(r.store).toBe(store);
  });

  it("conta le anomalie di una tabella solo se è presente E ha la colonna", () => {
    const tabelle: RapportoTabella[] = [
      { tabella: "fatture", presente: true, conColonna: true, righe: 100, sedeSconosciuta: 1, tenantNullo: 2, tenantDiscorde: 3 },
      { tabella: "tars_run", presente: true, conColonna: false, righe: 50, sedeSconosciuta: 9, tenantNullo: 0, tenantDiscorde: 0 },
      { tabella: "computi", presente: false, conColonna: false, righe: 0, sedeSconosciuta: 0, tenantNullo: 0, tenantDiscorde: 0 },
    ];
    const r = riassumi([], tabelle);
    // fatture: 1+2+3=6; tars_run ignorata (niente colonna, anche se sedeSconosciuta=9); assente ignorata.
    expect(r.anomalie).toBe(6);
  });

  it("nessuna anomalia su rapporto vuoto", () => {
    expect(riassumi([], []).anomalie).toBe(0);
  });

  it("somma store e tabelle insieme", () => {
    const store: RapportoStore[] = [
      { chiave: "clienti", tenantId: 1, nome: "clienti", record: 1, senzaTenant: 1, tenantDiscorde: 0, sedeSconosciuta: 0, idDoppi: 0 },
    ];
    const tabelle: RapportoTabella[] = [
      { tabella: "fatture", presente: true, conColonna: true, righe: 1, sedeSconosciuta: 0, tenantNullo: 1, tenantDiscorde: 0 },
    ];
    expect(riassumi(store, tabelle).anomalie).toBe(2);
  });
});

describe("formattaRapporto", () => {
  it("produce una tabella leggibile con i totali e le anomalie", () => {
    const store: RapportoStore[] = [
      { chiave: "clienti", tenantId: 1, nome: "clienti", record: 10, senzaTenant: 1, tenantDiscorde: 0, sedeSconosciuta: 0, idDoppi: 0 },
    ];
    const tabelle: RapportoTabella[] = [
      { tabella: "fatture", presente: true, conColonna: true, righe: 5, sedeSconosciuta: 0, tenantNullo: 0, tenantDiscorde: 0 },
      { tabella: "tars_run", presente: false, conColonna: false, righe: 0, sedeSconosciuta: 0, tenantNullo: 0, tenantDiscorde: 0 },
    ];
    const rapporto = riassumi(store, tabelle);
    const testo = formattaRapporto(rapporto);

    expect(testo).toContain("clienti");
    expect(testo).toContain("fatture");
    expect(testo).toContain("tars_run");
    expect(testo).toContain("Anomalie totali: 1");
  });

  it("un rapporto pulito dice zero anomalie", () => {
    const rapporto = riassumi(
      [{ chiave: "clienti", tenantId: 1, nome: "clienti", record: 3, senzaTenant: 0, tenantDiscorde: 0, sedeSconosciuta: 0, idDoppi: 0 }],
      []
    );
    expect(formattaRapporto(rapporto)).toContain("Anomalie totali: 0");
  });
});
