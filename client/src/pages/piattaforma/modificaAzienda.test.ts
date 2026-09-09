import { describe, expect, it } from "vitest";

import {
  diffModifica,
  erroriModulo,
  payloadDaRipetere,
  valoriIniziali,
  type EsitoParziale,
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

  // Nit della revisione (fix round 1, Task 4): la forma dei campi era
  // controllata, i tetti di lunghezza dello stesso schema del server no —
  // `schemaPayloadModificaTenant`/`schemaPayloadModificaProprietario`
  // (server/tenants/comandi.ts). `indirizzoLegale` li aveva già (per la
  // fatturazione, sotto), qui i cinque che mancavano.
  it("ragione sociale, note e nome della sede non superano il tetto del server", () => {
    expect(erroriModulo(SCHEDA, conCambio({ nome: "A".repeat(121) }))).toContain(
      "La ragione sociale non supera i 120 caratteri."
    );
    expect(erroriModulo(SCHEDA, conCambio({ nome: "A".repeat(120) }))).not.toContain(
      "La ragione sociale non supera i 120 caratteri."
    );
    expect(erroriModulo(SCHEDA, conCambio({ note: "A".repeat(2001) }))).toContain(
      "Le note non superano i 2000 caratteri."
    );
    expect(erroriModulo(SCHEDA, conCambio({ sedeNome: "A".repeat(121) }))).toContain(
      "Il nome della sede non supera i 120 caratteri."
    );
  });

  it("senza sede predefinita il tetto della sede non si controlla: non c'è il campo", () => {
    const senzaSede: SchedaModificabile = { ...SCHEDA, sedePredefinita: null };
    const valori = { ...valoriIniziali(senzaSede, null), sedeNome: "A".repeat(121) };
    expect(erroriModulo(senzaSede, valori)).toEqual([]);
  });

  it("nome, cognome e telefono del proprietario non superano il tetto del server", () => {
    const valori = conCambio({
      proprietario: {
        id: 11,
        nome: "A".repeat(81),
        cognome: "B".repeat(81),
        email: "anna@esempio.it",
        telefono: "0".repeat(41),
      },
    });
    const errori = erroriModulo(SCHEDA, valori);
    expect(errori).toContain("Il nome del proprietario non supera gli 80 caratteri.");
    expect(errori).toContain("Il cognome del proprietario non supera gli 80 caratteri.");
    expect(errori).toContain("Il telefono del proprietario non supera i 40 caratteri.");
  });
});

describe("payloadDaRipetere", () => {
  const NIENTE_SALVATO: EsitoParziale = { azienda: null, proprietario: false };

  /** Slug e proprietario cambiati insieme: il caso composto della revisione. */
  function diffComposto() {
    return diffModifica(
      SCHEDA,
      conCambio({
        slug: "hvuv-serramenti",
        proprietario: {
          id: 11,
          nome: "Anna",
          cognome: "Bianchi",
          email: "anna@nuovo.it",
          telefono: "",
        },
      })
    );
  }

  it("il primo tentativo manda tutto quello che è cambiato, sullo slug con cui si è aperto il dialogo", () => {
    const diff = diffComposto();
    const daRipetere = payloadDaRipetere(diff, SCHEDA.slug, NIENTE_SALVATO);
    expect(daRipetere.payloadAzienda).toEqual({ nuovoSlug: "hvuv-serramenti" });
    expect(daRipetere.payloadProprietario).toEqual(diff.payloadProprietario);
    expect(daRipetere.slug).toBe("hvuv");
    expect(daRipetere.sezioni).toEqual(["Azienda", "Proprietario"]);
  });

  it("dopo l'azienda salvata e il proprietario fallito manda solo il proprietario, sullo slug nuovo", () => {
    // È il bug della revisione: senza `payloadDaRipetere`, un secondo
    // tentativo ricalcolato da `diff` (che confronta ancora con la scheda
    // VECCHIA) rimanderebbe anche `nuovoSlug`, con `slug: "hvuv"` — e dopo
    // il cambio riuscito il server risponde NOT_FOUND su quello slug: il
    // proprietario non si potrebbe più salvare in nessun modo.
    const diff = diffComposto();
    const fatto: EsitoParziale = { azienda: { slug: "hvuv-serramenti" }, proprietario: false };
    const daRipetere = payloadDaRipetere(diff, SCHEDA.slug, fatto);
    expect(daRipetere.payloadAzienda).toBeNull();
    expect(daRipetere.payloadProprietario).toEqual(diff.payloadProprietario);
    expect(daRipetere.slug).toBe("hvuv-serramenti");
    expect(daRipetere.sezioni).toEqual(["Proprietario"]);
  });

  it("dopo che sono andati a buon fine tutti e due non resta niente da mandare", () => {
    const diff = diffComposto();
    const fatto: EsitoParziale = { azienda: { slug: "hvuv-serramenti" }, proprietario: true };
    const daRipetere = payloadDaRipetere(diff, SCHEDA.slug, fatto);
    expect(daRipetere.payloadAzienda).toBeNull();
    expect(daRipetere.payloadProprietario).toBeNull();
    expect(daRipetere.sezioni).toEqual([]);
    // Lo slug resta comunque quello nuovo: è lì che vive l'azienda adesso.
    expect(daRipetere.slug).toBe("hvuv-serramenti");
  });

  it("il proprietario già salvato da solo (nessun cambio di slug) non tocca lo slug di apertura", () => {
    const diff = diffModifica(SCHEDA, conCambio({ nome: "Hvuv Infissi" }));
    const fatto: EsitoParziale = { azienda: null, proprietario: true };
    const daRipetere = payloadDaRipetere(diff, SCHEDA.slug, fatto);
    // L'azienda non era ancora stata salvata: il suo payload resta da mandare.
    expect(daRipetere.payloadAzienda).toEqual({ nome: "Hvuv Infissi" });
    expect(daRipetere.slug).toBe(SCHEDA.slug);
    expect(daRipetere.sezioni).toEqual(["Azienda"]);
  });

  it("senza niente di già salvato lo slug resta quello con cui si è aperto il dialogo", () => {
    const diff = diffModifica(SCHEDA, conCambio({ nome: "Hvuv Infissi" }));
    const daRipetere = payloadDaRipetere(diff, SCHEDA.slug, NIENTE_SALVATO);
    expect(daRipetere.slug).toBe(SCHEDA.slug);
  });
});
