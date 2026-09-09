// I11 della revisione (spec §10, «Confine»): la cornice delle integrazioni
// non aveva nessun test fra due aziende. Il rischio non è un errore mancato
// — è più silenzioso: un adattatore che dimentica il confine non lancia,
// mostra il numero WhatsApp o la casella di un'altra azienda dentro la
// pagina giusta.
//
// Setup come server/routers/crossTenant.test.ts: due aziende vere nel
// control plane, i loro store istanziati, un contesto per ciascuna.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { contestoDiProva } from "../_core/contestoDiProva";
import { istanziaStoresPerTenant } from "../_core/persistence";
import { appRouter } from "../routers";
import { conTenant } from "../tenants/contestoCorrente";
import { getSediStore } from "../routers/sedi";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";
import { caselle } from "../comunicazioni/caselle";
import { configWhatsApp } from "../comunicazioni/whatsapp";
import { risolvi } from "./router";

// Id alti e slug dedicati: mai quelli di un altro file di test.
const SEDE1 = 90501;
const SEDE2 = 90502;
const UTENTE1 = 90511;
const UTENTE2 = 90512;

let t1: TenantRecord;
let t2: TenantRecord;
let nSedi = 0;

beforeAll(async () => {
  delete process.env.FLAG_MULTI_AZIENDA; // acceso (default): la guardia gira
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  t1 = await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
  t2 = await repo.inserisci({ slug: "acme-integrazioni", nome: "Acme Infissi" });
  await istanziaStoresPerTenant(t2.id);

  const sedi = getSediStore();
  nSedi = sedi.length;
  const ora = new Date();
  sedi.push(
    { id: SEDE1, tenantId: t1.id, nome: "RG", citta: null, indirizzo: null, attiva: true, createdAt: ora, updatedAt: ora },
    { id: SEDE2, tenantId: t2.id, nome: "Acme", citta: null, indirizzo: null, attiva: true, createdAt: ora, updatedAt: ora }
  );

  // Dati riconoscibili, solo nell'azienda 1.
  conTenant(t1.id, () => {
    caselle.push({
      id: 90521,
      sedeId: SEDE1,
      nome: "Casella di Ruffino Group",
      indirizzo: "solo-di-ruffino@example.it",
      host: "mail.example.it",
      porta: 993,
      tls: true,
      passwordCifrata: "v1.finta",
      cartella: "INBOX",
      attiva: true,
      ultimoUid: null,
      uidValidity: null,
      ultimaSync: null,
      ultimoErrore: null,
      messaggiImportati: 0,
    } as any);
    configWhatsApp.push({
      id: 90522,
      sedeId: SEDE1,
      numero: "+39 000 solo-di-ruffino",
      phoneNumberId: "pn-90522",
      wabaId: "waba-90522",
      attiva: true,
      tokenCifrato: "v1.finto",
      appSecretCifrato: "",
      verifyToken: "vt-90522",
    } as any);
  });
});

afterAll(() => {
  conTenant(t1.id, () => {
    const c = caselle.findIndex(x => x.id === 90521);
    if (c >= 0) caselle.splice(c, 1);
    const w = configWhatsApp.findIndex(x => x.id === 90522);
    if (w >= 0) configWhatsApp.splice(w, 1);
  });
  getSediStore().splice(nSedi);
  resetTenantRepositoryForTesting();
});

const caller = (utenteId: number, sedeId: number, tenant: TenantRecord) =>
  appRouter.createCaller(
    contestoDiProva({ utenteId, sedeId, tenantId: tenant.id, tenant })
  );

describe("le integrazioni non attraversano il confine dell'azienda", () => {
  it("l'elenco dell'azienda 2 non nomina niente dell'azienda 1", async () => {
    const stati = await caller(UTENTE2, SEDE2, t2).integrazioni.elenco();
    for (const s of stati) {
      if (s.soggetto) expect(s.soggetto).not.toMatch(/solo-di-ruffino/);
    }
    expect(stati.find(s => s.chiave === "email")?.collegato).toBe(false);
    expect(stati.find(s => s.chiave === "whatsapp")?.collegato).toBe(false);
  });

  it("nella sua azienda, invece, la casella si vede", async () => {
    const stati = await caller(UTENTE1, SEDE1, t1).integrazioni.elenco();
    expect(stati.find(s => s.chiave === "email")?.soggetto).toBe(
      "solo-di-ruffino@example.it"
    );
  });

  it("un adattatore chiesto sulla sede di un'altra azienda dà NOT_FOUND", () => {
    // NOT_FOUND e non FORBIDDEN: l'id di una sede altrui non deve nemmeno
    // ricevere conferma di esistere (CLAUDE.md, invarianti).
    const ctx = contestoDiProva({
      utenteId: UTENTE2,
      sedeId: SEDE1, // la sede è dell'azienda 1
      sediIds: [SEDE2],
      tenantId: t2.id,
      tenant: t2,
    });
    try {
      risolvi(ctx, "fic");
      throw new Error("doveva lanciare");
    } catch (e) {
      expect((e as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("le procedure del router rifiutano allo stesso modo", async () => {
    const fuoriSede = appRouter.createCaller(
      contestoDiProva({
        utenteId: UTENTE2,
        sedeId: SEDE1,
        sediIds: [SEDE2],
        tenantId: t2.id,
        tenant: t2,
      })
    );
    await expect(
      fuoriSede.integrazioni.verifica({ chiave: "fic" })
    ).rejects.toThrow(/non trovata/i);
    await expect(
      fuoriSede.integrazioni.salta({ chiave: "email" })
    ).rejects.toThrow(/non trovata/i);
  });

  it("un adattatore ad ambito azienda non si blocca sulla sede", async () => {
    // `backup` e `agente` non hanno sede: il confine è quello dell'azienda,
    // che il contesto porta già.
    const stati = await caller(UTENTE2, SEDE2, t2).integrazioni.elenco();
    expect(stati.map(s => s.chiave)).toContain("backup");
    expect(stati.map(s => s.chiave)).toContain("agente");
  });
});
