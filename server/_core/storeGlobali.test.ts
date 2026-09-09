// server/_core/storeGlobali.test.ts
// Guardia STRUTTURALE (Task 5, spec §3.1): le sole quattro famiglie dichiarate
// `{ ambito: "globale" }` — nessuna di più, nessuna di meno. Erano sette fino
// al WS3: i tre store del backup (`backup_config`, `backup_log`,
// `backup_oauth`) sono passati per azienda, perché ogni azienda fa il backup
// sul PROPRIO Drive. Sul modello di
// server/_core/idGlobali.test.ts e server/tenants/confine.test.ts: legge i
// sorgenti e fallisce se qualcuno aggiunge o toglie una dichiarazione senza
// aggiornare questa lista. L'elenco delle dichiarazioni viene da
// `dichiarazioniPersistedStore` (sorgentiDiProva.ts), condiviso con
// server/tenants/verifica.confine.test.ts (R18): una sola lettura dei
// sorgenti da tenere giusta, e l'ambito è attribuito alla chiamata a cui
// appartiene per quanto lunga sia la sua callback onLoad (il backfill di
// utenti.ts supera i 1500 caratteri).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dichiarazioniPersistedStore, sorgentiDegliStore } from "./sorgentiDiProva";

const ATTESI = [
  "platform_feature_flag_audit",
  "platform_feature_flags",
  "sedi",
  "utenti",
];

describe("store globali", () => {
  it("esattamente quattro store dichiarano ambito globale (nomi)", () => {
    const { dichiarazioni } = dichiarazioniPersistedStore();
    const trovati = dichiarazioni.filter(d => d.ambito === "globale").map(d => d.nome);
    expect(trovati.sort()).toEqual(ATTESI);
  });

  it("il conteggio grezzo delle dichiarazioni globali non dipende dalla lettura delle chiamate", () => {
    // Indipendente da `dichiarazioniPersistedStore`: conta ogni occorrenza del
    // letterale `{ ambito: "globale" }` nei file. Un'occorrenza che la lettura
    // non attribuisce a una chiamata (nome non letterale, argomenti in un
    // ordine strano) fa divergere i due numeri.
    let conteggio = 0;
    for (const f of sorgentiDegliStore()) {
      conteggio += [...readFileSync(f, "utf8").matchAll(/\{\s*ambito:\s*"globale"\s*\}/g)].length;
    }
    expect(conteggio).toBe(ATTESI.length);
  });
});
