// server/tenants/servizio.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __impostaDriverPerTest, type StorageDriver } from "../_core/fileStorage";
import { hashPassword } from "../_core/password";
import * as persistenceModulo from "../_core/persistence";
import { __registraTenantNotoPerTest, storeDi, tenantsNoti } from "../_core/persistence";
// Side-effect only: registra la famiglia "clienti" (persistedStore) così i
// test di questo file possono verificare `istanziaStoresPerTenant` su uno
// store per-tenant vero, senza importare l'intero appRouter.
import "../routers/clienti";
// Il test di `ricalcola_storage` (Task 4) legge anche "preventivi_documenti"
// e "ticket_allegati": qui l'intero albero, più semplice che elencare i
// singoli router che li registrano.
import "../routers";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
// WS4 (Task 3): solo per leggere `eurInNano` nelle asserzioni sul comando
// `imposta_abbonamento` — nessuna logica di dominio importata qui, resta in
// `./servizio` via `await import` (v. il commento nel sorgente).
import { eurInNano } from "../abbonamenti/costanti";
import { MESSAGGI, TENANT_PREDEFINITO_ID, TENANT_PREDEFINITO_SLUG } from "./costanti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { __impostaDriveRipristinoPerTest } from "./ripristino";
import {
  allineaTenantPredefinito,
  assegnaProprietario,
  crea,
  eseguiComandiInAttesa,
  eseguiComandoSubito,
  modificaProprietario,
  modificaTenant,
  revocaProprietario,
  riattiva,
  sospendi,
} from "./servizio";

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
const script = { tipo: "script" as const, nome: "script:tenant@test" };

beforeEach(() => {
  resetTenantRepositoryForTesting();
  nS = sedi.length;
  nU = utenti.length;
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  delete process.env.FLAG_MULTI_AZIENDA;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const inputAcme = () => ({
  slug: "acme",
  nome: "Acme Infissi",
  sede: { nome: "Acme Infissi", citta: "Sarzana" },
  proprietario: { nome: "Mario", cognome: "Rossi", email: "mario@acme.test", passwordHash: hashPassword("Password-lunga-12") },
});

describe("crea", () => {
  it("crea tenant, prima sede e proprietario+direzione, con gli eventi", async () => {
    const esito = await crea(inputAcme(), script);
    expect(esito.creatoOra).toBe(true);
    expect(esito.tenant.slug).toBe("acme");
    const sede = sedi.find(s => s.id === esito.sedeId)!;
    expect(sede.tenantId).toBe(esito.tenant.id);
    const utente = utenti.find(u => u.id === esito.utenteId)!;
    expect(utente.ruoli).toEqual(["proprietario", "direzione"]);
    expect(utente.sediIds).toEqual([esito.sedeId]);
    expect(utente.tenantId).toBe(esito.tenant.id);
    const eventi = await getTenantRepository().eventi(esito.tenant.id);
    // `abbonamento_creato` (WS4, Task 3): la prova di 30 giorni nasce subito
    // dopo l'evento `creato`, prima ancora che sede e proprietario esistano.
    expect(eventi.map(e => e.tipo)).toEqual(["creato", "abbonamento_creato", "proprietario_assegnato"]);
    expect(eventi[0].attore).toBe("script:tenant@test");
  });

  it("semina la prova di 30 giorni per il nuovo tenant (WS4, interruttore acceso)", async () => {
    const ora = new Date("2026-09-08T09:00:00Z");
    vi.useFakeTimers({ now: ora, toFake: ["Date"] });
    const esito = await crea(inputAcme(), script);
    const abbonamento = getTenantRepository().abbonamentoDi(esito.tenant.id);
    expect(abbonamento).toMatchObject({ tenantId: esito.tenant.id, tipo: "paid", stato: "trialing" });
    expect(abbonamento?.finePeriodo?.toISOString()).toBe(new Date(ora.getTime() + 30 * 86_400_000).toISOString());
  });

  it("è idempotente per slug e rifiuta slug non validi ed email di altre aziende", async () => {
    const primo = await crea(inputAcme(), script);
    const secondo = await crea(inputAcme(), script);
    expect(secondo.creatoOra).toBe(false);
    expect(secondo.tenant.id).toBe(primo.tenant.id);
    expect(secondo.sedeId).toBe(primo.sedeId);
    expect(secondo.utenteId).toBe(primo.utenteId);
    await expect(crea({ ...inputAcme(), slug: "Acme" }, script)).rejects.toThrow(/Slug/);
    await expect(crea({ ...inputAcme(), slug: "altra" }, script)).rejects.toThrow(/altra azienda/);
    expect(getTenantRepository().perSlug("altra")).toBeNull();
  });

  it("tenant esistente senza sedi: completa sede, proprietario e la prova mancante, senza un secondo evento creato (Important 4; Task 3 fix round 1, Ruling R8)", async () => {
    const repo = getTenantRepository();
    // Semina il tenant 1 PRIMA: in un repo appena azzerato il primo tenant
    // creato prenderebbe proprio l'id 1 (il tenant "intoccabile"), come già
    // annotato più sotto in questo file per `ripristina_archivi` e
    // `imposta_abbonamento`.
    await repo.assicuraTenantPredefinito();
    const preesistente = await repo.inserisci({ slug: "acme", nome: "Acme Infissi" });
    const esito = await crea(inputAcme(), script);
    expect(esito.creatoOra).toBe(false);
    expect(esito.tenant.id).toBe(preesistente.id);
    const sede = sedi.find(s => s.id === esito.sedeId)!;
    expect(sede.tenantId).toBe(preesistente.id);
    const utente = utenti.find(u => u.id === esito.utenteId)!;
    expect(utente.tenantId).toBe(preesistente.id);
    const eventi = await repo.eventi(preesistente.id);
    // Nessun evento "creato": la riga tenant non è nata in questa chiamata.
    // "abbonamento_creato" invece sì: il tenant esisteva già ma senza una
    // prova (mai passato da `crea` prima d'ora, inserito qui a mano) — `crea`
    // la semina comunque, non solo per un tenant nuovo (R8: nessun tenant
    // deve restare senza abbonamento).
    expect(eventi.map(e => e.tipo)).toEqual(["abbonamento_creato", "proprietario_assegnato"]);
    expect(repo.abbonamentoDi(preesistente.id)?.stato).toBe("trialing");
  });

  it("un commit fallito ripristina sedi e utenti spinti in questo giro; l'evento creato resta (Important 4)", async () => {
    // conTransazioneStoreAtomica reale non fallisce mai in test (niente
    // DATABASE_URL: `commit()` interno è un no-op) — la sostituiamo con una
    // versione che esegue comunque il callback di `crea` (così sede e utente
    // vengono davvero spinti negli array vivi) ma il cui `commit` rilancia.
    vi.spyOn(persistenceModulo, "conTransazioneStoreAtomica").mockImplementationOnce(
      (async (_stores: unknown, operazione: (commit: () => Promise<void>) => Promise<unknown>) =>
        operazione(async () => {
          throw new Error("commit fallito (prova)");
        })) as typeof persistenceModulo.conTransazioneStoreAtomica
    );
    await expect(crea(inputAcme(), script)).rejects.toThrow(/commit fallito/);
    const tenant = getTenantRepository().perSlug("acme");
    expect(tenant).not.toBeNull();
    expect(sedi.some(s => s.tenantId === tenant!.id)).toBe(false);
    expect(utenti.some((u: any) => u.tenantId === tenant!.id)).toBe(false);
    const eventi = await getTenantRepository().eventi(tenant!.id);
    // La prova (WS4) nasce PRIMA della transazione di sede/utente: resta,
    // come l'evento `creato`, anche se il commit fallisce dopo.
    expect(eventi.map(e => e.tipo)).toEqual(["creato", "abbonamento_creato"]);
  });

  it("se istanziaStoresPerTenant fallisce, la sede e l'utente creati in questo giro vengono tolti e il tenant resta", async () => {
    vi.spyOn(persistenceModulo, "istanziaStoresPerTenant").mockRejectedValueOnce(
      new Error("istanzia fallita (prova)")
    );
    await expect(crea(inputAcme(), script)).rejects.toThrow(/istanzia fallita/);
    const tenant = getTenantRepository().perSlug("acme");
    expect(tenant).not.toBeNull();
    expect(sedi.some(s => s.tenantId === tenant!.id)).toBe(false);
    expect(utenti.some((u: any) => u.tenantId === tenant!.id)).toBe(false);
    const eventi = await getTenantRepository().eventi(tenant!.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creato", "abbonamento_creato"]);
  });
});

describe("crea: store del tenant (Task 6)", () => {
  it("istanzia gli store del tenant appena creato: storeDi è [] e tenantsNoti() lo contiene", async () => {
    // Il primo tenant creato in un repo di controllo appena azzerato prende
    // id 1, che persistence.ts tiene sempre "noto" di default: non basta a
    // provare che `crea` chiami `istanziaStoresPerTenant`. Un secondo
    // tenant, invece, nasce con uno store per-tenant che prima non esisteva.
    await crea(inputAcme(), script);
    const secondo = await crea(
      {
        ...inputAcme(),
        slug: "beta",
        nome: "Beta Infissi",
        proprietario: { ...inputAcme().proprietario, email: "mario@beta.test" },
      },
      script
    );
    expect(storeDi(secondo.tenant.id, "clienti")).toEqual([]);
    expect(tenantsNoti()).toContain(secondo.tenant.id);
  });
});

describe("stato e proprietari", () => {
  it("sospende e riattiva con eventi e cache aggiornata", async () => {
    const { tenant } = await crea(inputAcme(), script);
    const sospeso = await sospendi(tenant.id, "insoluto", script);
    expect(sospeso.stato).toBe("sospeso");
    expect(getTenantRepository().perId(tenant.id)?.stato).toBe("sospeso");
    await riattiva(tenant.id, "pagato", script);
    expect(getTenantRepository().perId(tenant.id)?.stato).toBe("attivo");
    const tipi = (await getTenantRepository().eventi(tenant.id)).map(e => e.tipo);
    expect(tipi.slice(-2)).toEqual(["sospeso", "riattivato"]);
  });

  it("assegna e revoca il ruolo con la guardia dell'ultimo proprietario", async () => {
    const { tenant, sedeId, utenteId } = await crea(inputAcme(), script);
    const now = new Date();
    utenti.push({ id: 97701, nome: "S", cognome: "T", email: "s@acme.test", ruoli: ["direzione"], sediIds: [sedeId], attivo: true, tenantId: tenant.id, password: "scrypt$x", createdAt: now, updatedAt: now });
    await expect(revocaProprietario(tenant.id, utenteId, script)).rejects.toThrow(/ultimo proprietario/);
    await assegnaProprietario(tenant.id, 97701, script);
    expect(utenti.find(u => u.id === 97701)!.ruoli).toEqual(["direzione", "proprietario"]);
    await revocaProprietario(tenant.id, utenteId, script);
    expect(utenti.find(u => u.id === utenteId)!.ruoli).toEqual(["direzione"]);
    await expect(assegnaProprietario(tenant.id, 999_999, script)).rejects.toThrow(/inesistente/);
  });
});

// «Modifica azienda» (piano 09/09/2026, Task 2). Ogni test semina il tenant 1
// PRIMA di `crea(inputAcme(), script)` (come già altrove in questo file):
// altrimenti "acme", primo tenant inserito in un repo azzerato, prenderebbe
// proprio l'id 1 e i test sul tenant 1 (slug intoccabile) diventerebbero
// equivoci.
describe("modificaTenant", () => {
  it("aggiorna nome, note e fatturazione: un solo evento tenant_modificato coi campi davvero cambiati, il merge di fatturazione è campo per campo", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { tenant } = await crea(inputAcme(), script);

    const dopo1 = await modificaTenant(
      tenant.id,
      { nome: "Acme Infissi Srl", note: "cliente storico", fatturazione: { partitaIva: "12345678901" } },
      script
    );
    expect(dopo1.nome).toBe("Acme Infissi Srl");
    expect(dopo1.note).toBe("cliente storico");
    expect(dopo1.fatturazione.partitaIva).toBe("12345678901");
    expect(repo.perId(tenant.id)?.nome).toBe("Acme Infissi Srl");

    const evento1 = (await repo.eventi(tenant.id)).findLast(e => e.tipo === "tenant_modificato");
    expect(evento1?.dettagli).toEqual({
      campi: [
        { campo: "nome", prima: "Acme Infissi", dopo: "Acme Infissi Srl" },
        { campo: "note", prima: null, dopo: "cliente storico" },
        { campo: "partitaIva", prima: null, dopo: "12345678901" },
      ],
    });

    // Richiamare con GLI STESSI valori: nessun campo è "davvero cambiato",
    // quindi nessun secondo evento tenant_modificato.
    await modificaTenant(
      tenant.id,
      { nome: "Acme Infissi Srl", note: "cliente storico", fatturazione: { partitaIva: "12345678901" } },
      script
    );
    expect((await repo.eventi(tenant.id)).filter(e => e.tipo === "tenant_modificato").length).toBe(1);

    // Un secondo campo di fatturazione si aggiunge SENZA cancellare il primo:
    // `aggiornaTenant` fonde `fatturazione` campo per campo, non sostituisce.
    const dopo3 = await modificaTenant(tenant.id, { fatturazione: { pec: "acme@pec.it" } }, script);
    expect(dopo3.fatturazione.partitaIva).toBe("12345678901");
    expect(dopo3.fatturazione.pec).toBe("acme@pec.it");
  });

  it("nuovoSlug già usato da un'altra azienda: rifiutato, nessuna scrittura né evento", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    await crea(inputAcme(), script);
    const { tenant: beta } = await crea(
      { ...inputAcme(), slug: "beta", nome: "Beta Infissi", proprietario: { ...inputAcme().proprietario, email: "mario@beta.test" } },
      script
    );
    await expect(modificaTenant(beta.id, { nuovoSlug: "acme" }, script)).rejects.toThrow(/Slug già usato/);
    expect(repo.perId(beta.id)?.slug).toBe("beta");
    const eventi = await repo.eventi(beta.id);
    expect(eventi.some(e => e.tipo === "tenant_modificato" || e.tipo === "slug_cambiato")).toBe(false);
  });

  it("nuovoSlug diverso: registra slug_cambiato e perSlug segue il nuovo valore", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { tenant } = await crea(inputAcme(), script);
    const dopo = await modificaTenant(tenant.id, { nuovoSlug: "acme-nuovo" }, script);
    expect(dopo.slug).toBe("acme-nuovo");
    expect(repo.perSlug("acme")).toBeNull();
    expect(repo.perSlug("acme-nuovo")?.id).toBe(tenant.id);
    const evento = (await repo.eventi(tenant.id)).findLast(e => e.tipo === "slug_cambiato");
    expect(evento?.dettagli).toEqual({ da: "acme", a: "acme-nuovo" });
  });

  it("tenant 1: rifiuta il cambio di slug, accetta lo stesso slug e gli altri campi", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    await expect(modificaTenant(TENANT_PREDEFINITO_ID, { nuovoSlug: "altro-nome" }, script)).rejects.toThrow(
      MESSAGGI.tenant1SlugIntoccabile
    );
    expect(repo.perId(TENANT_PREDEFINITO_ID)?.slug).toBe(TENANT_PREDEFINITO_SLUG);

    // Lo stesso slug di adesso non è un cambio: nessun rifiuto.
    const dopo = await modificaTenant(
      TENANT_PREDEFINITO_ID,
      { nuovoSlug: TENANT_PREDEFINITO_SLUG, nome: "Ruffino Group Srl" },
      script
    );
    expect(dopo.nome).toBe("Ruffino Group Srl");
    expect(dopo.slug).toBe(TENANT_PREDEFINITO_SLUG);
  });

  it("sede di un'altra azienda o inesistente: NOT_FOUND, senza scrivere nulla (nemmeno gli altri campi della stessa chiamata)", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { sedeId: sedeAcme } = await crea(inputAcme(), script);
    const { tenant: beta } = await crea(
      { ...inputAcme(), slug: "beta", nome: "Beta Infissi", proprietario: { ...inputAcme().proprietario, email: "mario@beta.test" } },
      script
    );

    await expect(
      modificaTenant(beta.id, { nome: "Non deve salvare", sede: { id: sedeAcme, nome: "X", citta: null } }, script)
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: MESSAGGI.nonTrovato });
    expect(repo.perId(beta.id)?.nome).toBe("Beta Infissi");

    await expect(
      modificaTenant(beta.id, { sede: { id: 999_999, nome: "X", citta: null } }, script)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sede del proprio tenant: nome e città si aggiornano nello store sedi", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { tenant, sedeId } = await crea(inputAcme(), script);
    const dopo = await modificaTenant(
      tenant.id,
      { sede: { id: sedeId, nome: "Acme Nuova Sede", citta: "Genova" } },
      script
    );
    expect(dopo.id).toBe(tenant.id);
    const sede = sedi.find(s => s.id === sedeId)!;
    expect(sede.nome).toBe("Acme Nuova Sede");
    expect(sede.citta).toBe("Genova");
  });
});

describe("modificaProprietario", () => {
  it("aggiorna nome/cognome/telefono e registra l'evento coi soli campi davvero cambiati", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { tenant, utenteId } = await crea(inputAcme(), script);

    const esito = await modificaProprietario(
      tenant.id,
      { utenteId, nome: "Mario", cognome: "Bianchi", email: "mario@acme.test", telefono: "0187123456" },
      script
    );
    expect(esito).toEqual({ utenteId, emailCambiata: false });
    const utente = utenti.find(u => u.id === utenteId)!;
    expect(utente.cognome).toBe("Bianchi");
    expect(utente.telefono).toBe("0187123456");

    const evento = (await repo.eventi(tenant.id)).findLast(e => e.tipo === "proprietario_modificato");
    expect(evento?.dettagli).toEqual({
      utenteId,
      campi: [
        { campo: "cognome", prima: "Rossi", dopo: "Bianchi" },
        { campo: "telefono", prima: null, dopo: "0187123456" },
      ],
    });

    // Richiamare con GLI STESSI valori: nessun campo cambia, nessun secondo evento.
    await modificaProprietario(
      tenant.id,
      { utenteId, nome: "Mario", cognome: "Bianchi", email: "mario@acme.test", telefono: "0187123456" },
      script
    );
    expect((await repo.eventi(tenant.id)).filter(e => e.tipo === "proprietario_modificato").length).toBe(1);
  });

  it("emailCambiata: false se cambiano solo le maiuscole, true per un indirizzo davvero diverso", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { tenant, utenteId } = await crea(inputAcme(), script);

    const soloMaiuscole = await modificaProprietario(
      tenant.id,
      { utenteId, nome: "Mario", cognome: "Rossi", email: "MARIO@ACME.TEST" },
      script
    );
    expect(soloMaiuscole.emailCambiata).toBe(false);
    expect(utenti.find(u => u.id === utenteId)!.email).toBe("MARIO@ACME.TEST");

    const cambiata = await modificaProprietario(
      tenant.id,
      { utenteId, nome: "Mario", cognome: "Rossi", email: "mario.rossi@acme.test" },
      script
    );
    expect(cambiata.emailCambiata).toBe(true);
    expect(utenti.find(u => u.id === utenteId)!.email).toBe("mario.rossi@acme.test");
    const evento = (await repo.eventi(tenant.id)).findLast(e => e.tipo === "proprietario_modificato");
    expect(evento?.dettagli).toMatchObject({
      utenteId,
      campi: [{ campo: "email", prima: "MARIO@ACME.TEST", dopo: "mario.rossi@acme.test" }],
    });
  });

  it("email già usata da un altro utente dell'installazione (case-insensitive): rifiutata", async () => {
    await getTenantRepository().assicuraTenantPredefinito();
    const { tenant: acme, utenteId: utenteAcme } = await crea(inputAcme(), script);
    await crea(
      { ...inputAcme(), slug: "beta", nome: "Beta Infissi", proprietario: { ...inputAcme().proprietario, email: "titolare@beta.test" } },
      script
    );
    await expect(
      modificaProprietario(
        acme.id,
        { utenteId: utenteAcme, nome: "Mario", cognome: "Rossi", email: "TITOLARE@beta.test" },
        script
      )
    ).rejects.toThrow(/già in uso/);
  });

  it("utenteId mancante: lo risolve da sé con un solo proprietario, rifiuta come ambiguo con più di uno, riesce comunque con utenteId esplicito", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { tenant, sedeId, utenteId } = await crea(inputAcme(), script);

    const esito = await modificaProprietario(
      tenant.id,
      { nome: "Mario", cognome: "Rossi", email: "mario@acme.test", telefono: "0187000" },
      script
    );
    expect(esito.utenteId).toBe(utenteId);

    // Secondo proprietario nello stesso tenant (stesso stile della "guardia
    // dell'ultimo proprietario" più sopra in questo file).
    const now = new Date();
    utenti.push({
      id: 97810,
      nome: "Anna",
      cognome: "Verdi",
      email: "anna@acme.test",
      ruoli: ["proprietario"],
      sediIds: [sedeId],
      attivo: true,
      tenantId: tenant.id,
      password: "scrypt$x",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      modificaProprietario(tenant.id, { nome: "Mario", cognome: "Rossi", email: "mario@acme.test" }, script)
    ).rejects.toThrow(MESSAGGI.proprietarioAmbiguo);

    const esitoEsplicito = await modificaProprietario(
      tenant.id,
      { utenteId: 97810, nome: "Anna", cognome: "Verdi Bis", email: "anna@acme.test" },
      script
    );
    expect(esitoEsplicito.utenteId).toBe(97810);
    expect(utenti.find(u => u.id === 97810)!.cognome).toBe("Verdi Bis");
  });

  it("utenteId di un'altra azienda o senza ruolo proprietario: NOT_FOUND", async () => {
    await getTenantRepository().assicuraTenantPredefinito();
    const { tenant: acme, utenteId: utenteAcme } = await crea(inputAcme(), script);
    const { tenant: beta } = await crea(
      { ...inputAcme(), slug: "beta", nome: "Beta Infissi", proprietario: { ...inputAcme().proprietario, email: "mario@beta.test" } },
      script
    );
    await expect(
      modificaProprietario(beta.id, { utenteId: utenteAcme, nome: "X", cognome: "Y", email: "x@beta.test" }, script)
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: MESSAGGI.nonTrovato });

    const now = new Date();
    utenti.push({
      id: 97820,
      nome: "Extra",
      cognome: "Utente",
      email: "extra@acme.test",
      ruoli: ["commerciale"],
      sediIds: [],
      attivo: true,
      tenantId: acme.id,
      password: "scrypt$x",
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      modificaProprietario(acme.id, { utenteId: 97820, nome: "X", cognome: "Y", email: "x@acme.test" }, script)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// Copertura della coda dei comandi (Task 2): i due `case` nuovi di
// `eseguiComando`, come già `imposta_abbonamento`/`ricalcola_storage` sopra
// in questo file.
describe("eseguiComandiInAttesa: modifica_tenant e modifica_proprietario (Task 2)", () => {
  it("entrambi i comandi eseguono e l'esito riporta slug/emailCambiata", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { tenant, utenteId } = await crea(inputAcme(), script);

    const cTenant = await repo.accodaComando({
      tipo: "modifica_tenant",
      tenantId: tenant.id,
      payload: { slug: "acme", nome: "Acme Infissi Srl" },
      richiestoDa: "piattaforma:t@r.it",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(cTenant.id))?.esito).toEqual({ tenantId: tenant.id, slug: "acme" });
    expect(repo.perId(tenant.id)?.nome).toBe("Acme Infissi Srl");
    expect((await repo.eventi(tenant.id)).findLast(e => e.tipo === "tenant_modificato")?.attore).toBe(
      "piattaforma:t@r.it"
    );

    const cProprietario = await repo.accodaComando({
      tipo: "modifica_proprietario",
      tenantId: tenant.id,
      payload: { slug: "acme", utenteId, nome: "Mario", cognome: "Rossi", email: "mario2@acme.test" },
      richiestoDa: "piattaforma:t@r.it",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(cProprietario.id))?.esito).toEqual({
      tenantId: tenant.id,
      utenteId,
      emailCambiata: true,
    });
    expect(utenti.find(u => u.id === utenteId)!.email).toBe("mario2@acme.test");
  });

  it("un payload modifica_tenant non valido finisce in errore, senza bloccare i comandi successivi", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const invalido = await repo.accodaComando({
      tipo: "modifica_tenant",
      tenantId: null,
      payload: {},
      richiestoDa: "script:tenant@test",
    });
    const valido = await repo.accodaComando({
      tipo: "modifica_tenant",
      tenantId: null,
      payload: { slug: "ruffino-group", note: "ok" },
      richiestoDa: "script:tenant@test",
    });
    const esito = await eseguiComandiInAttesa();
    expect(esito).toEqual({ eseguiti: 1, falliti: 1 });
    expect((await repo.comando(invalido.id))?.stato).toBe("errore");
    expect((await repo.comando(valido.id))?.stato).toBe("eseguito");
  });
});

describe("allineaTenantPredefinito", () => {
  it("dà il ruolo alla prima direzione attiva senza proprietari, dopo che il control plane ha seminato il tenant 1", async () => {
    const now = new Date();
    utenti.push({ id: 97702, nome: "D", cognome: "Uno", email: "d1@t1.test", ruoli: ["direzione", "amministrazione", "commerciale"], sediIds: [1], attivo: true, tenantId: 1, password: "scrypt$x", createdAt: now, updatedAt: now });
    utenti.push({ id: 97703, nome: "D", cognome: "Due", email: "d2@t1.test", ruoli: ["direzione"], sediIds: [1], attivo: true, tenantId: 1, password: "scrypt$x", createdAt: now, updatedAt: now });
    const giaProprietari = utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).map(u => u.id);
    // Il seed della riga `tenants` è compito del control plane (`preparaTenants`
    // lo fa con `repo.assicuraTenantPredefinito()`, PRIMA che gli store
    // esistano): qui lo riproduciamo a mano perché il test lavora sugli store.
    await getTenantRepository().assicuraTenantPredefinito();
    await allineaTenantPredefinito();
    expect(getTenantRepository().perId(1)?.slug).toBe("ruffino-group");
    const oraProprietari = utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).map(u => u.id);
    // Se il tenant 1 non aveva proprietari, il primo candidato per id con meno di
    // 3 ruoli lo riceve (97702 ha già tre ruoli, quindi 97703 se l'utente 1 non c'è).
    expect(oraProprietari.length).toBeGreaterThanOrEqual(1);
    expect(oraProprietari.length).toBe(Math.max(giaProprietari.length, 1));
    await allineaTenantPredefinito();
    expect(utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).length).toBe(oraProprietari.length);
  });
});

describe("eseguiComandiInAttesa", () => {
  it("esegue i comandi in ordine e segna gli errori senza fermarsi", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const a = await repo.accodaComando({ tipo: "crea", tenantId: null, payload: inputAcme(), richiestoDa: "script:tenant@test" });
    const b = await repo.accodaComando({ tipo: "sospendi", tenantId: null, payload: { slug: "acme", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    const c = await repo.accodaComando({ tipo: "riattiva", tenantId: null, payload: { slug: "non-esiste", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    const esito = await eseguiComandiInAttesa();
    expect(esito).toEqual({ eseguiti: 2, falliti: 1 });
    expect((await repo.comando(a.id))?.stato).toBe("eseguito");
    expect((await repo.comando(b.id))?.stato).toBe("eseguito");
    expect((await repo.comando(c.id))?.esito).toMatchObject({ errore: expect.stringMatching(/non-esiste/) });
    expect(repo.perSlug("acme")?.stato).toBe("sospeso");
  });

  it("con l'interruttore spento non esegue nulla", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.accodaComando({ tipo: "crea", tenantId: null, payload: inputAcme(), richiestoDa: "script:tenant@test" });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 0, falliti: 0 });
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });

  it("un payload crea non valido finisce in errore con un messaggio zod, senza bloccare i comandi successivi (Important 4)", async () => {
    const repo = getTenantRepository();
    const invalido = await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload: { slug: "x" },
      richiestoDa: "script:tenant@test",
    });
    const valido = await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload: inputAcme(),
      richiestoDa: "script:tenant@test",
    });
    const esito = await eseguiComandiInAttesa();
    expect(esito).toEqual({ eseguiti: 1, falliti: 1 });
    const comandoInvalido = await repo.comando(invalido.id);
    expect(comandoInvalido?.stato).toBe("errore");
    expect(typeof (comandoInvalido?.esito as any)?.errore).toBe("string");
    expect((comandoInvalido?.esito as any)?.errore.length).toBeGreaterThan(0);
    expect((await repo.comando(valido.id))?.stato).toBe("eseguito");
    expect(getTenantRepository().perSlug("acme")).not.toBeNull();
  });

  it("ricalcola_storage: ricalcola il ledger del tenant indicato e il comando risulta eseguito", async () => {
    __registraTenantNotoPerTest(2);
    storeDi<any>(2, "preventivi_documenti").length = 0;
    storeDi<any>(2, "ticket_allegati").length = 0;
    const file = new Map<string, Buffer>([["tenant/2/anteprime/9/9-bbbbbbbb.jpg", Buffer.alloc(11)]]);
    const driver: StorageDriver = {
      name: "local",
      async put() {}, async get() { return null; }, async openRead() { return null; }, async delete() {},
      async head(k) { const b = file.get(k); return b ? { bytes: b.length } : null; },
    };
    __impostaDriverPerTest(driver);
    try {
      storeDi<any>(2, "preventivi_documenti").push({
        id: 9,
        tenantId: 2,
        sedeId: 20,
        commessaId: 1,
        nome: "a.pdf",
        size: 200,
        storageKey: "tenant/2/preventivi_documenti/9/9-aaaaaaaa.pdf",
        anteprime: { chiavi: ["tenant/2/anteprime/9/9-bbbbbbbb.jpg"] },
      });
      const repo = getTenantRepository();
      const comando = await repo.accodaComando({
        tipo: "ricalcola_storage",
        tenantId: 2,
        payload: { slug: "acme" },
        richiestoDa: "script:tenant@test",
      });
      const esito = await eseguiComandiInAttesa();
      expect(esito).toEqual({ eseguiti: 1, falliti: 0 });
      const eseguito = await repo.comando(comando.id);
      expect(eseguito?.stato).toBe("eseguito");
      expect(eseguito?.esito).toEqual({ tenantId: 2, bytes: 211, file: 2 });
    } finally {
      __impostaDriverPerTest(null);
      storeDi<any>(2, "preventivi_documenti").length = 0;
      storeDi<any>(2, "ticket_allegati").length = 0;
    }
  });

  it("ripristina_archivi: il server esegue il ripristino dell'azienda e mette l'esito nel comando (Task 8)", async () => {
    __registraTenantNotoPerTest(2);
    const repo = getTenantRepository();
    // Id 2 esplicito: il tenant 1 è Ruffino Group e il ripristino lo rifiuta
    // senza `ancheTenant1` (in un repo appena azzerato il primo inserito
    // prenderebbe proprio l'id 1).
    const acme = await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    sedi.push({ id: 97720, tenantId: acme.id, nome: "Acme HQ", attiva: true } as any);
    storeDi<any>(acme.id, "clienti").length = 0;
    storeDi<any>(acme.id, "clienti").push({ id: 1, tenantId: acme.id, sedeId: 97720 });
    // Nessun Drive nei test: il comando non riceve un `DriveRipristino`, lo
    // prende da qui (l'unica iniezione, sotto NODE_ENV=test).
    __impostaDriveRipristinoPerTest({
      async cartellaBackup() { return { id: "idcartella", nome: "Backup CRM 2026-09-07" }; },
      async dumpDisponibili() {
        return [{ nome: "clienti", scarica: async () => [{ id: 9, tenantId: acme.id, sedeId: 97720 }] }];
      },
    });
    try {
      const comando = await repo.accodaComando({
        tipo: "ripristina_archivi",
        tenantId: acme.id,
        payload: { slug: "acme", backup: "2026-09-07", solo: ["clienti"], scrivi: true },
        richiestoDa: "script:tenant@test",
      });
      expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
      const eseguito = await repo.comando(comando.id);
      expect(eseguito?.stato).toBe("eseguito");
      expect(eseguito?.esito).toMatchObject({
        tenantId: acme.id,
        dryRun: false,
        backup: { id: "idcartella", nome: "Backup CRM 2026-09-07" },
        store: [{ nome: "clienti", prima: 1, dopo: 1, sostituito: true }],
      });
      expect(storeDi(acme.id, "clienti")).toEqual([{ id: 9, tenantId: acme.id, sedeId: 97720 }]);
      expect(repo.perId(acme.id)?.stato).toBe("attivo");
      expect((await repo.eventi(acme.id)).map(e => e.tipo)).toEqual(["sospeso", "riattivato", "archivi_ripristinati"]);
    } finally {
      __impostaDriveRipristinoPerTest(null);
      storeDi<any>(acme.id, "clienti").length = 0;
    }
  });

  it("imposta_abbonamento: omaggio porta a complimentary/active; budget_tars e quota aggiornano i campi (Task 3)", async () => {
    const repo = getTenantRepository();
    // Semina il tenant 1 PRIMA: in un repo appena azzerato il primo tenant
    // creato prenderebbe proprio l'id 1 (il tenant "intoccabile"), come già
    // annotato per `ripristina_archivi` più sopra.
    await repo.assicuraTenantPredefinito();
    const { tenant } = await crea(inputAcme(), script);

    const omaggio = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: tenant.id,
      payload: { azione: "omaggio", slug: "acme", motivo: "pilota", scadenza: null },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(omaggio.id))?.esito).toMatchObject({
      tenantId: tenant.id,
      azione: "omaggio",
      stato: "active",
      tipo: "complimentary",
    });
    expect(repo.abbonamentoDi(tenant.id)?.omaggio?.motivo).toBe("pilota");

    const budget = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: tenant.id,
      payload: { azione: "budget_tars", slug: "acme", eur: 40 },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(budget.id))?.stato).toBe("eseguito");
    expect(repo.abbonamentoDi(tenant.id)?.budgetTarsNanoMese).toBe(eurInNano(40));

    const quota = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: tenant.id,
      payload: { azione: "quota", slug: "acme", quotaGb: 200 },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(quota.id))?.stato).toBe("eseguito");
    expect(repo.perId(tenant.id)?.storageQuotaBytes).toBe(200 * 1024 ** 3);
    const eventoQuota = (await repo.eventi(tenant.id)).findLast(e => e.tipo === "abbonamento_modificato");
    expect(eventoQuota?.dettagli).toMatchObject({ campo: "quota_storage_gb", dopo: 200 });
  });

  it("imposta_abbonamento su uno slug inesistente fallisce senza bloccare i comandi successivi", async () => {
    const repo = getTenantRepository();
    const comando = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: null,
      payload: { azione: "quota", slug: "non-esiste", quotaGb: 10 },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 0, falliti: 1 });
    expect((await repo.comando(comando.id))?.esito).toMatchObject({ errore: expect.stringMatching(/non-esiste/) });
  });

  it("imposta_abbonamento: proroga, extra_tars, tolleranze, disdetta e budget_tars con eur null (Task 3 fix round 1, copertura comandi)", async () => {
    const T0 = new Date("2026-09-08T09:00:00Z");
    vi.useFakeTimers({ now: T0, toFake: ["Date"] });
    const repo = getTenantRepository();
    // Semina il tenant 1 PRIMA: `proroga` e `disdetta` rifiutano il tenant 1
    // (`nonIlTenant1`), e in un repo appena azzerato il primo tenant creato
    // prenderebbe proprio quell'id, come già annotato più sopra in questo
    // file.
    await repo.assicuraTenantPredefinito();
    const { tenant } = await crea(inputAcme(), script);

    const proroga = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: tenant.id,
      payload: { azione: "proroga", slug: "acme", motivo: "cortesia", giorni: 10 },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(proroga.id))?.stato).toBe("eseguito");
    // La prova nasce con `finePeriodo` a T0+30gg (creaProva): è ancora nel
    // futuro rispetto a T0, quindi "il più tardi fra fine e adesso" è la
    // fine, e la proroga di 10 giorni si somma a quella (non a T0).
    expect(repo.abbonamentoDi(tenant.id)?.finePeriodo?.toISOString()).toBe(
      new Date(T0.getTime() + 40 * 86_400_000).toISOString()
    );

    const extraTars = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: tenant.id,
      payload: { azione: "extra_tars", slug: "acme", eur: 5 },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(extraTars.id))?.stato).toBe("eseguito");
    expect(repo.abbonamentoDi(tenant.id)?.extraTarsNano).toBe(eurInNano(5));

    const tolleranze = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: tenant.id,
      payload: { azione: "tolleranze", slug: "acme", storage: 3, tars: 9 },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(tolleranze.id))?.stato).toBe("eseguito");
    expect(repo.abbonamentoDi(tenant.id)).toMatchObject({ tolleranzaStorageGiorni: 3, tolleranzaTarsGiorni: 9 });

    const disdetta = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: tenant.id,
      payload: { azione: "disdetta", slug: "acme", disdetta: true },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(disdetta.id))?.stato).toBe("eseguito");
    expect(repo.abbonamentoDi(tenant.id)?.disdettaAFinePeriodo).toBe(true);

    const budgetNullo = await repo.accodaComando({
      tipo: "imposta_abbonamento",
      tenantId: tenant.id,
      payload: { azione: "budget_tars", slug: "acme", eur: null },
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(budgetNullo.id))?.stato).toBe("eseguito");
    expect(repo.abbonamentoDi(tenant.id)?.budgetTarsNanoMese).toBeNull();
  });

  it("creaProva fallita una volta: il comando crea finisce in errore col tenant senza abbonamento; lo stesso slug riparato al rilancio (Task 3 fix round 1, Ruling R8)", async () => {
    const repo = getTenantRepository();
    // Semina il tenant 1 PRIMA: come già annotato più sopra in questo file,
    // altrimenti "acme" prenderebbe proprio quell'id in un repo azzerato.
    await repo.assicuraTenantPredefinito();
    vi.spyOn(repo, "salvaAbbonamento").mockRejectedValueOnce(new Error("guasto"));

    const primo = await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload: inputAcme(),
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 0, falliti: 1 });
    expect((await repo.comando(primo.id))?.stato).toBe("errore");
    const tenant = repo.perSlug("acme");
    // La riga tenant resta (nasce PRIMA di `creaProva`): solo l'abbonamento
    // manca, perché `salvaAbbonamento` è fallito proprio lì dentro.
    expect(tenant).not.toBeNull();
    expect(repo.abbonamentoDi(tenant!.id)).toBeNull();
    expect((await repo.eventi(tenant!.id)).map(e => e.tipo)).toEqual(["creato", "comando_fallito"]);
    // Il fallimento è avvenuto PRIMA della transazione di sede/utente: questo
    // primo giro non ne ha creata nessuna.
    expect(sedi.some(s => s.tenantId === tenant!.id)).toBe(false);
    expect(utenti.some((u: any) => u.tenantId === tenant!.id)).toBe(false);

    // Rilancio dello stesso comando (stesso slug): `crea` è idempotente per
    // slug, `creaProva` non è più fallita (la mock era "once") e ripara
    // l'abbonamento mancante senza duplicare né la riga tenant né sede/utente.
    const secondo = await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload: inputAcme(),
      richiestoDa: "script:tenant@test",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(secondo.id))?.stato).toBe("eseguito");
    expect(repo.perSlug("acme")?.id).toBe(tenant!.id);
    expect(repo.abbonamentoDi(tenant!.id)?.stato).toBe("trialing");
    expect(sedi.filter(s => s.tenantId === tenant!.id).length).toBe(1);
    expect(utenti.filter((u: any) => u.tenantId === tenant!.id).length).toBe(1);
  });
});

// WS6 (pannello piattaforma, spec §4.3): `eseguiComando` ricava l'attore da
// `richiestoDa`. Un comando accodato dal pannello porta `piattaforma:<email>`
// e produce eventi con quell'attore, non uno script.
describe("eseguiComandiInAttesa: attore piattaforma (WS6)", () => {
  it("richiestoDa piattaforma:<email> produce eventi con l'attore piattaforma; uno script resta script:<nome>", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const { tenant } = await crea(inputAcme(), script);

    const daPiattaforma = await repo.accodaComando({
      tipo: "sospendi",
      tenantId: tenant.id,
      payload: { slug: tenant.slug, motivo: "prova pannello" },
      richiestoDa: "piattaforma:t@r.it",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    expect((await repo.comando(daPiattaforma.id))?.stato).toBe("eseguito");
    const eventoSospeso = (await repo.eventi(tenant.id)).findLast(e => e.tipo === "sospeso");
    expect(eventoSospeso?.attore).toBe("piattaforma:t@r.it");

    const daScript = await repo.accodaComando({
      tipo: "riattiva",
      tenantId: tenant.id,
      payload: { slug: tenant.slug, motivo: "prova script" },
      richiestoDa: "script:tenant@x",
    });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 1, falliti: 0 });
    const eventoRiattivato = (await repo.eventi(tenant.id)).findLast(e => e.tipo === "riattivato");
    expect(eventoRiattivato?.attore).toBe("script:tenant@x");
  });
});

// WS6 (pannello piattaforma, spec §5.2): il pannello accoda e vuole l'esito
// subito, non il prossimo giro dei 30 s. `eseguiComandoSubito` prende in
// carico il comando per id (`prendiEdEsegui` con `soloId`); se il giro lo ha
// già preso, aspetta che chiuda invece di rieseguirlo o di prenderne un altro.
describe("eseguiComandoSubito", () => {
  it("esegue subito il comando accodato e ne restituisce l'esito", async () => {
    process.env.FLAG_MULTI_AZIENDA = "on";
    const repo = getTenantRepository();
    await crea(inputAcme(), script);
    const c = await repo.accodaComando({
      tipo: "sospendi",
      tenantId: repo.perSlug("acme")!.id,
      payload: { slug: "acme", motivo: "prova pannello" },
      richiestoDa: "piattaforma:t@r.it",
    });
    const esito = await eseguiComandoSubito(c.id);
    expect(esito.stato).toBe("eseguito");
    expect(repo.perSlug("acme")?.stato).toBe("sospeso");
  });

  it("se il giro lo ha già chiuso, restituisce la riga chiusa senza rieseguire", async () => {
    process.env.FLAG_MULTI_AZIENDA = "on";
    const repo = getTenantRepository();
    await crea(inputAcme(), script);
    const c = await repo.accodaComando({
      tipo: "riattiva",
      tenantId: repo.perSlug("acme")!.id,
      payload: { slug: "acme", motivo: "già attiva" },
      richiestoDa: "piattaforma:t@r.it",
    });
    await eseguiComandiInAttesa(); // il giro lo consuma prima
    const esito = await eseguiComandoSubito(c.id, { attesaMs: 100, passoMs: 10 });
    expect(esito.id).toBe(c.id);
    expect(["eseguito", "errore"]).toContain(esito.stato);
  });

  // Il repository in memoria non aveva un claim: `c.stato` restava
  // "in_attesa" per tutta la durata di `esegui()`, quindi un secondo
  // `prendiEdEsegui` (qui, l'`eseguiComandoSubito` del pannello mentre il
  // giro dei 30 s ha già preso in carico lo stesso comando) poteva
  // prendere e rieseguire lo stesso comando invece di aspettare (fix round
  // 1: `inEsecuzione` in `createMemoryTenantRepository`, repository.ts).
  it("aspetta davvero", async () => {
    process.env.FLAG_MULTI_AZIENDA = "on";
    vi.useRealTimers();
    const repo = getTenantRepository();
    await crea(inputAcme(), script);
    const c = await repo.accodaComando({
      tipo: "riattiva",
      tenantId: repo.perSlug("acme")!.id,
      payload: { slug: "acme", motivo: "già attiva" },
      richiestoDa: "piattaforma:t@r.it",
    });

    // Simula il giro dei 30s che ha già preso in carico il comando: lo
    // tiene "in esecuzione" finché non si chiama `sblocca()`.
    let sblocca!: () => void;
    const attesa = new Promise<void>(r => (sblocca = r));
    let contatore = 0;
    const presa = repo.prendiEdEsegui(async () => {
      contatore++;
      await attesa;
      return { ok: true };
    });

    const risultato = eseguiComandoSubito(c.id, { passoMs: 5, attesaMs: 2000 });

    // Qualche giro di polling dopo, il comando è ancora in mano al claim
    // esterno: `eseguiComandoSubito` non l'ha rieseguito né lo ha
    // "rubato".
    await new Promise(r => setTimeout(r, 30));
    expect((await repo.comando(c.id))?.stato).toBe("in_attesa");

    sblocca();
    await presa;
    const esito = await risultato;

    expect(esito.stato).toBe("eseguito");
    expect(esito.esito).toMatchObject({ ok: true });
    expect(contatore).toBe(1);
  });

  it("allo scadere restituisce la riga ancora in attesa", async () => {
    process.env.FLAG_MULTI_AZIENDA = "on";
    vi.useRealTimers();
    const repo = getTenantRepository();
    await crea(inputAcme(), script);
    const c = await repo.accodaComando({
      tipo: "riattiva",
      tenantId: repo.perSlug("acme")!.id,
      payload: { slug: "acme", motivo: "già attiva" },
      richiestoDa: "piattaforma:t@r.it",
    });

    let sblocca!: () => void;
    const attesa = new Promise<void>(r => (sblocca = r));
    const presa = repo.prendiEdEsegui(async () => {
      await attesa;
      return { ok: true };
    });

    // Mai sbloccato entro `attesaMs`: il polling scade e restituisce la
    // riga così com'è, ancora "in_attesa".
    const esito = await eseguiComandoSubito(c.id, { passoMs: 5, attesaMs: 40 });
    expect(esito.stato).toBe("in_attesa");

    sblocca(); // pulizia: non deve restare un claim appeso al comando
    await presa;
  });

  it("a interruttore spento non esegue e lo dice", async () => {
    // Esplicito: senza questo, in ambiente di test l'interruttore è acceso
    // di default (fail-closed solo fuori da development/test — v.
    // `interruttoreAttivo`), come nell'analoga prova di `eseguiComandiInAttesa`.
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    const c = await repo.accodaComando({
      tipo: "ricalcola_storage",
      tenantId: 1,
      payload: { slug: "ruffino-group" },
      richiestoDa: "piattaforma:t@r.it",
    });
    await expect(eseguiComandoSubito(c.id)).rejects.toThrow(/FLAG_MULTI_AZIENDA/);
  });
});
