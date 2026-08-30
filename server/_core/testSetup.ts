// Guardia GLOBALE della suite: nessun test può fare una richiesta di
// rete reale (cost hardening, revisioni del 30/08/2026).
//
// Copre DUE strade, non una:
//   1. `globalThis.fetch` — l'adapter OpenAI e i client moderni;
//   2. `node:http` / `node:https` `request` — axios (usato da
//      `server/_core/sdk.ts`, importato da ogni test dei router) e ogni
//      libreria che non passa da fetch.
// Senza la seconda la promessa «nessun test raggiunge Internet» sarebbe
// più larga di ciò che il codice garantisce davvero.
//
// La sostituzione avviene al CARICAMENTO del file di setup (non in un
// hook), così un modulo che cattura `fetch` al momento dell'import trova
// già quello guardato. Localhost resta permesso: i test che simulano un
// server lo fanno in-process.

import http from "node:http";
import https from "node:https";

const HOST_AMMESSI = [/^(127\.0\.0\.1|localhost|::1)$/i];

function ammesso(host: string | undefined | null): boolean {
  if (!host) return false;
  const soloHost = String(host).split(":")[0];
  return HOST_AMMESSI.some(regola => regola.test(soloHost));
}

function vietata(destinazione: string): never {
  throw new Error(
    `RETE VIETATA NEI TEST: tentata una richiesta verso «${destinazione}». ` +
      "Nessun test deve raggiungere un servizio esterno: usa un fake o un mock esplicito."
  );
}

// ── 1. fetch ────────────────────────────────────────────────────────────
const fetchOriginale = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input?.url ?? String(input));
  try {
    const host = new URL(url).hostname;
    if (ammesso(host)) return fetchOriginale(input, init);
  } catch {
    // URL non parsabile: si blocca comunque.
  }
  vietata(url);
}) as typeof fetch;

// ── 2. http/https (axios e simili) ──────────────────────────────────────
for (const modulo of [http, https] as any[]) {
  const requestOriginale = modulo.request;
  const getOriginale = modulo.get;
  const controlla = (args: any[]): void => {
    const primo = args[0];
    const host =
      typeof primo === "string"
        ? (() => {
            try {
              return new URL(primo).hostname;
            } catch {
              return null;
            }
          })()
        : primo instanceof URL
          ? primo.hostname
          : (primo?.hostname ?? primo?.host ?? null);
    if (!ammesso(host)) vietata(String(host ?? primo));
  };
  modulo.request = function (...args: any[]) {
    controlla(args);
    return requestOriginale.apply(this, args as any);
  };
  modulo.get = function (...args: any[]) {
    controlla(args);
    return getOriginale.apply(this, args as any);
  };
}
