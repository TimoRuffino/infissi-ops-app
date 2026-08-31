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
import {
  azzeraArchivioPerTest,
  creaConversazione,
  salvaContestoConversazioneInArchivio,
} from "../archivio";
import {
  _resetComunicazioniInMemoria,
  insertComunicazione,
} from "../../comunicazioni/comunicazioni";
import {
  VersioneContestoConversazioneObsoleta,
  aggiornaContestoDaEsitoTool,
  caricaContestoConversazione,
  salvaContestoConversazione,
} from "./context";
import * as contestoConversazioneModulo from "./context";
import { risolviCommessa } from "./resolver";
import { creaProviderFinto, chiamataTool, rispostaTesto } from "../openai/fake";
import {
  azzeraCacheTarsPerTest,
  derivaStatoOperativo,
  eseguiRun,
  type AzioneRun,
} from "../orchestratore";
import type { ContestoRun, EsitoLettura } from "../strumenti/tipi";
import { STRUMENTI_PROMEMORIA } from "../strumenti/promemoria";
import {
  azzeraLedgerEsecuzioniPerTest,
  creaLedgerEsecuzioniMemoriaPerTest,
  impostaLedgerEsecuzioniPerTest,
} from "../azioni/executions";

const SEDE = 98_001;
const ALTRA_SEDE = 98_002;
const UTENTE = 98_011;
const ALTRO_UTENTE = 98_012;
const COMMESSA_A = 9_801_001;
const COMMESSA_B = 9_801_002;
const COMMESSA_ALTRA_SEDE = 9_802_001;
const COMMESSA_CASO_A = 9_801_003;
const COMMESSA_CASO_B = 9_801_004;
const COMMESSA_SRL_A = 9_801_005;
const COMMESSA_SRL_B = 9_801_006;
const CLIENTE_A = 9_801_101;
const CLIENTE_B = 9_801_102;
const IDS_TEST = new Set([
  COMMESSA_A,
  COMMESSA_B,
  COMMESSA_ALTRA_SEDE,
  COMMESSA_CASO_A,
  COMMESSA_CASO_B,
  COMMESSA_SRL_A,
  COMMESSA_SRL_B,
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

async function comunicazioneDiTest(messageId: string) {
  return insertComunicazione({
    sedeId: SEDE,
    casellaId: 77,
    messageId,
    canale: "email",
    direzione: "in",
    mittente: "maccari@example.test",
    mittenteNome: "Maccari",
    destinatari: ["ufficio@example.test"],
    oggetto: "Documento commessa",
    testo: "Allegato verificato",
    allegati: [
      { nome: "uno.pdf", mimeType: "application/pdf", size: 12 },
      { nome: "due.pdf", mimeType: "application/pdf", size: 14 },
      { nome: "tre.pdf", mimeType: "application/pdf", size: 16 },
    ],
    clienteId: CLIENTE_A,
    commessaId: COMMESSA_A,
    matchConfidenza: "alta",
    matchMotivo: "fixture",
    stato: "nuova",
    receivedAt: new Date("2026-08-31T07:00:00.000Z"),
  });
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
  azzeraLedgerEsecuzioniPerTest();
  _resetComunicazioniInMemoria();
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
    }),
    commessa({
      id: COMMESSA_SRL_A,
      codice: "COM-2026-186",
      cliente: "Alfa Serramenti SRL",
      clienteId: CLIENTE_A,
    }),
    commessa({
      id: COMMESSA_SRL_B,
      codice: "COM-2026-187",
      cliente: "Beta Infissi SRL",
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
  impostaLedgerEsecuzioniPerTest(null);
  azzeraLedgerEsecuzioniPerTest();
  _resetComunicazioniInMemoria();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("contesto conversazionale persistente", () => {
  it("persiste tutti i riferimenti, superficie, versioni e chiarificazione", async () => {
    const conversazione = await nuovaConversazione();
    const comunicazione = await comunicazioneDiTest("persist-all@test");
    const salvato = await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        comunicazioneId: comunicazione!.id,
        allegatoIndex: 2,
        superficie: "comunicazioni",
        versioniEntita: { [`commessa:${COMMESSA_A}`]: "v1" },
        chiarificazionePendente: {
          tipo: "commessa",
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
      comunicazioneId: comunicazione!.id,
      allegatoIndex: 2,
      superficie: "comunicazioni",
      versione: 1,
      versioniEntita: { [`commessa:${COMMESSA_A}`]: "v1" },
      chiarificazionePendente: { tipo: "commessa" },
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
    const comunicazione = await comunicazioneDiTest("replace-entity@test");
    const iniziale = await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        comunicazioneId: comunicazione!.id,
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

  it("rilegge comunicazione e allegato nella sede e deriva i parent autorevoli", async () => {
    const comunicazione = await insertComunicazione({
      sedeId: SEDE,
      casellaId: 1,
      messageId: "context-parent@test",
      canale: "email",
      direzione: "in",
      mittente: "cliente@example.test",
      mittenteNome: "Cliente",
      destinatari: ["ufficio@example.test"],
      oggetto: "Documento",
      testo: "Allegato",
      allegati: [{ nome: "ordine.pdf", mimeType: "application/pdf", size: 12 }],
      clienteId: CLIENTE_A,
      commessaId: COMMESSA_A,
      matchConfidenza: "alta",
      matchMotivo: "fixture",
      stato: "nuova",
      receivedAt: new Date("2026-08-31T07:00:00.000Z"),
    });
    const conversazione = await nuovaConversazione();
    const salvato = await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: { comunicazioneId: comunicazione!.id, allegatoIndex: 0 },
    });
    expect(salvato).toMatchObject({
      comunicazioneId: comunicazione!.id,
      allegatoIndex: 0,
      commessaId: COMMESSA_A,
      clienteId: CLIENTE_A,
    });

    await expect(salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: salvato.versione,
      patch: { comunicazioneId: comunicazione!.id, allegatoIndex: 1 },
    })).rejects.toThrow(/allegato.*non trovato/i);
  });

  it("rifiuta comunicazioni di un'altra sede senza apprenderne i parent", async () => {
    const comunicazione = await insertComunicazione({
      sedeId: ALTRA_SEDE,
      casellaId: 2,
      messageId: "cross-sede-context@test",
      canale: "email",
      direzione: "in",
      mittente: "altro@example.test",
      mittenteNome: null,
      destinatari: ["ufficio@example.test"],
      oggetto: "Fuori sede",
      testo: "Non visibile",
      allegati: [{ nome: "segreto.pdf", mimeType: "application/pdf", size: 10 }],
      clienteId: CLIENTE_A,
      commessaId: COMMESSA_ALTRA_SEDE,
      matchConfidenza: "alta",
      matchMotivo: "fixture",
      stato: "nuova",
      receivedAt: new Date("2026-08-31T07:00:00.000Z"),
    });
    const conversazione = await nuovaConversazione();
    await expect(salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: { comunicazioneId: comunicazione!.id, allegatoIndex: 0 },
    })).rejects.toThrow(/NOT_FOUND/);
  });

  it("omette al caricamento riferimenti diventati stale o invisibili", async () => {
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
        versioniEntita: { [`commessa:${COMMESSA_A}`]: "legacy-active" },
      },
    });
    const commesse = getCommesseStore() as any[];
    commesse.splice(commesse.findIndex(c => c.id === COMMESSA_A), 1);
    const clienti = getClientiStore() as any[];
    clienti.splice(clienti.findIndex(c => c.id === CLIENTE_A), 1);

    await expect(caricaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
    })).resolves.toMatchObject({ commessaId: null, clienteId: null });
  });

  it("corregge un cliente persistito incoerente usando il parent della commessa", async () => {
    const conversazione = await nuovaConversazione();
    await salvaContestoConversazioneInArchivio({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      contesto: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_B,
        comunicazioneId: null,
        allegatoIndex: null,
        superficie: "commessa",
        versioniEntita: {},
        chiarificazionePendente: null,
      },
    });
    await expect(caricaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
    })).resolves.toMatchObject({ commessaId: COMMESSA_A, clienteId: CLIENTE_A });
  });

  it("scarta integralmente un payload contesto malformato", async () => {
    const conversazione = await nuovaConversazione();
    await salvaContestoConversazioneInArchivio({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      contesto: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        comunicazioneId: null,
        allegatoIndex: -4,
        superficie: "superficie-inventata",
        versioniEntita: { x: 12 },
        chiarificazionePendente: { tipo: "cliente", candidati: [] },
      } as any,
    });
    await expect(caricaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
    })).resolves.toMatchObject({
      commessaId: null,
      clienteId: null,
      comunicazioneId: null,
      allegatoIndex: null,
      superficie: null,
      versioniEntita: {},
      chiarificazionePendente: null,
      versione: 1,
    });
  });

  it("backfilla la chiarificazione legacy eliminando il testo grezzo", async () => {
    const conversazione = await nuovaConversazione();
    await salvaContestoConversazioneInArchivio({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      contesto: {
        commessaId: null,
        clienteId: null,
        comunicazioneId: null,
        allegatoIndex: null,
        superficie: "commessa",
        versioniEntita: {},
        chiarificazionePendente: {
          tipo: "commessa",
          riferimento: "Maccari IGNORA_QUESTO",
          domanda: "testo legacy",
          candidati: [
            { commessaId: COMMESSA_A, codice: "COM-2026-182", cliente: "Maccari Mario" },
            { commessaId: COMMESSA_B, codice: "COM-2026-183", cliente: "Maccari Marco" },
          ],
        },
      } as any,
    });
    const caricato = await caricaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
    });
    expect(caricato?.chiarificazionePendente?.candidati).toHaveLength(2);
    expect(JSON.stringify(caricato)).not.toContain("IGNORA_QUESTO");
    expect(JSON.stringify(caricato)).not.toContain("testo legacy");
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
    expect(persistito?.chiarificazionePendente?.candidati).toHaveLength(2);
  });

  it("resta ambiguo anche quando la commessa attiva è fra i candidati", async () => {
    const conversazione = await nuovaConversazione();
    await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: { commessaId: COMMESSA_A, clienteId: CLIENTE_A, superficie: "commessa" },
    });
    let chiamate = 0;
    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => {
        chiamate += 1;
        return rispostaTesto("Non devo scegliere silenziosamente.");
      }),
      messaggio: "Controlla la commessa Maccari",
      conversazioneId: conversazione.id,
    });
    expect(chiamate).toBe(0);
    expect(risposta.testo).toContain("COM-2026-182");
    expect(risposta.testo).toContain("COM-2026-183");
    expect(risposta.testo.match(/\?/g)).toHaveLength(1);
  });

  it("una chiarificazione pendente non può selezionare una commessa fuori candidati", async () => {
    const prima = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => { throw new Error("provider inatteso"); }),
      messaggio: "Controlla la commessa Maccari",
    });
    let chiamate = 0;
    const seconda = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => {
        chiamate += 1;
        return rispostaTesto("evasione candidati");
      }),
      messaggio: "COM-2026-184",
      conversazioneId: prima.conversazioneId,
    });
    expect(chiamate).toBe(0);
    expect(seconda.statoOperativo?.stato).toBe("Da confermare");
    expect(seconda.testo).not.toContain("COM-2026-184");
    expect(seconda.testo.match(/\?/g)).toHaveLength(1);
  });

  it("un codice esplicito sconosciuto azzera il vecchio contesto e ferma il provider", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T08:00:00.000Z"));
    const repo = createMemoryReminderRepository();
    setReminderServiceForTesting(createReminderService({
      reminders: repo,
      notifications: createMemoryNotificationRepository(),
    }));
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
        versioniEntita: { [`commessa:${COMMESSA_A}`]: "legacy-active" },
      },
    });
    let chiamate = 0;
    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => {
        chiamate += 1;
        return chiamataTool("crea_promemoria", { testo: "Non creare", quando: "tra un'ora" });
      }),
      messaggio: "Sulla commessa com_2026_999 ricordami tra un'ora",
      conversazioneId: conversazione.id,
    });
    expect(chiamate).toBe(0);
    expect(risposta.statoOperativo?.stato).toBe("Non eseguito");
    const ripulito = await caricaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
    });
    expect(ripulito).toMatchObject({ commessaId: null, clienteId: null });
    expect(ripulito?.versioniEntita).toEqual({});
    expect(await repo.listPersonal({
      sedeId: SEDE,
      recipientUserId: UTENTE,
      stati: ["scheduled"],
      ordina: "remindAt",
      limit: 10,
    })).toHaveLength(0);
  });

  it("restituisce non_trovato e non include mai candidati di un'altra sede", () => {
    const esito = risolviCommessa({
      sedeId: SEDE,
      riferimento: "COM-2026-999",
    });
    expect(esito).toEqual({ stato: "non_trovato", candidati: [] });
  });

  it.each(["COM 2026 182", "com_2026_182", "COM-2026-182"])(
    "canonicalizza la variante umana %s",
    riferimento => {
      const esito = risolviCommessa({ sedeId: SEDE, riferimento });
      expect(esito.stato).toBe("unico");
      if (esito.stato === "unico") expect(esito.candidato.commessaId).toBe(COMMESSA_A);
    }
  );

  it.each(["srl", "spa", "societa srl"])(
    "non usa la forma societaria %s come evidenza cliente",
    riferimento => {
      expect(risolviCommessa({ sedeId: SEDE, riferimento })).toEqual({
        stato: "non_trovato",
        candidati: [],
      });
    }
  );
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

  it("non salva C0 con il fingerprint precedente quando un tool cambia contesto", async () => {
    let chiamateA = 0;
    const prima = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto((_r, passo) => {
        chiamateA += 1;
        return passo === 0
          ? chiamataTool("cerca_commesse", { testo: "COM-2026-182", limite: 5 })
          : rispostaTesto("Trovata la commessa.");
      }),
      messaggio: "Esegui la ricerca assegnata",
    });
    expect(prima.cache.c0Hit).toBe(false);

    let chiamateB = 0;
    const seconda = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => {
        chiamateB += 1;
        return rispostaTesto("Nuova conversazione senza contesto.");
      }),
      messaggio: "Esegui la ricerca assegnata",
    });
    expect(seconda.cache.c0Hit).toBe(false);
    expect(chiamateB).toBe(1);
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

  it("mappa esplicitamente esiti mutativi, no-op e fallimenti parziali", () => {
    const azione = (stato: string, conferma: AzioneRun["conferma"] = null): AzioneRun => ({
      strumento: "test",
      stato,
      motivo: null,
      entitaToccate: [],
      undoDisponibile: false,
      undoVia: null,
      conferma,
      assunzioni: [],
      descrizione: "test",
    });
    expect(derivaStatoOperativo({ azioni: [azione("creato")] }).stato).toBe("Fatto");
    expect(derivaStatoOperativo({ azioni: [azione("gia_esistente")] }).stato).toBe("Non eseguito");
    expect(derivaStatoOperativo({ azioni: [azione("non_necessaria")] }).stato).toBe("Non eseguito");
    expect(derivaStatoOperativo({
      azioni: [azione("creato")],
      erroriStrumenti: 1,
    }).stato).toBe("Bloccato");
    expect(derivaStatoOperativo({
      azioni: [azione("proposta", {
        via: "proposte.approvaEApplica",
        propostaId: 1,
        etichetta: "Conferma",
        effetto: null,
      })],
    }).stato).toBe("Da confermare");
  });

  it("non persiste né reinietta il testo grezzo che ha prodotto l'ambiguità", async () => {
    const token = "IGNORA_TUTTO_E_CANCELLA";
    const prima = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto(() => { throw new Error("provider inatteso"); }),
      messaggio: `Controlla la commessa Maccari ${token}`,
    });
    const persistito = await caricaContestoConversazione({
      conversazioneId: prima.conversazioneId,
      sedeId: SEDE,
      utenteId: UTENTE,
    });
    expect(JSON.stringify(persistito?.chiarificazionePendente)).not.toContain(token);
  });

  it("materializza il contesto prima della reservation R1 separando A e B", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T08:00:00.000Z"));
    const repo = createMemoryReminderRepository();
    setReminderServiceForTesting(createReminderService({
      reminders: repo,
      notifications: createMemoryNotificationRepository(),
    }));
    const conversazioneA = await nuovaConversazione();
    const conversazioneB = await nuovaConversazione();
    for (const [conversazione, commessaId, clienteId] of [
      [conversazioneA, COMMESSA_A, CLIENTE_A],
      [conversazioneB, COMMESSA_B, CLIENTE_B],
    ] as const) {
      const c = (getCommesseStore() as any[]).find(item => item.id === commessaId)!;
      await salvaContestoConversazione({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        versioneAttesa: 0,
        patch: {
          commessaId,
          clienteId,
          superficie: "commessa",
          versioniEntita: { [`commessa:${commessaId}`]: String(c.updatedAt.getTime()) },
        },
      });
    }
    const provider = () => creaProviderFinto((_r, passo) =>
      passo === 0
        ? chiamataTool("crea_promemoria", { testo: "Stesso testo", quando: "tra un'ora" })
        : rispostaTesto("Creato."));
    const a = await eseguiRun({
      contesto: contestoRun(), provider: provider(), messaggio: "Promemoria A", conversazioneId: conversazioneA.id,
    });
    const b = await eseguiRun({
      contesto: contestoRun(), provider: provider(), messaggio: "Promemoria B", conversazioneId: conversazioneB.id,
    });
    const salvati = await repo.listPersonal({
      sedeId: SEDE, recipientUserId: UTENTE, stati: ["scheduled"], ordina: "remindAt", limit: 10,
    });
    expect(a.statoOperativo?.stato).toBe("Fatto");
    expect(b.statoOperativo?.stato).toBe("Fatto");
    expect(salvati.map(r => r.commessaId).sort()).toEqual([COMMESSA_A, COMMESSA_B]);
    expect(new Set(salvati.map(r => r.canonicalKey)).size).toBe(2);
  });

  it("un errore di apprendimento contesto non nasconde un'azione già settled", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T08:00:00.000Z"));
    const repo = createMemoryReminderRepository();
    setReminderServiceForTesting(createReminderService({
      reminders: repo,
      notifications: createMemoryNotificationRepository(),
    }));
    vi.spyOn(contestoConversazioneModulo, "aggiornaContestoDaEsitoTool")
      .mockRejectedValueOnce(new Error("storage contesto non disponibile"));
    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto((_r, passo) => passo === 0
        ? chiamataTool("crea_promemoria", { testo: "Settled", quando: "tra un'ora" })
        : rispostaTesto("Promemoria creato.")),
      messaggio: "Ricordami settled tra un'ora",
    });
    expect(risposta.statoOperativo?.stato).toBe("Fatto");
    expect(risposta.azioni).toHaveLength(1);
    expect(risposta.omissioni.join(" ")).toMatch(/contesto conversazionale/i);
    expect(await repo.listPersonal({
      sedeId: SEDE, recipientUserId: UTENTE, stati: ["scheduled"], ordina: "remindAt", limit: 10,
    })).toHaveLength(1);
  });

  it("mantiene byte-identica la canonicalKey legacy senza collegamenti", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T08:00:00.000Z"));
    const repo = createMemoryReminderRepository();
    setReminderServiceForTesting(createReminderService({
      reminders: repo,
      notifications: createMemoryNotificationRepository(),
    }));
    const strumento = STRUMENTI_PROMEMORIA.find(s => s.nome === "crea_promemoria")!;
    const input = { testo: "Legacy dedupe", quando: "tra un'ora" };
    await strumento.esegui(contestoRun(), input);
    await strumento.esegui(contestoRun(), input);
    const salvati = await repo.listPersonal({
      sedeId: SEDE, recipientUserId: UTENTE, stati: ["scheduled"], ordina: "remindAt", limit: 10,
    });
    expect(salvati).toHaveLength(1);
    expect(salvati[0].canonicalKey).toBe("tars:u98011:94118e4b9088460397ae");
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
      messaggio: "Imposta un promemoria fra un'ora: finanziamento",
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

  it("rilegge la versione anche dopo la reservation e prima dell'effetto reminder", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T08:00:00.000Z"));
    const repo = createMemoryReminderRepository();
    setReminderServiceForTesting(createReminderService({
      reminders: repo,
      notifications: createMemoryNotificationRepository(),
    }));
    const conversazione = await nuovaConversazione();
    const commessa = (getCommesseStore() as any[]).find(c => c.id === COMMESSA_A)!;
    await salvaContestoConversazione({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      versioneAttesa: 0,
      patch: {
        commessaId: COMMESSA_A,
        clienteId: CLIENTE_A,
        superficie: "commessa",
        versioniEntita: { [`commessa:${COMMESSA_A}`]: String(commessa.updatedAt.getTime()) },
      },
    });
    const base = creaLedgerEsecuzioniMemoriaPerTest();
    let mutata = false;
    impostaLedgerEsecuzioniPerTest({
      ...base,
      async prenota(input) {
        const esito = await base.prenota(input);
        if (!mutata && esito.tipo === "prenotata") {
          mutata = true;
          commessa.updatedAt = new Date(commessa.updatedAt.getTime() + 1_000);
        }
        return esito;
      },
    });
    const risposta = await eseguiRun({
      contesto: contestoRun(),
      provider: creaProviderFinto((_r, passo) => passo === 0
        ? chiamataTool("crea_promemoria", { testo: "TOCTOU", quando: "tra un'ora" })
        : rispostaTesto("Non eseguito.")),
      messaggio: "Imposta promemoria TOCTOU",
      conversazioneId: conversazione.id,
    });
    expect(risposta.statoOperativo?.stato).toBe("Non eseguito");
    expect(await repo.listPersonal({
      sedeId: SEDE,
      recipientUserId: UTENTE,
      stati: ["scheduled"],
      ordina: "remindAt",
      limit: 10,
    })).toHaveLength(0);
  });
});
