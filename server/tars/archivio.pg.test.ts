// Contratto archivio su PostgreSQL reale. Richiede un DATABASE_URL verso un
// database di test; senza, Vitest dichiara esplicitamente la suite skipped.
//
// Esempio locale:
//   docker run -d --name tars-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=tars_test -p 55432:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test \
//     pnpm test -- server/tars/archivio.pg.test.ts

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import {
  aggiungiTurno,
  conversazioneDiUtente,
  creaConversazione,
  ensureTarsSchema,
  impostaConversazioneArchiviata,
  impostaConversazioneFissata,
  listaConversazioni,
  rinominaConversazione,
  turniDiConversazione,
} from "./archivio";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);
const SEDE = 77_109_901;
const ALTRA_SEDE = 77_109_902;
const UTENTE = 77_109_911;
const ALTRO_UTENTE = 77_109_912;

async function pulisciDatiTest(): Promise<void> {
  if (!kvSql) return;
  await kvSql`DELETE FROM tars_turni WHERE sede_id IN (${SEDE}, ${ALTRA_SEDE})`;
  await kvSql`DELETE FROM tars_conversazioni WHERE sede_id IN (${SEDE}, ${ALTRA_SEDE})`;
}

describe.skipIf(!conDatabase)(
  "archivio Tars PostgreSQL — contratto conversazioni",
  { timeout: 60_000 },
  () => {
    beforeAll(async () => {
      // Simula un deploy su installazione preesistente: la tabella base non
      // contiene ancora i campi di gestione; ensureTarsSchema deve aggiungerli.
      await kvSql!`
        CREATE TABLE IF NOT EXISTS tars_conversazioni (
          id BIGSERIAL PRIMARY KEY,
          sede_id INTEGER NOT NULL,
          utente_id INTEGER NOT NULL,
          titolo TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await ensureTarsSchema();
    });

    afterEach(pulisciDatiTest);
    afterAll(pulisciDatiTest);

    it("applica DDL additivo e CTE owner+sede senza turni parziali", async () => {
      const colonne = await kvSql!`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tars_conversazioni'`;
      expect(colonne.map((r: any) => r.column_name)).toEqual(
        expect.arrayContaining(["fissata", "archiviata_at"])
      );

      const conversazione = await creaConversazione({
        sedeId: SEDE,
        utenteId: UTENTE,
        titolo: "Owner SQL",
      });
      await expect(
        aggiungiTurno({
          conversazioneId: conversazione.id,
          sedeId: SEDE,
          utenteId: ALTRO_UTENTE,
          ruolo: "utente",
          contenuto: "Non scrivere",
        })
      ).rejects.toThrow("NOT_FOUND");
      await expect(turniDiConversazione(conversazione.id, SEDE)).resolves.toEqual([]);
      await expect(
        aggiungiTurno({
          conversazioneId: conversazione.id,
          sedeId: ALTRA_SEDE,
          utenteId: UTENTE,
          ruolo: "utente",
          contenuto: "Non scrivere da altra sede",
        })
      ).rejects.toThrow("NOT_FOUND");
      await expect(rinominaConversazione({
        conversazioneId: conversazione.id,
        sedeId: ALTRA_SEDE,
        utenteId: UTENTE,
        titolo: "Non rinominare da altra sede",
      })).resolves.toEqual({ stato: "non_trovato" });

      await aggiungiTurno({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        ruolo: "utente",
        contenuto: "Turno proprietario",
      });
      await expect(turniDiConversazione(conversazione.id, SEDE)).resolves.toHaveLength(1);
    });

    it("cerca letteralmente %, underscore e backslash, deriva preview e ordina tutte le conversazioni", async () => {
      const percentuale = await creaConversazione({
        sedeId: SEDE,
        utenteId: UTENTE,
        titolo: "Offerta 100%",
      });
      const underscore = await creaConversazione({
        sedeId: SEDE,
        utenteId: UTENTE,
        titolo: "Codice_A",
      });
      const backslash = await creaConversazione({
        sedeId: SEDE,
        utenteId: UTENTE,
        titolo: "Cartella\\infissi",
      });
      await aggiungiTurno({
        conversazioneId: percentuale.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        ruolo: "tars",
        contenuto: "Preview %",
      });
      await impostaConversazioneFissata({
        conversazioneId: percentuale.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        fissata: true,
      });
      // Date deliberate: la fissata è più vecchia, poi una recente e una
      // non fissata meno recente. L'ordine non dipende dalla granularità now().
      await kvSql!`UPDATE tars_conversazioni
        SET updated_at = NOW() - INTERVAL '3 hours' WHERE id = ${percentuale.id}`;
      await kvSql!`UPDATE tars_conversazioni
        SET updated_at = NOW() WHERE id = ${underscore.id}`;
      await kvSql!`UPDATE tars_conversazioni
        SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = ${backslash.id}`;

      const perPercentuale = await listaConversazioni(SEDE, UTENTE, { ricerca: "%" });
      const perUnderscore = await listaConversazioni(SEDE, UTENTE, { ricerca: "_" });
      const perBackslash = await listaConversazioni(SEDE, UTENTE, { ricerca: "\\" });
      const complete = await listaConversazioni(SEDE, UTENTE);
      expect(perPercentuale.map(c => c.id)).toEqual([percentuale.id]);
      expect(perPercentuale[0].anteprima).toBe("Preview %");
      expect(perUnderscore.map(c => c.id)).toEqual([underscore.id]);
      expect(perBackslash.map(c => c.id)).toEqual([backslash.id]);
      expect(complete.map(c => c.id)).toEqual([
        percentuale.id,
        underscore.id,
        backslash.id,
      ]);
    });

    it("rende l'archivio sola lettura nel percorso SQL fino al ripristino", async () => {
      const conversazione = await creaConversazione({
        sedeId: SEDE,
        utenteId: UTENTE,
        titolo: "Archivio SQL",
      });
      await impostaConversazioneFissata({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        fissata: true,
      });
      await impostaConversazioneArchiviata({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        archiviata: true,
      });
      const updatedAt = (await conversazioneDiUtente(
        conversazione.id,
        SEDE,
        UTENTE
      ))!.updatedAt.getTime();

      await expect(rinominaConversazione({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        titolo: "Non cambiare",
      })).resolves.toEqual({ stato: "archiviata" });
      await expect(impostaConversazioneFissata({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        fissata: true,
      })).resolves.toEqual({ stato: "archiviata" });
      await expect(impostaConversazioneArchiviata({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        archiviata: true,
      })).resolves.toEqual({ stato: "archiviata" });

      await expect(conversazioneDiUtente(conversazione.id, SEDE, UTENTE))
        .resolves.toMatchObject({
          titolo: "Archivio SQL",
          fissata: false,
          updatedAt: new Date(updatedAt),
        });
      await expect(impostaConversazioneArchiviata({
        conversazioneId: conversazione.id,
        sedeId: SEDE,
        utenteId: UTENTE,
        archiviata: false,
      })).resolves.toMatchObject({
        stato: "aggiornata",
        conversazione: { archiviataAt: null },
      });
    });
  }
);
