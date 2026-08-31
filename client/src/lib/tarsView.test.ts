import { describe, expect, it } from "vitest";
import {
  associaTurnoOttimisticoAConversazione,
  creaTurnoOttimistico,
  deveInviareDaTastiera,
  etichettaTempoConversazione,
  filtraConversazioni,
  raggruppaConversazioni,
  selezioneDopoCambioArchivio,
  selezioneDopoRispostaInvio,
  unisciConversazioniSenzaDuplicati,
  unisciTurniConOttimistico,
  type ConversazioneTarsView,
  type TurnoTarsView,
} from "./tarsView";

const conversazioni: ConversazioneTarsView[] = [
  {
    id: 1,
    titolo: "Ordine villa",
    anteprima: "Controlla i profili finestra",
    fissata: false,
    archiviataAt: null,
    updatedAt: new Date("2026-08-31T08:00:00.000Z"),
  },
  {
    id: 2,
    titolo: "Consegna cantiere",
    anteprima: "Preventivo serramenti pronto",
    fissata: true,
    archiviataAt: null,
    updatedAt: new Date("2026-08-30T08:00:00.000Z"),
  },
  {
    id: 3,
    titolo: "Pratica conclusa",
    anteprima: null,
    fissata: false,
    archiviataAt: new Date("2026-08-29T08:00:00.000Z"),
    updatedAt: new Date("2026-08-29T08:00:00.000Z"),
  },
];

describe("vista conversazioni Tars", () => {
  it("cerca per titolo o anteprima senza mutare l'input", () => {
    const input = [...conversazioni];

    expect(filtraConversazioni(input, "  VILLA ").map(c => c.id)).toEqual([1]);
    expect(filtraConversazioni(input, "serramenti").map(c => c.id)).toEqual([
      2,
    ]);
    expect(input).toEqual(conversazioni);
    expect(input[0]).toBe(conversazioni[0]);
  });

  it("separa fissate, recenti e archiviate ordinando ogni gruppo per aggiornamento", () => {
    const gruppi = raggruppaConversazioni([
      ...conversazioni,
      {
        ...conversazioni[0],
        id: 4,
        titolo: "Fissata recente",
        fissata: true,
        updatedAt: new Date("2026-08-31T09:00:00.000Z"),
      },
    ]);

    expect(gruppi.fissate.map(c => c.id)).toEqual([4, 2]);
    expect(gruppi.recenti.map(c => c.id)).toEqual([1]);
    expect(gruppi.archiviate.map(c => c.id)).toEqual([3]);
  });

  it("produce etichette italiane deterministiche per ora, oggi, ieri e date lontane", () => {
    const ora = new Date("2026-08-31T10:30:00.000Z");

    expect(etichettaTempoConversazione("2026-08-31T10:29:20.000Z", ora)).toBe(
      "Ora"
    );
    expect(etichettaTempoConversazione("2026-08-31T08:15:00.000Z", ora)).toBe(
      "10:15"
    );
    expect(etichettaTempoConversazione("2026-08-30T08:15:00.000Z", ora)).toBe(
      "Ieri"
    );
    expect(etichettaTempoConversazione("2026-04-07T08:15:00.000Z", ora)).toBe(
      "7 apr"
    );
    expect(etichettaTempoConversazione("2025-12-07T08:15:00.000Z", ora)).toBe(
      "7 dic 2025"
    );
  });

  it("apre una nuova conversazione solo quando viene archiviata quella attiva", () => {
    expect(
      selezioneDopoCambioArchivio({
        selezioneCorrente: 2,
        conversazioneId: 2,
        archiviata: true,
      })
    ).toBeNull();
    expect(
      selezioneDopoCambioArchivio({
        selezioneCorrente: 2,
        conversazioneId: 1,
        archiviata: true,
      })
    ).toBe(2);
  });

  it("un ripristino non forza la selezione corrente", () => {
    expect(
      selezioneDopoCambioArchivio({
        selezioneCorrente: 2,
        conversazioneId: 3,
        archiviata: false,
      })
    ).toBe(2);
    expect(
      selezioneDopoCambioArchivio({
        selezioneCorrente: null,
        conversazioneId: 3,
        archiviata: false,
      })
    ).toBeNull();
  });

  it("unisce attive e archiviate senza duplicare un id", () => {
    expect(
      unisciConversazioniSenzaDuplicati(
        [conversazioni[0], conversazioni[1]],
        [conversazioni[1], conversazioni[2]]
      ).map(conversazione => conversazione.id)
    ).toEqual([1, 2, 3]);
  });
});

describe("turno ottimistico Tars", () => {
  const turniServer: TurnoTarsView[] = [
    {
      id: 8,
      conversazioneId: 4,
      ruolo: "utente",
      contenuto: "Ripeti controllo",
      payload: null,
      createdAt: new Date("2026-08-31T10:00:00.000Z"),
    },
    {
      id: 9,
      conversazioneId: 4,
      ruolo: "tars",
      contenuto: "Controllo precedente completato",
      payload: null,
      createdAt: new Date("2026-08-31T10:00:02.000Z"),
    },
  ];

  it("mantiene il turno locale con chiave distinta finché il server non restituisce il suo echo", () => {
    const ottimistico = creaTurnoOttimistico({
      chiaveLocale: "invio-1",
      conversazioneId: 4,
      contenuto: "Ripeti controllo",
      createdAt: new Date("2026-08-31T10:05:00.000Z"),
      dopoTurnoId: 9,
    });

    const prima = unisciTurniConOttimistico(turniServer, ottimistico);
    expect(prima.map(t => t.id)).toEqual([8, 9, "locale:invio-1"]);

    const echo: TurnoTarsView = {
      id: 10,
      conversazioneId: 4,
      ruolo: "utente",
      contenuto: "Ripeti controllo",
      payload: null,
      createdAt: new Date("2026-08-31T10:05:01.000Z"),
    };
    const dopo = unisciTurniConOttimistico([...turniServer, echo], ottimistico);
    expect(dopo.map(t => t.id)).toEqual([8, 9, 10]);
  });

  it("non usa un messaggio uguale precedente o di un'altra conversazione per deduplicare", () => {
    const ottimistico = creaTurnoOttimistico({
      chiaveLocale: "invio-2",
      conversazioneId: 4,
      contenuto: "Ripeti controllo",
      createdAt: new Date("2026-08-31T10:05:00.000Z"),
      dopoTurnoId: 9,
    });
    const altraConversazione: TurnoTarsView = {
      id: 10,
      conversazioneId: 99,
      ruolo: "utente",
      contenuto: "Ripeti controllo",
      payload: null,
      createdAt: new Date("2026-08-31T10:05:01.000Z"),
    };

    expect(
      unisciTurniConOttimistico(
        [...turniServer, altraConversazione],
        ottimistico
      ).at(-1)?.id
    ).toBe("locale:invio-2");
  });

  it("lega una nuova chat all'id server prima di riconciliare il suo echo", () => {
    const nuovaChat = creaTurnoOttimistico({
      chiaveLocale: "invio-nuovo",
      conversazioneId: null,
      contenuto: "Situazione di oggi",
      createdAt: new Date("2026-08-31T10:05:00.000Z"),
      dopoTurnoId: 0,
    });
    const echoAltrui: TurnoTarsView = {
      id: 1,
      conversazioneId: 99,
      ruolo: "utente",
      contenuto: "Situazione di oggi",
      payload: null,
      createdAt: new Date("2026-08-31T10:05:01.000Z"),
    };

    expect(unisciTurniConOttimistico([echoAltrui], nuovaChat).at(-1)?.id).toBe(
      "locale:invio-nuovo"
    );

    const associato = associaTurnoOttimisticoAConversazione(nuovaChat, 7);
    expect(associato.conversazioneId).toBe(7);
    expect(
      unisciTurniConOttimistico(
        [{ ...echoAltrui, conversazioneId: 7 }],
        associato
      ).map(turno => turno.id)
    ).toEqual([1]);
  });

  it("adotta l'id restituito solo se la selezione non è cambiata durante l'invio", () => {
    expect(
      selezioneDopoRispostaInvio({
        selezioneCorrente: null,
        conversazioneInvioId: null,
        conversazioneRispostaId: 7,
      })
    ).toBe(7);
    expect(
      selezioneDopoRispostaInvio({
        selezioneCorrente: 12,
        conversazioneInvioId: null,
        conversazioneRispostaId: 7,
      })
    ).toBe(12);
    expect(
      selezioneDopoRispostaInvio({
        selezioneCorrente: 4,
        conversazioneInvioId: 4,
        conversazioneRispostaId: 4,
      })
    ).toBe(4);
  });
});

describe("matrice tastiera composer Tars", () => {
  it.each([
    [{ key: "Enter", shiftKey: false, isComposing: false }, true],
    [{ key: "Enter", shiftKey: true, isComposing: false }, false],
    [{ key: "Enter", shiftKey: false, isComposing: true }, false],
    [{ key: "a", shiftKey: false, isComposing: false }, false],
  ])("valuta %o come %s", (evento, atteso) => {
    expect(deveInviareDaTastiera(evento)).toBe(atteso);
  });
});
