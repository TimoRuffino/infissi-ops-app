// server/_core/ordineImport.test.ts
// Regressione (Fix round 1, Task 7): prima del fix, `_core/trpc.ts`
// importava `conTenant` da `tenants/contestoCorrente.ts`, che (tramite
// `./contesto`) importava `routers/sedi` e `routers/utenti`, che a loro
// volta importano `_core/trpc` — un ciclo. Un entry point che importasse un
// router PRIMA di `tenants/contestoCorrente.ts` (quasi ogni test: `../routers`
// è di solito il primo import) capovolgeva l'ordine di valutazione:
// `trpc.ts` partiva per primo, il ciclo lo rimandava dentro se stesso, e
// `routers/sedi.ts` (caricato nel mezzo, mentre `trpc.ts` era ancora a metà
// della sua valutazione) trovava `protectedProcedure`/`adminProcedure`
// ancora `undefined` — «Cannot read properties of undefined (reading
// 'input')» al semplice import, prima ancora che un test potesse girare.
//
// Questo file riproduce ESATTAMENTE quell'ordine: `routers/sedi` è il primo
// import, prima di qualunque modulo di `server/tenants/` (che qui non
// compare affatto). Con `contestoCorrente.ts` tornato una foglia del grafo
// dei moduli (niente `./contesto`/`./repository`, guardia strutturale in
// `server/tenants/confine.test.ts`) l'import non deve più lanciare, e il
// router deve arrivare completo, con le sue procedure.
import { sediRouter } from "../routers/sedi";
import { describe, expect, it } from "vitest";

describe("ordine di import: un router prima di tenants/", () => {
  it("sediRouter si costruisce comunque, con le sue procedure", () => {
    expect(sediRouter).toBeDefined();
    expect(Object.keys(sediRouter._def.procedures)).toEqual(
      expect.arrayContaining(["list", "listAll", "active", "create", "update", "switch"])
    );
  });
});
