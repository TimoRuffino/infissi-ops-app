// server/_core/permissions.test.ts
// Helper di esistenza/confine di sede usati dai router (WS3 Task 11):
// `oppureNotFound` sostituisce i vecchi `throw new Error("… non trovato")`
// (diventavano INTERNAL_SERVER_ERROR sotto tRPC), `recordOppureNotFound`
// aggiunge il confine di sede (`assertSedeScope`). Entrambi restituiscono
// sempre lo stesso messaggio generico — chi non deve sapere se una risorsa
// esiste in un'altra sede non lo sa (CLAUDE.md, invarianti).
import { describe, expect, it } from "vitest";
import { oppureNotFound, recordOppureNotFound } from "./permissions";

describe("oppureNotFound / recordOppureNotFound", () => {
  it("oppureNotFound e recordOppureNotFound: NOT_FOUND generico, mai il motivo", () => {
    expect(oppureNotFound({ id: 1 })).toEqual({ id: 1 });
    expect(() => oppureNotFound(null)).toThrow(expect.objectContaining({ code: "NOT_FOUND", message: "Risorsa non trovata." }));
    expect(recordOppureNotFound({ id: 1, sedeId: 2 }, 2)).toEqual({ id: 1, sedeId: 2 });
    expect(recordOppureNotFound({ id: 1, sedeId: 2 }, null)).toEqual({ id: 1, sedeId: 2 });
    expect(() => recordOppureNotFound({ id: 1, sedeId: 2 }, 3)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => recordOppureNotFound(undefined, 3)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});
