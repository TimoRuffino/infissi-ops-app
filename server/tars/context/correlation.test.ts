import { describe, expect, it } from "vitest";
import { fingerprintContext } from "./fingerprint";
import { rankEntityCandidates } from "./correlation";
import type { ContextFact } from "./types";

describe("rankEntityCandidates", () => {
  const candidates = [
    {
      entityType: "commessa" as const,
      entityId: 42,
      clienteId: 7,
      codiceCommessa: "COM-2026-042",
      emails: ["mario@example.test"],
      phones: ["+39 333 1234567"],
      codiceFiscale: "RSSMRA80A01H501U",
      partitaIva: null,
      invoiceNumbers: ["18/A"],
      invoices: [{ amount: 4_000, date: "2026-08-15" }],
      assigneeUserId: 4,
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    },
    {
      entityType: "commessa" as const,
      entityId: 43,
      clienteId: 7,
      codiceCommessa: "COM-2026-043",
      emails: ["mario@example.test"],
      phones: ["3331234567"],
      codiceFiscale: "RSSMRA80A01H501U",
      partitaIva: null,
      invoiceNumbers: [],
      invoices: [],
      assigneeUserId: 5,
      updatedAt: new Date("2026-01-01T10:00:00.000Z"),
    },
  ];

  it("fa vincere id e codice espliciti sulle somiglianze anagrafiche", () => {
    const ranked = rankEntityCandidates(
      {
        explicitEntityId: 43,
        codiceCommessa: "COM 2026 043",
        email: "mario@example.test",
      },
      candidates
    );
    expect(ranked[0]).toMatchObject({ entityId: 43 });
    expect(ranked[0].reasons).toEqual(
      expect.arrayContaining(["id esplicito", "codice commessa esatto"])
    );
  });

  it("combina riferimenti fiscali, fattura, importo e data in modo spiegabile", () => {
    const ranked = rankEntityCandidates(
      {
        codiceFiscale: "RSS MRA 80A01 H501U",
        invoiceNumber: "18/a",
        amount: 4_000,
        date: "2026-08-15",
        assigneeUserId: 4,
      },
      candidates
    );
    expect(ranked[0]).toMatchObject({ entityId: 42 });
    expect(ranked[0].reasons).toEqual(
      expect.arrayContaining([
        "codice fiscale esatto",
        "numero fattura esatto",
        "importo e data fattura compatibili",
      ])
    );
  });

  it("normalizza telefoni ed email e restituisce al massimo cinque candidati", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      ...candidates[0],
      entityId: 100 + index,
    }));
    const ranked = rankEntityCandidates(
      { phone: "333 123 4567", email: " MARIO@example.test " },
      many
    );
    expect(ranked).toHaveLength(5);
    expect(ranked[0].reasons).toEqual(
      expect.arrayContaining(["telefono esatto", "email esatta"])
    );
  });
});

describe("fingerprintContext", () => {
  it("e stabile rispetto all'ordine di fatti, oggetti ed evidenze", () => {
    const first: ContextFact[] = [
      {
        key: "b",
        value: { z: 2, a: 1 },
        confidence: "certain",
        evidence: [
          { sourceType: "ticket", sourceId: "2", label: "B", version: "2" },
          { sourceType: "ticket", sourceId: "1", label: "A", version: "1" },
        ],
      },
      { key: "a", value: [2, 1], confidence: "inferred", evidence: [] },
    ];
    const second: ContextFact[] = [
      { key: "a", value: [2, 1], confidence: "inferred", evidence: [] },
      {
        key: "b",
        value: { a: 1, z: 2 },
        confidence: "certain",
        evidence: [
          { sourceType: "ticket", sourceId: "1", label: "A", version: "1" },
          { sourceType: "ticket", sourceId: "2", label: "B", version: "2" },
        ],
      },
    ];

    const metadata = {
      schemaVersion: "1",
      policyVersion: "policy-1",
      collectorVersion: "collector-1",
    };
    expect(fingerprintContext({ ...metadata, facts: first })).toBe(
      fingerprintContext({ ...metadata, facts: second })
    );
    expect(fingerprintContext({ ...metadata, facts: first })).not.toBe(
      fingerprintContext({
        ...metadata,
        facts: first,
        policyVersion: "policy-2",
      })
    );
  });
});
