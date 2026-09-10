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

  it("con l'interruttore spento, disattivare l'unico proprietario del tenant è consentito (Minor 2)", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    // Stessa chiamata del test "l'ultimo proprietario ... non si tolgono"
    // sopra (PROPRIETARIO_T1 è l'unico proprietario del tenant 1), ma con
    // l'interruttore spento: la guardia dell'ultimo proprietario non si
    // applica (spec §8.3, comportamento di prima del WS1) — solo quella
    // dell'ultima direzione, che qui non scatta perché DIREZIONE_T1 resta.
    await expect(
      come(DIREZIONE_T1, ["direzione"]).utenti.update({ id: PROPRIETARIO_T1, ruoli: ["direzione"] })
    ).resolves.toMatchObject({ ruoli: ["direzione"] });
  });

  it("cancellare un secondo proprietario registra proprietario_revocato nel ledger", async () => {
    const now = new Date();
    utenti.push({
      id: 97515,
      nome: "N",
      cognome: "C",
      attivo: true,
      password: "scrypt$x",
      createdAt: now,
      updatedAt: now,
      email: "p3@ws1.test",
      ruoli: ["proprietario"],
      sediIds: [SEDE_T1],
      tenantId: 1,
    });
    await expect(
      come(PROPRIETARIO_T1, ["proprietario", "direzione"]).utenti.delete(97515)
    ).resolves.toEqual({ success: true });
    const eventi = await getTenantRepository().eventi(1);
    expect(eventi.at(-1)).toMatchObject({
      tipo: "proprietario_revocato",
      attore: `utente:${PROPRIETARIO_T1}`,
      dettagli: { cancellato: true },
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

// Ciclo di vita (piano 10/09/2026, D8): un invito pendente muore con
// l'utente — senza, il link riapriva da solo un account disattivato.
describe("inviti e disattivazione", () => {
  const emetti = (utenteId: number, email: string) =>
    getTenantRepository().emettiInvito({
      tenantId: 1,
      utenteId,
      email,
      tipo: "proprietario",
      creatoDa: "piattaforma:test@wyndoor.com",
      adesso: new Date(),
    });

  it("disattivare un utente annulla il suo invito valido e registra l'evento", async () => {
    const { invito } = await emetti(COMMERCIALE_T1, "c1@ws1.test");
    await come(DIREZIONE_T1, ["direzione"]).utenti.update({ id: COMMERCIALE_T1, attivo: false });
    const repo = getTenantRepository();
    const aggiornato = (await repo.invitiDi(1)).find(i => i.id === invito.id)!;
    expect(aggiornato.annullatoIl).not.toBeNull();
    const eventi = await repo.eventi(1);
    expect(eventi.at(-1)).toMatchObject({
      tipo: "invito_annullato",
      attore: `utente:${DIREZIONE_T1}`,
      dettagli: { invitoId: invito.id, perDisattivazione: true },
    });
  });

  it("eliminare un utente annulla il suo invito; ridisattivare chi è già spento non duplica eventi", async () => {
    const repo = getTenantRepository();
    const { invito } = await emetti(COMMERCIALE_T1, "c1@ws1.test");
    await come(DIREZIONE_T1, ["direzione"]).utenti.delete(COMMERCIALE_T1);
    expect((await repo.invitiDi(1)).find(i => i.id === invito.id)!.annullatoIl).not.toBeNull();
    // Un update che lascia attivo=false su chi è già disattivato non riannulla nulla.
    await come(DIREZIONE_T1, ["direzione"]).utenti.update({ id: PROPRIETARIO_T1, telefono: "0187" });
    const eventi = await repo.eventi(1);
    const annullamenti = eventi.filter(e => e.tipo === "invito_annullato");
    expect(annullamenti).toHaveLength(1);
  });
});
