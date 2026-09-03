import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import {
  eseguiTransizioneCommessa,
  storeTransizioniCommessa,
  verificaTransizioneCommessa,
} from "./transizioni";

const SEDE = 98501;
function ctx(): TrpcContext {
  return {
    user: { id: 98511, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}
function commessa(stato = "aggiornamento_contratto") {
  return { id: 98531, sedeId: SEDE, stato, updatedAt: new Date("2026-09-01T10:00:00Z"), dataConsegnaConfermata: null, dataChiusura: null } as any;
}
function dipendenze(c: any, computoValido: boolean) {
  return {
    trovaCommessa: (id: number) => (id === c.id ? c : null),
    eseguiStatoEAuditAtomico: async (operazione: any) => operazione(async () => {}),
    haDocumentoRichiesto: () => true,
    documentiRichiesti: () => [],
    etichettaDocumento: (tipo: string) => tipo,
    allineaTimeline: async () => {},
    computoValido: async () => computoValido,
    ora: () => new Date("2026-09-03T12:00:00.000Z"),
  };
}

describe("gate computo sulla transizione aggiornamento_contratto → fatture_pagamento", () => {
  it("la verifica blocca solo quel passaggio in avanti e solo con computo non valido", () => {
    const base = { commessa: commessa(), haDocumentoRichiesto: () => true, documentiRichiesti: () => [] as string[] };
    const bloccata = verificaTransizioneCommessa({ ...base, nuovoStato: "fatture_pagamento", computoValido: false });
    expect(bloccata.consentita).toBe(false);
    expect(bloccata.gate.bloccante).toBe(true);
    expect(bloccata.gate.computo).toEqual({ richiesto: true, valido: false });
    expect(bloccata.motivo).toMatch(/computo/i);
    const ok = verificaTransizioneCommessa({ ...base, nuovoStato: "fatture_pagamento", computoValido: true });
    expect(ok.consentita).toBe(true);
    const indietro = verificaTransizioneCommessa({ ...base, nuovoStato: "misure_esecutive", computoValido: false });
    expect(indietro.consentita).toBe(true);
    expect(indietro.gate.computo.richiesto).toBe(false);
    const sconosciuto = verificaTransizioneCommessa({ ...base, nuovoStato: "fatture_pagamento" });
    expect(sconosciuto.gate.computo).toEqual({ richiesto: true, valido: null });
    expect(sconosciuto.consentita).toBe(true);
  });

  it("l'esecuzione rifiuta con DOC_GATE_BLOCKED e testo sul computo; lo scavalco viene registrato", async () => {
    const c = commessa();
    await expect(
      eseguiTransizioneCommessa({ ctx: ctx(), commessaId: c.id, nuovoStato: "fatture_pagamento", origine: "router" }, dipendenze(c, false))
    ).rejects.toThrow(/^DOC_GATE_BLOCKED: .*computo dei limiti/i);
    expect(c.stato).toBe("aggiornamento_contratto");
    const esito = await eseguiTransizioneCommessa(
      { ctx: ctx(), commessaId: c.id, nuovoStato: "fatture_pagamento", origine: "router", bypassGateDocumentale: true },
      dipendenze(c, false)
    );
    expect(esito.a).toBe("fatture_pagamento");
    const registro = storeTransizioniCommessa.items.find(r => r.id === esito.transizioneId);
    expect(registro?.bypassGateDocumentale).toBe(true);
    expect((registro as any)?.gateScavalcato).toBe("computo");
  });

  it("con computo valido passa senza scavalco", async () => {
    const c = commessa();
    const esito = await eseguiTransizioneCommessa(
      { ctx: ctx(), commessaId: c.id, nuovoStato: "fatture_pagamento", origine: "router" },
      dipendenze(c, true)
    );
    const registro = storeTransizioniCommessa.items.find(r => r.id === esito.transizioneId);
    expect((registro as any)?.gateScavalcato).toBeNull();
  });
});
