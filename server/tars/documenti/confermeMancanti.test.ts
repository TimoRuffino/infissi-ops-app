// La caccia alle conferme d'ordine mancanti: chi entra nell'elenco, quali
// file sono candidati e quando la certezza basta per archiviare da soli.

import { describe, expect, it } from "vitest";
import {
  allegatoDaConferma,
  confermeOrdineMancanti,
  nomeDaConferma,
  type DipendenzeConfermeMancanti,
} from "./confermeMancanti";

const SEDE = 98_101;

const comunicazione = (extra: Partial<any>): any => ({
  id: 1,
  sedeId: SEDE,
  canale: "email",
  mittente: "ordini@tesconi.it",
  mittenteNome: "Tesconi",
  oggetto: "Conferma ordine",
  testo: "In allegato la conferma.",
  commessaId: null,
  clienteId: null,
  receivedAt: new Date("2026-09-01T09:00:00Z"),
  allegati: [],
  ...extra,
});

function deps(parziale: Partial<DipendenzeConfermeMancanti> = {}): DipendenzeConfermeMancanti {
  return {
    commesse: () => [
      // Da ordinare, senza conferma: deve comparire.
      { id: 10, sedeId: SEDE, codice: "COM-2026-010", cliente: "Tesconi Srl", stato: "da_ordinare" },
      // In produzione, senza conferma: pure.
      { id: 11, sedeId: SEDE, codice: "COM-2026-011", cliente: "Bianchi", stato: "produzione" },
      // In preventivo: la conferma non è ancora attesa.
      { id: 12, sedeId: SEDE, codice: "COM-2026-012", cliente: "Verdi", stato: "preventivo" },
      // Ha già la conferma nel fascicolo.
      { id: 13, sedeId: SEDE, codice: "COM-2026-013", cliente: "Neri", stato: "produzione" },
      // Archiviata: fuori.
      { id: 14, sedeId: SEDE, codice: "COM-2026-014", cliente: "Vecchia", stato: "produzione", archivedAt: new Date() },
      // Altra sede: invisibile.
      { id: 15, sedeId: SEDE + 1, codice: "COM-2026-015", cliente: "Altrove", stato: "da_ordinare" },
    ],
    documentiDiCommessa: commessaId =>
      commessaId === 13 ? [{ tipo: "conferma_ordine" }] : [{ tipo: "preventivo" }],
    comunicazioniConAllegati: async () => [],
    giaArchiviato: () => false,
    link: c => `/messaggi/email?messaggio=${c.id}`,
    ...parziale,
  };
}

describe("confermeOrdineMancanti", () => {
  it("elenca solo le commesse dove la conferma è attesa e manca", async () => {
    const righe = await confermeOrdineMancanti({ sedeId: SEDE, deps: deps() });
    expect(righe.map(r => r.commessaId).sort()).toEqual([10, 11]);
  });

  it("mail collegata + file «conferma» = certa (Tars archivia da solo)", async () => {
    const righe = await confermeOrdineMancanti({
      sedeId: SEDE,
      deps: deps({
        comunicazioniConAllegati: async () => [
          comunicazione({
            id: 900,
            commessaId: 10,
            allegati: [
              { nome: "Conferma_ordine_4471.pdf", mimeType: "application/pdf", size: 10 },
              { nome: "listino2026.pdf", mimeType: "application/pdf", size: 10 },
            ],
          }),
        ],
      }),
    });
    const tesconi = righe.find(r => r.commessaId === 10)!;
    expect(tesconi.candidati).toHaveLength(1);
    expect(tesconi.candidati[0]).toMatchObject({
      comunicazioneId: 900,
      allegatoIndex: 0,
      nomeFile: "Conferma_ordine_4471.pdf",
      certezza: "certa",
      link: "/messaggi/email?messaggio=900",
    });
    expect(tesconi.esito).toBe("archiviabile_subito");
    // La commessa con il file pronto viene prima di quella senza.
    expect(righe[0].commessaId).toBe(10);
  });

  it("mail non collegata che cita il codice, o file solo «ordine»: probabile, mai certa", async () => {
    const righe = await confermeOrdineMancanti({
      sedeId: SEDE,
      deps: deps({
        comunicazioniConAllegati: async () => [
          comunicazione({
            id: 901,
            commessaId: null,
            oggetto: "Vs. COM-2026-010",
            allegati: [{ nome: "Conferma_ordine.pdf", mimeType: "application/pdf", size: 10 }],
          }),
          comunicazione({
            id: 902,
            commessaId: 11,
            allegati: [{ nome: "ordine_fornitore_88.pdf", mimeType: "application/pdf", size: 10 }],
          }),
        ],
      }),
    });
    expect(righe.find(r => r.commessaId === 10)!.candidati[0]).toMatchObject({
      certezza: "probabile",
      comunicazioneId: 901,
    });
    expect(righe.find(r => r.commessaId === 11)!.candidati[0]).toMatchObject({
      certezza: "probabile",
      comunicazioneId: 902,
    });
  });

  it("dice «non trovata» quando la conferma non c'è, e cerca anche fra le mail del cliente", async () => {
    const righe = await confermeOrdineMancanti({
      sedeId: SEDE,
      deps: deps({
        commesse: () => [
          { id: 20, sedeId: SEDE, codice: "COM-2026-020", cliente: "Tesconi", clienteId: 77, stato: "produzione" },
          { id: 21, sedeId: SEDE, codice: "COM-2026-021", cliente: "Scoperta", clienteId: 78, stato: "produzione" },
        ],
        comunicazioniConAllegati: async () => [
          // Del cliente della commessa 20, ma non collegata e senza codice:
          // il fornitore cita il SUO riferimento, non il nostro.
          comunicazione({
            id: 910,
            commessaId: null,
            clienteId: 77,
            oggetto: "Conferma ordine 4471",
            allegati: [{ nome: "CO_4471.pdf", mimeType: "application/pdf", size: 10 }],
          }),
        ],
      }),
    });
    const conFile = righe.find(r => r.commessaId === 20)!;
    expect(conFile.esito).toBe("da_confermare");
    expect(conFile.candidati[0].motivo).toContain("stesso cliente");
    const scoperta = righe.find(r => r.commessaId === 21)!;
    expect(scoperta.esito).toBe("non_trovata");
    expect(scoperta.candidati).toEqual([]);
  });

  it("allegato già archiviato o mail estranea: nessun candidato", async () => {
    const comunicazioni = [
      comunicazione({
        id: 903,
        commessaId: 10,
        allegati: [{ nome: "Conferma_ordine.pdf", mimeType: "application/pdf", size: 10 }],
      }),
      // Non collegata e non cita nessun codice: rumore, resta fuori.
      comunicazione({
        id: 904,
        commessaId: null,
        oggetto: "Newsletter serramenti",
        testo: "Offerte del mese",
        allegati: [{ nome: "conferma_iscrizione.pdf", mimeType: "application/pdf", size: 10 }],
      }),
    ];
    const righe = await confermeOrdineMancanti({
      sedeId: SEDE,
      deps: deps({
        comunicazioniConAllegati: async () => comunicazioni,
        giaArchiviato: (_s, comunicazioneId) => comunicazioneId === 903,
      }),
    });
    expect(righe.every(r => r.candidati.length === 0)).toBe(true);
    expect(righe.every(r => r.esito === "non_trovata")).toBe(true);
  });
});

describe("nomi che NON sono conferme d'ordine", () => {
  it("scarta conferme di iscrizione/lettura, ordini del cliente, fatture e DDT", async () => {
    const rumore = [
      "conferma_iscrizione.pdf",
      "conferma di lettura.pdf",
      "conferma della ricezione.pdf",
      "conferma_pagamento.pdf",
      "Ordine_cliente_Rossi.pdf",
      "ordine di servizio.pdf",
      "fattura_118.pdf",
      "DDT_consegna.pdf",
      "preventivo_ordine.pdf",
    ];
    const righe = await confermeOrdineMancanti({
      sedeId: SEDE,
      deps: deps({
        comunicazioniConAllegati: async () => [
          comunicazione({
            id: 920,
            commessaId: 10,
            allegati: rumore.map(nome => ({
              nome,
              mimeType: "application/pdf",
              size: 10,
            })),
          }),
        ],
      }),
    });
    expect(righe.find(r => r.commessaId === 10)!.candidati).toEqual([]);
  });

  it("un'immagine o un invito non sono documenti d'ordine, qualunque sia il nome", async () => {
    const righe = await confermeOrdineMancanti({
      sedeId: SEDE,
      deps: deps({
        comunicazioniConAllegati: async () => [
          comunicazione({
            id: 921,
            commessaId: 10,
            allegati: [
              { nome: "conferma_ordine.jpg", mimeType: "image/jpeg", size: 10 },
              { nome: "conferma_ordine.ics", mimeType: "text/calendar", size: 10 },
            ],
          }),
        ],
      }),
    });
    expect(righe.find(r => r.commessaId === 10)!.candidati).toEqual([]);
  });
});

describe("nomeDaConferma", () => {
  it("riconosce i nomi che dichiarano una conferma o un ordine", () => {
    expect(nomeDaConferma("Ordini_di_Vendi_1684077(1).pdf", "application/pdf")).toBe("ordine");
    expect(nomeDaConferma("Conferma ordine 4471.pdf", "application/pdf")).toBe("conferma");
    expect(nomeDaConferma("CO_4471.pdf", "application/pdf")).toBe("conferma");
    // «conf.26_29488 aggiornata.pdf» è il nome vero delle conferme Pail, e
    // dal NOME non è riconosciuto: «conf.» seguito da cifre non è nessuno
    // dei disegni previsti. Il pattern non si allarga per questo — a farla
    // entrare è il mittente noto (`allegatoDaConferma`), che è la porta
    // giusta e non promuove i nomi esclusi.
    expect(nomeDaConferma("conf.26_29488 aggiornata.pdf", "application/pdf")).toBeNull();
  });

  it("un sollecito non è una conferma d'ordine", () => {
    // Alias manda «Sollecito_Ordin_…»: contiene «ordin» e finiva in coda.
    expect(nomeDaConferma("Sollecito_Ordin_1685983(1).pdf", "application/pdf")).toBeNull();
    expect(nomeDaConferma("SOLLECITO PAGAMENTO ordine 4471.pdf", "application/pdf")).toBeNull();
  });
});

describe("allegatoDaConferma", () => {
  it("un mittente noto apre la porta a un nome che non dice niente", () => {
    const primed = "R237_2026WU367846_20052026165105.pdf";
    // Senza mittente il nome non basta, ed è il caso di oggi: 312 mail, zero voci.
    expect(allegatoDaConferma({ nome: primed, mimeType: "application/pdf" })).toBeNull();
    expect(
      allegatoDaConferma({ nome: primed, mimeType: "application/pdf", mittente: "amministrazione@primed.it" })
    ).toBe("mittente");
    // I 59 allegati Alias che si chiamano letteralmente «allegato».
    expect(
      allegatoDaConferma({ nome: "allegato", mimeType: "application/pdf", mittente: "v.gregori@aliasblindate.com" })
    ).toBe("mittente");
    // Il nome vero delle conferme Pail, che dal nome non si riconosce.
    expect(
      allegatoDaConferma({ nome: "conf.26_29488 aggiornata.pdf", mimeType: "application/pdf", mittente: "ordini@pailporte.com" })
    ).toBe("mittente");
    // E il portale.
    expect(
      allegatoDaConferma({ nome: "Esportazione.pdf", mimeType: "application/pdf", mittente: "noreply@antenore.biz" })
    ).toBe("mittente");
  });

  it("il nome che dichiara la conferma vince: si sa già che cos'è", () => {
    expect(
      allegatoDaConferma({
        nome: "Ordini_di_Vendi_1684077(1).pdf",
        mimeType: "application/pdf",
        mittente: "v.gregori@aliasblindate.com",
      })
    ).toBe("ordine");
  });

  it("un nome escluso resta escluso anche da un fornitore noto", () => {
    // Primed manda anche i DDT, Alias i solleciti: il mittente non li promuove.
    expect(
      allegatoDaConferma({ nome: "R237_DDT_11_5_2026_9782.pdf", mimeType: "application/pdf", mittente: "amministrazione@primed.it" })
    ).toBeNull();
    expect(
      allegatoDaConferma({ nome: "Sollecito_Ordin_1685983(1).pdf", mimeType: "application/pdf", mittente: "v.gregori@aliasblindate.com" })
    ).toBeNull();
    expect(
      allegatoDaConferma({ nome: "ACCORDO COMMERCIALE 2026 listino.pdf", mimeType: "application/pdf", mittente: "vendite@oskura.it" })
    ).toBeNull();
  });

  it("un'immagine di firma non diventa una conferma", () => {
    // image001.png sono 118 allegati solo da Oskura.
    expect(
      allegatoDaConferma({ nome: "image001.png", mimeType: "image/png", mittente: "vendite@oskura.it" })
    ).toBeNull();
  });

  it("un mittente sconosciuto non apre niente", () => {
    expect(
      allegatoDaConferma({ nome: "IMG_9888.jpeg", mimeType: "image/jpeg", mittente: "mario@gmail.com" })
    ).toBeNull();
    expect(
      allegatoDaConferma({ nome: "documento.pdf", mimeType: "application/pdf", mittente: "mario@gmail.com" })
    ).toBeNull();
  });
});
