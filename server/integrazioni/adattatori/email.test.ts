import { describe, expect, it, vi, afterEach } from "vitest";
import type { Ctx } from "../contratto";
import { caselle } from "../../comunicazioni/caselle";
import * as imap from "../../comunicazioni/imap";
import { email, azionePerGuasto } from "./email";

const ctx = { user: { id: 1, role: "admin" }, sedeId: 1, tenantId: 1 } as unknown as Ctx;

function seminaCasella(sedeId: number, nome: string) {
  caselle.push({
    id: caselle.length + 1,
    sedeId,
    nome,
    indirizzo: `${nome.toLowerCase()}@example.it`,
    host: "mail.example.it",
    porta: 993,
    tls: true,
    passwordCifrata: "v1.finta",
    cartella: "INBOX",
    attiva: true,
    ultimoUid: null,
    uidValidity: null,
    ultimaSync: null,
    ultimoErrore: null,
    messaggiImportati: 0,
  } as any);
}

afterEach(() => {
  caselle.length = 0;
  vi.restoreAllMocks();
});

describe("adattatore email", () => {
  it("nessuna casella: da collegare, senza problema", async () => {
    const s = await email.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema).toBeNull();
  });

  it("lo stato nomina la casella della sede e ignora quelle delle altre", async () => {
    seminaCasella(1, "Ordini");
    seminaCasella(2, "Altra");

    const s = await email.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.soggetto).toBe("ordini@example.it");
  });

  it("con più caselle attive lo stato le conta invece di nominarne una a caso", async () => {
    seminaCasella(1, "Ordini");
    seminaCasella(1, "Amministrazione");

    expect((await email.stato(ctx)).soggetto).toBe("2 caselle");
  });

  it("il guasto arriva già tradotto da imap.ts: l'adattatore non lo riscrive", async () => {
    seminaCasella(1, "Ordini");
    vi.spyOn(imap, "testaCasella").mockResolvedValue({
      ok: false,
      errore:
        "Credenziali rifiutate dal server: controlla indirizzo e password della casella.",
    });

    const p = await email.verifica(ctx);
    expect(p?.causa).toBe(
      "Credenziali rifiutate dal server: controlla indirizzo e password della casella."
    );
    expect(p?.azione).toBe("ricollega");
    expect(p?.rimedio).toMatch(/ordini@example\.it/);
  });

  it("un guasto passeggero si riprova, non si ricollega", () => {
    expect(
      azionePerGuasto("Timeout di connessione: host o porta probabilmente errati")
    ).toBe("riprova");
    expect(azionePerGuasto("Credenziali rifiutate dal server")).toBe("ricollega");
  });

  it("tutto a posto: nessun problema", async () => {
    seminaCasella(1, "Ordini");
    vi.spyOn(imap, "testaCasella").mockResolvedValue({ ok: true, messaggi: 12 });

    expect(await email.verifica(ctx)).toBeNull();
  });

  it("il collegamento è un modulo, non un giro OAuth", async () => {
    await expect(email.avvia!(ctx)).resolves.toEqual({ tipo: "modulo" });
  });
});
