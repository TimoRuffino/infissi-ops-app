import { describe, expect, it } from "vitest";
import {
  contaPresidi,
  motivoRifiutoPresidio,
  portaChiusaPerTenant,
  presidioDi,
  proprietarioAggiunto,
  proprietarioTolto,
  ruoliDi,
  slugValido,
  tenantDelContesto,
  type UtentePresidio,
} from "./regole";

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

describe("portaChiusaPerTenant (WS1)", () => {
  it("apre solo il tenant 1", () => {
    expect(portaChiusaPerTenant(1)).toBe(false);
    expect(portaChiusaPerTenant(2)).toBe(true);
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
});
