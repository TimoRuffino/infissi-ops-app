// Il bacino della caccia alle conferme: mail in ingresso, non spam, nella
// finestra, con almeno un allegato che potrebbe essere un documento
// d'ordine. Qui il percorso in memoria; la SQL ha lo stesso contratto.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  insertComunicazione,
  listComunicazioniConAllegatiCandidati,
} from "./comunicazioni";

const SEDE = 98_301;
const giorniFa = (n: number) => new Date(Date.now() - n * 86_400_000);

async function mail(extra: Record<string, unknown>) {
  return (await insertComunicazione({
    sedeId: SEDE,
    casellaId: 9,
    messageId: `cand-${Math.random().toString(36).slice(2)}`,
    canale: "email",
    direzione: "in",
    mittente: "ordini@tesconi.it",
    mittenteNome: "Tesconi",
    destinatari: [],
    oggetto: "Conferma ordine",
    testo: "In allegato.",
    allegati: [{ nome: "CO_4471.pdf", mimeType: "application/pdf", size: 1000 }],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    receivedAt: giorniFa(400),
    ...extra,
  } as any))!;
}

describe("listComunicazioniConAllegatiCandidati", () => {
  // Il pre-filtro guarda i fornitori DELLA SEDE. Questi test descrivono il
  // bacino, non il riconoscimento: girano col seed della Ruffino, che è il
  // mondo di prima. Quello nuovo ha il suo test in fondo.
  beforeEach(() => {
    process.env.FLAG_FORNITORI_AZIENDA = "off";
  });
  afterEach(() => {
    delete process.env.FLAG_FORNITORI_AZIENDA;
  });

  it("prende la mail vecchia e scollegata con la conferma allegata; scarta uscita, spam, senza allegati utili, fuori finestra", async () => {
    const vecchiaScollegata = await mail({});
    const inUscita = await mail({ direzione: "out" });
    const spam = await mail({ categoria: "spam" });
    const senzaAllegatiUtili = await mail({
      allegati: [{ nome: "foto_cantiere.jpg", mimeType: "image/jpeg", size: 100 }],
    });
    const troppoVecchia = await mail({ receivedAt: giorniFa(600) });
    const troppoGrande = await mail({
      allegati: [{ nome: "Conferma.pdf", mimeType: "application/pdf", size: 50 * 1024 * 1024 }],
    });

    const trovate = await listComunicazioniConAllegatiCandidati({
      sedeId: SEDE,
      giorniIndietro: 540,
    });
    const ids = trovate.map(c => c.id);
    expect(ids).toContain(vecchiaScollegata.id);
    expect(ids).not.toContain(inUscita.id);
    expect(ids).not.toContain(spam.id);
    expect(ids).not.toContain(senzaAllegatiUtili.id);
    expect(ids).not.toContain(troppoVecchia.id);
    expect(ids).not.toContain(troppoGrande.id);
  });

  it("una mail di un fornitore noto entra anche col nome del file muto; una qualunque no", async () => {
    // Il caso Primed: 312 mail in un anno, nome del file che non dice
    // niente, zero voci in archivio.
    const primed = await mail({
      mittente: "amministrazione@primed.it",
      mittenteNome: "PRIMED S.R.L.",
      allegati: [
        { nome: "R237_2026WU367846_20052026165105.pdf", mimeType: "application/pdf", size: 120_000 },
      ],
    });
    // Lo stesso nome muto da un mittente qualunque resta fuori.
    const estranea = await mail({
      mittente: "mario@gmail.com",
      mittenteNome: "Mario",
      allegati: [
        { nome: "R237_2026WU367846_20052026165105.pdf", mimeType: "application/pdf", size: 120_000 },
      ],
    });
    // La porta del mittente si apre solo ai documenti: senza questo vincolo
    // le 118 image001.png della firma di Oskura entrerebbero a ogni giro.
    const firmaOskura = await mail({
      mittente: "vendite@oskura.it",
      mittenteNome: "Oskura",
      allegati: [{ nome: "image001.png", mimeType: "image/png", size: 4_000 }],
    });

    const ids = (
      await listComunicazioniConAllegatiCandidati({ sedeId: SEDE, giorniIndietro: 540 })
    ).map(c => c.id);
    expect(ids).toContain(primed.id);
    expect(ids).not.toContain(estranea.id);
    expect(ids).not.toContain(firmaOskura.id);
  });

  it("la finestra e il limite si possono stringere, mai oltre i tetti", async () => {
    const recente = await mail({ receivedAt: giorniFa(5) });
    const strette = await listComunicazioniConAllegatiCandidati({
      sedeId: SEDE,
      giorniIndietro: 30,
      limite: 1,
    });
    expect(strette).toHaveLength(1);
    expect(strette[0].id).toBe(recente.id);
  });
});

describe("il pre-filtro segue l'anagrafica della sede", () => {
  afterEach(() => {
    delete process.env.FLAG_FORNITORI_AZIENDA;
  });

  it("a interruttore acceso e anagrafica vuota nessun mittente è «noto» — ma nessuno diventa noto per sbaglio", () => {
    process.env.FLAG_FORNITORI_AZIENDA = "on";
    // `sorgenteMittenti()` di un elenco vuoto è `(?!)`: non combacia con
    // niente. Se fosse la stringa vuota, questa query pescherebbe OGNI mail.
    return (async () => {
      const muta = await mail({
        mittente: "amministrazione@primed.it",
        mittenteNome: "PRIMED S.R.L.",
        allegati: [
          { nome: "R237_2026WU367846_20052026165105.pdf", mimeType: "application/pdf", size: 120_000 },
        ],
      });
      const ids = (
        await listComunicazioniConAllegatiCandidati({ sedeId: SEDE, giorniIndietro: 540 })
      ).map(c => c.id);
      expect(ids).not.toContain(muta.id);
    })();
  });
});
