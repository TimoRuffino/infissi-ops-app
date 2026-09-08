// Punto 27 del piano «Tars più intelligente»: il filo della conversazione,
// derivato senza colonne nuove. Chi ripete non è più paziente.

import { describe, expect, it } from "vitest";
import {
  controparteNormalizzata,
  fili,
  filiInAttesa,
  oggettoNormalizzato,
} from "./filo";

const ADESSO = new Date("2026-09-08T10:00:00Z");
const giorniFa = (n: number) => new Date(ADESSO.getTime() - n * 86_400_000);

const msg = (patch: Record<string, unknown> = {}) => ({
  id: 1,
  canale: "email",
  direzione: "in",
  mittente: "Mario.Rossi@example.IT",
  mittenteNome: "Mario Rossi",
  destinatari: ["ufficio@ruffinogroup.it"],
  oggetto: "Preventivo finestre",
  commessaId: null,
  receivedAt: giorniFa(5),
  ...patch,
});

describe("normalizzazione", () => {
  it("«Re: Fwd: Preventivo» e «preventivo» sono lo stesso filo", () => {
    expect(oggettoNormalizzato("Re: Fwd:  Preventivo  Finestre")).toBe("preventivo finestre");
    expect(oggettoNormalizzato("R: R: R: Preventivo Finestre")).toBe("preventivo finestre");
    expect(oggettoNormalizzato("RE[2]: Preventivo Finestre")).toBe("preventivo finestre");
  });

  it("i numeri si confrontano senza spazi e prefissi di formattazione", () => {
    expect(controparteNormalizzata("+39 333 123 45 67")).toBe("393331234567");
    expect(controparteNormalizzata("Mario.Rossi@example.IT")).toBe("mario.rossi@example.it");
  });
});

describe("il filo", () => {
  it("mette insieme i messaggi della stessa conversazione, anche coi Re:", () => {
    const [filo] = fili(
      [
        msg({ id: 1, receivedAt: giorniFa(6) }),
        msg({ id: 2, oggetto: "Re: Preventivo finestre", receivedAt: giorniFa(4) }),
      ],
      ADESSO
    );
    expect(filo.messaggi).toBe(2);
    expect(filo.oggetto).toBe("preventivo finestre");
    expect(filo.nome).toBe("Mario Rossi");
  });

  it("conta le insistenze: i messaggi dopo la nostra ultima risposta", () => {
    const [filo] = fili(
      [
        msg({ id: 1, receivedAt: giorniFa(10) }),
        msg({
          id: 2,
          direzione: "out",
          mittente: "ufficio@ruffinogroup.it",
          destinatari: ["mario.rossi@example.it"],
          receivedAt: giorniFa(9),
        }),
        msg({ id: 3, oggetto: "Re: Preventivo finestre", receivedAt: giorniFa(6) }),
        msg({ id: 4, oggetto: "Re: Preventivo finestre", receivedAt: giorniFa(3) }),
        msg({ id: 5, oggetto: "Re: Preventivo finestre", receivedAt: giorniFa(1) }),
      ],
      ADESSO
    );
    expect(filo.insistenze).toBe(3);
    expect(filo.giorniInAttesa).toBe(6);
    expect(filo.ultimaRisposta).not.toBeNull();
  });

  it("se abbiamo risposto per ultimi non c'è nessuna attesa", () => {
    const [filo] = fili(
      [
        msg({ id: 1, receivedAt: giorniFa(4) }),
        msg({
          id: 2,
          direzione: "out",
          mittente: "ufficio@ruffinogroup.it",
          destinatari: ["mario.rossi@example.it"],
          receivedAt: giorniFa(3),
        }),
      ],
      ADESSO
    );
    expect(filo.insistenze).toBe(0);
    expect(filo.giorniInAttesa).toBeNull();
  });

  it("due controparti diverse sullo stesso oggetto restano due fili", () => {
    const righe = fili(
      [msg({ id: 1 }), msg({ id: 2, mittente: "altra@example.it", mittenteNome: "Altra" })],
      ADESSO
    );
    expect(righe).toHaveLength(2);
  });

  it("canali diversi non si mescolano", () => {
    const righe = fili(
      [
        msg({ id: 1 }),
        msg({ id: 2, canale: "whatsapp", mittente: "+39 333 123 45 67", oggetto: "" }),
      ],
      ADESSO
    );
    expect(righe).toHaveLength(2);
  });

  it("la commessa collegata si propaga al filo", () => {
    const [filo] = fili(
      [msg({ id: 1 }), msg({ id: 2, oggetto: "Re: Preventivo finestre", commessaId: 12 })],
      ADESSO
    );
    expect(filo.commessaId).toBe(12);
  });
});

describe("chi aspetta", () => {
  const conAttesa = (giorni: number, ripetizioni: number) =>
    fili(
      Array.from({ length: ripetizioni }, (_, i) =>
        msg({ id: i + 1, receivedAt: giorniFa(giorni - i) })
      ),
      ADESSO
    );

  it("due ripetizioni bastano anche se è di ieri", () => {
    expect(filiInAttesa(conAttesa(2, 2))).toHaveLength(1);
  });

  it("un messaggio solo di due giorni fa basta", () => {
    expect(filiInAttesa(conAttesa(2, 1))).toHaveLength(1);
  });

  it("un messaggio di oggi non è ancora un'attesa", () => {
    expect(filiInAttesa(fili([msg({ receivedAt: ADESSO })], ADESSO))).toHaveLength(0);
  });

  it("chi ha ripetuto di più viene prima", () => {
    const righe = filiInAttesa([
      ...conAttesa(9, 2),
      ...fili([msg({ id: 90, mittente: "b@x.it", receivedAt: giorniFa(20) })], ADESSO),
    ]);
    expect(righe[0].insistenze).toBe(2);
  });
});
