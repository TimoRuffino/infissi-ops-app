import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { caselle } from "../comunicazioni/caselle";
import { configWhatsApp } from "../comunicazioni/whatsapp";
import { REGISTRO } from "./registro";
import { risolvi } from "./router";

function ctx(role: "admin" | "user", sedeId = 1): TrpcContext {
  return {
    user: {
      id: 1,
      role,
      ruolo: role === "admin" ? "direzione" : "operatore",
    } as any,
    req: { protocol: "https", headers: {}, get: () => "app.wyndoor.com" } as any,
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [1],
    tenantId: 1,
    tenant: null,
  };
}

/**
 * Semina, nella sede indicata, un dato riconoscibile per ogni adattatore con
 * `ambito: "sede"`. Il marcatore `sede-<n>` deve restare invisibile alle altre.
 */
function seminaDatiDellaSede(sedeId: number) {
  caselle.push({
    id: 900 + sedeId,
    sedeId,
    nome: `Casella sede-${sedeId}`,
    indirizzo: `sede-${sedeId}@example.it`,
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
    id: 900 + sedeId,
    sedeId,
    numero: `+39 000 sede-${sedeId}`,
    phoneNumberId: `pn-${sedeId}`,
    wabaId: `waba-${sedeId}`,
    attiva: true,
    tokenCifrato: "v1.finto",
    appSecretCifrato: "",
    verifyToken: `vt-${sedeId}`,
  } as any);
}

afterEach(() => {
  caselle.length = 0;
  configWhatsApp.length = 0;
});

describe("guardie della cornice", () => {
  it("un operatore non vede nell'elenco le integrazioni della direzione", async () => {
    const stati = await appRouter.createCaller(ctx("user")).integrazioni.elenco();
    const chiavi = stati.map(s => s.chiave);
    for (const a of REGISTRO.filter(x => x.permesso === "direzione")) {
      expect(chiavi).not.toContain(a.chiave);
    }
  });

  it("un operatore che chiama per chiave un'integrazione della direzione riceve NOT_FOUND", () => {
    const direzionale = REGISTRO.find(a => a.permesso === "direzione")!;
    try {
      risolvi(ctx("user"), direzionale.chiave);
      throw new Error("doveva lanciare");
    } catch (e) {
      expect((e as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("una chiave sconosciuta dà lo STESSO NOT_FOUND: non si distingue «esiste ma non puoi»", () => {
    try {
      risolvi(ctx("user"), "inesistente" as any);
      throw new Error("doveva lanciare");
    } catch (e) {
      expect((e as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("ogni adattatore dichiara ambito e permesso", () => {
    for (const a of REGISTRO) {
      expect(["sede", "azienda"]).toContain(a.ambito);
      expect(["direzione", "utente"]).toContain(a.permesso);
    }
  });

  it("il soggetto di una sede non compare nell'elenco di un'altra", async () => {
    // CLAUDE.md: `sedeId` su ogni entità, e un record di un'altra sede non
    // deve produrre nessuna informazione utile a enumerarlo. Qui il rischio
    // è più sottile di un NOT_FOUND mancato: un adattatore che dimentica il
    // filtro non dà errore — mostra il numero, la casella o l'azienda della
    // sede sbagliata dentro la pagina giusta.
    seminaDatiDellaSede(2);

    const dellaUno = await appRouter.createCaller(ctx("admin", 1)).integrazioni.elenco();
    for (const s of dellaUno) {
      if (s.soggetto) expect(s.soggetto).not.toMatch(/sede-2/);
    }
  });

  it("guardia strutturale: nessun adattatore costruisce da sé un redirect dall'header Host", () => {
    const dir = join(__dirname, "adattatori");
    for (const f of readdirSync(dir).filter(
      n => n.endsWith(".ts") && !n.endsWith(".test.ts")
    )) {
      const testo = readFileSync(join(dir, f), "utf8");
      expect(
        testo,
        `${f} ricava il callback dalla richiesta invece che dalla piattaforma`
      ).not.toMatch(/req\.get\(\s*["']host["']\s*\)/);
    }
  });
});
