// T5: sollecito a 7 giorni (promemoria all'assegnatario, dedupe per
// canonicalKey), «perso?» a 30 (segnale del Centro Azioni), dormienti e
// altre sedi fuori. Date RELATIVE all'orologio vero: il service dei
// promemoria rifiuta un remindAt nel passato.

import { describe, expect, it } from "vitest";
import { getReminderService } from "../../reminders/service";
import {
  bozzaSollecito,
  giroSollecitiPreventivi,
  preventiviFermiDiSede,
  segnaliFollowupPreventivi,
  type DipendenzeFollowup,
} from "./preventivi";

const SEDE = 96_861;
const ALTRA_SEDE = 96_862;
const COMMERCIALE = 96_871;

const ADESSO = new Date();
const giorniFa = (n: number) => new Date(ADESSO.getTime() - n * 86_400_000);

function deps(parziale: Partial<DipendenzeFollowup> = {}): DipendenzeFollowup {
  return {
    commesse: () => [
      { id: 61, sedeId: SEDE, codice: "COM-2026-061", cliente: "Soare Maria", clienteId: 9, stato: "preventivo", assegnatoA: COMMERCIALE, createdAt: giorniFa(10) },
      { id: 62, sedeId: SEDE, codice: "COM-2026-062", cliente: "Butticè Sara", clienteId: 10, stato: "preventivo", assegnatoA: null, createdAt: giorniFa(35) },
      { id: 63, sedeId: SEDE, codice: "COM-2026-063", cliente: "Fresco Anna", clienteId: 11, stato: "preventivo", assegnatoA: COMMERCIALE, createdAt: giorniFa(2) },
      { id: 64, sedeId: SEDE, codice: "COM-2026-064", cliente: "Dormiente", clienteId: 12, stato: "preventivo", assegnatoA: COMMERCIALE, createdAt: giorniFa(200) },
      { id: 65, sedeId: SEDE, codice: "COM-2026-065", cliente: "In produzione", clienteId: 13, stato: "produzione", assegnatoA: COMMERCIALE, createdAt: giorniFa(40) },
      { id: 66, sedeId: ALTRA_SEDE, codice: "COM-2026-066", cliente: "Altrove", clienteId: 14, stato: "preventivo", assegnatoA: COMMERCIALE, createdAt: giorniFa(40) },
    ],
    ultimeComunicazioni: async () => new Map(),
    // L'attività reale coincide con la creazione nelle fixture.
    attivita: (commessa: any, _u, adesso) => {
      const creata = new Date(commessa.createdAt);
      return {
        giorni: Math.floor((adesso.getTime() - creata.getTime()) / 86_400_000),
        ultimaAttivita: creata,
      };
    },
    promemoria: getReminderService(),
    ...parziale,
  };
}

describe("preventiviFermiDiSede", () => {
  it("solo la sede, solo preventivi, dormienti esclusi, ordinati per fermo", async () => {
    const fermi = await preventiviFermiDiSede(SEDE, ADESSO, deps());
    expect(fermi.map(x => x.commessa.id)).toEqual([62, 61]);
    expect(fermi[0].giorni).toBeGreaterThanOrEqual(35);
  });
});

describe("giroSollecitiPreventivi", () => {
  it("crea il promemoria all'assegnatario con la bozza; il secondo giro non duplica; 30+ e senza assegnatario saltati", async () => {
    const d = deps();
    const primo = await giroSollecitiPreventivi({ sedeId: SEDE, adesso: ADESSO, deps: d });
    // 61 (10 gg, assegnata) → promemoria; 62 (35 gg) → è territorio del
    // caso «perso», niente promemoria.
    expect(primo).toEqual({ creati: 1, saltati: 0 });
    const promemoria = await getReminderService().listPersonal({
      sedeId: SEDE,
      recipientUserId: COMMERCIALE,
    });
    const sollecito = promemoria.find(p => p.commessaId === 61);
    expect(sollecito).toBeDefined();
    expect(sollecito!.text).toContain("COM-2026-061");
    expect(sollecito!.text).toContain("Bozza:");
    expect(sollecito!.text).toContain("Soare Maria");

    const secondo = await giroSollecitiPreventivi({ sedeId: SEDE, adesso: ADESSO, deps: d });
    expect(secondo).toEqual({ creati: 0, saltati: 1 });
  });

  it("la bozza è educata, nomina il cliente e non contiene importi", () => {
    const bozza = bozzaSollecito({ codice: "COM-2026-061", cliente: "Soare Maria" });
    expect(bozza).toContain("Soare Maria");
    expect(bozza).toContain("COM-2026-061");
    expect(bozza).not.toMatch(/€|\d+[.,]\d{2}/);
  });
});

describe("segnaliFollowupPreventivi", () => {
  it("dal trentesimo giorno il caso «perso?» con assegnatario o direzione; fingerprint a scaglioni", async () => {
    const segnali = await segnaliFollowupPreventivi(SEDE, ADESSO, deps());
    expect(segnali).toHaveLength(1);
    expect(segnali[0]).toMatchObject({
      kind: "preventivo_followup",
      commessaId: 62,
      targetRole: "direzione",
      assigneeUserId: null,
      link: "/commesse/62",
      fingerprint: "perso:30",
    });
    expect(segnali[0].title).toContain("perso");
    expect(segnali[0].title).toContain("COM-2026-062");
  });
});
