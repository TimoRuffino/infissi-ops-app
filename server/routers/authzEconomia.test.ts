// Slice 2 — dati economici e pagamenti dietro capability (R4/R5).
// Matrice confermata dalla direzione il 28/08/2026
// (docs/reports/slice-2-authz-economia-proposta.md):
//   - registro pagamenti[] → pagamento.read; costi/costoPosaStimato →
//     economia.read; scritture acconti → pagamento.record;
//   - la sintesi della scheda (pattuito, incassato, piano rate) resta
//     visibile a chi lavora la commessa;
//   - liste e board non trasmettono cifre ai non autorizzati: solo il
//     booleano daSaldare;
//   - l'abilitazione individuale passa da un override con audit, in
//     QUALUNQUE policyMode (legacy compreso);
//   - l'ownership non è una capability economica;
//   - cross-sede resta NOT_FOUND anche per gli autorizzati.

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getUtentiStore } from "./utenti";
import { getPolicyRepository } from "../authz/repository";
import { setFeatureFlags } from "../platform/featureFlags";
import { STATI_COMMESSA } from "./commesse";
import {
  collectActionSignals,
  groupSignals,
} from "../actionCenter/signals";
import type { ActionSignalInput } from "../actionCenter/types";

const SEDE = 90301;
const ALTRA_SEDE = 90302;
const SEDE_ENFORCE = 90303;

const DIREZIONE_ID = 90311;
const AMMINISTRAZIONE_ID = 90312;
const COMMERCIALE_ID = 90313;
const POSA_ID = 90314;

function context(
  userId: number,
  roles: string[],
  sedeId = SEDE
): TrpcContext {
  return {
    user: {
      id: userId,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

/**
 * Guardia «nessuna cifra nella notifica condivisa».
 *
 * Il confronto avviene su numeri interi, non su sottostringhe: l'id legacy
 * porta la versione del registro (`saldo-<id>-<attivi>:<epoch>`) e `createdAt`
 * viene serializzato in ISO con i millisecondi. Dentro quelle cifre volatili
 * un `toMatch(/500/)` può accendersi per caso — è successo — trasformando una
 * guardia sugli importi in un test instabile. Estraendo i numeri completi
 * (decimali inclusi, così `10:00:00.500` resta `00.500`) l'intento resta
 * intatto: un importo esposto come valore a sé viene ancora trovato.
 */
function importiEsposti(payload: unknown, vietati: number[]): string[] {
  const serializzato = JSON.stringify(payload) ?? "";
  const numeri = new Set(serializzato.match(/\d+(?:[.,]\d+)?/g) ?? []);
  const trovati = vietati
    .map(String)
    .filter(
      atteso =>
        numeri.has(atteso) ||
        numeri.has(`${atteso}.00`) ||
        numeri.has(`${atteso},00`)
    );
  if (serializzato.includes("€")) trovati.push("€");
  return trovati;
}

const direzione = (sedeId = SEDE) =>
  appRouter.createCaller(context(DIREZIONE_ID, ["direzione"], sedeId));
const amministrazione = (sedeId = SEDE) =>
  appRouter.createCaller(context(AMMINISTRAZIONE_ID, ["amministrazione"], sedeId));
const commerciale = (sedeId = SEDE) =>
  appRouter.createCaller(context(COMMERCIALE_ID, ["commerciale"], sedeId));
const posa = (sedeId = SEDE) =>
  appRouter.createCaller(context(POSA_ID, ["squadra_posa"], sedeId));

// permessi.updateOverride verifica che il destinatario esista nella sede.
function registraUtentiDiSede() {
  const utenti = getUtentiStore() as any[];
  for (const [id, ruoli] of [
    [DIREZIONE_ID, ["direzione"]],
    [AMMINISTRAZIONE_ID, ["amministrazione"]],
    [COMMERCIALE_ID, ["commerciale"]],
    [POSA_ID, ["squadra_posa"]],
  ] as const) {
    if (!utenti.some(u => u.id === id)) {
      utenti.push({
        id,
        nome: `Nome${id}`,
        cognome: `Cognome${id}`,
        email: `authz-${id}@example.test`,
        attivo: true,
        ruoli: [...ruoli],
        ruolo: ruoli[0],
        sediIds: [SEDE, ALTRA_SEDE, SEDE_ENFORCE],
      });
    }
  }
}
registraUtentiDiSede();

/** Commessa con registro, costi e pattuito, creata dalla direzione. */
async function commessaEconomica(assegnatoA?: number) {
  const caller = direzione();
  const commessa = await caller.commesse.create({
    cliente: `Authz ${Math.random().toString(36).slice(2, 8)}`,
    importoTotale: 5000,
    ...(assegnatoA != null ? { assegnatoA } : {}),
  });
  await caller.commesse.addPagamento({
    commessaId: commessa.id,
    importo: 2000,
    data: "2026-08-20",
  });
  await caller.commesse.addCosto({
    commessaId: commessa.id,
    importo: 1200,
    fornitore: "Fornitore Test",
  });
  await caller.commesse.update({
    id: commessa.id,
    costoPosaStimato: 300,
  });
  return commessa;
}

describe("R4 — shaping delle letture", () => {
  it("byId: direzione e amministrazione vedono registro, costi e costo posa", async () => {
    const commessa = await commessaEconomica();
    for (const caller of [direzione(), amministrazione()]) {
      const dettaglio: any = await caller.commesse.byId(commessa.id);
      expect(Array.isArray(dettaglio.pagamenti)).toBe(true);
      expect(dettaglio.pagamenti).toHaveLength(1);
      expect(Array.isArray(dettaglio.costi)).toBe(true);
      expect(dettaglio.costoPosaStimato).toBe(300);
    }
  });

  it("byId: i ruoli operativi ricevono la sintesi ma NESSUN dettaglio economico nel payload", async () => {
    const commessa = await commessaEconomica(COMMERCIALE_ID);
    for (const caller of [commerciale(), posa()]) {
      const dettaglio: any = await caller.commesse.byId(commessa.id);
      // La parte operativa resta accessibile (decisione 5).
      expect(dettaglio).not.toBeNull();
      expect(dettaglio.codice).toBe(commessa.codice);
      // Sintesi della scheda: visibile (matrice riga 1).
      expect(dettaglio.importoTotale).toBe(5000);
      expect(dettaglio.importoIncassato).toBe(2000);
      expect(dettaglio.nPagamenti).toBe(1);
      expect(Array.isArray(dettaglio.pianoRate)).toBe(true);
      // Dettagli: ASSENTI dal payload, non nascosti dalla UI (decisione 4/5).
      expect("pagamenti" in dettaglio).toBe(false);
      expect("costi" in dettaglio).toBe(false);
      expect("costoPosaStimato" in dettaglio).toBe(false);
      const serializzato = JSON.stringify(dettaglio);
      expect(serializzato).not.toContain('"pagamenti"');
      expect(serializzato).not.toContain('"costi"');
      expect(serializzato).not.toContain("1200");
    }
  });

  it("l'ownership non è una capability economica: l'assegnatario resta senza registro", async () => {
    const commessa = await commessaEconomica(COMMERCIALE_ID);
    const dettaglio: any = await commerciale().commesse.byId(commessa.id);
    expect(dettaglio.assegnatoA).toBe(COMMERCIALE_ID);
    expect("pagamenti" in dettaglio).toBe(false);
    expect("costi" in dettaglio).toBe(false);
  });

  it("anche le risposte delle mutation operative sono sagomate", async () => {
    const commessa = await commessaEconomica(COMMERCIALE_ID);
    const aggiornata: any = await commerciale().commesse.update({
      id: commessa.id,
      note: "aggiornamento operativo",
    });
    expect(aggiornata.note).toBe("aggiornamento operativo");
    expect("pagamenti" in aggiornata).toBe(false);
    expect("costi" in aggiornata).toBe(false);
    expect("costoPosaStimato" in aggiornata).toBe(false);

    const archiviata: any = await commerciale().commesse.archive(commessa.id);
    expect("pagamenti" in archiviata).toBe(false);
    const ripristinata: any = await commerciale().commesse.restore(commessa.id);
    expect("pagamenti" in ripristinata).toBe(false);
    // Le stesse risposte restano complete per gli autorizzati.
    const admAggiornata: any = await amministrazione().commesse.update({
      id: commessa.id,
      priorita: "alta",
    });
    expect(Array.isArray(admAggiornata.pagamenti)).toBe(true);
  });

  it("list: senza pagamento.read niente cifre, solo il booleano daSaldare", async () => {
    const conResiduo = await commessaEconomica();
    const saldata = await direzione().commesse.create({
      cliente: "Authz Saldata",
      importoTotale: 1000,
    });
    await direzione().commesse.addPagamento({
      commessaId: saldata.id,
      importo: 1000,
      data: "2026-08-21",
    });

    const lista: any[] = await commerciale().commesse.list({});
    const rigaResiduo = lista.find(c => c.id === conResiduo.id);
    const rigaSaldata = lista.find(c => c.id === saldata.id);
    expect(rigaResiduo.daSaldare).toBe(true);
    expect(rigaSaldata.daSaldare).toBe(false);
    for (const riga of [rigaResiduo, rigaSaldata]) {
      expect("importoTotale" in riga).toBe(false);
      expect("importoIncassato" in riga).toBe(false);
    }
    expect(JSON.stringify(lista)).not.toContain("5000");

    // Gli autorizzati continuano a ricevere le cifre (e daSaldare).
    const listaAdm: any[] = await amministrazione().commesse.list({});
    const rigaAdm = listaAdm.find(c => c.id === conResiduo.id);
    expect(rigaAdm.importoTotale).toBe(5000);
    expect(rigaAdm.importoIncassato).toBe(2000);
    expect(rigaAdm.daSaldare).toBe(true);
  });

  it("byPriorita: mai registro né costi nel payload; cifre solo agli autorizzati", async () => {
    const commessa = await commessaEconomica();
    const bucketsCommerciale: any = await commerciale().commesse.byPriorita();
    const rigaCommerciale = bucketsCommerciale.media.find(
      (c: any) => c.id === commessa.id
    );
    expect(rigaCommerciale).toBeTruthy();
    expect("pagamenti" in rigaCommerciale).toBe(false);
    expect("costi" in rigaCommerciale).toBe(false);
    expect("importoTotale" in rigaCommerciale).toBe(false);
    expect(rigaCommerciale.daSaldare).toBe(true);

    const bucketsAdm: any = await amministrazione().commesse.byPriorita();
    const rigaAdm = bucketsAdm.media.find((c: any) => c.id === commessa.id);
    expect(rigaAdm.importoTotale).toBe(5000);
    // Il registro resta comunque fuori dalle liste aggregate.
    expect("pagamenti" in rigaAdm).toBe(false);
  });

  it("pagamentiRecenti richiede pagamento.read", async () => {
    await commessaEconomica();
    await expect(
      amministrazione().commesse.pagamentiRecenti({ limit: 5 })
    ).resolves.toBeInstanceOf(Array);
    await expect(
      commerciale().commesse.pagamentiRecenti({ limit: 5 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("la sintesi operativa resta leggibile: pattuito e rate per tutti i ruoli", async () => {
    const commessa = await commessaEconomica();
    const pattuito = await posa().commesse.pattuito(commessa.id);
    expect(pattuito.importoTotale).toBe(5000);
    expect(Array.isArray(pattuito.rate)).toBe(true);
  });
});

describe("R5 — scritture dietro pagamento.record", () => {
  it("i ruoli operativi non registrano, modificano o rimuovono acconti", async () => {
    const commessa = await commessaEconomica(COMMERCIALE_ID);
    await expect(
      commerciale().commesse.addPagamento({
        commessaId: commessa.id,
        importo: 100,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      posa().commesse.updatePagamento({
        commessaId: commessa.id,
        pagamentoId: 1,
        importo: 1,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      commerciale().commesse.removePagamento({
        commessaId: commessa.id,
        pagamentoId: 1,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      commerciale().commesse.correggiPagamento({
        commessaId: commessa.id,
        pagamentoId: 1,
        ficDocumentoId: 1,
        ficSourceKey: "k",
        expectedFingerprint: "f",
        patch: { importo: 1 },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("amministrazione registra e l'incassato resta derivato", async () => {
    const commessa = await commessaEconomica();
    const dopo: any = await amministrazione().commesse.addPagamento({
      commessaId: commessa.id,
      importo: 500,
      data: "2026-08-22",
    });
    expect(dopo.importoIncassato).toBe(2500);
  });

  it("cross-sede: anche un autorizzato riceve NOT_FOUND, mai FORBIDDEN", async () => {
    const commessa = await commessaEconomica();
    await expect(
      amministrazione(ALTRA_SEDE).commesse.addPagamento({
        commessaId: commessa.id,
        importo: 10,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      amministrazione(ALTRA_SEDE).commesse.byId(commessa.id)
    ).resolves.toBeNull();
  });
});

describe("override individuale (decisione 3)", () => {
  it("in policyMode legacy l'override allow abilita il singolo utente, con audit; la revoca lo spegne", async () => {
    const commessa = await commessaEconomica();
    const admin = direzione();

    await expect(
      commerciale().commesse.addPagamento({ commessaId: commessa.id, importo: 50 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await admin.permessi.updateOverride({
      userId: COMMERCIALE_ID,
      capability: "pagamento.record",
      effect: "allow",
      reason: "Test slice 2: incaricato incassi showroom",
    });
    const dopo: any = await commerciale().commesse.addPagamento({
      commessaId: commessa.id,
      importo: 50,
      data: "2026-08-23",
    });
    expect(dopo.importoIncassato).toBe(2050);

    // L'override NON estende la lettura: serve pagamento.read, non record.
    const dettaglio: any = await commerciale().commesse.byId(commessa.id);
    expect("pagamenti" in dettaglio).toBe(false);

    await admin.permessi.updateOverride({
      userId: COMMERCIALE_ID,
      capability: "pagamento.record",
      effect: "inherit",
      reason: "Test slice 2: revoca dell'incarico incassi",
    });
    await expect(
      commerciale().commesse.addPagamento({ commessaId: commessa.id, importo: 5 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const audit = await getPolicyRepository().listPolicyChanges({
      sedeId: SEDE,
      userId: COMMERCIALE_ID,
    });
    const azioni = audit.map(item => item.action);
    expect(azioni).toContain("override_created");
    expect(azioni).toContain("override_revoked");
  });

  it("un deny individuale prevale sul ruolo amministrazione", async () => {
    const commessa = await commessaEconomica();
    await direzione().permessi.updateOverride({
      userId: AMMINISTRAZIONE_ID,
      capability: "pagamento.record",
      effect: "deny",
      reason: "Test slice 2: sospensione temporanea incassi",
    });
    try {
      await expect(
        amministrazione().commesse.addPagamento({
          commessaId: commessa.id,
          importo: 10,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await direzione().permessi.updateOverride({
        userId: AMMINISTRAZIONE_ID,
        capability: "pagamento.record",
        effect: "inherit",
        reason: "Test slice 2: fine sospensione incassi",
      });
    }
  });

  it("con policyMode=enforce la stessa matrice vale identica", async () => {
    setFeatureFlags(
      SEDE_ENFORCE,
      { policyMode: "enforce" },
      { actorUserId: DIREZIONE_ID, reason: "Test slice 2 enforce" }
    );
    const commessa = await direzione(SEDE_ENFORCE).commesse.create({
      cliente: "Authz Enforce",
      importoTotale: 900,
    });
    await expect(
      commerciale(SEDE_ENFORCE).commesse.addPagamento({
        commessaId: commessa.id,
        importo: 10,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      amministrazione(SEDE_ENFORCE).commesse.addPagamento({
        commessaId: commessa.id,
        importo: 10,
        data: "2026-08-24",
      })
    ).resolves.toMatchObject({ importoIncassato: 10 });
    const dettaglio: any = await commerciale(SEDE_ENFORCE).commesse.byId(
      commessa.id
    );
    expect("pagamenti" in dettaglio).toBe(false);
  });
});

describe("superfici condivise — nessun importo fuori dalle capability", () => {
  const snapshotCommessa = (registroVersione: string) => ({
    id: 7001,
    sedeId: SEDE,
    codice: "COM-2026-700",
    clienteId: null,
    cliente: "Saldo Condiviso",
    stato: "attesa_posa",
    priorita: "media",
    assegnatoA: COMMERCIALE_ID,
    createdBy: null,
    updatedAt: new Date("2026-08-28T09:00:00.000Z"),
    archivedAt: null,
    dataConsegnaConfermata: "2026-09-01",
    importoTotale: 5000,
    importoIncassato: 2000,
    registroVersione,
  });
  const inputSegnali = (registroVersione: string): ActionSignalInput => ({
    sedeId: SEDE,
    now: new Date("2026-08-28T10:00:00.000Z"),
    commesse: [snapshotCommessa(registroVersione)],
    tickets: [],
    garanzie: [],
    interventi: [],
  });

  it("il caso saldo del Centro Azioni è operativo ma senza cifre, e si risveglia quando il registro cambia", () => {
    const segnali = collectActionSignals(inputSegnali("2:1756371600000"));
    const saldo = segnali.find(segnale => segnale.kind === "saldo");
    expect(saldo).toBeTruthy();
    expect(saldo!.summary).toBe("La commessa ha un saldo residuo da incassare");
    expect(saldo!.actionLabel).toBe("Verifica e incassa il saldo residuo");
    // Né il segnale né il caso aggregato permettono di ricostruire importi.
    const serializzati =
      JSON.stringify(saldo) + JSON.stringify(groupSignals(segnali));
    for (const cifra of ["5000", "3000", "2000.00", "residuo di", "euro"]) {
      expect(serializzati).not.toContain(cifra);
    }

    // Stesso registro → stesso fingerprint (niente riaperture a vuoto).
    const ripetuto = collectActionSignals(inputSegnali("2:1756371600000"))
      .find(segnale => segnale.kind === "saldo");
    expect(ripetuto!.fingerprint).toBe(saldo!.fingerprint);
    // Un incasso parziale cambia la versione del registro → fingerprint
    // nuovo → il caso rinviato si risveglia.
    const dopoIncasso = collectActionSignals(inputSegnali("3:1756375200000"))
      .find(segnale => segnale.kind === "saldo");
    expect(dopoIncasso!.fingerprint).not.toBe(saldo!.fingerprint);
  });

  it("la notifica legacy del saldo non espone cifre, ri-notifica a ogni incasso e sparisce a saldo", async () => {
    const admin = direzione();
    const commessa = await admin.commesse.create({
      cliente: "Saldo Legacy",
      importoTotale: 4000,
      assegnatoA: COMMERCIALE_ID,
    });
    for (let step = 1; step <= STATI_COMMESSA.indexOf("attesa_posa"); step++) {
      await admin.commesse.update({
        id: commessa.id,
        stato: STATI_COMMESSA[step],
        force: true,
      });
    }
    await amministrazione().commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1000,
      data: "2026-08-25",
    });

    const trovaSaldo = async () => {
      const lista: any[] = await commerciale().notifiche.list();
      return lista.find(
        item =>
          typeof item.id === "string" &&
          item.id.startsWith(`saldo-${commessa.id}-`)
      );
    };

    const prima = await trovaSaldo();
    expect(prima).toBeTruthy();
    expect(prima.message).toBe("Saldo residuo da incassare");
    expect(importiEsposti(prima, [4000, 3000, 1000])).toEqual([]);

    await amministrazione().commesse.addPagamento({
      commessaId: commessa.id,
      importo: 500,
      data: "2026-08-26",
    });
    const dopo = await trovaSaldo();
    expect(dopo).toBeTruthy();
    // Id nuovo = ri-notifica; ancora nessuna cifra.
    expect(dopo.id).not.toBe(prima.id);
    expect(importiEsposti(dopo, [4000, 2500, 1500, 500])).toEqual([]);

    await amministrazione().commesse.addPagamento({
      commessaId: commessa.id,
      importo: 2500,
      data: "2026-08-27",
    });
    await expect(trovaSaldo()).resolves.toBeUndefined();
  });
});

describe("permessi.mie — la UI legge la stessa policy del server", () => {
  it("riflette ruolo e override correnti dell'utente autenticato", async () => {
    const primaDi = await commerciale().permessi.mie();
    expect(primaDi).not.toContain("pagamento.read");
    expect(primaDi).not.toContain("economia.read");

    const admin = await amministrazione().permessi.mie();
    expect(admin).toContain("pagamento.read");
    expect(admin).toContain("pagamento.record");
    expect(admin).toContain("economia.read");
  });
});
