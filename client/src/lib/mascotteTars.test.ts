import { describe, expect, it } from "vitest";

import {
  MAZZO_NUOVO,
  POSE_OCCASIONALI,
  POSE_TUTTE,
  eSiparietto,
  etichettaMascotte,
  pescaSiparietto,
  posaARiposo,
  posterDi,
  puoPartireSiparietto,
  vaInLoop,
  vaPrecaricata,
  vaSpecchiata,
  type MazzoSiparietti,
  type PosaOccasionale,
} from "./mascotteTars";

/** Sorteggio finto: consuma i valori dati, poi torna a 0. */
const sorteggioFinto = (valori: readonly number[]) => {
  let i = 0;
  return () => valori[i++] ?? 0;
};

/** Le prime `quante` estrazioni, nell'ordine in cui uscirebbero. */
function estrai(
  quante: number,
  sorteggio: () => number,
  mazzo: MazzoSiparietti = MAZZO_NUOVO,
): PosaOccasionale[] {
  const usciti: PosaOccasionale[] = [];
  let corrente = mazzo;
  for (let i = 0; i < quante; i++) {
    const e = pescaSiparietto(corrente, sorteggio);
    usciti.push(e.posa);
    corrente = e.mazzo;
  }
  return usciti;
}

describe("mascotte Tars — posa a riposo", () => {
  it("sta in piedi col pannello chiuso", () => {
    expect(posaARiposo(false)).toBe("idle");
  });

  it("indica il pannello quando è aperto", () => {
    expect(posaARiposo(true)).toBe("indica");
  });
});

describe("mascotte Tars — mazzo dei siparietti", () => {
  it("un giro li mostra tutti, una volta ciascuno", () => {
    const giro = estrai(POSE_OCCASIONALI.length, Math.random);
    expect(new Set(giro)).toEqual(new Set(POSE_OCCASIONALI));
    expect(giro).toHaveLength(POSE_OCCASIONALI.length);
  });

  it("ogni giro successivo li rimescola tutti, senza saltarne", () => {
    const lungo = estrai(POSE_OCCASIONALI.length * 4, Math.random);
    for (let i = 0; i < lungo.length; i += POSE_OCCASIONALI.length) {
      const giro = lungo.slice(i, i + POSE_OCCASIONALI.length);
      expect(new Set(giro)).toEqual(new Set(POSE_OCCASIONALI));
    }
  });

  it("mai due volte di fila la stessa clip, nemmeno cambiando giro", () => {
    // Il punto dove un doppione ravvicinato può ancora nascere è la
    // cucitura: ultimo di un giro e primo del successivo.
    const usciti = estrai(POSE_OCCASIONALI.length * 6, Math.random);
    for (let i = 1; i < usciti.length; i++) {
      expect(usciti[i]).not.toBe(usciti[i - 1]);
    }
  });

  it("il giro nuovo non ricomincia da chi ha chiuso il precedente", () => {
    // Sorteggio deterministico: con `() => 0` il mescolamento dà sempre lo
    // stesso ordine, e il primo della fila è noto. Se il giro prima si è
    // chiuso proprio su quello, deve uscire il secondo.
    const primo = estrai(1, () => 0)[0];
    const dopoQuelPrimo = pescaSiparietto(
      { daGiocare: [], ultimo: primo },
      () => 0,
    );
    expect(dopoQuelPrimo.posa).not.toBe(primo);
    expect(POSE_OCCASIONALI).toContain(dopoQuelPrimo.posa);
    // Lo scambio sposta, non elimina: il giro resta completo.
    expect(
      new Set([dopoQuelPrimo.posa, ...dopoQuelPrimo.mazzo.daGiocare]),
    ).toEqual(new Set(POSE_OCCASIONALI));
  });

  it("il mazzo si esaurisce una carta alla volta", () => {
    let mazzo = MAZZO_NUOVO;
    for (let i = POSE_OCCASIONALI.length - 1; i >= 0; i--) {
      mazzo = pescaSiparietto(mazzo, Math.random).mazzo;
      expect(mazzo.daGiocare).toHaveLength(i);
    }
    // Vuoto: la prossima pescata rimescola invece di dare undefined.
    expect(POSE_OCCASIONALI).toContain(pescaSiparietto(mazzo, Math.random).posa);
  });

  it("regge un sorteggio agli estremi senza uscire dall'elenco", () => {
    // Math.random non arriva a 1, ma un valore di confine non deve dare
    // undefined: il componente lo passerebbe come src del video.
    for (const s of [() => 0, () => 1, sorteggioFinto([1, 0, 1, 0])]) {
      for (const posa of estrai(POSE_OCCASIONALI.length * 2, s)) {
        expect(POSE_OCCASIONALI).toContain(posa);
      }
    }
  });

  it("distingue i siparietti dalle pose a riposo", () => {
    expect(eSiparietto("idle")).toBe(false);
    expect(eSiparietto("indica")).toBe(false);
    for (const p of POSE_OCCASIONALI) expect(eSiparietto(p)).toBe(true);
  });
});

describe("mascotte Tars — quando parte un siparietto", () => {
  it("parte dalla posa neutra", () => {
    expect(puoPartireSiparietto("idle", false, false)).toBe(true);
  });

  it("non parte mentre un altro siparietto è in corso", () => {
    expect(puoPartireSiparietto("evento", false, false)).toBe(false);
    expect(puoPartireSiparietto("cartello", false, false)).toBe(false);
  });

  it("non parte a pannello aperto: lì deve restare ferma a indicarlo", () => {
    expect(puoPartireSiparietto("idle", true, false)).toBe(false);
    expect(puoPartireSiparietto("indica", true, false)).toBe(false);
  });

  it("non parte con prefers-reduced-motion", () => {
    expect(puoPartireSiparietto("idle", false, true)).toBe(false);
  });
});

describe("mascotte Tars — specchiatura", () => {
  it("specchia solo la posa che indica", () => {
    expect(vaSpecchiata("indica")).toBe(true);
  });

  it("non specchia il cartello, o FATTURARE si leggerebbe al contrario", () => {
    expect(vaSpecchiata("cartello")).toBe(false);
    expect(vaSpecchiata("idle")).toBe(false);
    expect(vaSpecchiata("evento")).toBe(false);
  });
});

describe("mascotte Tars — poster fermo", () => {
  it("i siparietti ricadono sul poster neutro: da fermi non esistono", () => {
    expect(posterDi("evento")).toBe("idle");
    expect(posterDi("cartello")).toBe("idle");
  });

  it("la posa che indica ha il suo poster", () => {
    expect(posterDi("indica")).toBe("indica");
  });
});

describe("mascotte Tars — etichetta accessibile", () => {
  it("dice cosa fa il click", () => {
    expect(etichettaMascotte(false)).toBe("Chiedi a Tars");
    expect(etichettaMascotte(true)).toBe("Chiudi la domanda rapida a Tars");
  });
});

describe("mascotte Tars — continuità", () => {
  it("monta tutte le pose, non solo quella in vista", () => {
    expect(new Set(POSE_TUTTE)).toEqual(
      new Set(["idle", "indica", ...POSE_OCCASIONALI]),
    );
  });

  it("nessuna posa compare due volte fra quelle montate", () => {
    expect(new Set(POSE_TUTTE).size).toBe(POSE_TUTTE.length);
  });

  it("gira in loop solo a riposo: i siparietti si giocano una volta", () => {
    expect(vaInLoop("idle")).toBe(true);
    expect(vaInLoop("indica")).toBe(true);
    for (const p of POSE_OCCASIONALI) expect(vaInLoop(p)).toBe(false);
  });

  it("ogni posa raggiungibile è fra quelle montate", () => {
    const raggiungibili = new Set<string>([
      posaARiposo(false),
      posaARiposo(true),
      ...POSE_OCCASIONALI,
    ]);
    for (const p of raggiungibili) expect(POSE_TUTTE).toContain(p);
  });
});

describe("mascotte Tars — cosa scaricare subito", () => {
  it("precarica le pose a riposo: servono all'istante", () => {
    expect(vaPrecaricata("idle", null)).toBe(true);
    expect(vaPrecaricata("indica", null)).toBe(true);
  });

  it("dei siparietti scalda solo quello in arrivo", () => {
    expect(vaPrecaricata("calcio", "calcio")).toBe(true);
    for (const p of POSE_OCCASIONALI) {
      if (p === "calcio") continue;
      expect(vaPrecaricata(p, "calcio")).toBe(false);
    }
  });

  it("senza un siparietto in arrivo scarica solo le due pose a riposo", () => {
    const precaricate = POSE_TUTTE.filter(p => vaPrecaricata(p, null));
    expect(precaricate).toEqual(["idle", "indica"]);
  });
});
