import { beforeEach, describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
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
async function commessaDiProva(sedeId = 1): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9101 + clienti.length, sedeId, nome: "Elena", cognome: "Bianchi", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(context(sedeId, 1, ["direzione"]), { clienteId: cliente.id } as any);
  return (c as any).commessa?.id ?? (c as any).id;
}
const contratto = {
  pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null,
  comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18,
  detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
  detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale" as const, documentoId: null,
  opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
};
const riga = {
  categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null,
  oscuranteTipologia: null,
  descrizione: "Finestra", quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null,
  prezzoUnitCent: null, prezzoTotCent: 300000, beneSignificativo: true, accessori: [], note: null,
  origine: "manuale" as const, evidenza: null,
};

describe("router contratti", () => {
  beforeEach(() => _resetContrattiRepositoryForTests());

  it("il commerciale salva e rilegge; la squadra di posa legge soltanto", async () => {
    const commessaId = await commessaDiProva();
    const commerciale = appRouter.createCaller(context(1, 11, ["commerciale"]));
    const esito = await commerciale.contratti.salva({ commessaId, contratto, righe: [riga] });
    expect(esito.righe).toHaveLength(1);
    const posa = appRouter.createCaller(context(1, 12, ["squadra_posa"]));
    const letto = await posa.contratti.get({ commessaId });
    expect(letto.contratto?.pattuitoCent).toBe(1539500);
    expect(letto.puoModificare).toBe(false);
    await expect(posa.contratti.salva({ commessaId, contratto, righe: [riga] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un'altra sede riceve NOT_FOUND, non FORBIDDEN", async () => {
    const commessaId = await commessaDiProva(1);
    const altra = appRouter.createCaller(context(2, 13, ["direzione"]));
    await expect(altra.contratti.get({ commessaId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(altra.contratti.salva({ commessaId, contratto, righe: [riga] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gli errori di validazione arrivano come BAD_REQUEST leggibili", async () => {
    const commessaId = await commessaDiProva();
    const caller = appRouter.createCaller(context(1, 14, ["direzione"]));
    await expect(caller.contratti.salva({ commessaId, contratto: { ...contratto, rate: [{ numero: 1, quotaPct: 30, giorni: 0, data: null, descrizione: null }] }, righe: [riga] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
