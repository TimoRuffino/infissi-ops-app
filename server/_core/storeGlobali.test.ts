// server/_core/storeGlobali.test.ts
// Guardia STRUTTURALE (Task 5, spec §3.1): le sole sette famiglie dichiarate
// `{ ambito: "globale" }` — nessuna di più, nessuna di meno. Sul modello di
// server/_core/idGlobali.test.ts e server/tenants/confine.test.ts: legge i
// sorgenti e fallisce se qualcuno aggiunge o toglie una dichiarazione senza
// aggiornare questa lista.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo } from "./sorgentiDiProva";

const ATTESI = [
  "backup_config",
  "backup_log",
  "backup_oauth",
  "platform_feature_flag_audit",
  "platform_feature_flags",
  "sedi",
  "utenti",
];

// L'argomento `{ ambito: "globale" }` è sempre il TERZO di `persistedStore`,
// quindi arriva DOPO l'intera callback onLoad — per quanto lunga. Tre delle
// sette dichiarazioni hanno un onLoad che supera abbondantemente i 400
// caratteri (il backfill di server/routers/sedi.ts, la migrazione password/
// sediIds/tenantId di server/routers/utenti.ts — oltre 1500 caratteri — e il
// giro sui DEFAULT_FLAGS di server/platform/featureFlags.ts): la finestra
// deve coprire la più lunga delle sette, con margine.
//
// server/_core/persistence.ts è escluso di proposito: DEFINISCE
// `persistedStore`, non dichiara mai uno store. Il suo commento di
// intestazione mostra `persistedStore<MyType>("clienti")` come esempio, e
// poche righe dopo — in un'altra frase dello stesso commento — cita
// `{ ambito: "globale" }` (a ~420 caratteri di distanza). Con una finestra
// larga abbastanza da raggiungere la migrazione di utenti.ts, quel commento
// verrebbe letto come un'ottava famiglia globale inesistente.
const PERSISTENCE_TS = "server/_core/persistence.ts";

describe("store globali", () => {
  it("esattamente sette store dichiarano ambito globale", () => {
    const trovati: string[] = [];
    for (const f of fileSorgente(["server"]).filter(
      f => !/\.test\.ts$/.test(f) && relativo(f) !== PERSISTENCE_TS
    )) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(
        /persistedStore(?:<[^>]*>)?\(\s*"([a-z_]+)"[\s\S]{0,2000}?\{\s*ambito:\s*"globale"\s*\}/g
      )) {
        trovati.push(m[1]);
      }
    }
    expect(trovati.sort()).toEqual(ATTESI);
  });
});
