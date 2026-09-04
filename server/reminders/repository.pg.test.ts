// Contratto su PostgreSQL reale del repository dei promemoria: la seconda
// creazione con la stessa chiave canonica e senza proposta d'origine deve
// restituire il promemoria esistente, non un errore. In produzione
// (04/09/2026) ogni giro del follow-up preventivi moriva sul primo
// sollecito già creato con «could not determine data type of parameter $3»
// (42P18): il parametro nullo in `$n IS NOT NULL` non ha tipo senza cast.
//
// Richiede un DATABASE_URL di test; senza, la suite è dichiarata skipped.
//   docker run -d --name tars-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=tars_test -p 55432:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test \
//     pnpm test -- server/reminders/repository.pg.test.ts

import { afterAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { createPostgresReminderRepository } from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);
const SEDE = 77_309_901;

describe.skipIf(!conDatabase)("promemoria su PostgreSQL", () => {
  afterAll(async () => {
    if (!kvSql) return;
    await kvSql`DELETE FROM promemoria_eventi WHERE sede_id = ${SEDE}`;
    await kvSql`DELETE FROM promemoria WHERE sede_id = ${SEDE}`;
  });

  it("la stessa chiave canonica senza proposta d'origine restituisce l'esistente (niente 42P18)", async () => {
    const repository = createPostgresReminderRepository(kvSql!);
    const now = new Date();
    const base = {
      sedeId: SEDE,
      recipientUserId: 1,
      createdByUserId: 1,
      sourceProposalId: null,
      canonicalKey: `tars:sollecito-preventivo:test:${now.getTime()}`,
      text: "Sollecito di prova",
      remindAt: new Date(now.getTime() + 120_000),
      timezone: "Europe/Rome" as const,
      clienteId: null,
      commessaId: null,
      now,
    };
    const primo = await repository.create(base);
    expect(primo.created).toBe(true);
    const secondo = await repository.create({ ...base, text: "Sollecito ripetuto" });
    expect(secondo.created).toBe(false);
    expect(secondo.record.id).toBe(primo.record.id);
    expect(secondo.record.text).toBe("Sollecito di prova");
  });
});
