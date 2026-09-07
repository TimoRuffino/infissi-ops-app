// L'archivio fornitori: ogni conferma arrivata per mail entra in archivio,
// la lettura dice di quale commessa è, e quando è certa la conferma finisce
// da sola nel fascicolo — con il costo fornitore e la consegna a magazzino.
// Quando non è certa lo dice, e la collega una persona.

import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { getLiveComunicazione, insertComunicazione } from "../comunicazioni/comunicazioni";
import { pdfConTesto } from "../documenti/pdfMinimo";
import { appRouter } from "../routers";
import { setMatchComunicazione } from "../comunicazioni/comunicazioni";
import { getCommessaById, getCommesseStore } from "../routers/commesse";
import { getMagazzinoStore } from "../routers/magazzino";
import {
  archiviaAllegatoComunicazione,
  findDocumentoComunicazione,
  getDocumentiDiCommessa,
  getDocumentoCommessaById,
} from "../routers/preventiviContratti";
import { getUtentiStore } from "../routers/utenti";
import { azzeraMemoriaRicercaPerTest, creaLettoreCommessaNelDocumento } from "../tars/documenti/ricercaCommessaNelDocumento";
import {
  FORNITORE_DA_RICONOSCERE,
  azzeraArchivioFornitoriPerTest,
  collegaVoceArchivio,
  confermeDiSede,
  consegneInArrivo,
  eseguiGiroArchivioFornitori,
  fornitoreDiComunicazione,
  getArchivioFornitoriStore,
  riapriVoceArchivio,
  riepilogoFornitori,
  scartaVoceArchivio,
  type DipendenzeArchivioFornitori,
} from "./archivio";

const SEDE = 97_701;
const DIREZIONE_ID = 97_711;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Fornitori",
      email: "fornitori-dir@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(): TrpcContext {
  return {
    user: { id: DIREZIONE_ID, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}
const direzione = () => appRouter.createCaller(contestoTrpc());

/** Una conferma Alias con il cognome del cliente dentro. */
const confermaPer = (cliente: string, numero = "1602923") =>
  pdfConTesto([
    "Conferma Ordine",
    "ALIAS Srl Porte blindate",
    `2026 - CV ${numero} 23/02/2026`,
    "VS.RIFERIMENTO",
    cliente,
    "PORST-C013 PORTA BLIND.STEEL/C < 1900   NR   1,00",
    "Totale imponibile: EUR 948,73",
  ]);

/** Il numero della conferma dentro il PDF finto: il nome del file lo segue. */
function numeroDaPdf(bytes: Buffer): string {
  return /CV (\d+)/.exec(bytes.toString("latin1"))?.[1] ?? "0";
}

async function mailFornitore(extra: Record<string, unknown> = {}, pdf?: Buffer) {
  const bytes = pdf ?? confermaPer("ROSSI MARIO");
  return (await insertComunicazione({
    sedeId: SEDE,
    casellaId: 9,
    messageId: `arch-${Math.random().toString(36).slice(2)}`,
    canale: "email",
    direzione: "in",
    mittente: "v.gregori@aliasblindate.com",
    mittenteNome: "DE - DOOR DESIGN S.R.L. Veronica Gregori",
    destinatari: [],
    oggetto: "Conferma ordine 2026- CV 1602923",
    testo: "In allegato la conferma.",
    allegati: [
      {
        nome: `Ordini_di_Vendi_${numeroDaPdf(bytes)}.pdf`,
        mimeType: "application/pdf",
        size: bytes.length,
      },
    ],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    receivedAt: new Date(),
    ...extra,
  } as any))!;
}

/** Dipendenze con lo storage finto: il lettore riceve il PDF del test. */
function deps(pdfPerComunicazione: Map<number, Buffer>, comunicazioni: any[]): DipendenzeArchivioFornitori {
  const leggiRaw = async (c: any, indice: number) => ({
    buffer: pdfPerComunicazione.get(c.id) ?? confermaPer("NESSUNO"),
    nome: c.allegati[indice].nome,
    mimeType: c.allegati[indice].mimeType,
  });
  const lettore = creaLettoreCommessaNelDocumento({ visione: null, massimoLetture: 50 });
  return {
    comunicazioni: async () => comunicazioni,
    commesse: sede => (getCommesseStore() as any[]).filter(c => c.sedeId === sede),
    cerca: (sorgente, commesse) => lettore(sorgente, commesse),
    leggiRaw: leggiRaw as any,
    giaArchiviato: findDocumentoComunicazione,
    archivia: archiviaAllegatoComunicazione,
    collegaMail: setMatchComunicazione,
    documento: (id, sede) => getDocumentoCommessaById(id, sede),
    // Nei test il mittente del fornitore non è mai di casa.
    dominiInterni: () => new Set(["azienda-test.example"]),
    adesso: () => new Date(),
  };
}

async function commessaIn(stato: string, cliente: string) {
  const c = await direzione().commesse.create({ cliente });
  (getCommessaById(c.id) as any).stato = stato;
  (getCommessaById(c.id) as any).sedeId = SEDE;
  return getCommessaById(c.id) as any;
}

beforeEach(() => {
  azzeraArchivioFornitoriPerTest();
  azzeraMemoriaRicercaPerTest();
});

describe("fornitoreDiComunicazione", () => {
  it("riconosce il fornitore dal dominio anche quando il mittente è l'agenzia", () => {
    expect(
      fornitoreDiComunicazione({
        mittente: "v.gregori@aliasblindate.com",
        mittenteNome: "DE - DOOR DESIGN S.R.L. Veronica Gregori",
        allegati: [{ nome: "conferma.pdf", mimeType: "application/pdf" }],
      })
    ).toBe("Alias");
  });

  it("una mail che non è di un fornitore e non porta conferme resta fuori dall'archivio", () => {
    expect(
      fornitoreDiComunicazione({
        mittente: "info@banca.example",
        mittenteNome: "Banca",
        allegati: [{ nome: "estratto_conto.pdf", mimeType: "application/pdf" }],
      })
    ).toBeNull();
  });

  it("un inoltro interno non fa di noi un fornitore: resta «Da riconoscere»", () => {
    expect(
      fornitoreDiComunicazione(
        {
          mittente: "a.facci@ruffinogroup.example",
          mittenteNome: "Ufficio",
          allegati: [{ nome: "conf. ordine Cadimare.pdf", mimeType: "application/pdf" }],
        },
        new Set(["ruffinogroup.example"])
      )
    ).toBe(FORNITORE_DA_RICONOSCERE);
  });

  it("un mittente sconosciuto che manda una conferma entra col suo dominio", () => {
    expect(
      fornitoreDiComunicazione({
        mittente: "ordini@vetreriabianchi.example",
        mittenteNome: null,
        allegati: [{ nome: "Conferma ordine 12.pdf", mimeType: "application/pdf" }],
      })
    ).toBe("vetreriabianchi.example");
  });
});

describe("eseguiGiroArchivioFornitori", () => {
  it("la commessa è una sola: la conferma entra da sola nel fascicolo, con costo, consegna e mail collegata", async () => {
    const commessa = await commessaIn("da_ordinare", "Pistone Angelo");
    const pdf = confermaPer("PISTONE ANGELO");
    const mail = await mailFornitore({}, pdf);
    const mappa = new Map([[mail.id, pdf]]);

    const esito = await eseguiGiroArchivioFornitori({
      sedeId: SEDE,
      deps: deps(mappa, [mail]),
    });
    expect(esito).toMatchObject({ nuove: 1, lette: 1, collegateDaSole: 1, errori: 0 });

    const voce = getArchivioFornitoriStore()[0];
    expect(voce).toMatchObject({ fornitore: "Alias", stato: "collegata", commessaId: commessa.id });
    expect(voce.lettura).toMatchObject({ esito: "unica", commessaId: commessa.id });

    // Nel fascicolo, con il costo e la consegna che ne nascono.
    const documenti = getDocumentiDiCommessa(commessa.id);
    expect(documenti).toHaveLength(1);
    expect(documenti[0]).toMatchObject({ tipo: "conferma_ordine", origine: "automatico" });
    expect((getCommessaById(commessa.id) as any).costi[0]).toMatchObject({ importo: 948.73 });
    const merce = getMagazzinoStore().filter(p => p.commessaId === commessa.id);
    expect(merce).toHaveLength(1);
    expect(merce[0].fornitore).toBe("Alias");

    // La mail «di nessuno» ora è della commessa, con il motivo scritto.
    const collegata = await getLiveComunicazione(mail.id, SEDE);
    expect(collegata?.commessaId).toBe(commessa.id);
    expect(String(collegata?.matchMotivo)).toContain("archivio fornitori");

    // Un secondo giro non duplica niente.
    const secondo = await eseguiGiroArchivioFornitori({ sedeId: SEDE, deps: deps(mappa, [mail]) });
    expect(secondo).toMatchObject({ nuove: 0, collegateDaSole: 0 });
    expect(getArchivioFornitoriStore()).toHaveLength(1);
    expect(getDocumentiDiCommessa(commessa.id)).toHaveLength(1);
  });

  it("il testo non cita nessuna commessa: resta da collegare e lo dice", async () => {
    await commessaIn("da_ordinare", "Neri Luca");
    const pdf = confermaPer("SCONOSCIUTO QUALCUNO", "2000002");
    const mail = await mailFornitore({}, pdf);

    const esito = await eseguiGiroArchivioFornitori({
      sedeId: SEDE,
      deps: deps(new Map([[mail.id, pdf]]), [mail]),
    });
    expect(esito).toMatchObject({ lette: 1, collegateDaSole: 0, daCollegare: 1 });

    const voce = getArchivioFornitoriStore()[0];
    expect(voce.stato).toBe("da_collegare");
    expect(voce.lettura?.esito).toBe("nessuna");
    expect(voce.lettura?.motivo).toContain("non cita");
    expect(voce.commessaId).toBeNull();
  });

  it("due commesse dello stesso cliente in attesa: ambigua, coi candidati da scegliere", async () => {
    const prima = await commessaIn("da_ordinare", "Giacomazzi Giulia");
    const seconda = await commessaIn("produzione", "Giacomazzi Giulia");
    const pdf = confermaPer("GIACOMAZZI GIULIA", "2000003");
    const mail = await mailFornitore({}, pdf);

    await eseguiGiroArchivioFornitori({ sedeId: SEDE, deps: deps(new Map([[mail.id, pdf]]), [mail]) });
    const voce = getArchivioFornitoriStore()[0];
    expect(voce.stato).toBe("da_collegare");
    expect(voce.lettura?.esito).toBe("ambigua");
    expect(voce.lettura?.candidati.map(c => c.commessaId).sort()).toEqual(
      [prima.id, seconda.id].sort()
    );
    expect(voce.lettura?.candidati[0].codice).toBeTruthy();
    expect(getDocumentiDiCommessa(prima.id)).toHaveLength(0);
  });
});

describe("collegaVoceArchivio", () => {
  it("«è di questa commessa»: la conferma entra nel fascicolo e ne nascono costo e consegna", async () => {
    const commessa = await commessaIn("da_ordinare", "Ambigua Cliente");
    const pdf = confermaPer("SCONOSCIUTO QUALCUNO", "2000004");
    const mail = await mailFornitore({}, pdf);
    const d = deps(new Map([[mail.id, pdf]]), [mail]);
    await eseguiGiroArchivioFornitori({ sedeId: SEDE, deps: d });
    const voce = getArchivioFornitoriStore()[0];

    const esito = await collegaVoceArchivio({
      voceId: voce.id,
      commessaId: commessa.id,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
      nomeUtente: "Direzione",
      deps: d,
    });
    expect(esito.commessaId).toBe(commessa.id);
    expect(esito.costo).toMatchObject({ stato: "registrato", importo: 948.73 });
    expect(esito.consegne).toBe(1);

    const documenti = getDocumentiDiCommessa(commessa.id);
    expect(documenti[0]).toMatchObject({ tipo: "conferma_ordine", origine: "fornitori" });
    expect(String(documenti[0].note)).toContain("Direzione");
    expect(getMagazzinoStore().filter(p => p.commessaId === commessa.id)).toHaveLength(1);
    const aggiornata = getArchivioFornitoriStore()[0];
    expect(aggiornata).toMatchObject({ stato: "collegata", commessaId: commessa.id, decisaDa: DIREZIONE_ID });

    // Un secondo collegamento su un'altra commessa non passa: prima si toglie.
    const altra = await commessaIn("da_ordinare", "Altra Cliente");
    await expect(
      collegaVoceArchivio({
        voceId: voce.id,
        commessaId: altra.id,
        sedeId: SEDE,
        utenteId: DIREZIONE_ID,
        nomeUtente: "Direzione",
        deps: d,
      })
    ).rejects.toThrow(/CONFLICT/);
  });

  it("una commessa di un'altra sede o archiviata non si collega", async () => {
    const pdf = confermaPer("SCONOSCIUTO QUALCUNO", "2000005");
    const mail = await mailFornitore({}, pdf);
    const d = deps(new Map([[mail.id, pdf]]), [mail]);
    await eseguiGiroArchivioFornitori({ sedeId: SEDE, deps: d });
    const voce = getArchivioFornitoriStore()[0];

    const archiviata = await commessaIn("produzione", "Chiusa Cliente");
    (getCommessaById(archiviata.id) as any).archivedAt = new Date();
    await expect(
      collegaVoceArchivio({
        voceId: voce.id,
        commessaId: archiviata.id,
        sedeId: SEDE,
        utenteId: DIREZIONE_ID,
        nomeUtente: "Direzione",
        deps: d,
      })
    ).rejects.toThrow(/archiviata/);

    await expect(
      collegaVoceArchivio({
        voceId: voce.id,
        commessaId: 999_999,
        sedeId: SEDE,
        utenteId: DIREZIONE_ID,
        nomeUtente: "Direzione",
        deps: d,
      })
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("scarta, riapri e riepilogo", () => {
  it("una voce scartata resta a registro con chi lo ha detto, e può tornare in coda", async () => {
    const pdf = confermaPer("SCONOSCIUTO QUALCUNO", "2000006");
    const mail = await mailFornitore({}, pdf);
    await eseguiGiroArchivioFornitori({ sedeId: SEDE, deps: deps(new Map([[mail.id, pdf]]), [mail]) });
    const voce = getArchivioFornitoriStore()[0];

    const scartata = scartaVoceArchivio({
      voceId: voce.id,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
      nomeUtente: "Direzione",
      motivo: "È un listino",
    });
    expect(scartata.stato).toBe("scartata");
    expect(scartata.motivoDecisione).toContain("listino");
    expect(confermeDiSede({ sedeId: SEDE, gruppo: "da_collegare" })).toHaveLength(0);

    const riaperta = riapriVoceArchivio({ voceId: voce.id, sedeId: SEDE });
    expect(riaperta.stato).toBe("da_collegare");
    expect(riaperta.motivoDecisione).toBeNull();

    const riepilogo = riepilogoFornitori(SEDE);
    expect(riepilogo[0]).toMatchObject({ fornitore: "Alias", daCollegare: 1 });
    // Un'altra sede non vede niente.
    expect(riepilogoFornitori(SEDE + 1)).toHaveLength(0);
    expect(confermeDiSede({ sedeId: SEDE + 1 })).toHaveLength(0);
  });
});

describe("l'elenco unico delle conferme", () => {
  it("mette insieme quello che ha collegato Tars e quello che aspetta una mano, e dice cosa porta", async () => {
    const commessa = await commessaIn("da_ordinare", "Ventura Marco");
    const collegabile = confermaPer("VENTURA MARCO", "2000101");
    const orfana = confermaPer("NESSUNO AL MONDO", "2000102");
    const mailCollegata = await mailFornitore({}, collegabile);
    const mailOrfana = await mailFornitore({}, orfana);

    await eseguiGiroArchivioFornitori({
      sedeId: SEDE,
      deps: deps(
        new Map([
          [mailCollegata.id, collegabile],
          [mailOrfana.id, orfana],
        ]),
        [mailCollegata, mailOrfana]
      ),
    });

    const elenco = confermeDiSede({ sedeId: SEDE });
    const collegata = elenco.find(r => r.commessa?.id === commessa.id);
    const daCollegare = elenco.find(r => r.nome.includes("2000102"));

    // Quella certa è nel fascicolo, con il costo e la merce che ne sono nati.
    expect(collegata?.gruppo).toBe("collegata_tars");
    expect(collegata?.costo).toMatchObject({ stato: "registrato", importo: 948.73 });
    expect(collegata?.merce.consegne).toBe(1);
    expect(collegata?.fileUrl).toBe(`/api/documenti/${collegata?.documentoId}/file`);

    // Quella senza commessa resta apribile dalla mail, e dice già cosa porta.
    expect(daCollegare?.gruppo).toBe("da_collegare");
    expect(daCollegare?.fileUrl).toBe(
      `/api/comunicazioni/${mailOrfana.id}/allegati/0`
    );
    expect(daCollegare?.merce.articoliLetti.length).toBeGreaterThan(0);
    expect(daCollegare?.costo.stato).toBe("in_attesa");

    // Il filtro per gruppo è quello che la pagina usa per le sue schede.
    expect(confermeDiSede({ sedeId: SEDE, gruppo: "da_collegare" })).toHaveLength(1);
    // Un'altra sede non vede niente.
    expect(confermeDiSede({ sedeId: SEDE + 1 })).toHaveLength(0);
  });

  it("una conferma caricata a mano nel fascicolo compare lo stesso, senza doppioni", async () => {
    const commessa = await commessaIn("da_ordinare", "Manuale Luigi");
    const pdf = confermaPer("MANUALE LUIGI", "2000103");
    const mail = await mailFornitore({}, pdf);
    const mappa = new Map([[mail.id, pdf]]);
    await eseguiGiroArchivioFornitori({ sedeId: SEDE, deps: deps(mappa, [mail]) });

    const documenti = getDocumentiDiCommessa(commessa.id);
    const conferme = confermeDiSede({ sedeId: SEDE }).filter(
      r => r.commessa?.id === commessa.id
    );
    // Una voce d'archivio e il suo documento sono la stessa conferma.
    expect(documenti.filter(d => d.tipo === "conferma_ordine")).toHaveLength(1);
    expect(conferme).toHaveLength(1);
    expect(conferme[0].voceId).not.toBeNull();
    expect(conferme[0].documentoId).not.toBeNull();
  });
});

describe("il magazzino visto dal fornitore", () => {
  it("mostra cosa deve ancora arrivare, con il ritardo, e lo segna ricevuto a lotti", async () => {
    const commessa = await commessaIn("da_ordinare", "Attesa Giulio");
    const pdf = confermaPer("ATTESA GIULIO", "2000104");
    const mail = await mailFornitore({}, pdf);
    await eseguiGiroArchivioFornitori({
      sedeId: SEDE,
      deps: deps(new Map([[mail.id, pdf]]), [mail]),
    });

    const consegna = getMagazzinoStore().find(p => p.commessaId === commessa.id);
    expect(consegna).toBeTruthy();
    (consegna as any).dataConsegna = "2026-01-10";

    const inArrivo = consegneInArrivo({
      sedeId: SEDE,
      fornitore: "Alias",
      adesso: new Date("2026-01-20T09:00:00Z"),
    });
    const riga = inArrivo.find(r => r.commessa?.id === commessa.id);
    expect(riga?.giorniDiRitardo).toBe(10);
    expect(riga?.fileUrl).toBe(`/api/documenti/${riga?.documentoId}/file`);

    // Il riepilogo del fornitore porta il conto in cima alla pagina.
    const alias = riepilogoFornitori(SEDE).find(r => r.fornitore === "Alias");
    expect(alias!.inArrivo).toBeGreaterThan(0);

    // Segnare ricevuto a lotti tocca solo le righe che si avevano davanti.
    const esito = await direzione().magazzino.segnaRicevute({
      prodottoIds: [riga!.prodottoId],
    });
    expect(esito.segnate).toBe(1);
    expect(
      consegneInArrivo({ sedeId: SEDE, fornitore: "Alias" }).some(
        r => r.prodottoId === riga!.prodottoId
      )
    ).toBe(false);
  });
});
