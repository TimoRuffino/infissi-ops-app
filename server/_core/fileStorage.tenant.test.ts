// Chiavi con il prefisso dell'azienda, cintura in lettura e contabilità dei
// byte (spec WS3 §3.1–§3.2). Driver in memoria: nessun file su disco.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __impostaDriverPerTest,
  chiaveStorage,
  deleteFileQuiet,
  ErroreQuotaStorage,
  getFile,
  impostaContabileStorage,
  impostaVerificaQuota,
  openFileReadStream,
  putFile,
  statFile,
  tenantDellaChiave,
  type ContabileStorage,
  type StorageDriver,
} from "./fileStorage";
import { conTenant, modalitaTenantStretta } from "../tenants/contestoCorrente";

function driverInMemoria(): StorageDriver & { file: Map<string, Buffer> } {
  const file = new Map<string, Buffer>();
  return {
    name: "local",
    file,
    async put(k, b) { file.set(k, b); },
    async get(k) { return file.get(k) ?? null; },
    async openRead() { return null; },
    async delete(k) { file.delete(k); },
    async head(k) { const b = file.get(k); return b ? { bytes: b.length } : null; },
  };
}

function contabileFinto() {
  const chiamate: Array<["aggiungi" | "togli", number, number, number]> = [];
  const c: ContabileStorage = {
    async aggiungi(t, b, f) { chiamate.push(["aggiungi", t, b, f]); },
    async togli(t, b, f) { chiamate.push(["togli", t, b, f]); },
  };
  return { c, chiamate };
}

describe("fileStorage per tenant", () => {
  let driver = driverInMemoria();
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    driver = driverInMemoria();
    __impostaDriverPerTest(driver);
    modalitaTenantStretta(false);
    impostaContabileStorage(null);
    impostaVerificaQuota(null);
  });
  afterEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
    __impostaDriverPerTest(null);
    modalitaTenantStretta(false);
    impostaContabileStorage(null);
    impostaVerificaQuota(null);
    vi.restoreAllMocks();
  });

  it("chiaveStorage mette il prefisso dell'azienda, tenant 1 compreso; tenantDellaChiave lo rilegge", () => {
    expect(chiaveStorage(1, "preventivi_documenti", 7, 9, "a.pdf")).toMatch(/^tenant\/1\/preventivi_documenti\/7\/9-[0-9a-f]{8}\.pdf$/);
    expect(chiaveStorage(2, "anteprime", 3, 4, "p1.jpg")).toMatch(/^tenant\/2\/anteprime\/3\/4-[0-9a-f]{8}\.jpg$/);
    expect(tenantDellaChiave("tenant/2/anteprime/3/4-abcd1234.jpg")).toBe(2);
    expect(tenantDellaChiave("preventivi_documenti/7/9-abcd1234.pdf")).toBe(1); // chiave legacy
    expect(tenantDellaChiave("tenant/x/…")).toBe(1);
  });

  it("putFile scrive sotto tenant/<id>/ e avvisa il contabile", async () => {
    const { c, chiamate } = contabileFinto();
    impostaContabileStorage(c);
    const esito = await conTenant(2, () => putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png"));
    expect(esito.storageKey.startsWith("tenant/2/ticket_allegati/5/6-")).toBe(true);
    expect(driver.file.has(esito.storageKey)).toBe(true);
    expect(chiamate).toEqual([["aggiungi", 2, 3, 1]]);
  });

  it("senza gancio di quota putFile scrive normalmente", async () => {
    const esito = await conTenant(2, () => putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png"));
    expect(driver.file.has(esito.storageKey)).toBe(true);
  });

  it("con un gancio di quota che rifiuta, putFile lancia ErroreQuotaStorage e il driver non riceve il file", async () => {
    impostaVerificaQuota(async () => ({ messaggio: "Spazio esaurito" }));
    const promessa = conTenant(2, () => putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png"));
    await expect(promessa).rejects.toBeInstanceOf(ErroreQuotaStorage);
    await expect(promessa).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Spazio esaurito" });
    expect(driver.file.size).toBe(0);
  });

  it("un gancio di quota che lancia fa fallire l'upload con quell'errore (fail-closed, mai un upload «di comodo»)", async () => {
    impostaVerificaQuota(async () => {
      throw new Error("verifica quota giù");
    });
    await expect(
      conTenant(2, () => putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png"))
    ).rejects.toThrow("verifica quota giù");
    expect(driver.file.size).toBe(0);
  });

  it("putFile senza tenant nel contesto lancia (interruttore acceso, modalità stretta)", async () => {
    modalitaTenantStretta(true);
    await expect(putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png")).rejects.toThrow(
      "[fileStorage] scrittura senza tenant nel contesto"
    );
  });

  it("a interruttore spento le chiavi nuove hanno comunque il prefisso del tenant 1", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const esito = await putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png");
    expect(esito.storageKey.startsWith("tenant/1/")).toBe(true);
  });

  it("getFile/openFileReadStream: una chiave di un'altra azienda dà null; la chiave nuda è del tenant 1", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    driver.file.set("tenant/2/a/1/1-00000000.bin", Buffer.from("due"));
    driver.file.set("preventivi_documenti/1/1-00000000.pdf", Buffer.from("uno"));
    expect(await conTenant(1, () => getFile("tenant/2/a/1/1-00000000.bin"))).toBeNull();
    expect(await conTenant(1, () => openFileReadStream("tenant/2/a/1/1-00000000.bin"))).toBeNull();
    expect((await conTenant(2, () => getFile("tenant/2/a/1/1-00000000.bin")))?.toString()).toBe("due");
    expect((await conTenant(1, () => getFile("preventivi_documenti/1/1-00000000.pdf")))?.toString()).toBe("uno");
    expect(await conTenant(2, () => getFile("preventivi_documenti/1/1-00000000.pdf"))).toBeNull();
    expect(warn).toHaveBeenCalledWith("[fileStorage] lettura rifiutata: chiave di un'altra azienda");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("00000000"); // mai la chiave nel log
  });

  it("deleteFileQuiet sconta i byte passati, oppure quelli letti con head; un file assente non si sconta", async () => {
    const { c, chiamate } = contabileFinto();
    impostaContabileStorage(c);
    driver.file.set("tenant/2/a/1/1-00000000.bin", Buffer.from("12345"));
    driver.file.set("tenant/2/a/1/2-00000000.bin", Buffer.from("1234567"));
    deleteFileQuiet("tenant/2/a/1/1-00000000.bin", 5);
    deleteFileQuiet("tenant/2/a/1/2-00000000.bin");
    deleteFileQuiet("tenant/2/a/1/3-00000000.bin");
    await vi.waitFor(() => expect(chiamate.length).toBe(2));
    expect(chiamate).toEqual([["togli", 2, 5, 1], ["togli", 2, 7, 1]]);
    expect(driver.file.size).toBe(0);
  });

  // Fix wave finale: cancellazione e contabilità sono due guasti diversi.
  // Con un `catch` solo, una contabilità che falliva scriveva «delete
  // fallito» su un file cancellato benissimo, e chi leggeva il log andava a
  // cercare un file che non c'era più.
  it("una contabilità che fallisce non fa dire «delete fallito»: il file è cancellato, il conto no", async () => {
    const avvisi: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      avvisi.push(a.map(String).join(" "));
    });
    impostaContabileStorage({
      async aggiungi() {},
      async togli() { throw new Error("ledger giù"); },
    });
    driver.file.set("tenant/2/a/1/1-00000000.bin", Buffer.from("12345"));
    deleteFileQuiet("tenant/2/a/1/1-00000000.bin", 5);
    await vi.waitFor(() => expect(avvisi.length).toBe(1));
    expect(driver.file.has("tenant/2/a/1/1-00000000.bin")).toBe(false); // cancellato davvero
    expect(avvisi[0]).toContain("[fileStorage] contabilità non aggiornata per tenant/2/a/1/1-00000000.bin");
    expect(avvisi[0]).not.toContain("delete fallito");
    warn.mockRestore();
  });

  it("un delete che fallisce lo dice, e non tocca il conto", async () => {
    const avvisi: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      avvisi.push(a.map(String).join(" "));
    });
    const { c, chiamate } = contabileFinto();
    impostaContabileStorage(c);
    __impostaDriverPerTest({ ...driver, async delete() { throw new Error("R2 giù"); } });
    deleteFileQuiet("tenant/2/a/1/1-00000000.bin", 5);
    await vi.waitFor(() => expect(avvisi.length).toBe(1));
    expect(avvisi[0]).toContain("[fileStorage] delete fallito per tenant/2/a/1/1-00000000.bin");
    expect(chiamate).toEqual([]);
    warn.mockRestore();
  });

  it("senza dimensione nota (nessun bytes, driver senza head) il file si cancella e il ledger non si tocca", async () => {
    const { c, chiamate } = contabileFinto();
    impostaContabileStorage(c);
    const senzaHead = { ...driver, head: undefined };
    __impostaDriverPerTest(senzaHead);
    senzaHead.file.set("tenant/2/a/1/1-00000000.bin", Buffer.from("12345"));
    deleteFileQuiet("tenant/2/a/1/1-00000000.bin");
    await vi.waitFor(() => expect(senzaHead.file.has("tenant/2/a/1/1-00000000.bin")).toBe(false));
    expect(chiamate).toEqual([]); // scontare «zero byte, un file» sballerebbe il conto
  });

  it("statFile passa da head e risponde null senza head", async () => {
    driver.file.set("tenant/1/a/1/1-00000000.bin", Buffer.from("abcd"));
    expect(await statFile("tenant/1/a/1/1-00000000.bin")).toEqual({ bytes: 4 });
    expect(await statFile("tenant/1/a/1/9-00000000.bin")).toBeNull();
    __impostaDriverPerTest({ ...driver, head: undefined });
    expect(await statFile("tenant/1/a/1/1-00000000.bin")).toBeNull();
  });
});
