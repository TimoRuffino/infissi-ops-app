// Cost hardening — prove sul ledger AUTOREVOLE (PostgreSQL reale).
//
// Si eseguono solo con `DATABASE_URL` impostata verso un database di
// PROVA (mai produzione): senza, la suite viene saltata e resta il
// ledger in memoria degli altri test. Comando usato in locale:
//
//   docker run -d --name tars-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=tars_test -p 55432:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test \
//     npx vitest run server/tars/costi/pgConcorrenza.test.ts
//
// Provano ciò che il ledger in memoria non può provare: schema
// idempotente compatibile col deploy, serializzazione cross-connessione
// (quindi cross-processo e cross-replica) e idempotenza della chiave.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { kvSql } from "../../_core/persistence";
import {
  costoContato,
  creaLedgerPostgres,
  ensureCostiSchema,
  type LimitiNano,
} from "./ledger";
import { usdInNano } from "./tariffe";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

const LIMITI: LimitiNano = {
  runNano: usdInNano(0.1)!,
  giornoNano: usdInNano(2)!,
  meseNano: usdInNano(20)!,
};

describe.skipIf(!conDatabase)(
  "ledger PostgreSQL — atomicità reale",
  { timeout: 60_000 },
  () => {
    const ledger = creaLedgerPostgres();

    beforeEach(async () => {
      await ensureCostiSchema();
      await kvSql!`DELETE FROM tars_costi WHERE run_id LIKE 'pgtest-%'`;
    });

    afterAll(async () => {
      if (kvSql) {
        await kvSql`DELETE FROM tars_costi WHERE run_id LIKE 'pgtest-%'`;
      }
    });

    it("lo schema è idempotente: ricrearlo non rompe nulla (compatibile col deploy)", async () => {
      await ensureCostiSchema();
      await ensureCostiSchema();
      const [{ esiste }] = await kvSql!`SELECT COUNT(*)::int > 0 AS esiste
        FROM information_schema.tables WHERE table_name = 'tars_costi'`;
      expect(esiste).toBe(true);
      const colonne = await kvSql!`SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tars_costi'`;
      const nomi = colonne.map((c: any) => c.column_name);
      for (const attesa of [
        "chiamata_id",
        "run_id",
        "sede_id",
        "stato",
        "costo_prenotato_nano",
        "costo_reale_nano",
        "giorno_locale",
        "mese_locale",
      ]) {
        expect(nomi).toContain(attesa);
      }
    });

    it("prenotazioni CONCORRENTI su connessioni diverse non superano il tetto", async () => {
      // 20 prenotazioni parallele da 0,01 USD contro un tetto
      // giornaliero da 0,05: ne devono passare esattamente 5.
      const adesso = new Date();
      const quota = usdInNano(0.01)!;
      const limiti: LimitiNano = {
        runNano: usdInNano(1)!,
        giornoNano: usdInNano(0.05)!,
        meseNano: usdInNano(1)!,
      };
      const esiti = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          ledger.prenota({
            chiamataId: `pgtest-conc-${i}`,
            runId: `pgtest-run-${i}`,
            sedeId: (i % 3) + 1, // sedi diverse: il tetto è globale
            utenteId: 1,
            conversazioneId: null,
            modello: "gpt-5.6-terra",
            costoPrenotatoNano: quota,
            limiti,
            adesso,
          })
        )
      );
      const prenotate = esiti.filter(e => e.esito === "prenotata").length;
      const rifiutate = esiti.filter(e => e.esito === "rifiutata").length;
      expect(prenotate).toBe(5);
      expect(rifiutate).toBe(15);

      const consumo = await ledger.consumoCorrente({
        runId: "pgtest-run-0",
        adesso,
      });
      expect(consumo.giornoNano).toBeLessThanOrEqual(limiti.giornoNano);
      expect(consumo.giornoNano).toBe(5 * quota);
    });

    it("la stessa chiave prenotata in parallelo produce UNA sola riga", async () => {
      const adesso = new Date();
      const esiti = await Promise.all(
        Array.from({ length: 8 }, () =>
          ledger.prenota({
            chiamataId: "pgtest-idem",
            runId: "pgtest-run-idem",
            sedeId: 1,
            utenteId: 1,
            conversazioneId: null,
            modello: "gpt-5.6-terra",
            costoPrenotatoNano: usdInNano(0.01)!,
            limiti: LIMITI,
            adesso,
          })
        )
      );
      expect(esiti.filter(e => e.esito === "prenotata")).toHaveLength(1);
      expect(esiti.filter(e => e.esito === "gia_presente")).toHaveLength(7);
      const [{ n }] = await kvSql!`SELECT COUNT(*)::int AS n FROM tars_costi
        WHERE chiamata_id = 'pgtest-idem'`;
      expect(n).toBe(1);
    });

    it("riconciliazione, rilascio e scadenza si comportano come in memoria", async () => {
      const adesso = new Date();
      const prenotato = usdInNano(0.03)!;
      const comune = {
        runId: "pgtest-run-stati",
        sedeId: 1,
        utenteId: 1,
        conversazioneId: null,
        modello: "gpt-5.6-terra",
        costoPrenotatoNano: prenotato,
        limiti: LIMITI,
        adesso,
      };
      await ledger.prenota({ ...comune, chiamataId: "pgtest-settled" });
      await ledger.prenota({ ...comune, chiamataId: "pgtest-released" });
      await ledger.prenota({ ...comune, chiamataId: "pgtest-uncertain" });

      await ledger.riconcilia({
        chiamataId: "pgtest-settled",
        costoRealeNano: 1_000_000,
        tokenInput: 100,
        tokenCached: 40,
        tokenOutput: 10,
      });
      await ledger.chiudi({
        chiamataId: "pgtest-released",
        stato: "released",
        motivo: "rate_limit",
      });
      await ledger.chiudi({
        chiamataId: "pgtest-uncertain",
        stato: "uncertain",
        motivo: "timeout",
      });

      const righe = await kvSql!`SELECT chiamata_id, stato, costo_prenotato_nano,
          costo_reale_nano FROM tars_costi WHERE run_id = 'pgtest-run-stati'
        ORDER BY chiamata_id`;
      const per = (id: string) =>
        righe.find((r: any) => r.chiamata_id === id) as any;
      expect(per("pgtest-settled").stato).toBe("settled");
      expect(per("pgtest-released").stato).toBe("released");
      expect(per("pgtest-uncertain").stato).toBe("uncertain");

      // Il consumo somma: reale per settled, 0 per released, PRENOTATO
      // per uncertain (conservativo).
      const consumo = await ledger.consumoCorrente({
        runId: "pgtest-run-stati",
        adesso,
      });
      expect(consumo.runNano).toBe(1_000_000 + 0 + prenotato);

      // Una prenotazione appesa diventa `expired` e RESTA contata.
      await ledger.prenota({ ...comune, chiamataId: "pgtest-appesa" });
      await kvSql!`UPDATE tars_costi SET created_at = NOW() - INTERVAL '1 hour'
        WHERE chiamata_id = 'pgtest-appesa'`;
      expect(await ledger.scadiPrenotazioniVecchie(600_000, adesso)).toBeGreaterThanOrEqual(1);
      const [appesa] = await kvSql!`SELECT stato, costo_prenotato_nano,
          costo_reale_nano FROM tars_costi WHERE chiamata_id = 'pgtest-appesa'`;
      expect(appesa.stato).toBe("expired");
      expect(
        costoContato({
          stato: "expired",
          costoPrenotatoNano: Number(appesa.costo_prenotato_nano),
          costoRealeNano:
            appesa.costo_reale_nano == null
              ? null
              : Number(appesa.costo_reale_nano),
        })
      ).toBe(prenotato);
    });

    it("il riepilogo aggrega senza esporre contenuti", async () => {
      const adesso = new Date();
      await ledger.prenota({
        chiamataId: "pgtest-riep",
        runId: "pgtest-run-riep",
        sedeId: 1,
        utenteId: 1,
        conversazioneId: null,
        modello: "gpt-5.6-terra",
        costoPrenotatoNano: usdInNano(0.02)!,
        limiti: LIMITI,
        adesso,
      });
      await ledger.riconcilia({
        chiamataId: "pgtest-riep",
        costoRealeNano: 5_000_000,
        tokenInput: 1_000,
        tokenCached: 600,
        tokenOutput: 50,
      });
      const riepilogo = await ledger.riepilogo(adesso);
      expect(riepilogo.spesaGiornoNano).toBeGreaterThanOrEqual(5_000_000);
      expect(riepilogo.tokenGiorno.cached).toBeGreaterThanOrEqual(600);
      expect(JSON.stringify(riepilogo)).not.toMatch(/prompt|messaggio|testo/i);
    });
  }
);
