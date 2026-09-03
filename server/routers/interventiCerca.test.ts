// Cercare un appuntamento nel calendario.
//
// Il punto della ricerca è trovare quello che NON si vede: filtrare il mese
// aperto non servirebbe a niente. Quindi questi casi guardano soprattutto due
// cose — che la ricerca attraversi le date, e che non attraversi le sedi.
//
// Il secondo è la regola di casa: un record di un'altra sede deve dare
// `NOT_FOUND`, mai informazioni utili a enumerarlo. Una ricerca è il modo più
// facile per far uscire dati da una sede senza accorgersene.

import { beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getInterventiStore } from "./interventi";

const SEDE = 94_301;
const ALTRA_SEDE = 94_302;
const UTENTE = 94_311;

function contesto(sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: UTENTE,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione Test",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const caller = (sedeId = SEDE) => appRouter.createCaller(contesto(sedeId));

/** Scrive dritto nello store: qui interessa la lettura, non la creazione. */
function semina(righe: Array<Record<string, unknown>>) {
  const store = getInterventiStore() as any[];
  let id = 940_000;
  for (const riga of righe) {
    store.push({
      id: id++,
      sedeId: SEDE,
      tipo: "posa",
      stato: "pianificato",
      commessaId: null,
      squadraId: null,
      tecnicoId: null,
      titolo: null,
      note: null,
      indirizzo: null,
      oraInizio: null,
      oraFine: null,
      ...riga,
    });
  }
}

const OGGI = new Date().toISOString().slice(0, 10);
const giorno = (scarto: number) =>
  new Date(Date.now() + scarto * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  const store = getInterventiStore() as any[];
  for (let i = store.length - 1; i >= 0; i--) {
    if (store[i].id >= 940_000) store.splice(i, 1);
  }
});

describe("interventi.cerca", () => {
  it("trova per titolo anche fuori dal periodo mostrato", async () => {
    semina([
      { titolo: "Guerrero - posa pf", dataPianificata: giorno(200) },
      { titolo: "Altro lavoro", dataPianificata: OGGI },
    ]);
    const r = await caller().interventi.cerca({ q: "guerrero" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      titolo: "Guerrero - posa pf",
      data: giorno(200),
    });
  });

  it("cerca senza accenti, da tutt'e due i lati", async () => {
    semina([{ indirizzo: "Via Forlì 3", dataPianificata: OGGI }]);
    expect(await caller().interventi.cerca({ q: "forli" })).toHaveLength(1);
    expect(await caller().interventi.cerca({ q: "FORLÌ" })).toHaveLength(1);
  });

  it("trova nella nota, dove finisce quello che si scrive al volo", async () => {
    semina([{ note: "Registrare ante Zannini", dataPianificata: OGGI }]);
    expect(await caller().interventi.cerca({ q: "ante" })).toHaveLength(1);
  });

  it("trova per tipo, con l'etichetta che si legge a schermo", async () => {
    semina([{ tipo: "ferie", dataPianificata: OGGI }]);
    expect(await caller().interventi.cerca({ q: "ferie" })).toHaveLength(1);
  });

  it("un appuntamento di un'altra sede non esiste", async () => {
    semina([{ titolo: "Segreto Altrui", dataPianificata: OGGI }]);
    const store = getInterventiStore() as any[];
    store[store.length - 1].sedeId = ALTRA_SEDE;
    expect(await caller().interventi.cerca({ q: "segreto" })).toEqual([]);
  });

  it("gli annullati restano fuori: non sono appuntamenti", async () => {
    semina([
      { titolo: "Annullato Mario", dataPianificata: OGGI, stato: "annullato" },
    ]);
    expect(await caller().interventi.cerca({ q: "annullato mario" })).toEqual([]);
  });

  it("i più vicini a oggi vengono prima", async () => {
    semina([
      { titolo: "Rossi lontano", dataPianificata: giorno(90) },
      { titolo: "Rossi vicino", dataPianificata: giorno(2) },
      { titolo: "Rossi passato", dataPianificata: giorno(-30) },
    ]);
    const r = await caller().interventi.cerca({ q: "rossi" });
    expect(r.map(x => x.titolo)).toEqual([
      "Rossi vicino",
      "Rossi passato",
      "Rossi lontano",
    ]);
  });

  it("una ricerca vuota non restituisce il calendario intero", async () => {
    semina([{ titolo: "Qualcosa", dataPianificata: OGGI }]);
    expect(await caller().interventi.cerca({ q: "   " })).toEqual([]);
  });

  it("il limite si rispetta", async () => {
    semina(
      Array.from({ length: 12 }, (_, n) => ({
        titolo: `Ripetuto ${n}`,
        dataPianificata: giorno(n),
      }))
    );
    expect(await caller().interventi.cerca({ q: "ripetuto", limite: 5 })).toHaveLength(5);
  });

  it("restituisce la data, che è il motivo per cui si cerca", async () => {
    semina([
      { titolo: "Con orario", dataPianificata: giorno(3), oraInizio: "09:00", oraFine: "10:00" },
    ]);
    const [r] = await caller().interventi.cerca({ q: "con orario" });
    expect(r).toMatchObject({
      data: giorno(3),
      oraInizio: "09:00",
      oraFine: "10:00",
    });
    expect(r.id).toBeGreaterThan(0);
  });
});
