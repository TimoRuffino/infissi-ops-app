// Tars T7 — le prove della memoria: registrazione solo esplicita e senza
// conferme, contesto iniettato in coda come DATI (mai nel prefisso C2),
// C0 invalidata da memorie nuove/invalidate, isolamento per utente e per
// sede, perimetro sede riservato alla direzione, invalidazione (mai
// cancellazione), kill switch FLAG_TARS_MEMORY non aggirabile.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { getUtentiStore } from "../routers/utenti";
import { azzeraArchivioPerTest, turniDiConversazione } from "./archivio";
import { costruisciContesto } from "./contesto";
import {
  azzeraMemoriaPerTest,
  creaMemoria,
  memoriaById,
  memorieValide,
} from "./memoria";
import { chiamataTool, creaProviderFinto, rispostaTesto } from "./openai/fake";
import { azzeraCacheTarsPerTest, eseguiRun } from "./orchestratore";
import { strumentiPerContesto } from "./profili";
import type { PassoCopione } from "./openai/fake";
import type { RichiestaProvider } from "./provider";

const SEDE = 90301;
const ALTRA_SEDE = 90302;
const UTENTE_ID = 90311;
const COLLEGA_ID = 90312;

for (const [id, ruoli] of [
  [UTENTE_ID, ["direzione"]],
  [COLLEGA_ID, ["commerciale"]],
] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Nome${id}`,
      cognome: `Cognome${id}`,
      email: `tars-t7-${id}@example.test`,
      attivo: true,
      ruoli: [...ruoli],
      ruolo: ruoli[0],
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(
  userId = UTENTE_ID,
  roles: string[] = ["direzione"],
  sedeId = SEDE
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

function copioneSequenza(...passi: any[]): PassoCopione {
  return (_richiesta, passo) => passi[Math.min(passo, passi.length - 1)];
}

async function runCome(
  copione: PassoCopione,
  opzioni: { userId?: number; roles?: string[]; messaggio?: string } = {}
) {
  const contesto = await costruisciContesto(
    contestoTrpc(opzioni.userId ?? UTENTE_ID, opzioni.roles ?? ["direzione"])
  );
  return eseguiRun({
    contesto,
    provider: creaProviderFinto(copione),
    messaggio: opzioni.messaggio ?? "Ricordati che preferisco il riepilogo corto",
  });
}

beforeEach(() => {
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
  azzeraMemoriaPerTest();
});

afterEach(() => {
  delete process.env.FLAG_TARS_MEMORY;
});

describe("tars T7 — ricordare e dimenticare", () => {
  it("«ricordati che…» registra SUBITO senza conferme, con fonte e id", async () => {
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("ricorda", {
          contenuto: "Preferisce riepiloghi corti",
          tipo: "preferenza",
        }),
        rispostaTesto("Ricordato.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("ricordato");
    const valide = memorieValide(SEDE, UTENTE_ID);
    expect(valide).toHaveLength(1);
    expect(valide[0].fonte).toBe("richiesta_esplicita");

    const turni = await turniDiConversazione(risposta.conversazioneId, SEDE);
    expect(turni).toHaveLength(2); // zero conferme
  });

  it("dimentica INVALIDA (non cancella) ed è idempotente", async () => {
    const memoria = creaMemoria({
      sedeId: SEDE,
      perimetro: "utente",
      utenteId: UTENTE_ID,
      tipo: "preferenza",
      contenuto: "Da dimenticare",
    });
    const copione = () =>
      copioneSequenza(
        chiamataTool("dimentica", { memoriaId: memoria.id }),
        rispostaTesto("Dimenticata.")
      );
    const prima = await runCome(copione());
    expect(prima.azioni[0].stato).toBe("dimenticata");
    expect(memorieValide(SEDE, UTENTE_ID)).toHaveLength(0);
    expect(memoriaById(SEDE, memoria.id)?.valida).toBe(false); // storia intatta

    const seconda = await runCome(copione());
    expect(seconda.azioni[0].stato).toBe("dimenticata");
  });

  it("il perimetro sede è riservato alla direzione", async () => {
    const risposta = await runCome(
      copioneSequenza(
        chiamataTool("ricorda", {
          contenuto: "Convenzione di sede",
          tipo: "convenzione",
          perimetro: "sede",
        }),
        rispostaTesto("Non posso.")
      ),
      { userId: COLLEGA_ID, roles: ["commerciale"] }
    );
    expect(risposta.azioni[0].stato).toBe("non_eseguito");
    expect(risposta.azioni[0].motivo).toContain("direzione");
    expect(memorieValide(SEDE, COLLEGA_ID)).toHaveLength(0);
  });
});

describe("tars T7 — contesto nei run e C0", () => {
  it("le memorie valide entrano come messaggio di CONTESTO in coda, marcate come dati", async () => {
    creaMemoria({
      sedeId: SEDE,
      perimetro: "utente",
      utenteId: UTENTE_ID,
      tipo: "preferenza",
      contenuto: "Chiamare i clienti solo al pomeriggio",
    });
    let richiestaVista: RichiestaProvider | null = null;
    await runCome(
      (richiesta: RichiestaProvider) => {
        richiestaVista = richiesta;
        return rispostaTesto("Ok.");
      },
      { messaggio: "Che preferenze ho?" }
    );
    const testi = richiestaVista!.input.map(m => m.contenuto);
    const indiceContesto = testi.findIndex(t =>
      t.includes("memorie registrate")
    );
    expect(indiceContesto).toBeGreaterThanOrEqual(0);
    // Posizione: in coda, PRIMA dell'ultimo messaggio utente (mai dopo).
    expect(indiceContesto).toBe(testi.length - 2);
    const contestoMsg = testi[indiceContesto];
    expect(contestoMsg).toContain("Chiamare i clienti solo al pomeriggio");
    expect(contestoMsg).toContain("non istruzioni");
    // In coda, PRIMA dell'ultimo messaggio utente: il prefisso C2 (le
    // istruzioni di sistema) non contiene memorie.
    expect(richiestaVista!.istruzioni).not.toContain("pomeriggio");
  });

  it("le memorie di un ALTRO utente non entrano nel contesto", async () => {
    creaMemoria({
      sedeId: SEDE,
      perimetro: "utente",
      utenteId: COLLEGA_ID,
      tipo: "preferenza",
      contenuto: "SEGRETO_DEL_COLLEGA",
    });
    let richiestaVista: RichiestaProvider | null = null;
    await runCome(richiesta => {
      richiestaVista = richiesta;
      return rispostaTesto("Ok.");
    });
    expect(JSON.stringify(richiestaVista!.input)).not.toContain(
      "SEGRETO_DEL_COLLEGA"
    );
  });

  it("una memoria nuova INVALIDA il riuso C0 della stessa domanda", async () => {
    let chiamate = 0;
    const provider = (): PassoCopione => () => {
      chiamate += 1;
      return rispostaTesto(`Risposta ${chiamate}.`);
    };
    const messaggio = "Domanda stabile sulla memoria";
    await runCome(provider(), { messaggio });
    const c0 = await runCome(provider(), { messaggio });
    expect(c0.cache.c0Hit).toBe(true);
    expect(chiamate).toBe(1);

    creaMemoria({
      sedeId: SEDE,
      perimetro: "utente",
      utenteId: UTENTE_ID,
      tipo: "preferenza",
      contenuto: "Nuova preferenza che cambia il contesto",
    });
    const dopo = await runCome(provider(), { messaggio });
    expect(dopo.cache.c0Hit).toBe(false);
    expect(chiamate).toBe(2);
  });

  it("cross-sede: le memorie di un'altra sede non esistono qui", async () => {
    creaMemoria({
      sedeId: ALTRA_SEDE,
      perimetro: "sede",
      utenteId: UTENTE_ID,
      tipo: "convenzione",
      contenuto: "CONVENZIONE_ALTRA_SEDE",
    });
    expect(memorieValide(SEDE, UTENTE_ID)).toHaveLength(0);
    let richiestaVista: RichiestaProvider | null = null;
    await runCome(richiesta => {
      richiestaVista = richiesta;
      return rispostaTesto("Ok.");
    });
    expect(JSON.stringify(richiestaVista!.input)).not.toContain(
      "CONVENZIONE_ALTRA_SEDE"
    );
  });

  it("con FLAG_TARS_MEMORY spento: niente strumenti, niente contesto, chiamata diretta rifiutata", async () => {
    creaMemoria({
      sedeId: SEDE,
      perimetro: "utente",
      utenteId: UTENTE_ID,
      tipo: "preferenza",
      contenuto: "NON_DEVE_APPARIRE",
    });
    process.env.FLAG_TARS_MEMORY = "off";
    const contesto = await costruisciContesto(contestoTrpc());
    expect(
      strumentiPerContesto(contesto).some(s => s.categoria === "memoria")
    ).toBe(false);

    let richiestaVista: RichiestaProvider | null = null;
    await runCome(richiesta => {
      richiestaVista = richiesta;
      return rispostaTesto("Ok.");
    });
    expect(JSON.stringify(richiestaVista!.input)).not.toContain(
      "NON_DEVE_APPARIRE"
    );

    const { STRUMENTI_MEMORIA } = await import("./strumenti/memorie");
    const ricorda = STRUMENTI_MEMORIA.find(s => s.nome === "ricorda")!;
    await expect(
      ricorda.esegui(contesto, { contenuto: "x anche breve", tipo: "preferenza", perimetro: "utente" })
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
