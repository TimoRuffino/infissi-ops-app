// Test del router clienti: la creazione combinata «cliente e prima commessa»
// deve usare lo stesso percorso delle due mutation singole (stesse regole,
// stesso scope sede) e restare fail-closed: senza `commessa.create` non
// nasce nemmeno il cliente.

import { describe, expect, it, vi } from "vitest";

vi.mock("../authz/enforcement", async importOriginal => {
  const actual = await importOriginal<typeof import("../authz/enforcement")>();
  return {
    ...actual,
    authorizeCoreOperation: vi.fn(actual.authorizeCoreOperation),
  };
});

import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import { authorizeCoreOperation } from "../authz/enforcement";
import { appRouter } from "../routers";
import { backfillCliente, getClienteById, getClientiStore } from "./clienti";
import { getCommessaById, getCommesseStore } from "./commesse";

const SEDE = 90201;
const UTENTE = 90211;

function context(userId: number, sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: userId,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = () => appRouter.createCaller(context(UTENTE));

const autorizza = vi.mocked(authorizeCoreOperation);
const autorizzazioneReale = autorizza.getMockImplementation()!;

describe("clienti.createConCommessa", () => {
  it("crea il cliente e la prima commessa collegati, con i dati di lavoro del cliente", async () => {
    const caller = direzione();
    const { cliente, commessa } = await caller.clienti.createConCommessa({
      nome: "Mario",
      cognome: "Rossi",
      tipo: "privato",
      indirizzo: "Via Roma 1",
      citta: "Torino",
      cap: "10100",
      indirizzoLavoro: "Via Cantiere 5",
      cittaLavoro: "Moncalieri",
      capLavoro: "10024",
      telefono: "3331234567",
      email: "mario.rossi@example.com",
    });

    expect(cliente.sedeId).toBe(SEDE);
    expect(cliente.commesseIds).toEqual([commessa.id]);
    expect((getClienteById(cliente.id) as any).commesseIds).toContain(
      commessa.id
    );

    expect(getCommessaById(commessa.id)).not.toBeNull();
    expect(commessa).toMatchObject({
      sedeId: SEDE,
      clienteId: cliente.id,
      cliente: "Rossi Mario",
      stato: "preventivo",
      // La commessa vive dove si fa il lavoro, non dove arriva la fattura.
      indirizzo: "Via Cantiere 5",
      citta: "Moncalieri",
      telefono: "3331234567",
      email: "mario.rossi@example.com",
      assegnatoA: cliente.assegnatoA,
      createdBy: UTENTE,
    });
    expect(commessa.codice).toMatch(/^COM-\d{4}-\d{3}$/);
  });

  it("senza indirizzo di lavoro la commessa ricade sulla residenza, come il dialog", async () => {
    const caller = direzione();
    const { commessa } = await caller.clienti.createConCommessa({
      nome: " ",
      cognome: "Condominio Colline del Sole",
      tipo: "condominio",
      indirizzo: "Corso Francia 10",
      citta: "Rivoli",
    });

    expect(commessa).toMatchObject({
      cliente: "Condominio Colline del Sole",
      indirizzo: "Corso Francia 10",
      citta: "Rivoli",
      telefono: null,
      email: null,
    });
  });

  it("senza commessa.create non scrive nemmeno il cliente", async () => {
    const caller = direzione();
    const clientiPrima = getClientiStore().length;
    const commessePrima = getCommesseStore().length;

    autorizza.mockImplementation(async input => {
      if (input.capability === "commessa.create") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operazione non consentita dal profilo corrente.",
        });
      }
      return autorizzazioneReale(input);
    });
    try {
      await expect(
        caller.clienti.createConCommessa({ nome: "Senza", cognome: "Commessa" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      autorizza.mockImplementation(autorizzazioneReale);
    }

    expect(getClientiStore().length).toBe(clientiPrima);
    expect(getCommesseStore().length).toBe(commessePrima);
  });

  it("resta identico a clienti.create per il cliente e a commesse.create per la commessa", async () => {
    const caller = direzione();
    const separato = await caller.clienti.create({
      nome: "Anna",
      cognome: "Bianchi",
    });
    const commessaSeparata = await caller.commesse.create({
      clienteId: separato.id,
    });
    const { cliente, commessa } = await caller.clienti.createConCommessa({
      nome: "Anna",
      cognome: "Bianchi",
    });

    const chiaviCliente = (c: any) => Object.keys(c).sort();
    const chiaviCommessa = (c: any) => Object.keys(c).sort();
    expect(chiaviCliente(cliente)).toEqual(chiaviCliente(separato));
    expect(chiaviCommessa(commessa)).toEqual(chiaviCommessa(commessaSeparata));
  });
});

describe("recapito della fattura elettronica", () => {
  it("crea e aggiorna PEC, codice destinatario e id FiC; il minuscolo si normalizza, null svuota", async () => {
    const caller = direzione();
    const cliente = await caller.clienti.create({
      nome: " ",
      cognome: "Alfa Srl",
      tipo: "azienda",
      partitaIva: "01500270119",
      pec: "alfa@pec.it",
      codiceDestinatario: "abc1234", // copiato da una mail, minuscolo
      ficEntityId: 7788,
    });
    expect(cliente).toMatchObject({ pec: "alfa@pec.it", codiceDestinatario: "ABC1234", ficEntityId: 7788 });

    // Senza i campi il record li porta comunque, vuoti: lo snapshot della
    // fattura (server/fatture/cliente.ts) non deve indovinarli.
    const privato = await caller.clienti.create({ nome: "Mario", cognome: "Rossi" });
    expect(privato).toMatchObject({ pec: null, codiceDestinatario: null, ficEntityId: null });

    await caller.clienti.update({ id: privato.id, codiceDestinatario: " 0000000 ", pec: "rossi@pec.it", ficEntityId: 12 });
    expect(getClienteById(privato.id)).toMatchObject({
      codiceDestinatario: "0000000",
      pec: "rossi@pec.it",
      ficEntityId: 12,
    });

    // `null` svuota il campo, l'assenza lo lascia stare.
    await caller.clienti.update({ id: privato.id, codiceDestinatario: null, ficEntityId: null });
    expect(getClienteById(privato.id)).toMatchObject({
      codiceDestinatario: null,
      ficEntityId: null,
      pec: "rossi@pec.it",
    });

    await expect(caller.clienti.create({ nome: "X", cognome: "Y", codiceDestinatario: "abc12" })).rejects.toThrow();
    await expect(caller.clienti.update({ id: privato.id, pec: "non-una-pec" })).rejects.toThrow();
  });

  it("il backfill di onLoad dà i campi nuovi a null senza toccare quelli già scritti", () => {
    const legacy: any = { id: 1, nome: "Anna", cognome: "Verdi", createdBy: 7 };
    backfillCliente(legacy);
    expect(legacy).toMatchObject({
      pec: null,
      codiceDestinatario: null,
      ficEntityId: null,
      assegnatoA: 7,
      sedeId: 1,
      archivedAt: null,
      provincia: null,
    });

    // La provincia si ricava dalla convenzione «Città (SP)» dei record vecchi;
    // una sigla scritta resta com'è e una città senza sigla dà null.
    const conSigla: any = { id: 3, citta: "Sarzana (sp)" };
    backfillCliente(conSigla);
    expect(conSigla.provincia).toBe("SP");
    const scritta: any = { id: 4, citta: "Sarzana (SP)", provincia: "GE" };
    backfillCliente(scritta);
    expect(scritta.provincia).toBe("GE");

    const gia: any = {
      id: 2,
      pec: "x@pec.it",
      codiceDestinatario: "ABC1234",
      ficEntityId: 9,
      assegnatoA: 3,
      sedeId: 4,
      archivedAt: "2026-01-01",
    };
    backfillCliente(gia);
    expect(gia).toMatchObject({
      pec: "x@pec.it",
      codiceDestinatario: "ABC1234",
      ficEntityId: 9,
      assegnatoA: 3,
      sedeId: 4,
      archivedAt: "2026-01-01",
    });
  });
});
