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

// File sorgenti da controllare: sclude test e persistence.ts (vedi sopra)
function getFilesToCheck() {
  return fileSorgente(["server"]).filter(
    f => !/\.test\.ts$/.test(f) && relativo(f) !== PERSISTENCE_TS
  );
}

describe("store globali", () => {
  it("esattamente sette store dichiarano ambito globale (nomi)", () => {
    // Primo assertion: la regex assocía ogni nome di store alla sua dichiarazione globale,
    // finché la callback onLoad è ≤ 2000 caratteri. Un secondo assertion (sotto) conta
    // le dichiarazioni grezze, catturando eventuali store con callback più lunga.
    const trovati: string[] = [];
    for (const f of getFilesToCheck()) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(
        /persistedStore(?:<[^>]*>)?\(\s*"([a-z_]+)"[\s\S]{0,2000}?\{\s*ambito:\s*"globale"\s*\}/g
      )) {
        trovati.push(m[1]);
      }
    }
    expect(trovati.sort()).toEqual(ATTESI);
  });

  it("il conteggio grezzo delle dichiarazioni globali non dipende dalla finestra della regex", () => {
    // Secondo assertion: indipendente dalla regex di name-matching, conta ogni
    // occorrenza di `{ ambito: "globale" }` nei file. Cattura i negati per callback
    // più lunghe di 2000 caratteri che il primo test non vedrebbe.
    let conteggio = 0;
    for (const f of getFilesToCheck()) {
      const s = readFileSync(f, "utf8");
      for (const _ of s.matchAll(/\{\s*ambito:\s*"globale"\s*\}/g)) {
        conteggio++;
      }
    }
    expect(conteggio).toBe(ATTESI.length);
  });
});
