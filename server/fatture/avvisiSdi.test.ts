// L'allarme che insegue: le fatture ferme su Fatture in Cloud che stanno
// per scadere si fanno vedere anche fuori dalla tab della commessa.
// Repository di fatture e di notifiche in memoria, nessuna rete.
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryNotificationRepository } from "../notifications/repository";
import type { NotificationRepository } from "../notifications/repository";
import {
  avvisaScadenzeSdi,
  avvisoSdiDovuto,
  bozzaAvvisoSdi,
} from "./avvisiSdi";
import {
  createMemoryFattureRepository,
  type FattureRepository,
} from "./repository";

const SEDE = 1;
const EMITTENTE = 4242;
const ora = new Date("2026-09-15T09:00:00Z");

let repository: FattureRepository;
let notifiche: NotificationRepository;

const base = (over: Record<string, unknown> = {}) =>
  ({
    sedeId: SEDE,
    commessaId: 10,
    computoId: null,
    hashRighe: null,
    tipo: "fattura" as const,
    notaCreditoDi: null,
    stato: "emessa" as const,
    ficDocumentId: 900,
    numero: "127/2026",
    data: "2026-09-04",
    clienteSnapshot: null,
    pattuitoTipo: "lordo" as const,
    pattuitoCent: 100000,
    imponibileCent: 0,
    ivaCent: 0,
    totaleCent: 100000,
    deltaPattuitoCent: 0,
    markupCent: 0,
    markupForzatoCent: null,
    stornoCent: 0,
    diciture: [] as string[],
    note: null,
    intestazioneCantiere: null,
    detrazioneTipo: "nessuna" as const,
    pdfStorageKey: null,
    xmlStorageKey: null,
    xmlSha256: null,
    documentoId: null,
    eiStatusFic: "not_sent",
    ficUpdatedAt: null,
    eiErrore: null,
    inviataDryRun: false,
    scavalcoLimiti: false,
    scavalcoMotivo: null,
    createdBy: EMITTENTE,
    emessaDa: EMITTENTE,
    emessaAt: ora,
    ...over,
  }) as any;

beforeEach(() => {
  repository = createMemoryFattureRepository();
  notifiche = createMemoryNotificationRepository();
});

describe("avvisoSdiDovuto", () => {
  it("avvisa a 7, 3 e 1 giorno, e poi ogni giorno da 0 in giù", () => {
    expect([12, 11, 8, 6, 4, 2].map(avvisoSdiDovuto)).toEqual([
      false, false, false, false, false, false,
    ]);
    expect([7, 3, 1, 0, -1, -5].map(avvisoSdiDovuto)).toEqual([
      true, true, true, true, true, true,
    ]);
  });
});

describe("bozzaAvvisoSdi", () => {
  it("una notifica al giorno per fattura: la chiave canonica porta la data", () => {
    const a = bozzaAvvisoSdi({ fattura: base({ id: 5 }), giorni: 3, oggi: ora })!;
    const b = bozzaAvvisoSdi({
      fattura: base({ id: 5 }),
      giorni: 3,
      oggi: new Date("2026-09-15T21:00:00Z"),
    })!;
    expect(a.canonicalKey).toBe(b.canonicalKey);
    expect(a.canonicalKey).toContain("fattura-sdi:5:");
  });

  it("l'avviso va a chi l'ha mandata su Fatture in Cloud, e porta il numero", () => {
    const d = bozzaAvvisoSdi({ fattura: base({ id: 5 }), giorni: 3, oggi: ora })!;
    expect(d.recipientUserId).toBe(EMITTENTE);
    expect(d.title).toContain("127/2026");
    expect(d.body).toContain("3 giorni");
    expect(d.priority).toBe("high");
    expect(d.link).toBe("/fatturazione/10?passo=fattura");
  });

  it("da zero in giù è critica e lo dice", () => {
    const d = bozzaAvvisoSdi({ fattura: base({ id: 5 }), giorni: -2, oggi: ora })!;
    expect(d.priority).toBe("critical");
    expect(d.body).toContain("Scaduta da 2 giorni");
  });

  it("senza qualcuno da avvisare non si inventa un destinatario", () => {
    expect(
      bozzaAvvisoSdi({ fattura: base({ id: 5, emessaDa: null }), giorni: 3, oggi: ora })
    ).toBeNull();
  });
});

describe("avvisaScadenzeSdi", () => {
  it("avvisa solo le fatture ferme su FiC che sono in scadenza", async () => {
    // Scade fra 3 giorni (data 2026-09-04 + 12 = 2026-09-16, oggi il 15).
    const inScadenza = await repository.crea({
      fattura: base(), righe: [], riepilogo: [], scadenze: [], now: ora,
    });
    // Emessa oggi: ha tutto il tempo.
    await repository.crea({
      fattura: base({ data: "2026-09-15" }), righe: [], riepilogo: [], scadenze: [], now: ora,
    });
    // Già partita: non riguarda più nessuno.
    await repository.crea({
      fattura: base({ stato: "inviata", eiStatusFic: "sent" }),
      righe: [], riepilogo: [], scadenze: [], now: ora,
    });

    const esito = await avvisaScadenzeSdi({
      repository,
      notifiche,
      now: () => ora,
      utenti: () => [{ id: EMITTENTE, attivo: true, sediIds: [SEDE] }],
      conTenant: (_sedeId, azione) => azione(),
    });

    expect(esito.avvisate).toEqual([inScadenza.id]);
    const lista = await notifiche.list({
      sedeId: SEDE, recipientUserId: EMITTENTE, limit: 10, now: ora,
    });
    expect(lista.items).toHaveLength(1);
    expect(lista.items[0].body).toContain("1 giorno");
  });

  it("due giri nello stesso giorno non fanno due notifiche", async () => {
    await repository.crea({
      fattura: base(), righe: [], riepilogo: [], scadenze: [], now: ora,
    });
    const dip = {
      repository,
      notifiche,
      now: () => ora,
      utenti: () => [{ id: EMITTENTE, attivo: true, sediIds: [SEDE] }],
      conTenant: <T,>(_sedeId: number, azione: () => Promise<T>) => azione(),
    };
    await avvisaScadenzeSdi(dip);
    await avvisaScadenzeSdi(dip);

    const lista = await notifiche.list({
      sedeId: SEDE, recipientUserId: EMITTENTE, limit: 10, now: ora,
    });
    expect(lista.items).toHaveLength(1);
  });

  it("un destinatario che non è più di quella sede non riceve niente", async () => {
    await repository.crea({
      fattura: base(), righe: [], riepilogo: [], scadenze: [], now: ora,
    });
    const esito = await avvisaScadenzeSdi({
      repository,
      notifiche,
      now: () => ora,
      utenti: () => [{ id: EMITTENTE, attivo: true, sediIds: [99] }],
      conTenant: (_sedeId, azione) => azione(),
    });
    expect(esito.avvisate).toEqual([]);
  });
});
