// Fix round 1 (Task 6, WS2 «porta aperta»): `startCostoDaConfermaWorker`
// leggeva `preventivi_documenti` (store per tenant) in modo sincrono e
// fuori da qualunque contesto, solo per contare la riga di log di avvio —
// un difetto della stessa natura di `reconcileTimelineBoardStates` (Ruling
// R8), scoperto dal boot locale con FLAG_MULTI_AZIENDA acceso: il processo
// usciva prima di `server.listen` con «accesso allo store
// preventivi_documenti senza tenant nel contesto».
//
// Il ripiego sul tenant 1 fuori contesto, attivo di default nei test
// (server/tenants/contestoCorrente.ts), nasconde il difetto in quasi ogni
// altro test: qui si usa `modalitaTenantStretta(true)` per toglierlo,
// esattamente come richiede il commento sulla funzione. Nessun avvio di
// Express: si chiama solo `startCostoDaConfermaWorker`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __registraTenantNotoPerTest } from "../_core/persistence";
import { modalitaTenantStretta } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { startCostoDaConfermaWorker } from "./costoDaConfermaWorker";

describe("startCostoDaConfermaWorker — store per tenant al boot (fix round 1)", () => {
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso (NODE_ENV=test)
    resetTenantRepositoryForTesting();
    vi.useFakeTimers();
    modalitaTenantStretta(true);
  });

  afterEach(() => {
    modalitaTenantStretta(false);
    vi.useRealTimers();
    delete process.env.FLAG_MULTI_AZIENDA;
  });

  it("control plane vuoto (ripiega su [1]): non lancia «senza tenant nel contesto» e logga il conteggio", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await expect(startCostoDaConfermaWorker()).resolves.toBeUndefined();
      expect(info).toHaveBeenCalledWith(
        "[costo-da-conferma] attivo",
        expect.objectContaining({ daLeggere: expect.any(Number) })
      );
    } finally {
      info.mockRestore();
    }
  });

  it("con più tenant attivi gira su ciascuno, nel suo contesto, senza errori (prima del fix: crash sincrono al boot)", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    // Il tenant 2 esiste nel control plane ma non ha ancora gli store
    // istanziati (come dopo un `crea()` a caldo, Task 6): senza questa
    // riga `perOgniTenantAttivo` lo salterebbe con un errore per-tenant
    // (catturato, non un crash) invece di girare per davvero su entrambi.
    __registraTenantNotoPerTest(2);

    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(startCostoDaConfermaWorker()).resolves.toBeUndefined();
      expect(errore).not.toHaveBeenCalled();
    } finally {
      errore.mockRestore();
    }
  });
});
