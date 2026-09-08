// Budget Tars PER AZIENDA sul ledger autorevole (WS4, spec §7), su
// PostgreSQL vero — l'unico posto dove si può provare che la somma del mese
// per azienda e la scrittura di `tenant_id` funzionino davvero:
//
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm vitest run server/tars/costi/ledger.pg.test.ts --no-file-parallelism
//
// Senza `DATABASE_URL` la suite è saltata (come `pgConcorrenza.test.ts`, che
// prova l'atomicità sulla stessa tabella con altre righe).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../../_core/persistence";
import { creaLedgerPostgres, ensureCostiSchema, type LimitiNano } from "./ledger";
import { usdInNano } from "./tariffe";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

/**
 * Lock di SESSIONE tutto suo: questo file cancella e riconta le PROPRIE
 * righe di `tars_costi`, e `pgConcorrenza.test.ts` conta le sue sullo stesso
 * giorno. `prenota` prende per conto suo un advisory lock di TRANSAZIONE
 * (chiave diversa): i due non si incrociano.
 */
const LOCK_COSTI_AZIENDA_PG = 20260910;

/** Prefisso dei run e id d'azienda usati SOLO qui (nessuna FK su tars_costi). */
const PREFISSO = "ws4azienda";
const TENANT_A = 90201;
const TENANT_B = 90202;
const MODELLO = "gpt-5.6-terra";

/**
 * Nessun tetto globale: le somme di giorno e mese contano anche le righe
 * degli altri test pg, e un tetto qui renderebbe le asserzioni dipendenti
 * dall'ordine dei file. Il tetto sotto prova è solo quello d'azienda.
 */
const SENZA_TETTI: LimitiNano = { runNano: null, giornoNano: null, meseNano: null };

describe.skipIf(!conDatabase)(
  "ledger PostgreSQL — budget per azienda",
  { timeout: 60_000 },
  () => {
    const sql = kvSql!;
    const ledger = creaLedgerPostgres();
    const quota = usdInNano(0.01)!;
    let riservata: Awaited<ReturnType<typeof sql.reserve>> | null = null;

    const pulisci = () => sql`DELETE FROM tars_costi WHERE run_id LIKE ${`${PREFISSO}-%`}`;

    const prenota = (
      chiamataId: string,
      tenantId: number,
      opzioni: { limiteAziendaMeseNano?: number | null; costoNano?: number } = {}
    ) =>
      ledger.prenota({
        chiamataId: `${PREFISSO}-${chiamataId}`,
        runId: `${PREFISSO}-run-${tenantId}`,
        tenantId,
        sedeId: 1,
        utenteId: 1,
        conversazioneId: null,
        modello: MODELLO,
        costoPrenotatoNano: opzioni.costoNano ?? quota,
        limiteAziendaMeseNano: opzioni.limiteAziendaMeseNano ?? null,
        limiti: SENZA_TETTI,
        adesso: new Date(),
      });

    beforeAll(async () => {
      riservata = await sql.reserve();
      await riservata`SELECT pg_advisory_lock(${LOCK_COSTI_AZIENDA_PG})`;
      await ensureCostiSchema();
      await pulisci();
    });

    afterAll(async () => {
      // Solo le righe di questo file: la tabella resta, è di tutti.
      await pulisci();
      if (riservata) {
        await riservata`SELECT pg_advisory_unlock(${LOCK_COSTI_AZIENDA_PG})`;
        riservata.release();
      }
    });

    it("l'INSERT scrive tenant_id (il trigger del WS2 resta la rete, non la fonte)", async () => {
      const esito = await prenota("insert", TENANT_A);
      expect(esito.esito).toBe("prenotata");
      if (esito.esito !== "prenotata") return;
      expect(esito.riga.tenantId).toBe(TENANT_A);

      const [riga] = await sql`SELECT tenant_id FROM tars_costi
        WHERE chiamata_id = ${`${PREFISSO}-insert`}`;
      expect(Number(riga.tenant_id)).toBe(TENANT_A);
    });

    it("la somma del mese per azienda conta solo le righe di quell'azienda", async () => {
      await prenota("b1", TENANT_B);
      await prenota("b2", TENANT_B);
      await prenota("b3", TENANT_B);

      // Quarta chiamata dell'azienda B: vede le tre precedenti (non la riga
      // dell'azienda A, né quelle degli altri test).
      const esitoB = await prenota("b4", TENANT_B);
      expect(esitoB.esito).toBe("prenotata");
      expect(esitoB.consumo?.aziendaMeseNano).toBe(3 * quota);

      // Seconda chiamata dell'azienda A: la sua sola riga, non le quattro di B.
      const esitoA = await prenota("a2", TENANT_A);
      expect(esitoA.consumo?.aziendaMeseNano).toBe(quota);
      // Il mese GLOBALE le comprende tutte: il tetto della piattaforma resta
      // globale, quello d'azienda no.
      expect(esitoA.consumo?.meseNano ?? 0).toBeGreaterThanOrEqual(5 * quota);
    });

    it("il limite d'azienda superato rifiuta con limite «azienda» e non scrive nulla", async () => {
      // L'azienda B ha già 5 righe (b1…b4 + a nulla): il limite si calcola sul
      // consumo letto adesso, così il test non dipende dall'ordine.
      const sonda = await prenota("b-sonda", TENANT_B);
      expect(sonda.esito).toBe("prenotata");
      const consumato = (sonda.consumo?.aziendaMeseNano ?? 0) + quota;

      const rifiutata = await prenota("b-oltre", TENANT_B, {
        limiteAziendaMeseNano: consumato, // consumato + quota > consumato
      });
      expect(rifiutata).toMatchObject({ esito: "rifiutata", limite: "azienda" });
      if (rifiutata.esito !== "rifiutata") return;
      expect(rifiutata.consumo.aziendaMeseNano).toBe(consumato);
      expect(rifiutata.richiestoNano).toBe(quota);

      const righe = await sql`SELECT chiamata_id FROM tars_costi
        WHERE chiamata_id = ${`${PREFISSO}-b-oltre`}`;
      expect(righe).toHaveLength(0);

      // Lo STESSO limite non tocca l'azienda A: il tetto è per azienda.
      const altraAzienda = await prenota("a-sotto", TENANT_A, {
        limiteAziendaMeseNano: consumato,
      });
      expect(altraAzienda.esito).toBe("prenotata");
    });

    it("senza limite d'azienda (null) nessuna prenotazione viene rifiutata per azienda", async () => {
      const esito = await prenota("b-senza-limite", TENANT_B, {
        limiteAziendaMeseNano: null,
      });
      expect(esito.esito).toBe("prenotata");
    });
  }
);
