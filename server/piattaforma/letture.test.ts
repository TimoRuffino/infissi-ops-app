// server/piattaforma/letture.test.ts
// Le funzioni lette dal router del pannello piattaforma (WS6 spec §5.1):
// `elencoAziende` compone una riga per azienda da poche query «tutte
// insieme», `schedaAzienda` la arricchisce per il dettaglio di una sola. I
// test del router (router.test.ts) coprono l'autorizzazione e il conteggio
// delle query; questi si concentrano sui casi dei singoli campi — la
// funzione pura `workerSospesi` ha già la sua suite in tenants/cli.test.ts,
// qui si prova solo che `elencoAziende` la richiami con gli eventi giusti,
// per la giusta azienda.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../_core/password";
import { creaUtenteInterno, getUtentiStore } from "../routers/utenti";
import { getSediStore } from "../routers/sedi";
import {
  creaLedgerMemoriaPerTest,
  impostaLedgerPerTest,
  type LedgerCosti,
} from "../tars/costi/ledger";
import { conTenant } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { crea, type CreaTenantInput } from "../tenants/servizio";
import type { Attore } from "../tenants/tipi";
import { elencoAziende, schedaAzienda } from "./letture";

const T0 = new Date("2026-09-09T09:00:00.000Z");
const PASSWORD = "Password-lunga-12";
const SCRIPT: Attore = { tipo: "script", nome: "script:letture.test" };

let nU = 0;
let nS = 0;
let ledger: LedgerCosti;

const inputAzienda = (slug: string, ownerEmail: string): CreaTenantInput => ({
  slug,
  nome: `${slug} Infissi`,
  sede: { nome: `${slug} sede`, citta: "Sarzana" },
  proprietario: { nome: "Prop", cognome: slug, email: ownerEmail, passwordHash: hashPassword(PASSWORD) },
});

beforeEach(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  process.env.FLAG_MULTI_AZIENDA = "on";
  resetTenantRepositoryForTesting();
  ledger = creaLedgerMemoriaPerTest();
  impostaLedgerPerTest(ledger);
  nU = getUtentiStore().length;
  nS = getSediStore().length;
  const repo = getTenantRepository();
  await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
});

afterEach(() => {
  getUtentiStore().splice(nU);
  getSediStore().splice(nS);
  resetTenantRepositoryForTesting();
  impostaLedgerPerTest(null);
  delete process.env.FLAG_MULTI_AZIENDA;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("elencoAziende", () => {
  it("worker sospeso attivo compare solo nella riga della sua azienda", async () => {
    const repo = getTenantRepository();
    const acme = await crea(inputAzienda("acme", "mario@acme.test"), SCRIPT);
    const beta = await crea(inputAzienda("beta", "luca@beta.test"), SCRIPT);
    await repo.registraEvento({
      tenantId: acme.tenant.id,
      tipo: "worker_sospeso",
      attore: "sistema",
      dettagli: { etichetta: "smistamento", minuti: 120, errore: "timeout" },
    });

    const righe = await elencoAziende(T0);
    const rigaAcme = righe.find(r => r.slug === "acme")!;
    const rigaBeta = righe.find(r => r.slug === "beta")!;
    expect(rigaAcme.workerSospesi).toEqual([{ etichetta: "smistamento", finoA: new Date(T0.getTime() + 120 * 60_000), errore: "timeout" }]);
    expect(rigaBeta.workerSospesi).toEqual([]);
  });

  it("il consumo Tars assente dal ledger vale zero; un ledger irraggiungibile dà null e logga un avviso", async () => {
    await crea(inputAzienda("acme", "mario@acme.test"), SCRIPT);
    const righeOk = await elencoAziende(T0);
    expect(righeOk.find(r => r.slug === "acme")!.tars).toMatchObject({ consumoEur: 0, percentuale: 0 });

    vi.spyOn(ledger, "consumoAziendeMese").mockRejectedValue(new Error("LEDGER_ASSENTE"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const righeGuaste = await elencoAziende(T0);
    expect(righeGuaste.find(r => r.slug === "acme")!.tars).toMatchObject({ consumoEur: null, percentuale: null });
    expect(warn).toHaveBeenCalled();
  });

  it("invitoInSospeso solo per un'azienda senza proprietario attivo; invitiDi non è mai chiamato per le altre", async () => {
    const repo = getTenantRepository();
    const spiaInviti = vi.spyOn(repo, "invitiDi");
    const acme = await crea(inputAzienda("acme", "mario@acme.test"), SCRIPT);
    const beta = await crea(inputAzienda("beta", "luca@beta.test"), SCRIPT);
    // Il proprietario di beta viene disattivato: l'azienda resta senza un
    // proprietario attivo, come dopo una revoca senza un rimpiazzo ancora
    // assegnato — lo scenario in cui l'invito in sospeso conta davvero.
    conTenant(beta.tenant.id, () => {
      const utente = getUtentiStore().find((u: any) => u.email === "luca@beta.test");
      utente.attivo = false;
    });
    const { invito } = await repo.emettiInvito({
      tenantId: beta.tenant.id,
      utenteId: beta.utenteId,
      email: "nuovo@beta.test",
      tipo: "proprietario",
      creatoDa: "piattaforma:test",
      adesso: T0,
    });

    const righe = await elencoAziende(T0);
    expect(righe.find(r => r.slug === "acme")!.invitoInSospeso).toBeNull();
    expect(righe.find(r => r.slug === "beta")!.invitoInSospeso).toEqual({ email: invito.email, scadeIl: invito.scadeIl });
    // acme ha un proprietario attivo (Mario): mai un giro invitiDi per lei.
    // ruffino-group (il tenant 1, qui senza un utente con ruolo proprietario)
    // e beta ne sono prive, quindi PAGANO il giro in più — la regola di
    // costo dell'elenco (§5.1) lo prevede solo «di solito zero», non mai.
    expect(spiaInviti).not.toHaveBeenCalledWith(acme.tenant.id);
    expect(spiaInviti).toHaveBeenCalledWith(beta.tenant.id);
  });

  it("storage assente dà null; a quota calcola bloccoDal con la tolleranza dell'abbonamento", async () => {
    const repo = getTenantRepository();
    const acme = await crea(inputAzienda("acme", "mario@acme.test"), SCRIPT);
    const beta = await crea(inputAzienda("beta", "luca@beta.test"), SCRIPT);
    await repo.impostaQuotaStorage(beta.tenant.id, 1000);
    await repo.impostaStorage(beta.tenant.id, { bytes: 1000, file: 3 });
    await repo.impostaSoglia100Storage(beta.tenant.id, new Date(T0.getTime() - 2 * 86_400_000));

    const righe = await elencoAziende(T0);
    expect(righe.find(r => r.slug === "acme")!.storage).toBeNull();
    const storageBeta = righe.find(r => r.slug === "beta")!.storage!;
    expect(storageBeta).toMatchObject({ bytes: 1000, quotaBytes: 1000, percentuale: 100 });
    // tolleranzaStorageGiorni predefinita di creaProva: 7 giorni dalla soglia.
    expect(storageBeta.bloccoDal).toEqual(new Date(T0.getTime() + 5 * 86_400_000));
  });
});

describe("schedaAzienda", () => {
  it("dettaglio completo: sedi, abbonamento in euro/giorni, eventi, comandi, inviti, backup, provider", async () => {
    const repo = getTenantRepository();
    const acme = await crea(inputAzienda("acme", "mario@acme.test"), SCRIPT);
    await repo.emettiInvito({
      tenantId: acme.tenant.id,
      utenteId: acme.utenteId,
      email: "altro@acme.test",
      tipo: "proprietario",
      creatoDa: "piattaforma:test",
      adesso: T0,
    });

    const scheda = await schedaAzienda("acme", T0);
    expect(scheda).not.toBeNull();
    expect(scheda!.sedi).toEqual([{ id: acme.sedeId, nome: "acme sede", attiva: true }]);
    expect(scheda!.abbonamento).toMatchObject({
      tipo: "paid",
      stato: "trialing",
      budgetTarsEur: 25,
      extraTarsEur: 0,
      giorniAllaScadenza: 30,
      provider: "nessuno",
    });
    expect(scheda!.eventi.map(e => e.tipo)).toEqual(["creato", "abbonamento_creato", "proprietario_assegnato"]);
    expect(scheda!.comandi).toEqual([]);
    expect(scheda!.inviti).toHaveLength(1);
    expect(scheda!.inviti[0]).toMatchObject({ email: "altro@acme.test" });
    expect(scheda!.backup).toEqual([]);
    expect(scheda!.provider).toBe("nessuno");
  });

  it("slug sconosciuto: null, non lancia (il NOT_FOUND è del router, non della lettura)", async () => {
    await crea(inputAzienda("acme", "mario@acme.test"), SCRIPT);
    await expect(schedaAzienda("nessuna", T0)).resolves.toBeNull();
  });
});
