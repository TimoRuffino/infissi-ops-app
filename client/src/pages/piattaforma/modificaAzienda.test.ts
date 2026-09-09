import { describe, expect, it } from "vitest";

import {
  diffModifica,
  erroriModulo,
  valoriIniziali,
  type SchedaModificabile,
  type ValoriModifica,
} from "./modificaAzienda";

const SCHEDA: SchedaModificabile = {
  id: 2,
  nome: "Hvuv Serramenti",
  slug: "hvuv",
  note: null,
  fatturazione: {
    partitaIva: "12345678901",
    codiceFiscale: null,
    indirizzoLegale: null,
    emailAmministrativa: null,
    pec: null,
    codiceSdi: null,
  },
  sedePredefinita: { id: 7, nome: "Sede di Aulla", citta: "Aulla" },
  proprietari: [
    {
      id: 11,
      nome: "Anna",
      cognome: "Bianchi",
      email: "anna@esempio.it",
      telefono: null,
      invitoInSospeso: true,
    },
  ],
};

/** I valori di partenza con una modifica sopra: il modulo come lo lascia chi scrive. */
function conCambio(patch: Partial<ValoriModifica>): ValoriModifica {
  return { ...valoriIniziali(SCHEDA, null), ...patch };
}

describe("valoriIniziali", () => {
  it("porta nel modulo i valori della scheda, con «vuoto» al posto di null", () => {
    const valori = valoriIniziali(SCHEDA, null);
    expect(valori.nome).toBe("Hvuv Serramenti");
    expect(valori.slug).toBe("hvuv");
    // Nel modulo non entrano mai `null`: un input non li sa mostrare, e il
    // server accetta la stringa vuota come «azzera».
    expect(valori.note).toBe("");
    expect(valori.fatturazione.partitaIva).toBe("12345678901");
    expect(valori.fatturazione.pec).toBe("");
    expect(valori.sedeNome).toBe("Sede di Aulla");
    expect(valori.sedeCitta).toBe("Aulla");
    expect(valori.proprietario).toEqual({
      id: 11,
      nome: "Anna",
      cognome: "Bianchi",
      email: "anna@esempio.it",
      telefono: "",
    });
  });

  it("senza sede predefinita e senza proprietari non inventa niente", () => {
    const valori = valoriIniziali(
      { ...SCHEDA, sedePredefinita: null, proprietari: [] },
      null
    );
    expect(valori.sedeNome).toBe("");
    expect(valori.sedeCitta).toBe("");
    expect(valori.proprietario).toBeNull();
  });

  it("con più proprietari prende quello chiesto, non sempre il primo", () => {
    const due: SchedaModificabile = {
      ...SCHEDA,
      proprietari: [
        ...SCHEDA.proprietari,
        {
          id: 12,
          nome: "Bruno",
          cognome: "Neri",
          email: "bruno@esempio.it",
          telefono: "0187 000",
          invitoInSospeso: false,
        },
      ],
    };
    expect(valoriIniziali(due, 12).proprietario?.nome).toBe("Bruno");
    // Id sconosciuto (proprietario revocato mentre il dialogo era aperto):
    // si ripiega sul primo invece di lasciare il pannello senza nessuno.
    expect(valoriIniziali(due, 99).proprietario?.id).toBe(11);
  });
});

describe("diffModifica", () => {
  it("senza modifiche non manda nessuna delle due mutation", () => {
    const diff = diffModifica(SCHEDA, valoriIniziali(SCHEDA, null));
    expect(diff.payloadAzienda).toBeNull();
    expect(diff.payloadProprietario).toBeNull();
    expect(diff.sezioni).toEqual([]);
  });

  it("gli spazi attorno a un valore non sono una modifica", () => {
    const diff = diffModifica(
      SCHEDA,
      conCambio({ nome: "  Hvuv Serramenti  ", sedeCitta: " Aulla " })
    );
    expect(diff.payloadAzienda).toBeNull();
  });

  it("manda solo i campi cambiati, non tutta la scheda", () => {
    const diff = diffModifica(SCHEDA, conCambio({ nome: "Hvuv Infissi" }));
    expect(diff.payloadAzienda).toEqual({ nome: "Hvuv Infissi" });
    expect(diff.sezioni).toEqual(["Azienda"]);
  });

  it("lo slug cambiato viaggia come `nuovoSlug`", () => {
    const diff = diffModifica(SCHEDA, conCambio({ slug: "hvuv-serramenti" }));
    expect(diff.payloadAzienda).toEqual({ nuovoSlug: "hvuv-serramenti" });
  });

  it("l'azienda della piattaforma non manda MAI `nuovoSlug`", () => {
    // Il campo è di sola lettura nel dialogo: questa è la seconda serratura,
    // perché il rifiuto del server arriverebbe come comando in errore.
    const tenant1: SchedaModificabile = { ...SCHEDA, id: 1, slug: "ruffino-group" };
    const diff = diffModifica(
      tenant1,
      { ...valoriIniziali(tenant1, null), slug: "altro-slug", nome: "Ruffino Group SRL" }
    );
    expect(diff.payloadAzienda).toEqual({ nome: "Ruffino Group SRL" });
  });

  it("svuotare un campo è una modifica: la stringa vuota azzera", () => {
    const conNote: SchedaModificabile = { ...SCHEDA, note: "Cliente storico" };
    const diff = diffModifica(conNote, { ...valoriIniziali(conNote, null), note: "" });
    expect(diff.payloadAzienda).toEqual({ note: "" });
  });

  it("della fatturazione manda solo i campi toccati", () => {
    const valori = conCambio({
      fatturazione: {
        ...valoriIniziali(SCHEDA, null).fatturazione,
        partitaIva: "",
        pec: "hvuv@pec.it",
      },
    });
    const diff = diffModifica(SCHEDA, valori);
    expect(diff.payloadAzienda).toEqual({
      fatturazione: { partitaIva: "", pec: "hvuv@pec.it" },
    });
    expect(diff.sezioni).toEqual(["Fatturazione"]);
  });

  it("la sede viaggia intera anche se cambia la sola città: non è un patch", () => {
    const diff = diffModifica(SCHEDA, conCambio({ sedeCitta: "Pontremoli" }));
    expect(diff.payloadAzienda).toEqual({
      sede: { id: 7, nome: "Sede di Aulla", citta: "Pontremoli" },
    });
    expect(diff.sezioni).toEqual(["Sede"]);
  });

  it("senza sede predefinita non c'è niente da mandare", () => {
    const senzaSede: SchedaModificabile = { ...SCHEDA, sedePredefinita: null };
    const diff = diffModifica(senzaSede, {
      ...valoriIniziali(senzaSede, null),
      sedeNome: "Inventata",
    });
    expect(diff.payloadAzienda).toBeNull();
  });

  it("il proprietario viaggia intero, con il suo id, appena un campo cambia", () => {
    const diff = diffModifica(
      SCHEDA,
      conCambio({
        proprietario: {
          id: 11,
          nome: "Anna",
          cognome: "Bianchi",
          email: "anna@nuovo.it",
          telefono: "",
        },
      })
    );
    expect(diff.payloadProprietario).toEqual({
      utenteId: 11,
      nome: "Anna",
      cognome: "Bianchi",
      email: "anna@nuovo.it",
      telefono: "",
    });
    expect(diff.sezioni).toEqual(["Proprietario"]);
  });

  it("scegliere un altro proprietario senza toccarne i campi non lo modifica", () => {
    const due: SchedaModificabile = {
      ...SCHEDA,
      proprietari: [
        ...SCHEDA.proprietari,
        {
          id: 12,
          nome: "Bruno",
          cognome: "Neri",
          email: "bruno@esempio.it",
          telefono: "0187 000",
          invitoInSospeso: false,
        },
      ],
    };
    expect(diffModifica(due, valoriIniziali(due, 12)).payloadProprietario).toBeNull();
  });

  it("le due mutation partono insieme quando cambiano tutte e due le parti", () => {
    const valori = conCambio({
      nome: "Hvuv Infissi",
      proprietario: {
        id: 11,
        nome: "Anna",
        cognome: "Bianchi",
        email: "anna@esempio.it",
        telefono: "0187 111",
      },
    });
    const diff = diffModifica(SCHEDA, valori);
    expect(diff.payloadAzienda).toEqual({ nome: "Hvuv Infissi" });
    expect(diff.payloadProprietario?.telefono).toBe("0187 111");
    expect(diff.sezioni).toEqual(["Azienda", "Proprietario"]);
  });
});

describe("erroriModulo", () => {
  it("tace quando il modulo è compilabile così com'è", () => {
    expect(erroriModulo(SCHEDA, valoriIniziali(SCHEDA, null))).toEqual([]);
  });

  it("non lascia partire una ragione sociale vuota", () => {
    expect(erroriModulo(SCHEDA, conCambio({ nome: "   " }))).toContain(
      "La ragione sociale non può restare vuota."
    );
  });

  it("ferma uno slug che il server rifiuterebbe per forma", () => {
    expect(erroriModulo(SCHEDA, conCambio({ slug: "Hvuv Serramenti" }))).toHaveLength(1);
    expect(erroriModulo(SCHEDA, conCambio({ slug: "hvuv-2" }))).toEqual([]);
  });

  it("porta fuori l'errore del campo di fatturazione, non solo un «non valido»", () => {
    const valori = conCambio({
      fatturazione: { ...valoriIniziali(SCHEDA, null).fatturazione, partitaIva: "1234" },
    });
    expect(erroriModulo(SCHEDA, valori)).toEqual([
      "Partita IVA: La partita IVA sono undici cifre, senza «IT».",
    ]);
  });

  it("il nome della sede non si svuota, e l'email del proprietario deve avere una forma", () => {
    expect(erroriModulo(SCHEDA, conCambio({ sedeNome: "" }))).toContain(
      "Il nome della sede non può restare vuoto."
    );
    const valori = conCambio({
      proprietario: {
        id: 11,
        nome: "Anna",
        cognome: "",
        email: "anna",
        telefono: "",
      },
    });
    expect(erroriModulo(SCHEDA, valori)).toEqual([
      "Nome e cognome del proprietario non possono restare vuoti.",
      "L'email del proprietario non ha la forma di un indirizzo.",
    ]);
  });
});
