// Anteprime delle evidenze (06/09/2026): le pagine si rendono in JPEG una
// volta, finiscono nello storage e si rileggono per pagina e per sede. Le
// prove che vogliono pdftoppm si saltano da sole quando manca.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import {
  caricaDocumentoCommessaDaBuffer,
  getDocumentoRecordById,
} from "../routers/preventiviContratti";
import { getUtentiStore } from "../routers/utenti";
import { disponibilitaOcr } from "./ocr";
import { pdfConTesto } from "./pdfMinimo";
import {
  ANTEPRIME_VERSIONE,
  leggiAnteprima,
  rendiAnteprime,
  scaldaAnteprime,
} from "./anteprime";

// Storage in memoria: i test non scrivono in ./data/files.
const memoriaStorage = vi.hoisted(() => new Map<string, Buffer>());
const scritture = vi.hoisted(() => ({ n: 0 }));
vi.mock("../_core/fileStorage", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/fileStorage")>();
  const { createHash } = await import("node:crypto");
  let progressivo = 0;
  return {
    ...actual,
    putFile: vi.fn(
      async (
        collection: string,
        _parentId: number,
        _recordId: number,
        originalName: string,
        buffer: Buffer,
        _mimeType: string
      ) => {
        scritture.n += 1;
        const storageKey = `${collection}/test/${++progressivo}-${originalName}`;
        memoriaStorage.set(storageKey, Buffer.from(buffer));
        return { storageKey, checksum: createHash("sha256").update(buffer).digest("hex") };
      }
    ),
    getFile: vi.fn(async (storageKey: string) => memoriaStorage.get(storageKey) ?? null),
    deleteFileQuiet: vi.fn(() => {}),
  };
});

const SEDE = 97_601;
const ALTRA_SEDE = 97_602;
const DIREZIONE_ID = 97_611;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Anteprime",
      email: "anteprime-dir@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE, ALTRA_SEDE],
    });
  }
}

function contestoTrpc(sedeId: number): TrpcContext {
  return {
    user: {
      id: DIREZIONE_ID,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

async function documentoInSede(
  sedeId: number,
  opzioni: { mimeType?: string; buffer?: Buffer; nome?: string } = {}
) {
  const commessa = await appRouter.createCaller(contestoTrpc(sedeId)).commesse.create({ cliente: "Anteprime Test" });
  return caricaDocumentoCommessaDaBuffer({
    commessaId: commessa.id,
    nome: opzioni.nome ?? "Documento.pdf",
    tipo: "altro",
    mimeType: opzioni.mimeType ?? "application/pdf",
    buffer: opzioni.buffer ?? pdfConTesto(["Conferma", "Totale imponibile EUR 100,00"]),
    sedeId,
    createdBy: DIREZIONE_ID,
    keepNome: true,
  });
}

const binariPresenti = (await disponibilitaOcr()).disponibile;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("anteprime — contratto senza binari", () => {
  it("con l'interruttore spento non rende e non legge", async () => {
    vi.stubEnv("FLAG_ANTEPRIME_EVIDENZE", "off");
    const documento = await documentoInSede(SEDE);
    const prima = scritture.n;
    expect(await rendiAnteprime({ documento, sedeId: SEDE, bytes: pdfConTesto(["x"]) })).toBeNull();
    expect(scritture.n).toBe(prima);
    const letta = await leggiAnteprima(documento.id, SEDE, 1);
    expect(letta).toMatchObject({ esito: "non_disponibile", codice: "spento" });
  });

  it("una foto non si rende: la pagina è il file stesso", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const documento = await documentoInSede(SEDE, { mimeType: "image/jpeg", buffer: jpeg, nome: "foto.jpg" });
    const meta = await rendiAnteprime({ documento, sedeId: SEDE, bytes: jpeg });
    expect(meta).toMatchObject({ versione: ANTEPRIME_VERSIONE, formato: "originale", pagine: 1, chiavi: [] });
    expect(getDocumentoRecordById(documento.id)?.anteprime).toMatchObject({ formato: "originale" });
    const letta = await leggiAnteprima(documento.id, SEDE, 1);
    expect(letta.esito).toBe("ok");
    if (letta.esito === "ok") {
      expect(letta.mimeType).toBe("image/jpeg");
      expect(letta.buffer.equals(jpeg)).toBe(true);
    }
    expect(await leggiAnteprima(documento.id, SEDE, 2)).toEqual({ esito: "fuori_intervallo", pagine: 1 });
  });

  it("un documento di un'altra sede non esiste, e una pagina zero è fuori intervallo", async () => {
    const documento = await documentoInSede(SEDE);
    expect(await leggiAnteprima(documento.id, ALTRA_SEDE, 1)).toMatchObject({
      esito: "non_disponibile",
      codice: "documento",
    });
    expect(await leggiAnteprima(documento.id, SEDE, 0)).toMatchObject({ esito: "fuori_intervallo" });
  });

  it("un file oltre il limite non si rende", async () => {
    const documento = await documentoInSede(SEDE);
    const grande = Buffer.alloc(15 * 1024 * 1024 + 1);
    expect(await rendiAnteprime({ documento, sedeId: SEDE, bytes: grande })).toBeNull();
  });
});

describe.skipIf(!binariPresenti)("anteprime — con i binari reali", { timeout: 120_000 }, () => {
  it("rende le pagine in JPEG una volta sola, le ricorda sul documento e le rilegge per pagina", async () => {
    const bytes = pdfConTesto(["Conferma", "Totale imponibile EUR 100,00"]);
    const documento = await documentoInSede(SEDE, { buffer: bytes });
    const prima = scritture.n;
    const meta = await rendiAnteprime({ documento, sedeId: SEDE, bytes });
    expect(meta).toMatchObject({ versione: ANTEPRIME_VERSIONE, formato: "jpeg", pagine: 1, dpi: 150 });
    expect(meta!.chiavi).toHaveLength(1);
    expect(meta!.checksum).toBe(documento.checksum ?? null);
    // JPEG vero nello storage.
    const salvata = memoriaStorage.get(meta!.chiavi[0])!;
    expect([...salvata.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(scritture.n).toBe(prima + 1);

    // La scaldata non rifà un lavoro già fatto.
    await scaldaAnteprime(getDocumentoRecordById(documento.id)!, SEDE, bytes);
    expect(scritture.n).toBe(prima + 1);

    const letta = await leggiAnteprima(documento.id, SEDE, 1);
    expect(letta.esito).toBe("ok");
    if (letta.esito === "ok") {
      expect(letta.mimeType).toBe("image/jpeg");
      expect(letta.buffer.equals(salvata)).toBe(true);
    }
    expect(await leggiAnteprima(documento.id, SEDE, 2)).toEqual({ esito: "fuori_intervallo", pagine: 1 });
  });

  it("a richiesta, senza anteprime, la prima lettura rende da sola", async () => {
    const documento = await documentoInSede(SEDE);
    // Un documento appena caricato non ha anteprime (il backfill onLoad mette null ai record letti dal DB).
    expect(getDocumentoRecordById(documento.id)?.anteprime ?? null).toBeNull();
    const letta = await leggiAnteprima(documento.id, SEDE, 1);
    expect(letta.esito).toBe("ok");
    expect(getDocumentoRecordById(documento.id)?.anteprime?.pagine).toBe(1);
  });

  it("se la pagina resa sparisce dallo storage, il metadato si dimentica e si rifà", async () => {
    const documento = await documentoInSede(SEDE);
    const meta = await rendiAnteprime({ documento, sedeId: SEDE, bytes: pdfConTesto(["Riga"]) });
    memoriaStorage.delete(meta!.chiavi[0]);
    const prima = await leggiAnteprima(documento.id, SEDE, 1);
    expect(prima).toMatchObject({ esito: "non_disponibile", codice: "storage" });
    expect(getDocumentoRecordById(documento.id)?.anteprime).toBeNull();
    const seconda = await leggiAnteprima(documento.id, SEDE, 1);
    expect(seconda.esito).toBe("ok");
  });
});
