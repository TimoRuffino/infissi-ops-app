// Backup per azienda (spec WS3 §4.1–§4.2): store per tenant, refresh token
// cifrato, state nel control plane, cartella radice per azienda.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __registraTenantNotoPerTest, storeDi } from "./persistence";
import { conTenant, modalitaTenantStretta } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { decryptSecret, isEncrypted } from "./secretBox";
import { __alCaricamentoOAuthPerTest, backupStatus, handleOAuthCallback, issueOAuthState, nomeCartellaRadice } from "./driveBackup";

const realFetch = global.fetch;

describe("backup per azienda", () => {
  beforeEach(async () => {
    process.env.MAIL_ENCRYPTION_KEY = "chiave-di-prova";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "segreto";
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme Infissi" });
    // Mai `__resetPersistenzaPerTest()` qui: driveBackup importa i router (via
    // tenants/giri) e il reset azzererebbe le famiglie registrate all'import.
    __registraTenantNotoPerTest(2);
    for (const t of [1, 2]) for (const nome of ["backup_oauth", "backup_config", "backup_log"]) storeDi<any>(t, nome).length = 0;
  });
  afterEach(() => {
    global.fetch = realFetch;
    resetTenantRepositoryForTesting();
    modalitaTenantStretta(false);
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  });

  it("gli store del backup sono per tenant e il token si salva cifrato nell'azienda dello state", async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "acc", refresh_token: "REFRESH-2", expires_in: 3600 }), { status: 200 });
      }
      if (u.includes("/about")) return new Response(JSON.stringify({ user: { emailAddress: "acme@example.com" } }), { status: 200 });
      throw new Error(`fetch inatteso: ${u}`);
    }) as any;
    const state = await conTenant(2, () => issueOAuthState(7));
    await handleOAuthCallback("codice", state, "https://crm/cb"); // rotta anonima: nessun contesto
    const righe2 = storeDi<any>(2, "backup_oauth");
    expect(righe2).toHaveLength(1);
    expect(righe2[0].refreshToken).toBeUndefined();
    expect(isEncrypted(righe2[0].refreshTokenCifrato)).toBe(true);
    expect(decryptSecret(righe2[0].refreshTokenCifrato)).toBe("REFRESH-2");
    expect(righe2[0].email).toBe("acme@example.com");
    expect(storeDi<any>(1, "backup_oauth")).toHaveLength(0);
    expect(conTenant(2, () => backupStatus()).oauthEmail).toBe("acme@example.com");
    expect(conTenant(1, () => backupStatus()).oauthEmail).toBeNull();
    await expect(handleOAuthCallback("codice", state, "https://crm/cb")).rejects.toThrow("Stato OAuth non valido o scaduto");
  });

  it("una riga con refreshToken in chiaro viene cifrata al caricamento (senso unico)", () => {
    // La stessa funzione che persistence passa come onLoad, chiamata a mano con
    // il blob del WS2: così la migrazione si prova senza rifare il bootstrap.
    const righe: any[] = [{ id: 1, refreshToken: "IN-CHIARO", email: "x@y", rootFolderId: null, connectedAt: new Date() }];
    __alCaricamentoOAuthPerTest(righe, { firstBoot: false, tenantId: 2 });
    expect(righe[0].refreshToken).toBeUndefined();
    expect(decryptSecret(righe[0].refreshTokenCifrato)).toBe("IN-CHIARO");
    delete process.env.MAIL_ENCRYPTION_KEY;
    const senzaChiave: any[] = [{ id: 1, refreshToken: "RESTA", email: null, rootFolderId: null, connectedAt: new Date() }];
    __alCaricamentoOAuthPerTest(senzaChiave, { firstBoot: false, tenantId: 2 });
    expect(senzaChiave[0].refreshToken).toBe("RESTA");
    process.env.MAIL_ENCRYPTION_KEY = "chiave-di-prova";
  });

  it("la cartella radice è per azienda: Ruffino Group tiene la sua", () => {
    expect(nomeCartellaRadice(1)).toBe("Backup CRM Ruffino");
    expect(nomeCartellaRadice(2)).toBe("Backup Wyndor — Acme Infissi");
  });
});
