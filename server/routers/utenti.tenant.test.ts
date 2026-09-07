import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { contestoDiProva } from "../_core/contestoDiProva";
import { getSediStore, sedePredefinita } from "./sedi";
import { getUtentiStore } from "./utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";

const SEDE_T1 = 97501;
const SEDE_T2 = 97502;
const PROPRIETARIO_T1 = 97511; // proprietario + direzione
const DIREZIONE_T1 = 97512;
const COMMERCIALE_T1 = 97513;
const PROPRIETARIO_T2 = 97514;

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
let t1: TenantRecord;
let t2: TenantRecord;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  t1 = await repo.assicuraTenantPredefinito();
  t2 = await repo.inserisci({ slug: "acme", nome: "Acme" });
  nS = sedi.length;
  nU = utenti.length;
  const now = new Date();
  sedi.push(
    { id: SEDE_T1, tenantId: 1, nome: "Ruffino Test", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE_T2, tenantId: 2, nome: "Acme Test", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
  const base = { nome: "N", cognome: "C", attivo: true, password: "scrypt$x", createdAt: now, updatedAt: now };
  utenti.push(
    { ...base, id: PROPRIETARIO_T1, email: "p1@ws1.test", ruoli: ["proprietario", "direzione"], sediIds: [SEDE_T1], tenantId: 1 },
    { ...base, id: DIREZIONE_T1, email: "d1@ws1.test", ruoli: ["direzione"], sediIds: [SEDE_T1], tenantId: 1 },
    { ...base, id: COMMERCIALE_T1, email: "c1@ws1.test", ruoli: ["commerciale"], sediIds: [SEDE_T1], tenantId: 1 },
    { ...base, id: PROPRIETARIO_T2, email: "p2@ws1.test", ruoli: ["proprietario", "direzione"], sediIds: [SEDE_T2], tenantId: 2 }
  );
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  delete process.env.FLAG_MULTI_AZIENDA;
});

const come = (utenteId: number, ruoli: string[]) =>
  appRouter.createCaller(
    contestoDiProva({ utenteId, ruoli, sedeId: SEDE_T1, sediIds: [SEDE_T1], tenantId: 1, tenant: t1 })
  );

describe("ruolo proprietario", () => {
  it("lo assegna solo chi ha tenant.manage_proprietari; la direzione no", async () => {
    await expect(
      come(DIREZIONE_T1, ["direzione"]).utenti.update({ id: COMMERCIALE_T1, ruoli: ["commerciale", "proprietario"] })
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Solo un proprietario può nominare o revocare un proprietario." });

    const aggiornato = await come(PROPRIETARIO_T1, ["proprietario", "direzione"]).utenti.update({
      id: COMMERCIALE_T1,
      ruoli: ["commerciale", "proprietario"],
    });
    expect(aggiornato.ruoli).toEqual(["commerciale", "proprietario"]);
    const eventi = await getTenantRepository().eventi(1);
    expect(eventi.at(-1)).toMatchObject({ tipo: "proprietario_assegnato", attore: `utente:${PROPRIETARIO_T1}` });
  });

  it("anche in create serve la capability, e con l'interruttore spento non si aggiunge", async () => {
    const input = { nome: "Nuovo", cognome: "Prop", email: "np@ws1.test", ruoli: ["proprietario" as const], sediIds: [SEDE_T1], password: "Password-lunga-12" };
    await expect(come(DIREZIONE_T1, ["direzione"]).utenti.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    process.env.FLAG_MULTI_AZIENDA = "off";
    await expect(come(PROPRIETARIO_T1, ["proprietario", "direzione"]).utenti.create(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.",
    });
    // chi lo ha già lo conserva
    await expect(
      come(DIREZIONE_T1, ["direzione"]).utenti.update({ id: PROPRIETARIO_T1, telefono: "0187" })
    ).resolves.toMatchObject({ ruoli: ["proprietario", "direzione"] });
  });

  it("l'ultimo proprietario e l'ultima direzione del tenant non si tolgono", async () => {
    const io = come(PROPRIETARIO_T1, ["proprietario", "direzione"]);
    await expect(io.utenti.update({ id: PROPRIETARIO_T1, ruoli: ["direzione"] })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/ultimo proprietario/),
    });
    await expect(io.utenti.delete(PROPRIETARIO_T1)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // il tenant 2 non conta: il suo proprietario resta uno
    await expect(io.utenti.update({ id: DIREZIONE_T1, ruoli: ["commerciale"] })).resolves.toBeTruthy();
    await expect(io.utenti.update({ id: PROPRIETARIO_T1, ruoli: ["proprietario"] })).rejects.toMatchObject({
      message: expect.stringMatching(/ultimo utente direzione/),
    });
  });
});

describe("isolamento del control plane", () => {
  it("un utente di un altro tenant non esiste: byId null, update e delete NOT_FOUND, list non lo mostra", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);
    await expect(io.utenti.byId(PROPRIETARIO_T2)).resolves.toBeNull();
    await expect(io.utenti.update({ id: PROPRIETARIO_T2, telefono: "1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(io.utenti.delete(PROPRIETARIO_T2)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const tutti = await io.utenti.list({ adminScope: true });
    expect(tutti.some((u: any) => u.id === PROPRIETARIO_T2)).toBe(false);
    expect(tutti.some((u: any) => u.id === COMMERCIALE_T1)).toBe(true);
  });

  it("le sedi assegnate devono appartenere al tenant, e l'email resta unica ovunque", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);
    await expect(io.utenti.update({ id: COMMERCIALE_T1, sediIds: [SEDE_T2] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      io.utenti.create({ nome: "X", cognome: "Y", email: "P2@ws1.test", ruoli: ["ordini"], password: "Password-lunga-12" })
    ).rejects.toThrow(/Email già in uso/);
    const creato = await io.utenti.create({ nome: "X", cognome: "Y", email: "x@ws1.test", ruoli: ["ordini"], password: "Password-lunga-12" });
    // prima sede attiva del tenant 1: il seed «La Spezia» se il test l'ha caricato, altrimenti SEDE_T1
    expect(creato.sediIds).toEqual([sedePredefinita(1)]);
    expect((creato as any).tenantId).toBe(1);
  });
});
