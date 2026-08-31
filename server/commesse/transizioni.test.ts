import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { TrpcContext } from "../_core/context";

type CommessaTest = {
  id: number;
  sedeId: number;
  stato: string;
  updatedAt: Date;
  dataConsegnaConfermata: string | null;
  dataChiusura: string | null;
};

const SEDE = 98401;

function ctx(
  sedeId = SEDE,
  userId = 98411,
  ruoli: string[] = ["direzione"]
): TrpcContext {
  return {
    user: {
      id: userId,
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      name: "Direzione transizioni",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

async function moduloTransizioni(): Promise<any> {
  // Il path non letterale permette al primo RED di arrivare a una normale
  // asserzione anche prima che il nuovo modulo esista.
  const percorso = "./transizioni";
  return import(percorso).catch(() => null);
}

function dipendenze(commessa: CommessaTest, gate = true) {
  let salvataggi = 0;
  const timeline: Array<{ id: number; stato: string }> = [];
  return {
    valore: {
      trovaCommessa: (id: number) => (id === commessa.id ? commessa : null),
      salvaStatoEAudit: async () => {
        salvataggi += 1;
      },
      haDocumentoRichiesto: () => gate,
      documentiRichiesti: (stato: string) =>
        stato === "preventivo" ? ["preventivo", "contratto"] : [],
      etichettaDocumento: (tipo: string) => tipo,
      allineaTimeline: async (id: number, stato: string) => {
        timeline.push({ id, stato });
      },
      ora: () => new Date("2026-08-31T12:00:00.000Z"),
    },
    salvataggi: () => salvataggi,
    timeline,
  };
}

describe("servizio canonico transizioni commessa", () => {
  it("è l'unica state machine usata dal router", () => {
    const router = readFileSync(
      new URL("../routers/commesse.ts", import.meta.url),
      "utf8"
    );
    expect(router).toContain("eseguiTransizioneCommessa(");
    expect(router).not.toMatch(/const\s+TRANSIZIONI_VALIDE/);
    expect(router).not.toContain("function validateTransizione");
  });

  it("applica la stessa state machine, il gate e l'allineamento timeline", async () => {
    const modulo = await moduloTransizioni();
    expect(modulo).not.toBeNull();
    if (!modulo) return;

    const commessa: CommessaTest = {
      id: 98421,
      sedeId: SEDE,
      stato: "preventivo",
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
      dataConsegnaConfermata: null,
      dataChiusura: null,
    };
    const bloccata = dipendenze(commessa, false);
    await expect(
      modulo.eseguiTransizioneCommessa(
        {
          ctx: ctx(),
          commessaId: commessa.id,
          nuovoStato: "misure_esecutive",
          origine: "tars",
          versioneAttesa: modulo.versioneCommessa(commessa),
          attoreNome: "Direzione transizioni",
        },
        bloccata.valore
      )
    ).rejects.toThrow("DOC_GATE_BLOCKED");
    expect(commessa.stato).toBe("preventivo");
    expect(bloccata.salvataggi()).toBe(0);

    const ammessa = dipendenze(commessa, true);
    const esito = await modulo.eseguiTransizioneCommessa(
      {
        ctx: ctx(),
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        origine: "tars",
        versioneAttesa: modulo.versioneCommessa(commessa),
        attoreNome: "Direzione transizioni",
      },
      ammessa.valore
    );
    expect(esito).toMatchObject({
      da: "preventivo",
      a: "misure_esecutive",
      riusata: false,
    });
    expect(commessa.stato).toBe("misure_esecutive");
    expect(ammessa.salvataggi()).toBe(1);
    expect(ammessa.timeline).toEqual([
      { id: commessa.id, stato: "misure_esecutive" },
    ]);
  });

  it("rilegge la versione prima dell'effetto e rifiuta force fuori dal router legacy", async () => {
    const modulo = await moduloTransizioni();
    expect(modulo).not.toBeNull();
    if (!modulo) return;

    const commessa: CommessaTest = {
      id: 98422,
      sedeId: SEDE,
      stato: "preventivo",
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
      dataConsegnaConfermata: null,
      dataChiusura: null,
    };
    const deps = dipendenze(commessa, true);
    const versioneVecchia = modulo.versioneCommessa(commessa);
    commessa.updatedAt = new Date("2026-08-31T10:01:00.000Z");

    await expect(
      modulo.eseguiTransizioneCommessa(
        {
          ctx: ctx(),
          commessaId: commessa.id,
          nuovoStato: "misure_esecutive",
          origine: "tars",
          versioneAttesa: versioneVecchia,
          attoreNome: "Direzione transizioni",
        },
        deps.valore
      )
    ).rejects.toThrow(/VERSIONE_COMMESSA_OBSOLETA/);
    await expect(
      modulo.eseguiTransizioneCommessa(
        {
          ctx: ctx(),
          commessaId: commessa.id,
          nuovoStato: "misure_esecutive",
          origine: "tars",
          versioneAttesa: modulo.versioneCommessa(commessa),
          bypassGateDocumentale: true,
          attoreNome: "Direzione transizioni",
        },
        deps.valore
      )
    ).rejects.toThrow(/BYPASS_GATE_VIETATO/);
    await expect(
      modulo.eseguiTransizioneCommessa(
        {
          ctx: ctx(),
          commessaId: commessa.id,
          nuovoStato: "misure_esecutive",
          origine: "tars",
          versioneAttesa: modulo.versioneCommessa(commessa),
          patchAutorizzata: { note: "scrittura laterale" },
        },
        deps.valore
      )
    ).rejects.toThrow(/PATCH_TRANSIZIONE_VIETATA/);
    expect(commessa.stato).toBe("preventivo");
    expect(deps.salvataggi()).toBe(0);
  });

  it("Undo usa l'audit server-side, richiede stato/versione immutati e ripristina integralmente il cleanup", async () => {
    const modulo = await moduloTransizioni();
    expect(modulo).not.toBeNull();
    if (!modulo) return;

    const commessa: CommessaTest = {
      id: 98423,
      sedeId: SEDE,
      stato: "produzione",
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
      dataConsegnaConfermata: "2026-09-20",
      dataChiusura: null,
    };
    const deps = dipendenze(commessa, true);
    const indietro = await modulo.eseguiTransizioneCommessa(
      {
        ctx: ctx(),
        commessaId: commessa.id,
        nuovoStato: "da_ordinare",
        origine: "tars",
        versioneAttesa: modulo.versioneCommessa(commessa),
        attoreNome: "Direzione transizioni",
      },
      deps.valore
    );
    expect(commessa.dataConsegnaConfermata).toBeNull();

    const undo = await modulo.annullaTransizioneCommessa(
      {
        ctx: ctx(),
        transizioneId: indietro.transizioneId,
        attoreNome: "Direzione transizioni",
      },
      deps.valore
    );
    expect(undo).toMatchObject({ da: "da_ordinare", a: "produzione" });
    expect(commessa.stato).toBe("produzione");
    expect(commessa.dataConsegnaConfermata).toBe("2026-09-20");
    expect(commessa.dataChiusura).toBeNull();

    await expect(
      modulo.annullaTransizioneCommessa(
        {
          ctx: ctx(),
          transizioneId: indietro.transizioneId,
          attoreNome: "Direzione transizioni",
        },
        deps.valore
      )
    ).rejects.toThrow(/UNDO_TRANSIZIONE_NON_DISPONIBILE/);

    const archiviata: CommessaTest = {
      id: 98427,
      sedeId: SEDE,
      stato: "archiviata",
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
      dataConsegnaConfermata: "2026-09-20",
      dataChiusura: "2026-10-01",
    };
    const depsArchiviata = dipendenze(archiviata, true);
    const riapertura = await modulo.eseguiTransizioneCommessa(
      {
        ctx: ctx(),
        commessaId: archiviata.id,
        nuovoStato: "interventi_regolazioni",
        origine: "tars",
        versioneAttesa: modulo.versioneCommessa(archiviata),
        attoreNome: "Direzione transizioni",
      },
      depsArchiviata.valore
    );
    expect(archiviata.dataChiusura).toBeNull();

    await modulo.annullaTransizioneCommessa(
      {
        ctx: ctx(),
        transizioneId: riapertura.transizioneId,
        attoreNome: "Direzione transizioni",
      },
      depsArchiviata.valore
    );
    expect(archiviata).toMatchObject({
      stato: "archiviata",
      dataConsegnaConfermata: "2026-09-20",
      dataChiusura: "2026-10-01",
    });
  });

  it("non lascia stato senza audit quando la persistenza atomica fallisce", async () => {
    const modulo = await moduloTransizioni();
    expect(modulo).not.toBeNull();
    if (!modulo) return;
    const commessa: CommessaTest = {
      id: 98426,
      sedeId: SEDE,
      stato: "preventivo",
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
      dataConsegnaConfermata: null,
      dataChiusura: null,
    };
    const deps = dipendenze(commessa, true);
    (deps.valore as any).salvaStatoEAudit = async () => {
      throw new Error("persistenza interrotta");
    };

    await expect(
      modulo.eseguiTransizioneCommessa(
        {
          ctx: ctx(),
          commessaId: commessa.id,
          nuovoStato: "misure_esecutive",
          origine: "tars",
          versioneAttesa: modulo.versioneCommessa(commessa),
        },
        deps.valore
      )
    ).rejects.toThrow("persistenza interrotta");
    expect(commessa).toMatchObject({
      stato: "preventivo",
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
    });
  });

  it("Undo fallisce senza effetti se la commessa è cambiata o appartiene a un'altra sede", async () => {
    const modulo = await moduloTransizioni();
    expect(modulo).not.toBeNull();
    if (!modulo) return;

    const commessa: CommessaTest = {
      id: 98424,
      sedeId: SEDE,
      stato: "preventivo",
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
      dataConsegnaConfermata: null,
      dataChiusura: null,
    };
    const deps = dipendenze(commessa, true);
    const avanti = await modulo.eseguiTransizioneCommessa(
      {
        ctx: ctx(),
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        origine: "tars",
        versioneAttesa: modulo.versioneCommessa(commessa),
        attoreNome: "Direzione transizioni",
      },
      deps.valore
    );
    commessa.updatedAt = new Date("2026-08-31T12:01:00.000Z");
    await expect(
      modulo.annullaTransizioneCommessa(
        {
          ctx: ctx(),
          transizioneId: avanti.transizioneId,
          attoreNome: "Direzione transizioni",
        },
        deps.valore
      )
    ).rejects.toThrow(/VERSIONE_COMMESSA_OBSOLETA/);
    expect(commessa.stato).toBe("misure_esecutive");

    await expect(
      modulo.eseguiTransizioneCommessa(
        {
          ctx: ctx(SEDE + 1),
          commessaId: commessa.id,
          nuovoStato: "aggiornamento_contratto",
          origine: "tars",
          versioneAttesa: modulo.versioneCommessa(commessa),
          attoreNome: "Direzione transizioni",
        },
        deps.valore
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Undo non è enumerabile né compensabile da un collega non-direzione", async () => {
    const modulo = await moduloTransizioni();
    expect(modulo).not.toBeNull();
    if (!modulo) return;
    const commessa: CommessaTest = {
      id: 98425,
      sedeId: SEDE,
      stato: "preventivo",
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
      dataConsegnaConfermata: null,
      dataChiusura: null,
    };
    const deps = dipendenze(commessa, true);
    const esito = await modulo.eseguiTransizioneCommessa(
      {
        ctx: ctx(SEDE, 98431, ["direzione"]),
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        origine: "tars",
        versioneAttesa: modulo.versioneCommessa(commessa),
      },
      deps.valore
    );
    await expect(
      modulo.annullaTransizioneCommessa(
        {
          ctx: ctx(SEDE, 98432, ["commerciale"]),
          transizioneId: esito.transizioneId,
        },
        deps.valore
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(commessa.stato).toBe("misure_esecutive");
  });
});
