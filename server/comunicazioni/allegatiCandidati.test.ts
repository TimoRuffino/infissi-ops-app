// Il bacino della caccia alle conferme: mail in ingresso, non spam, nella
// finestra, con almeno un allegato che potrebbe essere un documento
// d'ordine. Qui il percorso in memoria; la SQL ha lo stesso contratto.

import { describe, expect, it } from "vitest";
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
