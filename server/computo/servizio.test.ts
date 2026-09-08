import { beforeEach, describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { leggiContratto, salvaContratto } from "../contratti/servizio";
import { _resetComputiRepositoryForTests } from "./repository";
import { computoValido, correggiVoce, eliminaComputi, eseguiComputo, ultimoComputo } from "./servizio";
import { creaCommessa } from "../routers/commesse";
import { getClientiStore } from "../routers/clienti";
import type { TrpcContext } from "../_core/context";

const SEDE = 1;
const ctx = (): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> => ({
  user: { id: 5, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "T" } as any,
  sedeId: SEDE,
  sediIds: [SEDE],
});
async function nuovaCommessa(): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9201 + clienti.length, sedeId: SEDE, nome: "E", cognome: "B", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(ctx(), { clienteId: cliente.id } as any);
  return (c as any).commessa?.id ?? (c as any).id;
}
/** `tipologia` è parametrizzabile per il caso «CHECK2 incompleto»: un codice DEI non
 * riconosciuto nel catalogo (v. test sotto) non blocca il salvataggio del contratto
 * (solo un'avvertenza, R13 in servizio.ts), ma rende il computo che ne segue incompleto. */
async function commessaConContratto(tipologia = "C25077-e"): Promise<number> {
  const commessaId = await nuovaCommessa();
  await salvaContratto({
    sedeId: SEDE, commessaId, actorUserId: 5,
    contratto: { pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione", detrazioneImmobile: "prima_casa", detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale", documentoId: null, opzioniComputo: OPZIONI_COMPUTO_DEFAULT },
    righe: [{ categoria: "serramento_pvc", tipologia, oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "PF", quantita: 3, larghezzaMm: 1900, altezzaMm: 2400, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale", evidenza: null }],
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

  it("segnala i parametri cambiati quando le righe restano identiche", async () => {
    const commessaId = await commessaConContratto();
    await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    expect((await ultimoComputo(SEDE, commessaId)).valido).toBe(true);
    // stesse righe (hashRighe identico), cambia solo la distanza dal magazzino → hashParametri no
    await salvaContratto({
      sedeId: SEDE, commessaId, actorUserId: 5,
      contratto: { pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 40, detrazioneTipo: "ristrutturazione", detrazioneImmobile: "prima_casa", detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale", documentoId: null, opzioniComputo: OPZIONI_COMPUTO_DEFAULT },
      righe: [{ categoria: "serramento_pvc", tipologia: "C25077-e", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "PF", quantita: 3, larghezzaMm: 1900, altezzaMm: 2400, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale", evidenza: null }],
    });
    const dopo = await ultimoComputo(SEDE, commessaId);
    expect(dopo.valido).toBe(false);
    expect(dopo.motivo).toMatch(/parametri/i);
  });

  it("un computo con una tipologia DEI non riconosciuta è incompleto e mai valido", async () => {
    const commessaId = await commessaConContratto("NON_ESISTE_NEL_CATALOGO");
    const computo = await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    expect(computo.esito).toBe("incompleto");
    const stato = await ultimoComputo(SEDE, commessaId);
    expect(stato.valido).toBe(false);
    expect(stato.motivo).toMatch(/incompleto/i);
  });

  it("senza contratto salvato, il motivo è che manca il contratto", async () => {
    const commessaId = await nuovaCommessa();
    const stato = await ultimoComputo(SEDE, commessaId);
    expect(stato.computo).toBeNull();
    expect(stato.valido).toBe(false);
    expect(stato.motivo).toMatch(/contratto/i);
  });
});

describe("correzioni a mano del computo (08/09/2026)", () => {
  beforeEach(() => {
    _resetContrattiRepositoryForTests();
    _resetComputiRepositoryForTests();
  });
  const contratto = () => ({ pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const, detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale" as const, documentoId: null, opzioniComputo: OPZIONI_COMPUTO_DEFAULT });
  const riga = (altezzaMm = 2400) => ({ categoria: "serramento_pvc" as const, tipologia: "C25077-e", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "PF", quantita: 3, larghezzaMm: 1900, altezzaMm, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale" as const, evidenza: null });
  const nessuna = { quantita: null, prezzoUnitCent: null, limiteCent: null, inclusa: null, motivo: null };

  it("corregge una voce, rifà il computo valido, la scrive nel contratto e un salvataggio dal form la conserva", async () => {
    const commessaId = await commessaConContratto();
    const base = await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    const posaBase = base.voci.find(v => v.codice === "posa")!;
    const esito = await correggiVoce({ sedeId: SEDE, commessaId, actorUserId: 5, codice: "posa", correzione: { ...nessuna, quantita: 8, motivo: " due squadre " } });
    expect(esito.valido).toBe(true);
    const posa = esito.computo.voci.find(v => v.codice === "posa")!;
    expect(posa.quantita).toBe(8);
    expect(posa.dettaglio.correzione).toBe("due squadre");
    expect(posa.dettaglio.limiteCalcolatoCent).toBe(posaBase.limiteCent);
    expect(posa.limiteCent).not.toBe(posaBase.limiteCent);
    expect((await ultimoComputo(SEDE, commessaId)).valido).toBe(true);
    const { contratto: salvato } = await leggiContratto(SEDE, commessaId);
    expect(salvato?.opzioniComputo.correzioni).toEqual([{ codice: "posa", quantita: 8, prezzoUnitCent: null, limiteCent: null, inclusa: null, motivo: "due squadre" }]);
    expect(salvato?.hashParametri).toBe(esito.computo.hashParametri);
    // Il form del contratto non manda correzioni: il salvataggio le conserva e il computo resta valido.
    await salvaContratto({ sedeId: SEDE, commessaId, actorUserId: 5, contratto: contratto(), righe: [riga()] });
    const dopo = await leggiContratto(SEDE, commessaId);
    expect(dopo.contratto?.opzioniComputo.correzioni).toHaveLength(1);
    expect((await ultimoComputo(SEDE, commessaId)).valido).toBe(true);
  });

  it("«ripristina» toglie la correzione; correzione vuota, voce inesistente e altra sede sono rifiutate", async () => {
    const commessaId = await commessaConContratto();
    await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    await correggiVoce({ sedeId: SEDE, commessaId, actorUserId: 5, codice: "posa", correzione: { ...nessuna, limiteCent: 99900 } });
    const tolta = await correggiVoce({ sedeId: SEDE, commessaId, actorUserId: 5, codice: "posa", correzione: null });
    expect(tolta.valido).toBe(true);
    expect(tolta.computo.voci.find(v => v.codice === "posa")!.dettaglio.correzione).toBeUndefined();
    expect((await leggiContratto(SEDE, commessaId)).contratto?.opzioniComputo.correzioni).toEqual([]);
    await expect(correggiVoce({ sedeId: SEDE, commessaId, actorUserId: 5, codice: "posa", correzione: { ...nessuna } })).rejects.toThrow(/VALIDAZIONE/);
    await expect(correggiVoce({ sedeId: SEDE, commessaId, actorUserId: 5, codice: "voce_che_non_esiste", correzione: { ...nessuna, quantita: 1 } })).rejects.toThrow(/non esiste/);
    await expect(correggiVoce({ sedeId: 2, commessaId, actorUserId: 5, codice: "posa", correzione: { ...nessuna, quantita: 1 } })).rejects.toThrow(/NOT_FOUND/);
  });

  it("se cambiano le righe, il salvataggio del contratto avvisa delle correzioni sulle voci per riga", async () => {
    const commessaId = await commessaConContratto();
    await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    await correggiVoce({ sedeId: SEDE, commessaId, actorUserId: 5, codice: "dei_riga_1", correzione: { ...nessuna, limiteCent: 100000, motivo: "prezzo concordato" } });
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, actorUserId: 5, contratto: contratto(), righe: [riga(2500)] });
    expect(esito.avvertenze.some(a => a.includes("Le righe sono cambiate") && a.includes("dei_riga_1"))).toBe(true);
    expect(esito.contratto.opzioniComputo.correzioni).toHaveLength(1);
    expect((await ultimoComputo(SEDE, commessaId)).motivo).toMatch(/righe/i);
  });
});

describe("eliminaComputi (08/09/2026)", () => {
  beforeEach(() => {
    _resetContrattiRepositoryForTests();
    _resetComputiRepositoryForTests();
  });

  it("cancella i computi della commessa: il giudizio torna «nessun computo», il contratto resta e si ricalcola", async () => {
    const commessaId = await commessaConContratto();
    await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    expect(await eliminaComputi({ sedeId: SEDE, commessaId, actorUserId: 5 })).toEqual({ eliminati: 2 });
    const dopo = await ultimoComputo(SEDE, commessaId);
    expect(dopo.computo).toBeNull();
    expect(dopo.motivo).toBe("Nessun computo eseguito.");
    expect((await leggiContratto(SEDE, commessaId)).contratto).not.toBeNull();
    const rifatto = await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: 5 });
    expect(rifatto.esito).toBe("ok");
    // Un'altra sede o una commessa inesistente non trovano nulla da cancellare.
    expect(await eliminaComputi({ sedeId: 2, commessaId, actorUserId: 5 })).toEqual({ eliminati: 0 });
    expect(await eliminaComputi({ sedeId: SEDE, commessaId: 424242, actorUserId: 5 })).toEqual({ eliminati: 0 });
  });
});
