// Guardia GLOBALE della suite: nessun test può fare una richiesta di
// rete reale (cost hardening, revisione del 30/08/2026).
//
// Prima esisteva un solo test che sostituiva `fetch` nel proprio file:
// provava che il fake non usa la rete — cosa già vera per costruzione —
// mentre gli altri 30+ file restavano scoperti. Qui la sostituzione vale
// per l'INTERA suite: se un giorno qualcuno collegasse per errore il
// provider reale (o un client legacy) dentro un test, il test fallirebbe
// con un messaggio esplicito invece di partire davvero verso Internet.
//
// I test che devono simulare HTTP restano liberi di installare il
// proprio mock (`vi.spyOn(globalThis, "fetch")`): il loro mock ha la
// precedenza e viene ripristinato da vitest a fine test.

import { beforeAll } from "vitest";

const HOST_AMMESSI = [/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/];

beforeAll(() => {
  const originale = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input?.url ?? String(input));
    if (HOST_AMMESSI.some(regola => regola.test(url))) {
      return originale(input, init);
    }
    throw new Error(
      `RETE VIETATA NEI TEST: tentata una richiesta verso «${url}». ` +
        "Nessun test deve raggiungere un servizio esterno: usa un fake o un mock esplicito."
    );
  }) as typeof fetch;
});
