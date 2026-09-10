// Il seme demo (Task 5, piano 2026-09-10-staging-demo): al boot, SOLO in
// staging e su store vuoti, popola 6 clienti e 6 commesse passando dai
// percorsi di dominio (createClienteFromSync, creaCommessa). Qui si verifica
// il gate (non-staging, store non vuoti) e l'idempotenza.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conTenant } from "../tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { getClientiStore } from "../routers/clienti";
import { getCommesseStore } from "../routers/commesse";
import { getUtentiStore } from "../routers/utenti";
import { eseguiSemeDemo } from "./semeDemo";

const originale = process.env.AMBIENTE;
beforeEach(() => {
  process.env.AMBIENTE = "staging";
  // L'admin di bootstrap esiste già negli store in memoria dei test; se un
  // altro test lo ha disattivato, se ne assicura uno attivo con direzione.
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.attivo && (u.ruoli ?? []).includes("direzione"))) {
    utenti.push({
      id: 999,
      email: "direzione@test.local",
      attivo: true,
      ruoli: ["direzione"],
      sediIds: [1],
      tenantId: TENANT_PREDEFINITO_ID,
      nome: "Test",
      cognome: "Direzione",
    });
  }
});
afterEach(() => {
  if (originale === undefined) delete process.env.AMBIENTE;
  else process.env.AMBIENTE = originale;
});

describe("eseguiSemeDemo", () => {
  it("fuori da staging non fa nulla", async () => {
    delete process.env.AMBIENTE;
    await expect(eseguiSemeDemo()).resolves.toEqual({
      seminato: false,
      motivo: "non-staging",
    });
  });

  it("semina 6 clienti e 6 commesse su store vuoti, e la seconda volta non duplica", async () => {
    await conTenant(TENANT_PREDEFINITO_ID, async () => {
      const clientiPrima = getClientiStore().length;
      const commessePrima = getCommesseStore().length;

      const primo = await eseguiSemeDemo();
      if (clientiPrima === 0 && commessePrima === 0) {
        expect(primo.seminato).toBe(true);
        expect(getClientiStore().length).toBe(6);
        expect(getCommesseStore().length).toBe(6);
        // Ogni commessa è collegata a un cliente e ha un importo.
        for (const c of getCommesseStore() as any[]) {
          expect(c.clienteId).toBeGreaterThan(0);
          expect(c.importoTotale).toBeGreaterThan(0);
        }
      }

      const dopoPrimo = {
        clienti: getClientiStore().length,
        commesse: getCommesseStore().length,
      };
      const secondo = await eseguiSemeDemo();
      expect(secondo.seminato).toBe(false);
      expect(secondo.motivo).toBe("store-non-vuoti");
      expect(getClientiStore().length).toBe(dopoPrimo.clienti);
      expect(getCommesseStore().length).toBe(dopoPrimo.commesse);
    });
  });
});
