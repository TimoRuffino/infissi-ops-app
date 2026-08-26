// La chat è nuova persistenza: senza DATABASE_URL gira sul fallback in
// memoria, ed è quello che questi test esercitano. Le query PostgreSQL
// restano da verificare su Railway.

import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetChatInMemoria,
  canaleGenerale,
  chiaveDiretta,
  leggiMessaggi,
  listaCanali,
  scriviMessaggio,
  segnaLetto,
  trovaCanale,
  trovaOCreaCanale,
} from "./store";

const SEDE = 1;
const ALTRA_SEDE = 2;

beforeEach(() => {
  _resetChatInMemoria();
});

describe("chiaveDiretta", () => {
  it("è la stessa nei due versi", () => {
    expect(chiaveDiretta(3, 9)).toBe(chiaveDiretta(9, 3));
    expect(chiaveDiretta(3, 9)).toBe("dm:3:9");
  });
});

describe("canali", () => {
  it("il generale esiste una volta sola per sede", async () => {
    const primo = await canaleGenerale(SEDE);
    const secondo = await canaleGenerale(SEDE);
    expect(secondo.id).toBe(primo.id);

    const altra = await canaleGenerale(ALTRA_SEDE);
    expect(altra.id).not.toBe(primo.id);
  });

  it("una diretta richiesta due volte non si sdoppia", async () => {
    const a = await trovaOCreaCanale({
      sedeId: SEDE,
      tipo: "diretto",
      chiave: chiaveDiretta(1, 2),
      nome: "Alessandro",
      membriIds: [1, 2],
    });
    const b = await trovaOCreaCanale({
      sedeId: SEDE,
      tipo: "diretto",
      chiave: chiaveDiretta(2, 1),
      nome: "Timmy",
      membriIds: [2, 1],
    });
    expect(b.id).toBe(a.id);
  });

  it("la lista mostra il generale a tutti e le dirette solo ai membri", async () => {
    await canaleGenerale(SEDE);
    await trovaOCreaCanale({
      sedeId: SEDE,
      tipo: "diretto",
      chiave: chiaveDiretta(1, 2),
      nome: "Coppia",
      membriIds: [1, 2],
    });

    const perUno = await listaCanali({ sedeId: SEDE, utenteId: 1 });
    const perTre = await listaCanali({ sedeId: SEDE, utenteId: 3 });

    expect(perUno.map(c => c.tipo).sort()).toEqual(["diretto", "generale"]);
    expect(perTre.map(c => c.tipo)).toEqual(["generale"]);
  });

  it("un canale di un'altra sede non è raggiungibile per id", async () => {
    const canale = await canaleGenerale(ALTRA_SEDE);
    expect(await trovaCanale(SEDE, canale.id)).toBeNull();
    expect(await trovaCanale(ALTRA_SEDE, canale.id)).not.toBeNull();
  });
});

describe("messaggi", () => {
  it("rifiuta un messaggio vuoto", async () => {
    const canale = await canaleGenerale(SEDE);
    await expect(
      scriviMessaggio({
        sedeId: SEDE,
        canaleId: canale.id,
        autoreId: 1,
        autoreNome: "Timmy",
        testo: "   ",
      })
    ).rejects.toThrow();
  });

  it("conserva l'ordine cronologico e il contesto", async () => {
    const canale = await canaleGenerale(SEDE);
    await scriviMessaggio({
      sedeId: SEDE,
      canaleId: canale.id,
      autoreId: 1,
      autoreNome: "Timmy",
      testo: "primo",
    });
    await scriviMessaggio({
      sedeId: SEDE,
      canaleId: canale.id,
      autoreId: null,
      autoreNome: "Tars",
      testo: "secondo",
      commessaId: 42,
      propostaId: 7,
    });

    const messaggi = await leggiMessaggi({ sedeId: SEDE, canaleId: canale.id });
    expect(messaggi.map(m => m.testo)).toEqual(["primo", "secondo"]);
    expect(messaggi[1]).toMatchObject({
      autoreId: null,
      autoreNome: "Tars",
      commessaId: 42,
      propostaId: 7,
    });
  });

  it("i messaggi di un'altra sede non entrano nella lettura", async () => {
    const canale = await canaleGenerale(SEDE);
    await scriviMessaggio({
      sedeId: SEDE,
      canaleId: canale.id,
      autoreId: 1,
      autoreNome: "Timmy",
      testo: "mio",
    });
    expect(
      await leggiMessaggi({ sedeId: ALTRA_SEDE, canaleId: canale.id })
    ).toEqual([]);
  });
});

describe("non letti", () => {
  it("conta i messaggi altrui e non i propri", async () => {
    const canale = await canaleGenerale(SEDE);
    await scriviMessaggio({
      sedeId: SEDE,
      canaleId: canale.id,
      autoreId: 2,
      autoreNome: "Alessandro",
      testo: "ciao",
    });
    await scriviMessaggio({
      sedeId: SEDE,
      canaleId: canale.id,
      autoreId: 1,
      autoreNome: "Timmy",
      testo: "risposta mia",
    });

    const perUno = await listaCanali({ sedeId: SEDE, utenteId: 1 });
    expect(perUno[0].nonLetti).toBe(1);
    expect(perUno[0].ultimo?.testo).toBe("risposta mia");
  });

  it("i messaggi di sistema contano come non letti", async () => {
    const canale = await canaleGenerale(SEDE);
    await scriviMessaggio({
      sedeId: SEDE,
      canaleId: canale.id,
      autoreId: null,
      autoreNome: "Tars",
      testo: "ho eseguito qualcosa",
    });
    const lista = await listaCanali({ sedeId: SEDE, utenteId: 1 });
    expect(lista[0].nonLetti).toBe(1);
  });

  it("segnaLetto azzera e non arretra", async () => {
    const canale = await canaleGenerale(SEDE);
    const primo = await scriviMessaggio({
      sedeId: SEDE,
      canaleId: canale.id,
      autoreId: 2,
      autoreNome: "Alessandro",
      testo: "uno",
    });
    const secondo = await scriviMessaggio({
      sedeId: SEDE,
      canaleId: canale.id,
      autoreId: 2,
      autoreNome: "Alessandro",
      testo: "due",
    });

    await segnaLetto({
      sedeId: SEDE,
      canaleId: canale.id,
      utenteId: 1,
      finoAId: secondo.id,
    });
    expect((await listaCanali({ sedeId: SEDE, utenteId: 1 }))[0].nonLetti).toBe(
      0
    );

    // Una seconda scheda con un segnalibro vecchio non deve far ricomparire
    // i messaggi come non letti.
    await segnaLetto({
      sedeId: SEDE,
      canaleId: canale.id,
      utenteId: 1,
      finoAId: primo.id,
    });
    expect((await listaCanali({ sedeId: SEDE, utenteId: 1 }))[0].nonLetti).toBe(
      0
    );
  });
});
