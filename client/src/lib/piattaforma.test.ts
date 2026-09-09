import { describe, expect, it } from "vitest";

import { piattaformaGateLabel, slugSuggerito, TENANT_PIATTAFORMA_ID } from "./piattaforma";

describe("piattaformaGateLabel", () => {
  it("aspetta finché l'identità è in volo", () => {
    expect(piattaformaGateLabel({ mio: undefined, loading: true })).toBe(
      "loading"
    );
    // Anche con un payload già arrivato: se una delle due query sta ancora
    // girando la guardia non deve lampeggiare «rifiutato».
    expect(
      piattaformaGateLabel({ mio: { piattaforma: true }, loading: true })
    ).toBe("loading");
  });

  it("apre solo con il segnale del server", () => {
    expect(
      piattaformaGateLabel({ mio: { piattaforma: true }, loading: false })
    ).toBe("allowed");
  });

  it("rifiuta senza il segnale, e senza inventarne uno", () => {
    expect(piattaformaGateLabel({ mio: { piattaforma: false } })).toBe(
      "blocked"
    );
    // `tenants.mio` non risponde (errore, sessione scaduta): fail-closed.
    expect(piattaformaGateLabel({ mio: undefined })).toBe("blocked");
    expect(piattaformaGateLabel({ mio: null, loading: false })).toBe("blocked");
    // Un campo assente non è un sì.
    expect(piattaformaGateLabel({ mio: {} })).toBe("blocked");
  });
});

describe("slugSuggerito", () => {
  it("scrive un nome commerciale come lo vuole SLUG_RE", () => {
    expect(slugSuggerito("Ruffino Group")).toBe("ruffino-group");
    expect(slugSuggerito("Serramenti Dell'Orto S.R.L.")).toBe(
      "serramenti-dell-orto-s-r-l"
    );
  });

  it("toglie gli accenti invece di buttarli via", () => {
    expect(slugSuggerito("Città di Càstello")).toBe("citta-di-castello");
  });

  it("non lascia mai un trattino ai bordi, nemmeno dopo il taglio a 40", () => {
    expect(slugSuggerito("  —Infissi—  ")).toBe("infissi");
    const lungo = slugSuggerito(`${"a".repeat(40)} b`);
    expect(lungo).toBe("a".repeat(40));
    // 40 caratteri esatti + parola successiva: il taglio cadrebbe sul
    // trattino, e uno slug con il trattino in coda non passa SLUG_RE.
    const alBordo = slugSuggerito(`${"a".repeat(39)} bc`);
    expect(alBordo).toBe("a".repeat(39));
    expect(alBordo.endsWith("-")).toBe(false);
  });

  it("resta vuoto se non c'è niente da cui ricavarlo", () => {
    expect(slugSuggerito("")).toBe("");
    expect(slugSuggerito("!!!")).toBe("");
  });
});

describe("TENANT_PIATTAFORMA_ID", () => {
  it("è 1, come TENANT_PREDEFINITO_ID del server, e vive in un posto solo", () => {
    // Il client non può importare server/tenants/costanti.ts: la costante è
    // ricopiata, ma UNA volta — prima stava in due pagine (fix wave finale).
    expect(TENANT_PIATTAFORMA_ID).toBe(1);
  });
});
