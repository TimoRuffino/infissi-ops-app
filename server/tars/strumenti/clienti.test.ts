// Strumenti L0 clienti (accesso ampliato, 01/09/2026): ricerca e scheda
// cliente sede-scoped, con economia sagomata dalle capability e le
// commesse archiviate fuori dai quadri operativi (solo conteggio).

import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { getUtentiStore } from "../../routers/utenti";
import { costruisciContesto } from "../contesto";
import { STRUMENTI_CLIENTI } from "./clienti";

const SEDE = 96001;
const ALTRA_SEDE = 96002;
const DIREZIONE_ID = 96011;
const POSA_ID = 96012;

for (const [id, ruoli] of [
  [DIREZIONE_ID, ["direzione"]],
  [POSA_ID, ["squadra_posa"]],
] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Nome${id}`,
      cognome: `Cognome${id}`,
      email: `tars-clienti-${id}@example.test`,
      attivo: true,
      ruoli: [...ruoli],
      ruolo: ruoli[0],
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(
  userId: number,
  roles: string[],
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

const direzione = (sedeId = SEDE) =>
  appRouter.createCaller(contestoTrpc(DIREZIONE_ID, ["direzione"], sedeId));

async function contestoRun(userId: number, roles: string[], sedeId = SEDE) {
  return costruisciContesto(contestoTrpc(userId, roles, sedeId));
}

function strumento(nome: string) {
  const trovato = STRUMENTI_CLIENTI.find(s => s.nome === nome);
  if (!trovato) throw new Error(`strumento ${nome} non registrato`);
  return trovato;
}

let clienteId: number;

beforeEach(async () => {
  const cliente = await direzione().clienti.create({
    nome: "Impianti SRL",
    cognome: "Maccari",
    tipo: "azienda",
    telefono: "0301234567",
    email: "amministrazione@maccari.test",
    citta: "Brescia",
    partitaIva: "01234567890",
  });
  clienteId = cliente.id;
});

describe("cerca_clienti", () => {
  it("trova per testo nella sede, senza importi e senza archiviati", async () => {
    const archiviato = await direzione().clienti.create({
      nome: "Da Archivio",
      cognome: "Vecchio",
    });
    await direzione().clienti.archive(archiviato.id);

    const esito = await strumento("cerca_clienti").esegui(
      await contestoRun(DIREZIONE_ID, ["direzione"]),
      { testo: "maccari", limite: 20 }
    );
    const nomi = esito.dati.clienti.map((c: any) => c.denominazione);
    expect(nomi.join(" ")).toContain("Maccari");
    expect(
      esito.dati.clienti.some((c: any) => c.denominazione.includes("Vecchio"))
    ).toBe(false);
    expect(JSON.stringify(esito)).not.toContain("importoTotale");
    expect(esito.omissioni.join(" ")).toContain("archiviati");
  });

  it("gli archiviati entrano solo su richiesta esplicita", async () => {
    const archiviato = await direzione().clienti.create({
      nome: "Solo Archivio",
      cognome: "Cliente",
    });
    await direzione().clienti.archive(archiviato.id);

    const esito = await strumento("cerca_clienti").esegui(
      await contestoRun(DIREZIONE_ID, ["direzione"]),
      { testo: "solo archivio", archiviati: true, limite: 20 }
    );
    expect(
      esito.dati.clienti.some((c: any) => c.id === archiviato.id)
    ).toBe(true);
  });

  it("non vede i clienti di un'altra sede", async () => {
    const esito = await strumento("cerca_clienti").esegui(
      await contestoRun(DIREZIONE_ID, ["direzione"], ALTRA_SEDE),
      { testo: "maccari", limite: 20 }
    );
    expect(esito.dati.clienti).toHaveLength(0);
  });
});

describe("leggi_cliente", () => {
  it("restituisce anagrafica, contatti e commesse ATTIVE; le archiviate solo come conteggio", async () => {
    const attiva = await direzione().commesse.create({
      cliente: "Maccari Impianti SRL",
      clienteId,
    });
    const daArchiviare = await direzione().commesse.create({
      cliente: "Maccari Impianti SRL",
      clienteId,
    });
    await direzione().commesse.archive(daArchiviare.id);

    const esito = await strumento("leggi_cliente").esegui(
      await contestoRun(DIREZIONE_ID, ["direzione"]),
      { clienteId }
    );
    expect(esito.dati.anagrafica).toMatchObject({
      id: clienteId,
      tipo: "azienda",
      telefono: "0301234567",
      email: "amministrazione@maccari.test",
    });
    expect(
      esito.dati.commesse.attive.map((c: any) => c.id)
    ).toContain(attiva.id);
    expect(
      esito.dati.commesse.attive.map((c: any) => c.id)
    ).not.toContain(daArchiviare.id);
    expect(esito.dati.commesse.archiviateTotale).toBe(1);
    expect(esito.evidenze.length).toBeGreaterThan(0);
  });

  it("senza capability economiche gli importi NON partono e l'omissione è dichiarata", async () => {
    await direzione().commesse.create({
      cliente: "Maccari Impianti SRL",
      clienteId,
    });

    const perPosa = await strumento("leggi_cliente").esegui(
      await contestoRun(POSA_ID, ["squadra_posa"]),
      { clienteId }
    );
    expect(perPosa.dati.economia).toBeNull();
    expect(perPosa.omissioni.join(" ")).toContain("economia");
    expect(JSON.stringify(perPosa)).not.toContain("importoTotale");

    const perDirezione = await strumento("leggi_cliente").esegui(
      await contestoRun(DIREZIONE_ID, ["direzione"]),
      { clienteId }
    );
    expect(perDirezione.dati.economia).not.toBeNull();
  });

  it("cross-sede: un cliente di un'altra sede è NOT_FOUND, mai dati", async () => {
    await expect(
      strumento("leggi_cliente").esegui(
        await contestoRun(DIREZIONE_ID, ["direzione"], ALTRA_SEDE),
        { clienteId }
      )
    ).rejects.toThrow(/NOT_FOUND/);
  });
});
