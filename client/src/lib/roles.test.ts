import { describe, expect, it } from "vitest";

import { direzioneGateLabel, getRuoli, isDirezione } from "./roles";

describe("direzioneGateLabel", () => {
  it("apre alla direzione e chiude agli altri ruoli", () => {
    expect(
      direzioneGateLabel({ user: { ruoli: ["direzione"] }, loading: false })
    ).toBe("allowed");
    expect(
      direzioneGateLabel({ user: { ruoli: ["commerciale"] }, loading: false })
    ).toBe("blocked");
  });

  it("resta in attesa finché l'identità non è nota", () => {
    expect(direzioneGateLabel({ user: null, loading: true })).toBe("loading");
  });

  // Una sessione ancora in volo non deve mostrare per un istante la schermata
  // di rifiuto a chi la direzione ce l'ha davvero.
  it("non chiude prima di sapere chi è l'utente", () => {
    expect(
      direzioneGateLabel({ user: { ruoli: ["direzione"] }, loading: true })
    ).toBe("loading");
  });

  it("chiude quando la sessione è risolta e non c'è nessun utente", () => {
    expect(direzioneGateLabel({ user: null, loading: false })).toBe("blocked");
    expect(direzioneGateLabel({ user: undefined, loading: false })).toBe(
      "blocked"
    );
  });

  // L'helper è un adapter di `isDirezione`, non una seconda regola di ruolo.
  it("segue `isDirezione`, incluso il ruolo singolo legacy", () => {
    const legacy = { ruolo: "direzione" };
    expect(getRuoli(legacy)).toEqual(["direzione"]);
    expect(isDirezione(legacy)).toBe(true);
    expect(direzioneGateLabel({ user: legacy, loading: false })).toBe(
      "allowed"
    );
  });

  // Nessuna scorciatoia lato client: la guardia è UX, il confine resta il
  // server. Un payload arbitrario non apre nulla.
  it("non si lascia aprire da forme di utente inattese", () => {
    expect(direzioneGateLabel({ user: "direzione", loading: false })).toBe(
      "blocked"
    );
    expect(
      direzioneGateLabel({ user: { isAdmin: true }, loading: false })
    ).toBe("blocked");
  });
});
