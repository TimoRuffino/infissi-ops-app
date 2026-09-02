// La ricerca delle liste dal capo opposto: un cliente e una commessa veri,
// cercati con quello che uno ha davvero sottomano — il numero da cui l'hanno
// chiamato, la mail di un preventivo, la via del cantiere.
//
// Le due `list` qui sotto sono le stesse che interroga la palette comandi
// (⌘K): quello che passa di qui passa anche di là.

import { beforeAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";

const SEDE = 90401;
const ALTRA_SEDE = 90402;

function context(sedeId: number): TrpcContext {
  return {
    user: {
      id: 90411,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Utente ricerca",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const caller = (sedeId: number = SEDE) =>
  appRouter.createCaller(context(sedeId));

let clienteId = 0;
let commessaId = 0;
let codiceCommessa = "";

beforeAll(async () => {
  const cliente = await caller().clienti.create({
    nome: "Giuseppina",
    cognome: "Bonaccòrsi",
    telefono: "+39 340 1234567",
    email: "g.bonaccorsi@example.it",
    indirizzo: "Via dei Colli 14",
    citta: "Forlì",
    cap: "47121",
    referenti: [
      {
        nome: "Studio Neri",
        ruolo: "architetto",
        telefono: "0187 872687",
        email: "studio.neri@example.it",
      },
    ],
  });
  clienteId = cliente.id;

  const commessa = await caller().commesse.create({
    clienteId: cliente.id,
    cliente: "Bonaccòrsi Giuseppina",
    indirizzo: "Via del Cantiere 3",
    citta: "Cesenatico",
    telefono: "0541 800123",
    email: "cantiere.bonaccorsi@example.it",
  });
  commessaId = commessa.id;
  codiceCommessa = commessa.codice;
});

const trovaCliente = async (search: string) =>
  (await caller().clienti.list({ search })).some((c: any) => c.id === clienteId);

const trovaCommessa = async (search: string) =>
  (await caller().commesse.list({ search })).some(
    (c: any) => c.id === commessaId
  );

describe("ricerca clienti", () => {
  it("trova per nome, nei due ordini in cui lo si scrive", async () => {
    expect(await trovaCliente("giuseppina bonaccorsi")).toBe(true);
    expect(await trovaCliente("bonaccorsi giuseppina")).toBe(true);
  });

  it("trova per numero, comunque sia scritto in anagrafica", async () => {
    expect(await trovaCliente("3401234567")).toBe(true);
    expect(await trovaCliente("340 123 4567")).toBe(true);
    expect(await trovaCliente("+39 340 1234567")).toBe(true);
    expect(await trovaCliente("340-1234")).toBe(true);
  });

  it("trova per mail", async () => {
    expect(await trovaCliente("g.bonaccorsi@example.it")).toBe(true);
    expect(await trovaCliente("bonaccorsi@example")).toBe(true);
  });

  it("trova per indirizzo, città e CAP", async () => {
    expect(await trovaCliente("via dei colli")).toBe(true);
    expect(await trovaCliente("colli 14")).toBe(true);
    expect(await trovaCliente("forli")).toBe(true); // senza accento
    expect(await trovaCliente("47121")).toBe(true);
  });

  it("trova dal referente: la telefonata arriva spesso dall'architetto", async () => {
    expect(await trovaCliente("872687")).toBe(true);
    expect(await trovaCliente("studio neri")).toBe(true);
    expect(await trovaCliente("studio.neri@example.it")).toBe(true);
  });

  it("non allarga a chi non c'entra", async () => {
    expect(await trovaCliente("3339999999")).toBe(false);
    expect(await trovaCliente("via garibaldi")).toBe(false);
    expect(await trovaCliente("levanto")).toBe(false);
  });

  it("resta dentro la sede: un numero giusto da un'altra sede non trova nulla", async () => {
    const altrove = await caller(ALTRA_SEDE).clienti.list({
      search: "3401234567",
    });
    expect(altrove.some((c: any) => c.id === clienteId)).toBe(false);
  });
});

describe("ricerca commesse", () => {
  it("trova per codice e per cliente", async () => {
    expect(await trovaCommessa(codiceCommessa)).toBe(true);
    expect(await trovaCommessa("bonaccorsi")).toBe(true);
  });

  it("trova per numero del cantiere", async () => {
    expect(await trovaCommessa("800123")).toBe(true);
    expect(await trovaCommessa("0541 800123")).toBe(true);
  });

  it("trova per mail, indirizzo e città", async () => {
    expect(await trovaCommessa("cantiere.bonaccorsi@example.it")).toBe(true);
    expect(await trovaCommessa("via del cantiere")).toBe(true);
    expect(await trovaCommessa("cesenatico")).toBe(true);
  });

  it("non allarga a chi non c'entra", async () => {
    expect(await trovaCommessa("3339999999")).toBe(false);
    expect(await trovaCommessa("rimini")).toBe(false);
  });

  it("resta dentro la sede", async () => {
    const altrove = await caller(ALTRA_SEDE).commesse.list({
      search: codiceCommessa,
    });
    expect(altrove.some((c: any) => c.id === commessaId)).toBe(false);
  });
});
