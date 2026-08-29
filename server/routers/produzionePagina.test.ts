// Release hardening (29/08/2026): la pagina UI «Produzione» è stata
// rimossa perché inutilizzata. Questi test inchiodano il perimetro:
// (1) nessuna voce di navigazione o collegamento la punta più, la vecchia
// route reindirizza al Board; (2) i processi produttivi SOTTOSTANTI —
// stato della commessa, router BOM/fasi/NC, gate — restano intatti.

import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { STATI_COMMESSA } from "./commesse";

const RADICE_CLIENT = path.resolve(process.cwd(), "client/src");

async function fileClient(): Promise<string[]> {
  const trovati: string[] = [];
  async function visita(cartella: string) {
    for (const voce of await fs.readdir(cartella, { withFileTypes: true })) {
      const pieno = path.join(cartella, voce.name);
      if (voce.isDirectory()) await visita(pieno);
      else if (/\.(ts|tsx)$/.test(voce.name)) trovati.push(pieno);
    }
  }
  await visita(RADICE_CLIENT);
  return trovati;
}

function contesto(sedeId = 93001): TrpcContext {
  return {
    user: {
      id: 93011,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione Hardening",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

describe("pagina Produzione rimossa — navigazione e collegamenti", () => {
  it("la pagina non esiste più e nessun file la importa", async () => {
    await expect(
      fs.access(path.join(RADICE_CLIENT, "pages/Produzione.tsx"))
    ).rejects.toThrow();
    for (const file of await fileClient()) {
      const testo = await fs.readFile(file, "utf8");
      expect(testo, `${file} importa la pagina rimossa`).not.toMatch(
        /pages\/Produzione/
      );
    }
  });

  it("nessuna voce di navigazione o card punta a /produzione; resta solo il redirect", async () => {
    const occorrenze: string[] = [];
    for (const file of await fileClient()) {
      // I file di test non sono superfici di navigazione (il test del
      // redirect usa proprio «/produzione» come input).
      if (/\.test\.tsx?$/.test(file)) continue;
      const testo = await fs.readFile(file, "utf8");
      if (testo.includes("/produzione")) occorrenze.push(file);
    }
    // L'unico riferimento ammesso è la route di App.tsx che reindirizza.
    expect(occorrenze).toEqual([path.join(RADICE_CLIENT, "App.tsx")]);
    const app = await fs.readFile(path.join(RADICE_CLIENT, "App.tsx"), "utf8");
    const blocco = app.slice(app.indexOf('path="/produzione'), app.indexOf('path="/produzione') + 300);
    expect(blocco).toContain("LegacyRedirect");
    expect(blocco).toContain("produzioneRedirect");
    // La sidebar e l'hub Gestione non hanno più l'etichetta «Produzione».
    for (const nav of ["components/DashboardLayout.tsx", "pages/Integrazioni.tsx"]) {
      const testo = await fs.readFile(path.join(RADICE_CLIENT, nav), "utf8");
      expect(testo).not.toMatch(/label:\s*"Produzione"/);
    }
  });
});

describe("pagina Produzione rimossa — i processi sottostanti restano", () => {
  it("lo stato «produzione» della commessa esiste ancora nella macchina a stati", () => {
    expect(STATI_COMMESSA).toContain("produzione");
  });

  it("il router BOM/fasi/NC resta registrato e funzionante (candidato a bonifica, non rimosso)", async () => {
    const caller = appRouter.createCaller(contesto());
    const commessa = await caller.commesse.create({ cliente: "Hardening Produzione" });
    const bom = await caller.produzione.bom.create({
      commessaId: commessa.id,
      aperturaId: 1,
      componenti: [
        {
          tipo: "profilo",
          descrizione: "Profilo PVC bianco",
          quantita: 4,
          unitaMisura: "mt",
        },
      ],
    });
    expect(bom.stato).toBe("bozza");
    const validata = await caller.produzione.bom.validate({
      id: bom.id,
      validataDa: "Direzione Hardening",
      noteValidazione: "ok",
    });
    expect(validata.stato).toBe("validata");
    const stats = await caller.produzione.bom.stats({});
    expect(stats.totale).toBeGreaterThan(0);
  });
});
