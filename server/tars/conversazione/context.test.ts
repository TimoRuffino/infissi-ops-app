import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryNotificationRepository,
} from "../../notifications/repository";
import { createMemoryReminderRepository } from "../../reminders/repository";
import {
  createReminderService,
  setReminderServiceForTesting,
} from "../../reminders/service";
import { getClientiStore } from "../../routers/clienti";
import { getCommesseStore } from "../../routers/commesse";
import { azzeraArchivioPerTest, creaConversazione } from "../archivio";
import {
  VersioneContestoConversazioneObsoleta,
  aggiornaContestoDaEsitoTool,
  caricaContestoConversazione,
  salvaContestoConversazione,
} from "./context";
import { risolviCommessa } from "./resolver";
import { creaProviderFinto, chiamataTool, rispostaTesto } from "../openai/fake";
import { azzeraCacheTarsPerTest, eseguiRun } from "../orchestratore";
import type { ContestoRun, EsitoLettura } from "../strumenti/tipi";

const SEDE = 98_001;
const ALTRA_SEDE = 98_002;
const UTENTE = 98_011;
const ALTRO_UTENTE = 98_012;
const COMMESSA_A = 9_801_001;
const COMMESSA_B = 9_801_002;
const COMMESSA_ALTRA_SEDE = 9_802_001;
const COMMESSA_CASO_A = 9_801_003;
const COMMESSA_CASO_B = 9_801_004;
const CLIENTE_A = 9_801_101;
const CLIENTE_B = 9_801_102;
const IDS_TEST = new Set([
  COMMESSA_A,
  COMMESSA_B,
  COMMESSA_ALTRA_SEDE,
  COMMESSA_CASO_A,
  COMMESSA_CASO_B,
]);
const CLIENTI_TEST = new Set([CLIENTE_A, CLIENTE_B]);

function commessa(input: {
  id: number;
  sedeId?: number;
  codice: string;
  cliente: string;
  clienteId: number;
  updatedAt?: Date;
}) {
  return {
    id: input.id,
    sedeId: input.sedeId ?? SEDE,
    codice: input.codice,
    cliente: input.cliente,
    clienteId: input.clienteId,
    stato: "preventivo",
    priorita: "media",
    prodotti: [],
    pagamenti: [],
    costi: [],
    importoTotale: null,
    importoIncassato: 0,
    createdAt: new Date("2026-08-30T08:00:00.000Z"),
    updatedAt: input.updatedAt ?? new Date("2026-08-30T09:00:00.000Z"),
  };
}

function cliente(id: number, cognome: string) {
  return {
    id,
    sedeId: SEDE,
    nome: "Mario",
    cognome,
    tipo: "privato",
    commesseIds: [],
    createdAt: new Date("2026-08-30T08:00:00.000Z"),
    updatedAt: new Date("2026-08-30T09:00:00.000Z"),
  };
}

function contestoRun(): ContestoRun {
  return {
    utenteId: UTENTE,
    sedeId: SEDE,
    ruoli: ["direzione"],
    direzione: true,
    capability: new Set([
      "commessa.read",
      "pagamento.read",
      "economia.read",
      "tars.use",
    ] as any),
    capabilityFingerprint: "caps-context-test",
    lingua: "it",
    fuso: "Europe/Rome",
  };
}

async function nuovaConversazione(utenteId = UTENTE, sedeId = SEDE) {
  return creaConversazione({ sedeId, utenteId, titolo: "Contesto test" });
}

function esitoCommessa(
  id: number,
  clienteId: number,
  versione = "1788076800000"
): EsitoLettura<Record<string, unknown>> {
  const c = (getCommesseStore() as any[]).find(item => item.id === id)!;
  return {
    dati: { id, clienteId, codice: c.codice },
    evidenze: [
      {
        tipo: "entita",
        riferimento: `commessa:${id}`,
        descrizione: `${c.codice} — ${c.cliente}`,
      },
      {
        tipo: "entita",
        riferimento: `cliente:${clienteId}`,
        descrizione: c.cliente,
      },
    ],
    freschezza: "2026-08-31T10:00:00.000Z",
    fonteAutorevole: "CRM Ruffino Flow",
    omissioni: [],
    versioniEntita: { [`commessa:${id}`]: versione },
  };
}

beforeEach(() => {
  azzeraArchivioPerTest();
  azzeraCacheTarsPerTest();
  (getCommesseStore() as any[]).push(
    commessa({
      id: COMMESSA_A,
      codice: "COM-2026-182",
      cliente: "Maccari Mario",
      clienteId: CLIENTE_A,
    }),
    commessa({
      id: COMMESSA_B,
      codice: "COM-2026-183",
      cliente: "Maccari Marco",
      clienteId: CLIENTE_B,
    }),
    commessa({
      id: COMMESSA_ALTRA_SEDE,
      sedeId: ALTRA_SEDE,
      codice: "COM-2026-999",
      cliente: "Maccari Mario",
      clienteId: CLIENTE_A,
    }),
    commessa({
      id: COMMESSA_CASO_A,
      codice: "COM-2026-184",
      cliente: "Caso T5 Alfa",
      clienteId: CLIENTE_A,
    }),
    commessa({
      id: COMMESSA_CASO_B,
      codice: "COM-2026-185",
      cliente: "Caso T5 Beta",
      clienteId: CLIENTE_B,
    })
  );
  (getClientiStore() as any[]).push(
    cliente(CLIENTE_A, "Maccari"),
    cliente(CLIENTE_B, "Maccari")
  );
});

afterEach(() => {
  const commesse = getCommesseStore() as any[];
  for (let index = commesse.length - 1; index >= 0; index -= 1) {
    if (IDS_TEST.has(commesse[index].id)) commesse.splice(index, 1);
  }
  const clienti = getClientiStore() as any[];
  for (let index = clienti.length - 1; index >= 0; index -= 1) {
    if (CLIENTI_TEST.has(clienti[index].id)) clienti.splice(index, 1);
  }
  setReminderServiceForTesting(null);
  vi.useRealTimers();
});

describe("contesto conversazionale persistente", () => {
  it("persiste tutti i riferimenti, superficie, versioni e chiarificazione", async () => {
    const conversazione = await nuovaConversazione();
    const salvato = await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        comunicazioneId: 77,
        allegatoIndex: 2,
        superficie: "comunicazioni",
        versioniEntita: { [`commessa:${COMMESSA_A}`]: "v1" },
        chiarificazionePendente: {
          tipo: "commessa",
          riferimento: "Maccari",
          domanda: "Intendi COM-2026-182 o COM-2026-183?",
          candidati: [
            { commessaId: COMMESSA_A, codice: "COM-2026-182", cliente: "Maccari Mario" },
            { commessaId: COMMESSA_B, codice: "COM-2026-183", cliente: "Maccari Marco" },
          ],
        },
      },
    });

    expect(salvato.versione).toBe(1);
    await expect(
      caricaContestoConversazione({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
      })
    ).resolves.toMatchObject({
      commessaId: COMMESSA_A,
      clienteId: CLIENTE_A,
      comunicazioneId: 77,
      allegatoIndex: 2,
      superficie: "comunicazioni",
      versione: 1,
      versioniEntita: { [`commessa:${COMMESSA_A}`]: "v1" },
      chiarificazionePendente: {
        domanda: "Intendi COM-2026-182 o COM-2026-183?",
      },
    });
  });

  it("isola il contesto per sede e utente senza rivelare la conversazione", async () => {
    const conversazione = await nuovaConversazione();
    await expect(
      caricaContestoConversazione({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: ALTRO_UTENTE,
      })
    ).resolves.toBeNull();
    await expect(
      caricaContestoConversazione({
        conversazioneId: conversazione.id,
        sedeId: ALTRA_SEDE,
        utenteId: UTENTE,
      })
    ).resolves.toBeNull();
  });

  it("rifiuta una patch costruita su una versione ormai superata", async () => {
    const conversazione = await nuovaConversazione();
    await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: { superficie: "commessa" },
    });

    await expect(
      salvaContestoConversazione({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        versioneAttesa: 0,
        patch: { commessaId: COMMESSA_A },
      })
    ).rejects.toBeInstanceOf(VersioneContestoConversazioneObsoleta);
  });

  it("un esito tool univoco sostituisce l'entità attiva e i suoi riferimenti dipendenti", async () => {
    const conversazione = await nuovaConversazione();
    const iniziale = await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        comunicazioneId: 77,
        allegatoIndex: 1,
        superficie: "comunicazioni",
      },
    });
    const aggiornato = await aggiornaContestoDaEsitoTool({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: iniziale.versione,
      strumento: "leggi_commessa",
      esito: esitoCommessa(COMMESSA_B, CLIENTE_B),
    });

    expect(aggiornato).toMatchObject({
      commessaId: COMMESSA_B,
      clienteId: CLIENTE_B,
      comunicazioneId: null,
      allegatoIndex: null,
      superficie: "commessa",
      chiarificazionePendente: null,
    });
  });

  it("non acquisisce ID presenti solo nel testo del modello", async () => {
    const conversazione = await nuovaConversazione();
    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() =>
        rispostaTesto(`La commessa ${COMMESSA_A} è quella attiva.`)
      ),
      messaggio: "Parliamo d'altro",
      conversazioneId: conversazione.id,
    });
    const contesto = await caricaContestoConversazione({
      conversazioneId: risposta.conversazioneId,
      sedeId: SEDE,
      utenteId: UTENTE,
    });
    expect(contesto?.commessaId).toBeNull();
  });
});

describe("resolver deterministico commessa", () => {
  it("restituisce unico con ranking ed evidenza per un codice esatto", () => {
    const esito = risolviCommessa({ sedeId: SEDE, riferimento: "COM-2026-182" });
    expect(esito.stato).toBe("unico");
    if (esito.stato !== "unico") throw new Error("esito inatteso");
    expect(esito.candidato).toMatchObject({
      commessaId: COMMESSA_A,
      codice: "COM-2026-182",
    });
    expect(esito.candidato.punteggio).toBeGreaterThan(0);
    expect(esito.candidato.evidenze).toContain("codice esatto");
  });

  it("restituisce ambiguo con una sola domanda concreta e salva i candidati", async () => {
    const esito = risolviCommessa({ sedeId: SEDE, riferimento: "Maccari" });
    expect(esito.stato).toBe("ambiguo");
    if (esito.stato !== "ambiguo") throw new Error("esito inatteso");
    expect(esito.domanda.match(/\?/g)).toHaveLength(1);
    expect(esito.domanda).toContain("COM-2026-182");
    expect(esito.domanda).toContain("COM-2026-183");
    expect(esito.candidati).toHaveLength(2);

    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => {
        throw new Error("il provider non deve partire per una ambiguità deterministica");
      }),
      messaggio: "Controlla la commessa Maccari",
    });
    expect(risposta.statoOperativo).toMatchObject({ stato: "Da confermare" });
    expect(risposta.testo).toBe(esito.domanda);
    const persistito = await caricaContestoConversazione({
      conversazioneId: risposta.conversazioneId,
      sedeId: SEDE,
      utenteId: UTENTE,
    });
    expect(persistito?.commessaId).toBeNull();
    expect(persistito?.chiarificazionePendente?.domanda).toBe(esito.domanda);
  });

  it("restituisce non_trovato e non include mai candidati di un'altra sede", () => {
    const esito = risolviCommessa({
      sedeId: SEDE,
      riferimento: "COM-2026-999",
    });
    expect(esito).toEqual({ stato: "non_trovato", candidati: [] });
  });
});

describe("integrazione orchestratore, profilo e stato operativo", () => {
  it("non interpreta parole operative generiche come riferimento a una commessa", async () => {
    let chiamate = 0;
    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => {
        chiamate += 1;
        return rispostaTesto("Procedo con il caso richiesto.");
      }),
      messaggio: "Agisci sul caso/proposta di prova",
    });

    expect(chiamate).toBe(1);
    expect(risposta.testo).toBe("Procedo con il caso richiesto.");
    expect(risposta.statoOperativo).toMatchObject({ stato: "Preparato" });
  });

  it("carica il contesto prima del profilo, lo inietta in coda e usa un catalogo contestuale", async () => {
    const conversazione = await nuovaConversazione();
    await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        superficie: "commessa",
        versioniEntita: { [`commessa:${COMMESSA_A}`]: "1788080400000" },
      },
    });
    let richiesta: any;
    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(r => {
        richiesta = r;
        return rispostaTesto("Posso leggere il gate e preparare il prossimo passo.");
      }),
      messaggio: "Cosa puoi fare?",
      conversazioneId: conversazione.id,
    });

    const nomi = richiesta.strumenti.map((s: any) => s.nome);
    expect(nomi).toContain("leggi_commessa");
    expect(nomi).toContain("verifica_gate_commessa");
    expect(nomi).not.toContain("leggi_memorie");
    expect(nomi).not.toContain("cerca_commesse");
    const ultimoContesto = richiesta.input.at(-2)?.contenuto ?? "";
    expect(ultimoContesto).toContain("CONTESTO_CONVERSAZIONE_VERIFICATO");
    expect(ultimoContesto).toContain("COM-2026-182");
    expect(risposta.statoOperativo).toMatchObject({ stato: "Preparato" });
  });

  it("il fingerprint del contesto separa C0 e C2", async () => {
    const conversazioneA = await nuovaConversazione();
    const conversazioneB = await nuovaConversazione();
    await salvaContestoConversazione({
      conversazioneId: conversazioneA.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: { commessaId: COMMESSA_A, superficie: "commessa" },
    });
    await salvaContestoConversazione({
      conversazioneId: conversazioneB.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: { commessaId: COMMESSA_B, superficie: "commessa" },
    });
    const chiaviC2: string[] = [];
    let chiamate = 0;
    const provider = creaProviderFinto(r => {
      chiamate += 1;
      chiaviC2.push(r.chiaveCachePrompt);
      return rispostaTesto("Risposta contestuale.");
    });

    const prima = await eseguiRun({
      contesto: contestoRun(),
      provider,
      messaggio: "Cosa manca?",
      conversazioneId: conversazioneA.id,
    });
    const seconda = await eseguiRun({
      contesto: contestoRun(),
      provider,
      messaggio: "Cosa manca?",
      conversazioneId: conversazioneB.id,
    });

    expect(prima.cache.c0Hit).toBe(false);
    expect(seconda.cache.c0Hit).toBe(false);
    expect(chiamate).toBe(2);
    expect(new Set(chiaviC2).size).toBe(2);
  });

  it("deriva Fatto da un esito azione reale e Bloccato da una degradazione", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T08:00:00.000Z"));
    const repo = createMemoryReminderRepository();
    setReminderServiceForTesting(
      createReminderService({
        reminders: repo,
        notifications: createMemoryNotificationRepository(),
      })
    );
    const fatto = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto((_r, passo) =>
        passo === 0
          ? chiamataTool("crea_promemoria", {
              testo: "Chiamare il fornitore",
              quando: "tra un'ora",
            })
          : rispostaTesto("Promemoria creato.")
      ),
      messaggio: "Ricordami fra un'ora di chiamare il fornitore",
    });
    expect(fatto.statoOperativo).toMatchObject({ stato: "Fatto" });

    const bloccato = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => "errore_fatale"),
      messaggio: "Richiesta che fallisce",
    });
    expect(bloccato.statoOperativo).toMatchObject({ stato: "Bloccato" });
  });

  it("crea_promemoria eredita la commessa solo dal contesto persistente verificato e la rilegge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T08:00:00.000Z"));
    const repo = createMemoryReminderRepository();
    setReminderServiceForTesting(
      createReminderService({
        reminders: repo,
        notifications: createMemoryNotificationRepository(),
      })
    );
    const conversazione = await nuovaConversazione();
    await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        superficie: "commessa",
        versioniEntita: { [`commessa:${COMMESSA_A}`]: "1788080400000" },
      },
    });

    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto((_r, passo) =>
        passo === 0
          ? chiamataTool("crea_promemoria", {
              testo: "Finanziamento Maccari",
              quando: "tra un'ora",
            })
          : rispostaTesto("Promemoria creato.")
      ),
      messaggio: "Imposta un promemoria fra un'ora: finanziamento Maccari",
      conversazioneId: conversazione.id,
    });

    const salvati = await repo.listPersonal({
      sedeId: SEDE,
      recipientUserId: UTENTE,
      stati: ["scheduled"],
      ordina: "remindAt",
      limit: 10,
    });
    expect(risposta.statoOperativo).toMatchObject({ stato: "Fatto" });
    expect(salvati).toHaveLength(1);
    expect(salvati[0].commessaId).toBe(COMMESSA_A);
    expect(salvati[0].clienteId).toBe(CLIENTE_A);
  });

  it("blocca l'eredità del reminder se la versione della commessa è diventata stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T08:00:00.000Z"));
    const repo = createMemoryReminderRepository();
    setReminderServiceForTesting(
      createReminderService({
        reminders: repo,
        notifications: createMemoryNotificationRepository(),
      })
    );
    const conversazione = await nuovaConversazione();
    await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        superficie: "commessa",
        versioniEntita: { [`commessa:${COMMESSA_A}`]: "1788080400000" },
      },
    });
    const corrente = (getCommesseStore() as any[]).find(c => c.id === COMMESSA_A);
    corrente.updatedAt = new Date("2026-08-31T07:30:00.000Z");

    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto((_r, passo) =>
        passo === 0
          ? chiamataTool("crea_promemoria", {
              testo: "Finanziamento Maccari",
              quando: "tra un'ora",
            })
          : rispostaTesto("Non eseguito: la commessa è cambiata.")
      ),
      messaggio: "Imposta un promemoria fra un'ora sul finanziamento",
      conversazioneId: conversazione.id,
    });

    expect(risposta.statoOperativo).toMatchObject({ stato: "Non eseguito" });
    expect(await repo.listPersonal({
      sedeId: SEDE,
      recipientUserId: UTENTE,
      stati: ["scheduled"],
      ordina: "remindAt",
      limit: 10,
    })).toHaveLength(0);
  });
});
