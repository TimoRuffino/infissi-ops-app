import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import {
  aggiungiTurno,
  azzeraArchivioPerTest,
  creaConversazione,
  impostaConversazioneArchiviata,
  impostaConversazioneFissata,
  listaConversazioni,
  rinominaConversazione,
  turniDiConversazione,
} from "./archivio";

const SEDE = 77101;
const ALTRA_SEDE = 77102;
const UTENTE = 77111;
const ALTRO_UTENTE = 77112;

beforeEach(() => {
  azzeraArchivioPerTest();
});

function caller(utenteId = UTENTE, sedeId = SEDE) {
  return appRouter.createCaller({
    user: {
      id: utenteId,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: `Utente ${utenteId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  } satisfies TrpcContext);
}

describe("archivio conversazioni Tars", () => {
  it("crea metadati di gestione e deriva l'anteprima dall'ultimo turno", async () => {
    const conversazione = await creaConversazione({
      sedeId: SEDE,
      utenteId: UTENTE,
      titolo: "Preventivo villa",
    });
    expect(conversazione.fissata).toBe(false);
    expect(conversazione.archiviataAt).toBeNull();
    expect(conversazione.anteprima).toBeNull();

    await aggiungiTurno({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      ruolo: "utente",
      contenuto: "Primo messaggio",
    });
    await aggiungiTurno({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      ruolo: "tars",
      contenuto: "Ultima risposta visibile",
    });

    await expect(
      listaConversazioni(SEDE, UTENTE, { ricerca: "VILLA" })
    ).resolves.toMatchObject([
      {
        id: conversazione.id,
        anteprima: "Ultima risposta visibile",
        fissata: false,
        archiviataAt: null,
      },
    ]);
  });

  it("ordina le fissate e poi le recenti, cerca anche nell'anteprima e limita il risultato", async () => {
    const recente = await creaConversazione({
      sedeId: SEDE,
      utenteId: UTENTE,
      titolo: "Recentissima",
    });
    const fissata = await creaConversazione({
      sedeId: SEDE,
      utenteId: UTENTE,
      titolo: "Da fissare",
    });
    await aggiungiTurno({
      conversazioneId: fissata.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      ruolo: "tars",
      contenuto: "Dettaglio serramento",
    });
    await impostaConversazioneFissata({
      conversazioneId: fissata.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      fissata: true,
    });

    const ordinate = await listaConversazioni(SEDE, UTENTE, { limite: 1 });
    expect(ordinate.map(c => c.id)).toEqual([fissata.id]);
    await expect(
      listaConversazioni(SEDE, UTENTE, { ricerca: "SERRAMENTO" })
    ).resolves.toMatchObject([{ id: fissata.id }]);
    expect(recente.id).not.toBe(fissata.id);
  });

  it("archivia senza cancellare, esclude di default e ripristina", async () => {
    const conversazione = await creaConversazione({
      sedeId: SEDE,
      utenteId: UTENTE,
      titolo: "Recuperabile",
    });
    await impostaConversazioneFissata({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      fissata: true,
    });
    const archiviata = await impostaConversazioneArchiviata({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      archiviata: true,
    });
    expect(archiviata).toMatchObject({
      stato: "aggiornata",
      conversazione: { fissata: false, archiviataAt: expect.any(Date) },
    });
    await expect(listaConversazioni(SEDE, UTENTE)).resolves.toEqual([]);
    await expect(
      listaConversazioni(SEDE, UTENTE, { archiviate: true })
    ).resolves.toMatchObject([{ id: conversazione.id }]);

    await impostaConversazioneArchiviata({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: UTENTE,
      archiviata: false,
    });
    await expect(listaConversazioni(SEDE, UTENTE)).resolves.toMatchObject([
      { id: conversazione.id, archiviataAt: null },
    ]);
  });

  it("non modifica né aggiorna una conversazione di altra sede o proprietario", async () => {
    const conversazione = await creaConversazione({
      sedeId: SEDE,
      utenteId: UTENTE,
      titolo: "Privata",
    });
    await expect(
      rinominaConversazione({
        conversazioneId: conversazione.id,
        sedeId: ALTRA_SEDE,
        utenteId: UTENTE,
        titolo: "Tentativo sede",
      })
    ).resolves.toEqual({ stato: "non_trovato" });
    await expect(
      impostaConversazioneFissata({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: ALTRO_UTENTE,
        fissata: true,
      })
    ).resolves.toEqual({ stato: "non_trovato" });
    await expect(
      aggiungiTurno({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: ALTRO_UTENTE,
        ruolo: "utente",
        contenuto: "Intrusione",
      })
    ).rejects.toThrow("NOT_FOUND");
    await expect(turniDiConversazione(conversazione.id, SEDE)).resolves.toEqual([]);
    await expect(listaConversazioni(SEDE, UTENTE)).resolves.toMatchObject([
      { id: conversazione.id, titolo: "Privata", fissata: false },
    ]);
  });
});

describe("router conversazioni Tars", () => {
  it("valida ricerca e limite e non rivela una rinomina cross-owner", async () => {
    const conversazione = await creaConversazione({
      sedeId: SEDE,
      utenteId: UTENTE,
      titolo: "Solo mia",
    });
    await expect(
      caller().tars.conversazioni({ ricerca: "x".repeat(101) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().tars.conversazioni({ limite: 101 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller(ALTRO_UTENTE).tars.rinominaConversazione({
        conversazioneId: conversazione.id,
        titolo: "Tentativo",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("archivia, ripristina e invalida semanticamente tramite endpoint", async () => {
    const conversazione = await creaConversazione({
      sedeId: SEDE,
      utenteId: UTENTE,
      titolo: "Da gestire",
    });
    const api = caller();
    await expect(
      api.tars.fissaConversazione({
        conversazioneId: conversazione.id,
        fissata: true,
      })
    ).resolves.toMatchObject({ fissata: true });
    await expect(
      api.tars.archiviaConversazione({
        conversazioneId: conversazione.id,
        archiviata: true,
      })
    ).resolves.toMatchObject({ archiviataAt: expect.any(Date), fissata: false });
    await expect(
      api.tars.archiviaConversazione({
        conversazioneId: conversazione.id,
        archiviata: false,
      })
    ).resolves.toMatchObject({ archiviataAt: null });
  });
});
