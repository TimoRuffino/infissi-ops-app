import { beforeEach, describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { _resetComputiRepositoryForTests } from "../computo/repository";
import { creaCommessa } from "./commesse";
import { getClientiStore } from "./clienti";

function context(sedeId: number, userId: number, ruoli: string[]): TrpcContext {
  return {
    user: { id: userId, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "T" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}
const contratto = {
  pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null,
  comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18,
  detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
  detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale" as const, documentoId: null,
  opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
};
const riga = {
  categoria: "serramento_pvc" as const, tipologia: "C25077-c", oscuranteIntegrato: null,
  oscuranteTipologia: null,
  descrizione: "Finestra", quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null,
  prezzoUnitCent: null, prezzoTotCent: 300000, beneSignificativo: true, accessori: [], note: null,
  origine: "manuale" as const, evidenza: null,
};
async function commessaDiProva(sedeId = 1): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9301 + clienti.length, sedeId, nome: "E", cognome: "B", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(context(sedeId, 1, ["direzione"]), { clienteId: cliente.id } as any);
  return (c as any).commessa?.id ?? (c as any).id;
}

describe("router computo", () => {
  beforeEach(() => {
    _resetContrattiRepositoryForTests();
    _resetComputiRepositoryForTests();
  });

  it("il commerciale esegue e rilegge; la squadra di posa legge soltanto", async () => {
    const commessaId = await commessaDiProva();
    const commerciale = appRouter.createCaller(context(1, 21, ["commerciale"]));
    await commerciale.contratti.salva({ commessaId, contratto, righe: [riga] });
    const prima = await commerciale.computo.ultimo({ commessaId });
    expect(prima.computo).toBeNull();
    expect(prima.puoEseguire).toBe(true);
    const computo = await commerciale.computo.esegui({ commessaId });
    expect(computo.esito).toBe("ok");
    const posa = appRouter.createCaller(context(1, 22, ["squadra_posa"]));
    const letto = await posa.computo.ultimo({ commessaId });
    expect(letto.valido).toBe(true);
    expect(letto.puoEseguire).toBe(false);
    await expect(posa.computo.esegui({ commessaId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("senza contratto: PRECONDITION_FAILED; altra sede: NOT_FOUND", async () => {
    const commessaId = await commessaDiProva();
    const caller = appRouter.createCaller(context(1, 23, ["direzione"]));
    await expect(caller.computo.esegui({ commessaId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const altra = appRouter.createCaller(context(2, 24, ["direzione"]));
    await expect(altra.computo.ultimo({ commessaId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
