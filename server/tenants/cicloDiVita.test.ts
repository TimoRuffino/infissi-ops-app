// server/tenants/cicloDiVita.test.ts
// Date sempre RELATIVE a Date.now(): mai una data fissa che fra un anno
// diventa una bomba a orologeria.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { giroCicloDiVita, MOTIVO_MAI_ATTIVATA } from "./cicloDiVita";
import { ATTESA_ATTIVAZIONE_MS, RITENZIONE_CANCELLAZIONE_MS } from "./costanti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

const GIORNO = 86_400_000;
const fra = (ms: number) => new Date(Date.now() + ms);

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  await getTenantRepository().assicuraTenantPredefinito();
});

afterEach(() => {
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("giroCicloDiVita", () => {
  it("una in_attesa più vecchia di 14 giorni riceve un comando cancella, una volta sola", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "mai-attivata", nome: "Mai Attivata", stato: "in_attesa" });
    // Troppo presto: nessun comando.
    expect(await giroCicloDiVita(fra(ATTESA_ATTIVAZIONE_MS - GIORNO))).toEqual({ cancellazioni: 0, svuotamenti: 0 });
    // Compiuti i 14 giorni: un solo cancella, e il secondo giro non duplica.
    expect(await giroCicloDiVita(fra(ATTESA_ATTIVAZIONE_MS + GIORNO))).toEqual({ cancellazioni: 1, svuotamenti: 0 });
    expect(await giroCicloDiVita(fra(ATTESA_ATTIVAZIONE_MS + GIORNO))).toEqual({ cancellazioni: 0, svuotamenti: 0 });
    const inAttesa = await repo.comandiInAttesa();
    expect(inAttesa).toHaveLength(1);
    expect(inAttesa[0]).toMatchObject({
      tipo: "cancella",
      tenantId: t.id,
      payload: { slug: "mai-attivata", motivo: MOTIVO_MAI_ATTIVATA },
    });
  });

  it("una cancellata oltre la ritenzione riceve svuota_tenant; una già svuotata no", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "in-uscita", nome: "In Uscita" });
    await repo.aggiornaStato(t.id, "cancellato", "disdetta", { cancellatoIl: new Date() });
    expect(await giroCicloDiVita(fra(RITENZIONE_CANCELLAZIONE_MS - GIORNO))).toEqual({ cancellazioni: 0, svuotamenti: 0 });
    expect(await giroCicloDiVita(fra(RITENZIONE_CANCELLAZIONE_MS + GIORNO))).toEqual({ cancellazioni: 0, svuotamenti: 1 });
    // Il comando resta in coda: nessun duplicato al giro dopo.
    expect(await giroCicloDiVita(fra(RITENZIONE_CANCELLAZIONE_MS + 2 * GIORNO))).toEqual({ cancellazioni: 0, svuotamenti: 0 });
    // Una lapide già svuotata non genera altri comandi.
    await repo.aggiornaStato(t.id, "cancellato", "svuotata", { svuotatoIl: new Date() });
    const inAttesa = await repo.comandiInAttesa();
    for (const c of inAttesa) {
      // simuliamo l'esecuzione: la coda si svuota e il giro non riaccoda
      await repo.prendiEdEsegui(async () => ({ ok: true }), { soloId: c.id });
    }
    expect(await giroCicloDiVita(fra(RITENZIONE_CANCELLAZIONE_MS + 3 * GIORNO))).toEqual({ cancellazioni: 0, svuotamenti: 0 });
  });

  it("attive e sospese non si toccano; a interruttore spento non fa nulla", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ slug: "viva", nome: "Viva" });
    const s = await repo.inserisci({ slug: "ferma", nome: "Ferma" });
    await repo.aggiornaStato(s.id, "sospeso", "insoluto");
    expect(await giroCicloDiVita(fra(365 * GIORNO))).toEqual({ cancellazioni: 0, svuotamenti: 0 });
    process.env.FLAG_MULTI_AZIENDA = "off";
    await repo.inserisci({ slug: "spenta", nome: "Spenta", stato: "in_attesa" });
    expect(await giroCicloDiVita(fra(365 * GIORNO))).toEqual({ cancellazioni: 0, svuotamenti: 0 });
  });
});
