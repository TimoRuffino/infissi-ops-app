import { beforeEach, describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { salvaContratto } from "../contratti/servizio";
import { _resetComputiRepositoryForTests } from "./repository";
import { computoValido, eseguiComputo, ultimoComputo } from "./servizio";
import { creaCommessa } from "../routers/commesse";
import { getClientiStore } from "../routers/clienti";
import type { TrpcContext } from "../_core/context";

const SEDE = 1;
const ctx = (): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> => ({
  user: { id: 5, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "T" } as any,
  sedeId: SEDE,
  sediIds: [SEDE],
});
async function commessaConContratto(): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9201 + clienti.length, sedeId: SEDE, nome: "E", cognome: "B", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(ctx(), { clienteId: cliente.id } as any);
  const commessaId = (c as any).commessa?.id ?? (c as any).id;
  await salvaContratto({
    sedeId: SEDE, commessaId, actorUserId: 5,
    contratto: { pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione", detrazioneImmobile: "prima_casa", detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale", documentoId: null, opzioniComputo: OPZIONI_COMPUTO_DEFAULT },
    righe: [{ categoria: "serramento_pvc", tipologia: "C25077-e", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "PF", quantita: 3, larghezzaMm: 1900, altezzaMm: 2400, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale", evidenza: null }],
  });
  return commessaId;
}

describe("servizio computo", () => {
  beforeEach(() => {
    _resetContrattiRepositoryForTests();
    _resetComputiRepositoryForTests();
  });

  it("esegue il computo dal contratto e lo dichiara valido finché le righe non cambiano", async () => {
    const commessaId = await commessaConContratto();
    expect(await computoValido(SEDE, commessaId)).toBe(false);
    const computo = await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    expect(computo.zona).toBe("D");
    expect(computo.esito).toBe("ok");
    expect(computo.voci.find(v => v.codice === "massimale_A")?.limiteCent).toBe(1067040); // 780 × 13,68
    expect(await computoValido(SEDE, commessaId)).toBe(true);
    const stato = await ultimoComputo(SEDE, commessaId);
    expect(stato.valido).toBe(true);
    // cambia una misura → superato
    await salvaContratto({
      sedeId: SEDE, commessaId, actorUserId: 5,
      contratto: { pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione", detrazioneImmobile: "prima_casa", detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale", documentoId: null, opzioniComputo: OPZIONI_COMPUTO_DEFAULT },
      righe: [{ categoria: "serramento_pvc", tipologia: "C25077-e", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "PF", quantita: 3, larghezzaMm: 1900, altezzaMm: 2500, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale", evidenza: null }],
    });
    const dopo = await ultimoComputo(SEDE, commessaId);
    expect(dopo.valido).toBe(false);
    expect(dopo.motivo).toMatch(/righe/i);
  });

  it("senza contratto il computo rifiuta con NOT_FOUND", async () => {
    await expect(eseguiComputo({ sedeId: SEDE, commessaId: 424242, actorUserId: 5 })).rejects.toThrow("NOT_FOUND");
  });
});
