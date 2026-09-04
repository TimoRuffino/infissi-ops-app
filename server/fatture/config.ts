// Configurazione di fatturazione per sede (IBAN, banca, metodo di pagamento,
// numerazione e conto FiC, footer) e verifica dello scope di scrittura di
// Fatture in Cloud: una chiamata a /issued_documents/info conferma che il
// token collegato può davvero emettere documenti, e ne mette in cache gli
// id (aliquote IVA, conto di pagamento, numerazioni, metodi di pagamento)
// così il resto della fatturazione dal contratto non li richiede ogni volta.
import type { FatturazioneConfig } from "@shared/fatturazione/tipi";
import {
  accessTokenFic,
  getCfg,
  ficGet as ficGetDefault,
} from "../routers/fattureInCloud";
import { getFattureRepository } from "./repository";

/** IBAN italiano: IT + 2 cifre di controllo + 1 lettera CIN + 10 cifre ABI/CAB + 12 alfanumerici CC, verificato con il modulo 97 IBAN (ISO 7064). */
export function ibanValido(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(s)) return false;
  const riordinato = s.slice(4) + s.slice(0, 4);
  const numerico = riordinato.replace(/[A-Z]/g, ch =>
    String(ch.charCodeAt(0) - 55)
  );
  let resto = 0;
  for (const cifra of numerico) resto = (resto * 10 + Number(cifra)) % 97;
  return resto === 1;
}

export async function configFatturazione(
  sedeId: number
): Promise<FatturazioneConfig> {
  const repo = getFattureRepository();
  await repo.ensureSchema();
  return repo.config(sedeId);
}

export async function salvaConfigFatturazione(input: {
  sedeId: number;
  patch: Partial<
    Pick<
      FatturazioneConfig,
      | "iban"
      | "banca"
      | "intestatario"
      | "metodoPagamento"
      | "numerazioneFic"
      | "paymentAccountIdFic"
      | "dicituraFooter"
      | "speseDocumentazioneCent"
    >
  >;
}): Promise<FatturazioneConfig> {
  if (
    input.patch.iban != null &&
    input.patch.iban !== "" &&
    !ibanValido(input.patch.iban)
  ) {
    throw new Error("VALIDAZIONE: IBAN non valido.");
  }
  if (
    input.patch.metodoPagamento != null &&
    !/^MP\d{2}$/.test(input.patch.metodoPagamento)
  ) {
    throw new Error("VALIDAZIONE: metodo di pagamento non valido (es. MP05).");
  }
  // R17: è un importo in centesimi, come ogni cifra del CRM.
  if (
    input.patch.speseDocumentazioneCent != null &&
    (!Number.isInteger(input.patch.speseDocumentazioneCent) ||
      input.patch.speseDocumentazioneCent < 0)
  ) {
    throw new Error(
      "VALIDAZIONE: spese di documentazione non valide (centesimi interi, mai negativi)."
    );
  }
  const repo = getFattureRepository();
  await repo.ensureSchema();
  const attuale = await repo.config(input.sedeId);
  const iban =
    input.patch.iban == null
      ? attuale.iban
      : input.patch.iban.replace(/\s+/g, "").toUpperCase() || null;
  return repo.salvaConfig({
    ...attuale,
    ...input.patch,
    iban,
    sedeId: input.sedeId,
  });
}

/**
 * Chiama GET /c/{company}/issued_documents/info?type=invoice: se risponde,
 * il token ha davvero i permessi di scrittura (non solo quelli concessi in
 * fase di consenso OAuth, che l'utente potrebbe aver limitato dal pannello
 * Fatture in Cloud) e la risposta porta gli id da usare per emettere —
 * aliquote IVA, conti di pagamento, numerazioni, metodi di pagamento — che
 * qui vengono messi in cache sulla configurazione di sede.
 */
export async function verificaScopeScrittura(input: {
  sedeId: number;
  ficGet?: typeof ficGetDefault;
  now?: Date;
}): Promise<{
  ok: boolean;
  motivo: string | null;
  config: FatturazioneConfig;
  opzioni: {
    vatTypes: Array<{
      id: number;
      value: number;
      description: string;
      eInvoice: boolean;
    }>;
    paymentAccounts: Array<{ id: number; name: string }>;
    numerations: string[];
    paymentMethods: Array<{ id: number; name: string }>;
  } | null;
}> {
  const repo = getFattureRepository();
  await repo.ensureSchema();
  const attuale = await repo.config(input.sedeId);
  const cfg = getCfg(input.sedeId);
  try {
    const token = cfg.companyId ? await accessTokenFic(cfg) : null;
    if (!token || !cfg.companyId) {
      const config = await repo.salvaConfig({
        ...attuale,
        scopeScritturaOk: false,
      });
      return {
        ok: false,
        motivo: "Fatture in Cloud non è collegato per questa sede.",
        config,
        opzioni: null,
      };
    }
    const risposta = await (input.ficGet ?? ficGetDefault)(
      `/c/${cfg.companyId}/issued_documents/info?type=invoice`,
      token
    );
    const d = risposta?.data ?? {};
    const vat = (d.vat_types_list ?? []) as Array<{
      id: number;
      value: number;
      description: string;
      e_invoice?: boolean;
      default?: boolean;
    }>;
    const scegli = (valore: number) => {
      const c = vat.filter(v => v.value === valore && v.e_invoice !== false);
      return (c.find(v => v.default) ?? c[0])?.id ?? null;
    };
    const conti = (
      (d.payment_accounts_list ?? []) as Array<{ id: number; name: string }>
    ).map(c => ({
      id: c.id,
      name: c.name,
    }));
    const config = await repo.salvaConfig({
      ...attuale,
      vatIdsFic: { 22: scegli(22), 10: scegli(10) },
      paymentAccountIdFic:
        attuale.paymentAccountIdFic ??
        (conti.length === 1 ? conti[0].id : null),
      scopeScritturaOk: true,
      scopeVerificatoAt: input.now ?? new Date(),
    });
    return {
      ok: true,
      motivo: null,
      config,
      opzioni: {
        vatTypes: vat.map(v => ({
          id: v.id,
          value: v.value,
          description: v.description,
          eInvoice: v.e_invoice !== false,
        })),
        paymentAccounts: conti,
        numerations: Object.keys(d.numerations ?? {}),
        paymentMethods: (
          (d.payment_methods_list ?? []) as Array<{ id: number; name: string }>
        ).map(m => ({
          id: m.id,
          name: m.name,
        })),
      },
    };
  } catch (errore) {
    const config = await repo.salvaConfig({
      ...attuale,
      scopeScritturaOk: false,
    });
    const messaggio = String((errore as any)?.message ?? "");
    return {
      ok: false,
      motivo:
        /40[13]/.test(messaggio) || /permesso|autorizz/i.test(messaggio)
          ? "Permessi FiC insufficienti: ri-autorizza con i permessi di scrittura."
          : `Verifica non riuscita: ${messaggio}`,
      config,
      opzioni: null,
    };
  }
}
