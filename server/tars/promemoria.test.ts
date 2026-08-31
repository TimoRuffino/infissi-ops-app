// Tars T2 — le prove dei promemoria L1: richiesta esplicita = ZERO
// conferme (attrito misurato sui turni), idempotenza senza duplicati,
// ricreazione dopo annullo, DST onesto (ora inesistente/ambigua
// rifiutata, mai indovinata), ownership e sede fail-closed, kill switch
// non aggirabile nemmeno chiamando lo strumento a mano. Provider SEMPRE
// finto; repository promemoria in memoria, pulito a ogni test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import {
  createMemoryNotificationRepository,
} from "../notifications/repository";
import {
  createMemoryReminderRepository,
} from "../reminders/repository";
import {
  createReminderService,
  setReminderServiceForTesting,
  type ReminderService,
} from "../reminders/service";
import type { ReminderRepository } from "../reminders/repository";
import { getCommesseStore } from "../routers/commesse";
import { getUtentiStore } from "../routers/utenti";
import { azzeraArchivioPerTest, turniDiConversazione } from "./archivio";
import { costruisciContesto } from "./contesto";
import { creaProviderFinto, chiamataTool, rispostaTesto } from "./openai/fake";
import { azzeraCacheTarsPerTest, eseguiRun } from "./orchestratore";
import { strumentiPerContesto } from "./profili";
import type { PassoCopione } from "./openai/fake";
import type { RispostaProvider } from "./provider";
import { STRUMENTI_PROMEMORIA } from "./strumenti/promemoria";

const SEDE = 96001;
const ALTRA_SEDE = 96002;
const UTENTE_ID = 96011;
const COLLEGA_ID = 96012;

// Sabato 29/08/2026, 10:30 Europe/Rome (CEST).
const ORA_BASE = new Date("2026-08-29T08:30:00.000Z");

for (const id of [UTENTE_ID, COLLEGA_ID]) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Nome${id}`,
      cognome: `Cognome${id}`,
      email: `tars-t2-${id}@example.test`,
      attivo: true,
      ruoli: ["commerciale"],
      ruolo: "commerciale",
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(
  userId: number,
  sedeId = SEDE,
  roles: string[] = ["commerciale"]
): TrpcContext {
  return {
    user: {
      id: userId,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

let repo: ReminderRepository;
let servizio: ReminderService;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ORA_BASE);
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
  repo = createMemoryReminderRepository();
  servizio = createReminderService({
    reminders: repo,
    notifications: createMemoryNotificationRepository(),
  });
  setReminderServiceForTesting(servizio);
});

afterEach(() => {
  setReminderServiceForTesting(null);
  vi.useRealTimers();
  delete process.env.FLAG_TARS_REMINDERS;
  delete process.env.FLAG_TARS_READ_TOOLS;
});

function copioneSequenza(...passi: RispostaProvider[]): PassoCopione {
  return (_richiesta, passo) => passi[Math.min(passo, passi.length - 1)];
}

async function runCome(
  copione: PassoCopione,
  opzioni: { userId?: number; sedeId?: number; conversazioneId?: number } = {}
) {
  const contesto = await costruisciContesto(
    contestoTrpc(opzioni.userId ?? UTENTE_ID, opzioni.sedeId ?? SEDE)
  );
  return eseguiRun({
    contesto,
    provider: creaProviderFinto(copione),
    messaggio: "Ricordami domani alle 9 di chiamare Mario",
    conversazioneId: opzioni.conversazioneId ?? null,
  });
}

function tuttiIPromemoria(sedeId = SEDE, userId = UTENTE_ID) {
  return repo.listPersonal({
    sedeId,
    recipientUserId: userId,
    stati: ["scheduled", "due", "completed", "cancelled"],
    ordina: "remindAt",
    limit: 100,
  });
}

describe("tars T2 — attrito zero sulle richieste esplicite", () => {
  it("«ricordami domani alle 9» crea SUBITO: un solo giro di strumenti, nessun turno di conferma, undo dichiarato", async () => {
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("crea_promemoria", {
          testo: "Chiamare Mario",
          quando: "domani alle 9",
        }),
        rispostaTesto("Fatto: promemoria per domani alle 9. Posso annullarlo quando vuoi.")
      )
    );

    expect(risposta.stato).toBe("ok");
    expect(risposta.strumentiUsati).toEqual(["crea_promemoria"]);
    expect(risposta.azioni).toHaveLength(1);
    expect(risposta.azioni[0]).toMatchObject({
      stato: "creato",
      undoDisponibile: true,
    });
    expect(risposta.azioni[0].undoVia).toMatchObject({
      procedura: "promemoria.cancel",
    });

    // 30/08/2026 09:00 Europe/Rome (CEST) = 07:00Z.
    const salvati = await tuttiIPromemoria();
    expect(salvati).toHaveLength(1);
    expect(salvati[0].remindAt.toISOString()).toBe("2026-08-30T07:00:00.000Z");
    expect(salvati[0].recipientUserId).toBe(UTENTE_ID);

    // ATTRITO = 0: solo domanda e risposta finale, nessun turno di conferma.
    const turni = await turniDiConversazione(risposta.conversazioneId, SEDE);
    expect(turni).toHaveLength(2);
    expect(turni.map(t => t.ruolo)).toEqual(["utente", "tars"]);
    expect(turni[1].contenuto.toLowerCase()).not.toContain("sei sicuro");
  });

  it("le assunzioni del server (fasce orarie) arrivano dichiarate nell'azione", async () => {
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("crea_promemoria", {
          testo: "Verificare la conferma d'ordine",
          quando: "venerdì",
        }),
        rispostaTesto("Fatto.")
      )
    );
    expect(risposta.azioni[0].assunzioni.join(" ")).toContain("09:00");
  });
});

describe("tars T2 — idempotenza e duplicati zero", () => {
  const creaDueVolte = () =>
    copioneSequenza(
      chiamataTool("crea_promemoria", {
        testo: "Chiamare Mario",
        quando: "domani alle 9",
      }),
      rispostaTesto("Fatto.")
    );

  it("il doppio invio dello stesso messaggio non crea duplicati (run separati)", async () => {
    const prima = await runCome(creaDueVolte());
    const seconda = await runCome(creaDueVolte());
    expect(prima.azioni[0].stato).toBe("creato");
    expect(seconda.cache.c0Hit).toBe(false); // i run con azioni non entrano in C0
    // Il retry settled restituisce lo stesso esito senza richiamare il tool.
    expect(seconda.azioni[0].stato).toBe("creato");
    expect(await tuttiIPromemoria()).toHaveLength(1);
  });

  it("la doppia tool call identica nello stesso run esegue una volta sola (C1)", async () => {
    const doppia: RispostaProvider = {
      tipo: "tool_call",
      chiamate: [
        {
          id: "c1",
          nome: "crea_promemoria",
          argomenti: JSON.stringify({
            testo: "Chiamare Mario",
            quando: "domani alle 9",
          }),
        },
        {
          id: "c2",
          nome: "crea_promemoria",
          argomenti: JSON.stringify({
            testo: "Chiamare Mario",
            quando: "domani alle 9",
          }),
        },
      ],
      uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
    };
    const risposta = await runCome(
      copioneSequenza(doppia, rispostaTesto("Fatto."))
    );
    expect(risposta.cache.c1Hit).toBe(1);
    expect(await tuttiIPromemoria()).toHaveLength(1);
  });

  it("dopo un annullo la stessa richiesta RICREA (catena deterministica)", async () => {
    await runCome(creaDueVolte());
    const [creato] = await tuttiIPromemoria();
    await servizio.cancel({
      sedeId: SEDE,
      recipientUserId: UTENTE_ID,
      id: creato.id,
    });

    const risposta = await runCome(creaDueVolte());
    expect(risposta.azioni[0].stato).toBe("creato");
    const dopo = await tuttiIPromemoria();
    expect(dopo.filter(r => r.status === "cancelled")).toHaveLength(1);
    expect(dopo.filter(r => r.status === "scheduled")).toHaveLength(1);
  });
});

describe("tars T2 — DST onesto (Europe/Rome)", () => {
  it("un orario che non esiste (notte dell'ora legale) viene rifiutato, non indovinato", async () => {
    vi.setSystemTime(new Date("2026-03-28T10:00:00.000Z")); // 28/03/2026
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("crea_promemoria", {
          testo: "Test DST",
          quando: "domani alle 2:30",
        }),
        rispostaTesto("Non si può: orario inesistente.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("non_eseguito");
    expect(risposta.azioni[0].motivo).toContain("ora legale");
    expect(await tuttiIPromemoria()).toHaveLength(0);
  });

  it("un orario ambiguo (ritorno all'ora solare) viene rifiutato con motivo chiaro", async () => {
    vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z")); // 24/10/2026
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("crea_promemoria", {
          testo: "Test DST",
          quando: "domani alle 2:30",
        }),
        rispostaTesto("Orario ambiguo.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("non_eseguito");
    expect(risposta.azioni[0].motivo).toContain("ora solare");
    expect(await tuttiIPromemoria()).toHaveLength(0);
  });

  it("«domani alle 9» a cavallo del cambio produce le 9 LOCALI del giorno dopo", async () => {
    vi.setSystemTime(new Date("2026-03-28T10:00:00.000Z"));
    await runCome(
      copioneSequenza(
        chiamataTool("crea_promemoria", {
          testo: "Posa",
          quando: "domani alle 9",
        }),
        rispostaTesto("Fatto.")
      )
    );
    const [record] = await tuttiIPromemoria();
    expect(record.remindAt.toISOString()).toBe("2026-03-29T07:00:00.000Z");
  });
});

describe("tars T2 — spostare, annullare, completare, leggere", () => {
  async function creaDiretto(testo = "Chiamare Mario") {
    const { record } = await servizio.createApproved({
      sedeId: SEDE,
      requestedByUserId: UTENTE_ID,
      sourceProposalId: null,
      actionKey: `test:${testo}`,
      text: testo,
      remindAtIso: "2026-08-30T07:00:00.000Z",
      clienteId: null,
      commessaId: null,
    });
    return record;
  }

  it("sposta_promemoria cambia l'orario, dichiara prima/dopo e come tornare indietro", async () => {
    const record = await creaDiretto();
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("sposta_promemoria", {
          promemoriaId: record.id,
          quando: "domani pomeriggio",
        }),
        rispostaTesto("Spostato.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("spostato");
    const aggiornato = await repo.findById(SEDE, UTENTE_ID, record.id);
    // 30/08/2026 15:00 CEST = 13:00Z.
    expect(aggiornato?.remindAt.toISOString()).toBe(
      "2026-08-30T13:00:00.000Z"
    );
    const eventi = await repo.listEvents(SEDE, record.id);
    expect(eventi.map(e => e.eventType)).toContain("snoozed");
  });

  it("annulla_promemoria annulla e resta idempotente al secondo colpo", async () => {
    const record = await creaDiretto();
    const copione = copioneSequenza(
      chiamataTool("annulla_promemoria", { promemoriaId: record.id }),
      rispostaTesto("Annullato.")
    );
    const prima = await runCome(copione);
    expect(prima.azioni[0].stato).toBe("annullato");
    const seconda = await runCome(copione);
    expect(seconda.azioni[0].stato).toBe("annullato");
    const salvato = await repo.findById(SEDE, UTENTE_ID, record.id);
    expect(salvato?.status).toBe("cancelled");
  });

  it("completa_promemoria segna fatto; leggi_promemoria elenca la settimana", async () => {
    const record = await creaDiretto("Verificare bolla");
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("completa_promemoria", { promemoriaId: record.id }),
        rispostaTesto("Fatto.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("completato");

    const contesto = await costruisciContesto(contestoTrpc(UTENTE_ID));
    const altro = await creaDiretto("Chiamare fornitore");
    const strumenti = strumentiPerContesto(contesto);
    const leggi = strumenti.find(s => s.nome === "leggi_promemoria");
    const esito: any = await leggi!.esegui(contesto, {
      periodo: "settimana",
      includiConclusi: false,
      limite: 20,
    });
    expect(esito.dati.promemoria.map((r: any) => r.id)).toContain(altro.id);
    expect(esito.dati.promemoria.map((r: any) => r.id)).not.toContain(
      record.id
    );
  });
});

describe("tars T2 — confini: ownership, sede, schema, kill switch", () => {
  it("il promemoria di un collega non si annulla: non trovato, nessun effetto", async () => {
    const { record } = await servizio.createApproved({
      sedeId: SEDE,
      requestedByUserId: COLLEGA_ID,
      sourceProposalId: null,
      actionKey: "test:collega",
      text: "Del collega",
      remindAtIso: "2026-08-30T07:00:00.000Z",
      clienteId: null,
      commessaId: null,
    });
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("annulla_promemoria", { promemoriaId: record.id }),
        rispostaTesto("Non trovato.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("non_eseguito");
    expect(risposta.azioni[0].motivo).toContain("non trovato");
    const intatto = await repo.findById(SEDE, COLLEGA_ID, record.id);
    expect(intatto?.status).toBe("scheduled");
  });

  it("una commessa di un'altra sede non si collega: non trovata, nessun promemoria", async () => {
    const commesse = getCommesseStore() as any[];
    if (!commesse.some(c => c.id === 97001)) {
      commesse.push({
        id: 97001,
        sedeId: ALTRA_SEDE,
        codice: "ALT-97001",
        cliente: "Altra Sede Srl",
        stato: "preventivo",
        pagamenti: [],
      });
    }
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("crea_promemoria", {
          testo: "Sulla commessa altrui",
          quando: "domani alle 9",
          commessaId: 97001,
        }),
        rispostaTesto("Non trovata.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("non_eseguito");
    expect(risposta.azioni[0].motivo).toContain("Commessa non trovata");
    expect(await tuttiIPromemoria()).toHaveLength(0);
  });

  it("lo schema strict rifiuta un destinatario esplicito: L1 è personale per costruzione", async () => {
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("crea_promemoria", {
          testo: "Per un altro",
          quando: "domani alle 9",
          recipientUserId: COLLEGA_ID,
        }),
        rispostaTesto("Non posso creare promemoria per altri.")
      )
    );
    expect(risposta.azioni).toHaveLength(0);
    expect(await tuttiIPromemoria()).toHaveLength(0);
    expect(await tuttiIPromemoria(SEDE, COLLEGA_ID)).toHaveLength(0);
  });

  it("con FLAG_TARS_REMINDERS spento lo strumento non esiste nel profilo e la chiamata forzata non crea nulla", async () => {
    process.env.FLAG_TARS_REMINDERS = "off";
    const contesto = await costruisciContesto(contestoTrpc(UTENTE_ID));
    expect(
      strumentiPerContesto(contesto).some(s => s.categoria === "promemoria" && s.livello === "L1")
    ).toBe(false);

    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("crea_promemoria", {
          testo: "Aggiro il flag",
          quando: "domani alle 9",
        }),
        rispostaTesto("Strumento non disponibile.")
      )
    );
    expect(risposta.azioni).toHaveLength(0);
    expect(await tuttiIPromemoria()).toHaveLength(0);
  });

  it("difesa in profondità: anche l'esecuzione DIRETTA dello strumento rifiuta col flag spento", async () => {
    process.env.FLAG_TARS_REMINDERS = "off";
    const contesto = await costruisciContesto(contestoTrpc(UTENTE_ID));
    const crea = STRUMENTI_PROMEMORIA.find(s => s.nome === "crea_promemoria");
    await expect(
      crea!.esegui(contesto, { testo: "x", quando: "domani alle 9" })
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("i promemoria non attraversano le sedi nemmeno in lettura", async () => {
    await creaDirettamente();
    const contestoAltraSede = await costruisciContesto(
      contestoTrpc(UTENTE_ID, ALTRA_SEDE)
    );
    const leggi = strumentiPerContesto(contestoAltraSede).find(
      s => s.nome === "leggi_promemoria"
    );
    const esito: any = await leggi!.esegui(contestoAltraSede, {
      periodo: "futuri",
      includiConclusi: true,
      limite: 50,
    });
    expect(esito.dati.promemoria).toHaveLength(0);
  });

  async function creaDirettamente() {
    await servizio.createApproved({
      sedeId: SEDE,
      requestedByUserId: UTENTE_ID,
      sourceProposalId: null,
      actionKey: "test:sede",
      text: "Nella mia sede",
      remindAtIso: "2026-08-30T07:00:00.000Z",
      clienteId: null,
      commessaId: null,
    });
  }
});
