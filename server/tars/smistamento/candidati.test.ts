// Candidati deterministici dello smistamento: casi calcati sui pattern
// reali della casella (inoltri interni col cliente dentro, cognome nel
// testo, filo già collegato, cognome di una persona dell'azienda che NON
// deve valere), con motivi spiegabili e verdetto certo solo su prove forti.

import { describe, expect, it } from "vitest";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import {
  estraiMittenteOriginale,
  generaCandidati,
  type ClienteCandidabile,
  type CommessaCandidabile,
} from "./candidati";

const SEDE = 1;

function comunicazione(parziale: Partial<Comunicazione>): Comunicazione {
  return {
    id: 100,
    sedeId: SEDE,
    casellaId: 1,
    messageId: "m-100",
    uid: null,
    canale: "email",
    direzione: "in",
    mittente: "esterno@example.test",
    mittenteNome: null,
    destinatari: ["info@azienda.test"],
    oggetto: "Senza oggetto",
    testo: "",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    deletedAt: null,
    tarsAnalizzata: false,
    categoria: "da_classificare",
    classificazioneScore: 0,
    classificazioneMotivo: null,
    classificazioneFonte: "regole",
    tarsRiepilogo: null,
    tarsIstruzione: null,
    tarsUltimaAnalisiAt: null,
    receivedAt: new Date("2026-09-02T08:00:00Z"),
    createdAt: new Date("2026-09-02T08:00:00Z"),
    ...parziale,
  };
}

const CLIENTI: ClienteCandidabile[] = [
  { id: 1, cognome: "Gallo", nome: "Paolo", email: "paolo.gallo@example.test", telefono: "+39 333 1234567" },
  { id: 2, cognome: "Bianchi", nome: "Marco", email: "m.bianchi@example.test" },
  { id: 3, cognome: "Ruffino", nome: "Timothy", email: "t.ruffino@azienda.test" },
  { id: 4, cognome: "", nome: "BODYTECH S.R.L.", email: "amministrazione@bodytech.test", tipo: "azienda" },
  { id: 5, cognome: "Stretti", nome: "Silvia", telefono: "+39 340 7654321" },
];

const COMMESSE: CommessaCandidabile[] = [
  { id: 10, codice: "COM-2026-101", cliente: "Gallo Paolo", clienteId: 1, citta: "Sarzana", stato: "preventivo" },
  { id: 11, codice: "COM-2026-102", cliente: "Bianchi Marco", clienteId: 2, stato: "produzione" },
  { id: 12, codice: "COM-2026-103", cliente: "Bianchi Marco", clienteId: 2, stato: "preventivo" },
  { id: 13, codice: "COM-2026-104", cliente: "BODYTECH S.R.L.", clienteId: 4, stato: "misure_esecutive" },
  { id: 14, codice: "COM-2026-105", cliente: "Stretti Silvia", clienteId: 5, telefono: "+39 340 7654321", stato: "attesa_posa" },
  { id: 15, codice: "COM-2025-090", cliente: "Gallo Paolo", clienteId: 1, stato: "archiviata", archivedAt: "2026-01-01" },
];

const INTERNI = new Set(["info@azienda.test", "t.ruffino@azienda.test", "amministrazione@azienda.test"]);
const COGNOMI_INTERNI = new Set(["ruffino"]);

function genera(c: Comunicazione, filo: Comunicazione[] = []) {
  return generaCandidati({
    comunicazione: c,
    clienti: CLIENTI,
    commesse: COMMESSE,
    indirizziInterni: INTERNI,
    cognomiInterni: COGNOMI_INTERNI,
    filoCollegato: filo,
  });
}

describe("estraiMittenteOriginale", () => {
  it("legge il Da: di un inoltro Outlook/Gmail e il «ha scritto» delle risposte", () => {
    expect(
      estraiMittenteOriginale("Fwd\n\n---------- Messaggio inoltrato ----------\nDa: Paolo Gallo <Paolo.Gallo@example.test>\nData: ...")
    ).toBe("paolo.gallo@example.test");
    expect(
      estraiMittenteOriginale("Il giorno mar 2 set 2026 alle 10:00 Paolo Gallo <paolo.gallo@example.test> ha scritto:\n> ciao")
    ).toBe("paolo.gallo@example.test");
    expect(estraiMittenteOriginale("nessuna intestazione qui")).toBeNull();
  });
});

describe("generaCandidati — verdetti certi", () => {
  it("il codice commessa nel testo è certo, anche in un inoltro interno", () => {
    const esito = genera(
      comunicazione({
        mittente: "t.ruffino@azienda.test",
        oggetto: "I: documenti",
        testo: "Vi giro i documenti per la COM-2026-101, grazie",
      })
    );
    expect(esito.certo).toMatchObject({ commessaId: 10, clienteId: 1 });
    expect(esito.segnali.interno).toBe(true);
  });

  it("un codice di commessa archiviata NON è certo", () => {
    const esito = genera(comunicazione({ testo: "Rif. COM-2025-090" }));
    expect(esito.certo).toBeNull();
  });

  it("lo stesso filo di una comunicazione già collegata eredita il collegamento", () => {
    const precedente = comunicazione({
      id: 90,
      direzione: "out",
      mittente: "info@azienda.test",
      destinatari: ["carlotta@fornitore.test"],
      oggetto: "Grafica cartellone",
      commessaId: 13,
      clienteId: 4,
    });
    const esito = genera(
      comunicazione({
        mittente: "carlotta@fornitore.test",
        oggetto: "Re: Grafica cartellone",
        testo: "Ecco la bozza aggiornata",
      }),
      [precedente]
    );
    expect(esito.certo).toMatchObject({ commessaId: 13 });
    expect(esito.certo?.motivo).toContain("#90");
  });

  it("un filo che diverge su due commesse produce candidati, non certezza", () => {
    const a = comunicazione({ id: 91, oggetto: "Re: preventivo", commessaId: 11, mittente: "m.bianchi@example.test" });
    const b = comunicazione({ id: 92, oggetto: "Re: preventivo", commessaId: 12, mittente: "m.bianchi@example.test" });
    const esito = genera(
      comunicazione({ mittente: "m.bianchi@example.test", oggetto: "Re: preventivo", testo: "ok" }),
      [a, b]
    );
    expect(esito.certo).toBeNull();
    expect(esito.candidati.map(c => c.id).sort()).toEqual(expect.arrayContaining([11, 12]));
  });

  it("una comunicazione già collegata resta collegata e ha un solo candidato", () => {
    const esito = genera(comunicazione({ commessaId: 14, clienteId: 5, matchMotivo: "Numero riconosciuto." }));
    expect(esito.certo).toMatchObject({ commessaId: 14 });
    expect(esito.candidati).toHaveLength(1);
  });
});

describe("generaCandidati — candidati con motivo", () => {
  it("inoltro interno col cliente dentro: cliente e la sua unica commessa in testa, con motivo", () => {
    const esito = genera(
      comunicazione({
        mittente: "amministrazione@azienda.test",
        oggetto: "I: Fattura e documenti x infissi",
        testo: "---------- Messaggio inoltrato ----------\nDa: Paolo Gallo <paolo.gallo@example.test>\nOggetto: documenti\n\nBuongiorno, in allegato i documenti richiesti.",
      })
    );
    expect(esito.certo).toBeNull();
    expect(esito.segnali).toMatchObject({ interno: true, inoltro: true, mittenteOriginale: "paolo.gallo@example.test" });
    const primo = esito.candidati[0];
    expect(primo.tipo).toBe("commessa");
    expect(primo.id).toBe(10);
    expect(primo.punteggio).toBeGreaterThanOrEqual(80);
    expect(primo.motivi.join(" ")).toContain("paolo.gallo@example.test");
  });

  it("il cognome del cliente nell'oggetto è un candidato, quello di una persona dell'azienda no", () => {
    const esito = genera(
      comunicazione({
        mittente: "amministrazione@azienda.test",
        oggetto: "Fattura e documenti x infissi Gallo",
        testo: "Movimenti Ruffino allegati.",
      })
    );
    expect(esito.candidati.some(c => c.tipo === "cliente" && c.id === 1)).toBe(true);
    expect(esito.candidati.some(c => c.tipo === "cliente" && c.id === 3)).toBe(false);
  });

  it("una ragione sociale a più parole conta quando compare per intero", () => {
    const esito = genera(
      comunicazione({ oggetto: "Sopralluogo Bodytech", testo: "Per BODYTECH S.R.L. confermiamo giovedì." })
    );
    const bodytech = esito.candidati.find(c => c.tipo === "commessa" && c.id === 13);
    expect(bodytech).toBeDefined();
    expect(bodytech!.motivi.join(" ")).toContain("bodytech");
  });

  it("un cliente con più commesse attive porta ognuna come candidata a metà punteggio", () => {
    const esito = genera(
      comunicazione({ clienteId: 2, matchConfidenza: "media", matchMotivo: "Mittente riconosciuto come Bianchi Marco, che ha 2 commesse attive.", testo: "ok" })
    );
    const commesse = esito.candidati.filter(c => c.tipo === "commessa").map(c => c.id).sort();
    expect(commesse).toEqual([11, 12]);
    const cliente = esito.candidati.find(c => c.tipo === "cliente");
    expect(cliente?.id).toBe(2);
    expect(cliente!.punteggio).toBeGreaterThan(esito.candidati.find(c => c.id === 11)!.punteggio);
  });

  it("un telefono nel testo aggancia cliente e commessa di contatto", () => {
    const esito = genera(comunicazione({ testo: "Mi chiami al 340 765 4321 grazie" }));
    expect(esito.candidati.some(c => c.tipo === "commessa" && c.id === 14)).toBe(true);
    expect(esito.candidati.some(c => c.tipo === "cliente" && c.id === 5)).toBe(true);
  });

  it("senza nessun indizio: nessun certo e nessun candidato", () => {
    const esito = genera(
      comunicazione({ mittente: "formazione@corsi.test", oggetto: "CORSO PRIMO SOCCORSO", testo: "Iscrizioni aperte" })
    );
    expect(esito.certo).toBeNull();
    expect(esito.candidati).toEqual([]);
  });
});
