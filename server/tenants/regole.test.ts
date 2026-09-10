import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MESSAGGI } from "./costanti";
import {
  contaPresidi,
  motivoRifiutoPresidio,
  motivoRifiutoTenant,
  motivoRifiutoTransizione,
  presidioDi,
  proprietarioAggiunto,
  proprietarioTolto,
  righeTenantSedi,
  ruoliDi,
  slugValido,
  tenantDelContesto,
  type UtentePresidio,
} from "./regole";
import type { TenantRecord } from "./tipi";

const u = (
  id: number,
  ruoli: string[],
  tenantId = 1,
  attivo = true
): UtentePresidio => ({ id, ruoli, tenantId, attivo });

describe("slugValido", () => {
  it("accetta minuscole, cifre e trattini interni", () => {
    expect(slugValido("ruffino-group")).toBe(true);
    expect(slugValido("acme2")).toBe(true);
  });
  it("rifiuta maiuscole, trattini agli estremi, spazi e slug troppo lunghi", () => {
    expect(slugValido("Acme")).toBe(false);
    expect(slugValido("-acme")).toBe(false);
    expect(slugValido("acme-")).toBe(false);
    expect(slugValido("ac me")).toBe(false);
    expect(slugValido("a".repeat(41))).toBe(false);
  });
});

describe("motivoRifiutoTenant", () => {
  const attivo = { id: 2, slug: "acme", nome: "Acme", stato: "attivo", motivoStato: null, createdAt: new Date(), updatedAt: new Date() } as TenantRecord;
  const sospeso = { ...attivo, stato: "sospeso" } as TenantRecord;
  beforeEach(() => { delete process.env.FLAG_MULTI_AZIENDA; });
  afterEach(() => { delete process.env.FLAG_MULTI_AZIENDA; });
  it("interruttore spento: mai un rifiuto", () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: sospeso, sedeId: null }, { scrittura: true })).toBeNull();
  });
  it("tenant 2 attivo con sede: passa in lettura e scrittura (la porta chiusa non esiste più)", () => {
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: attivo, sedeId: 5 }, { scrittura: true })).toBeNull();
  });
  it("sospeso: scrittura rifiutata, lettura e sedi.switch (esente) ammesse", () => {
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: sospeso, sedeId: 5 }, { scrittura: true })?.messaggio).toBe(MESSAGGI.solaLettura);
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: sospeso, sedeId: 5 }, { scrittura: false })).toBeNull();
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: sospeso, sedeId: 5 }, { scrittura: true, esente: true })).toBeNull();
  });
  it("senza sede attiva: rifiuto, anche in lettura", () => {
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: attivo, sedeId: null }, { scrittura: false })?.messaggio).toBe(MESSAGGI.senzaSede);
  });
  it("tenant nullo nel contesto (test a mano) senza record: nessun rifiuto, come nel WS1", () => {
    expect(motivoRifiutoTenant({ tenantId: 1, tenant: null, sedeId: 1 }, { scrittura: true })).toBeNull();
  });
  it("in_attesa/archiviato/cancellato: porta chiusa anche in lettura, nessuna esenzione", () => {
    for (const stato of ["in_attesa", "archiviato", "cancellato"] as const) {
      const chiuso = { ...attivo, stato } as TenantRecord;
      expect(motivoRifiutoTenant({ tenantId: 2, tenant: chiuso, sedeId: 5 }, { scrittura: false })?.messaggio).toBe(
        MESSAGGI.aziendaNonAccessibile
      );
      expect(
        motivoRifiutoTenant({ tenantId: 2, tenant: chiuso, sedeId: 5 }, { scrittura: true, esente: true })?.messaggio
      ).toBe(MESSAGGI.aziendaNonAccessibile);
    }
  });
});

describe("motivoRifiutoTransizione (ciclo di vita, 10/09/2026)", () => {
  const con = (stato: TenantRecord["stato"], svuotatoIl: Date | null = null) => ({ stato, svuotatoIl });
  it("archivia parte solo da attivo o sospeso; cancella da tutto tranne cancellato", () => {
    expect(motivoRifiutoTransizione("archivia", con("attivo"))).toBeNull();
    expect(motivoRifiutoTransizione("archivia", con("sospeso"))).toBeNull();
    expect(motivoRifiutoTransizione("archivia", con("in_attesa"))).toMatch(/Transizione non ammessa/);
    expect(motivoRifiutoTransizione("archivia", con("cancellato"))).toMatch(/Transizione non ammessa/);
    expect(motivoRifiutoTransizione("cancella", con("in_attesa"))).toBeNull();
    expect(motivoRifiutoTransizione("cancella", con("archiviato"))).toBeNull();
    expect(motivoRifiutoTransizione("cancella", con("cancellato"))).toMatch(/Transizione non ammessa/);
  });
  it("riattiva copre sospeso, archiviato e cancellato — ma mai una lapide svuotata, mai in_attesa", () => {
    expect(motivoRifiutoTransizione("riattiva", con("sospeso"))).toBeNull();
    expect(motivoRifiutoTransizione("riattiva", con("archiviato"))).toBeNull();
    expect(motivoRifiutoTransizione("riattiva", con("cancellato"))).toBeNull();
    expect(motivoRifiutoTransizione("riattiva", con("cancellato", new Date()))).toBe(MESSAGGI.aziendaSvuotata);
    expect(motivoRifiutoTransizione("riattiva", con("in_attesa"))).toMatch(/Transizione non ammessa/);
  });
});

describe("ruoliDi", () => {
  it("preferisce ruoli[] e ricade su ruolo", () => {
    expect(ruoliDi({ ruoli: ["ordini", "commerciale"] })).toEqual(["ordini", "commerciale"]);
    expect(ruoliDi({ ruoli: [], ruolo: "direzione" })).toEqual(["direzione"]);
    expect(ruoliDi(null)).toEqual([]);
  });
});

describe("presìdi per tenant", () => {
  const utenti = [
    u(1, ["direzione", "proprietario"], 1),
    u(2, ["commerciale"], 1),
    u(3, ["direzione"], 2),
    u(4, ["proprietario"], 2, false),
  ];

  it("conta solo attivi del tenant", () => {
    expect(contaPresidi(utenti, 1)).toEqual({ direzione: 1, proprietari: 1 });
    expect(contaPresidi(utenti, 2)).toEqual({ direzione: 1, proprietari: 0 });
  });

  it("rifiuta di togliere l'ultima direzione o l'ultimo proprietario del tenant", () => {
    expect(
      motivoRifiutoPresidio(utenti[0], { ...utenti[0], ruoli: ["proprietario"] }, utenti)
    ).toMatch(/ultimo utente direzione/);
    expect(
      motivoRifiutoPresidio(utenti[0], { ...utenti[0], ruoli: ["direzione"] }, utenti)
    ).toMatch(/ultimo proprietario/);
    expect(motivoRifiutoPresidio(utenti[0], null, utenti)).toMatch(/ultimo utente direzione/);
    expect(motivoRifiutoPresidio(utenti[0], { ...utenti[0], attivo: false }, utenti)).not.toBeNull();
  });

  it("con opzioni.proprietari = false non blocca la perdita dell'ultimo proprietario (Minor 2, interruttore spento)", () => {
    // Stesso caso di sopra (utenti[0] è l'unico proprietario del tenant 1),
    // ma con la guardia dei proprietari disattivata: nessun blocco.
    expect(
      motivoRifiutoPresidio(utenti[0], { ...utenti[0], ruoli: ["direzione"] }, utenti, { proprietari: false })
    ).toBeNull();
    // La guardia dell'ultima direzione resta attiva a prescindere dall'opzione.
    expect(
      motivoRifiutoPresidio(utenti[0], { ...utenti[0], ruoli: ["proprietario"] }, utenti, { proprietari: false })
    ).toMatch(/ultimo utente direzione/);
  });

  it("non guarda oltre il tenant e lascia passare le modifiche innocue", () => {
    expect(motivoRifiutoPresidio(utenti[2], null, utenti)).toMatch(/ultimo utente direzione/);
    expect(motivoRifiutoPresidio(utenti[1], null, utenti)).toBeNull();
    const conDue = [...utenti, u(5, ["direzione", "proprietario"], 1)];
    expect(motivoRifiutoPresidio(conDue[0], null, conDue)).toBeNull();
  });

  it("riconosce quando il ruolo proprietario entra o esce", () => {
    expect(proprietarioAggiunto(["direzione"], ["direzione", "proprietario"])).toBe(true);
    expect(proprietarioAggiunto(["proprietario"], ["proprietario"])).toBe(false);
    expect(proprietarioTolto(["proprietario"], ["direzione"])).toBe(true);
    expect(proprietarioTolto(["direzione"], ["direzione"])).toBe(false);
  });

  it("presidioDi legge un record utente qualunque, con tenant 1 di ripiego", () => {
    expect(presidioDi({ id: 7, attivo: 1, ruoli: ["ordini"] })).toEqual({ id: 7, attivo: true, ruoli: ["ordini"], tenantId: 1 });
    expect(presidioDi({ id: 8, attivo: true, ruolo: "direzione", tenantId: 3 })).toEqual({ id: 8, attivo: true, ruoli: ["direzione"], tenantId: 3 });
  });

  it("tenantDelContesto ricade su 1", () => {
    expect(tenantDelContesto({ tenantId: null })).toBe(1);
    expect(tenantDelContesto({ tenantId: 5 })).toBe(5);
  });

  it("righeTenantSedi mette il tenant 1 dove il campo manca", () => {
    expect(
      righeTenantSedi([{ id: 1 }, { id: 2, tenantId: null }, { id: 3, tenantId: 7 }])
    ).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 2, tenantId: 1 },
      { sedeId: 3, tenantId: 7 },
    ]);
    expect(righeTenantSedi([])).toEqual([]);
  });
});
