import { beforeEach, describe, expect, it, vi } from "vitest";

const storageProbe = vi.hoisted(() => ({ fail: false }));

vi.mock("../_core/fileStorage", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/fileStorage")>();
  return {
    ...actual,
    putFile: vi.fn(async () => {
      if (storageProbe.fail) throw new Error("storage non disponibile");
      return {
        storageKey: "preventivi_documenti/test/fattura.pdf",
        checksum: "a".repeat(64),
      };
    }),
  };
});

import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import {
  deleteDocumentoFic,
  findDocumentoFic,
  StorageAllegatoTemporaneamenteNonDisponibile,
  upsertDocumentoFic,
} from "./preventiviContratti";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `storage-fic-${sedeId}`,
      name: "Direzione",
      email: `storage-fic-${sedeId}@example.test`,
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [sedeId],
  };
}

describe("storage documenti FiC", () => {
  beforeEach(() => {
    storageProbe.fail = false;
  });

  it("non crea fallback base64 quando putFile fallisce", async () => {
    const sedeId = 304;
    const ficId = 304_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Storage FiC" });
    storageProbe.fail = true;

    await expect(
      upsertDocumentoFic({
        sedeId,
        ficId,
        commessaId: commessa.id,
        numero: "304/PDF",
        data: "2026-08-20",
        pdf: Buffer.from("%PDF-1.4\nno fallback\n%%EOF", "ascii"),
        createdBy: sedeId,
      })
    ).rejects.toBeInstanceOf(StorageAllegatoTemporaneamenteNonDisponibile);
    expect(findDocumentoFic(sedeId, ficId)).toBeNull();
  });

  it("trova il sourceRef FiC soltanto nella sede proprietaria", async () => {
    const sedeId = 306;
    const ficId = 306_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Scope PDF FiC" });

    try {
      const documento = await upsertDocumentoFic({
        sedeId,
        ficId,
        commessaId: commessa.id,
        numero: "306/PDF",
        data: "2026-08-20",
        pdf: Buffer.from("%PDF-1.4\nscope\n%%EOF", "ascii"),
        createdBy: sedeId,
      });

      expect(documento.sourceRef).toBe(`fic:${sedeId}:${ficId}`);
      expect(findDocumentoFic(sedeId, ficId)?.id).toBe(documento.id);
      expect(findDocumentoFic(sedeId + 1, ficId)).toBeNull();
    } finally {
      deleteDocumentoFic(sedeId, ficId);
    }
  });
});
