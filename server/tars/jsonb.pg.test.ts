// Contratto jsonb su PostgreSQL reale: le colonne jsonb di Tars si scrivono
// come VERI array/oggetti (mai la doppia codifica `JSON.stringify(...)::jsonb`
// di postgres-js, v. server/chat/store.ts) e le righe storiche doppio-
// codificate vengono riparate dalle migrazioni in ensureSchema.
//
// Richiede un DATABASE_URL di test; senza, la suite è dichiarata skipped.
//   docker run -d --name tars-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=tars_test -p 55432:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test \
//     pnpm test -- server/tars/jsonb.pg.test.ts
//
// NB: seminare le righe corrotte PRIMA della prima chiamata alle funzioni
// (ensureSchema gira una volta per processo e ripara al primo uso).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import {
  aggiungiTurno,
  creaConversazione,
  registraRun,
  salvaContestoConversazioneInArchivio,
  turniDiConversazione,
} from "./archivio";
import { contestoConversazioneVuoto } from "./conversazione/types";
import { repositoryOsservazioniCorrente } from "./proattivita/repository";
import type { NuovaOsservazione } from "./proattivita/types";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);
const SEDE = 77_209_901;
const UTENTE = 77_209_911;

const NUOVA: NuovaOsservazione = {
  sedeId: SEDE,
  casoKey: "commessa:900001",
  detector: "ticket",
  detectorVersione: "v1",
  fingerprint: "fp-nuovo",
  commessaId: 900001,
  targetType: "commessa",
  targetId: 900001,
  titolo: "Osservazione di contratto",
  sintesi: "Solo test",
  priorita: "alta",
  materialita: "media",
  confidenza: "media",
};

async function pulisci(): Promise<void> {
  if (!kvSql) return;
  // Le tabelle dell'archivio nascono solo al primo ensureTarsSchema: su un
  // database appena creato la pulizia deve saltare quelle assenti.
  for (const tabella of [
    "tars_turni",
    "tars_run",
    "tars_conversazioni",
    "tars_osservazioni",
  ]) {
    const [{ esiste }] = await kvSql`
      SELECT to_regclass(${tabella})::text IS NOT NULL AS esiste`;
    if (!esiste) continue;
    await kvSql`DELETE FROM ${kvSql(tabella)} WHERE sede_id = ${SEDE}`;
  }
}

describe.skipIf(!conDatabase)(
  "jsonb Tars su PostgreSQL — niente doppia codifica, migrazione delle righe storiche",
  { timeout: 60_000 },
  () => {
    beforeAll(async () => {
      // Semina lo scenario di produzione pre-fix PRIMA che ensureSchema
      // giri: righe con jsonb STRING (doppia codifica) e uno storico misto
      // [stringa, evento] come lo lasciava l'append SQL.
      await kvSql!`CREATE TABLE IF NOT EXISTS tars_osservazioni (
        id SERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        caso_key TEXT NOT NULL,
        detector TEXT NOT NULL,
        detector_versione TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        commessa_id INTEGER NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        titolo TEXT NOT NULL,
        sintesi TEXT NOT NULL,
        priorita TEXT NOT NULL,
        materialita TEXT NOT NULL,
        confidenza TEXT NOT NULL,
        stato TEXT NOT NULL,
        cooldown_fino_a TIMESTAMPTZ NULL,
        storico JSONB NOT NULL DEFAULT '[]'::jsonb,
        aperta_at TIMESTAMPTZ NOT NULL,
        aggiornata_at TIMESTAMPTZ NOT NULL,
        risolta_at TIMESTAMPTZ NULL,
        UNIQUE (sede_id, caso_key, detector, detector_versione)
      )`;
      await pulisci();
      const eventoAperta = JSON.stringify([
        { tipo: "aperta", fingerprint: "fp-vecchio", at: "2026-09-01T01:53:38.616Z" },
      ]);
      // Riga 1: storico = stringa jsonb pura (doppia codifica).
      await kvSql!`INSERT INTO tars_osservazioni (
          sede_id, caso_key, detector, detector_versione, fingerprint,
          commessa_id, target_type, target_id, titolo, sintesi, priorita,
          materialita, confidenza, stato, storico, aperta_at, aggiornata_at
        ) VALUES (
          ${SEDE}, ${"commessa:900001"}, ${"ticket"}, ${"v1"}, ${"fp-vecchio"},
          ${900001}, ${"commessa"}, ${900001}, ${"Titolo"}, ${"Sintesi"},
          ${"alta"}, ${"media"}, ${"media"}, ${"aperta"},
          to_jsonb(${eventoAperta}::text), now(), now()
        )`;
      // Riga 2: storico = array MISTO [stringa, evento] (append su stringa).
      await kvSql!`INSERT INTO tars_osservazioni (
          sede_id, caso_key, detector, detector_versione, fingerprint,
          commessa_id, target_type, target_id, titolo, sintesi, priorita,
          materialita, confidenza, stato, storico, aperta_at, aggiornata_at
        ) VALUES (
          ${SEDE}, ${"commessa:900002"}, ${"ticket"}, ${"v1"}, ${"fp-misto"},
          ${900002}, ${"commessa"}, ${900002}, ${"Titolo"}, ${"Sintesi"},
          ${"alta"}, ${"media"}, ${"media"}, ${"aperta"},
          jsonb_build_array(
            to_jsonb(${eventoAperta}::text),
            jsonb_build_object('tipo', 'auto_risolta', 'fingerprint', 'fp-misto', 'at', '2026-09-01T08:00:00.000Z')
          ), now(), now()
        )`;
    });

    afterAll(pulisci);

    it("ensureSchema ripara le righe doppio-codificate e l'upsert su di esse non esplode più", async () => {
      const repository = repositoryOsservazioniCorrente();
      // Primo contatto: fa girare la migrazione.
      await repository.ensureSchema();
      const tipi = await kvSql!`SELECT jsonb_typeof(storico) AS t, count(*) AS c
        FROM tars_osservazioni WHERE sede_id = ${SEDE} GROUP BY 1`;
      expect(tipi).toHaveLength(1);
      expect(tipi[0].t).toBe("array");
      // La riga mista è tornata soli-eventi.
      const [mista] = await kvSql!`SELECT storico FROM tars_osservazioni
        WHERE sede_id = ${SEDE} AND caso_key = ${"commessa:900002"}`;
      for (const evento of mista.storico as any[]) {
        expect(typeof evento).toBe("object");
        expect(Number.isNaN(new Date(evento.at).getTime())).toBe(false);
      }
      // L'upsert che in produzione lanciava «Invalid time value» ora passa
      // e appende un evento leggibile.
      const esito = await repository.upsert(NUOVA, new Date());
      expect(esito.esito).toBe("aggiornata");
      expect(
        esito.record.storico.every(e => !Number.isNaN(e.at.getTime()))
      ).toBe(true);
      const [riga] = await kvSql!`SELECT jsonb_typeof(storico) AS t
        FROM tars_osservazioni WHERE sede_id = ${SEDE} AND caso_key = ${NUOVA.casoKey}`;
      expect(riga.t).toBe("array");
    });

    it("risolviAssenti appende un VERO oggetto evento, non una stringa", async () => {
      const repository = repositoryOsservazioniCorrente();
      const risolte = await repository.risolviAssenti({
        sedeId: SEDE,
        casiVivi: new Map(),
        now: new Date(),
      });
      expect(risolte).toBeGreaterThan(0);
      const righe = await kvSql!`SELECT storico FROM tars_osservazioni
        WHERE sede_id = ${SEDE} AND stato = 'auto_risolta'`;
      expect(righe.length).toBeGreaterThan(0);
      for (const r of righe) {
        const ultimo = (r.storico as any[]).at(-1);
        expect(typeof ultimo).toBe("object");
        expect(ultimo.tipo).toBe("auto_risolta");
      }
    });

    it("payload turno, contesto conversazione e telemetria run si scrivono come veri jsonb", async () => {
      const conversazione = await creaConversazione({
        sedeId: SEDE,
        utenteId: UTENTE,
        titolo: "Contratto jsonb",
      });
      await aggiungiTurno({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        ruolo: "tars",
        contenuto: "risposta",
        payload: { degradato: true, runId: "run-jsonb" },
      });
      const { versione, ...contesto } = {
        ...contestoConversazioneVuoto(),
        commessaId: 900001,
      };
      void versione;
      await salvaContestoConversazioneInArchivio({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        versioneAttesa: 0,
        contesto,
      });
      await registraRun({
        sedeId: SEDE,
        utenteId: UTENTE,
        conversazioneId: conversazione.id,
        stato: "ok",
        provider: "finto",
        modello: "gpt-5.6-sol",
        versioni: { prompt: "v8" },
        contatori: { c1Hit: 1 },
        errore: null,
      });

      const [turno] = await kvSql!`SELECT jsonb_typeof(payload) AS t
        FROM tars_turni WHERE sede_id = ${SEDE}`;
      expect(turno.t).toBe("object");
      const [conv] = await kvSql!`SELECT jsonb_typeof(contesto) AS t
        FROM tars_conversazioni WHERE id = ${conversazione.id}`;
      expect(conv.t).toBe("object");
      const [run] = await kvSql!`SELECT jsonb_typeof(versioni) AS v, jsonb_typeof(contatori) AS c
        FROM tars_run WHERE sede_id = ${SEDE}`;
      expect(run.v).toBe("object");
      expect(run.c).toBe("object");

      // E la rilettura applicativa vede il payload come oggetto.
      const turni = await turniDiConversazione(conversazione.id, SEDE);
      const doTars = turni.find(t => t.ruolo === "tars");
      expect((doTars?.payload as any)?.degradato).toBe(true);
    });
  }
);
