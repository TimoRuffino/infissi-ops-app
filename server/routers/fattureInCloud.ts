import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getClientiStore, createClienteFromSync } from "./clienti";
import {
  generaProposteRiconciliazione,
  upsertFatture,
  type RataFic,
} from "./ficFatture";

// ── Fatture in Cloud → CRM sync ──────────────────────────────────────────────
// Polls the FiC API (v2) for the current year's issued invoices and creates
// any client that doesn't exist in the CRM yet — the manual migration done
// once, kept alive automatically. Read-only towards FiC; token pasted by
// direzione in Impostazioni (FiC → Impostazioni → API → nuovo token).

const FIC = "https://api-v2.fattureincloud.it";

type FicConfig = {
  id: number;
  accessToken: string | null;
  companyId: number | null;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastResult: string | null;
};

const _cfgStore = persistedStore<FicConfig>("fic_config", () => {});
const cfgRows = _cfgStore.items;

function getCfg(): FicConfig {
  if (cfgRows.length === 0) {
    cfgRows.push({
      id: 1,
      accessToken: null,
      companyId: null,
      enabled: false,
      lastSyncAt: null,
      lastResult: null,
    });
    _cfgStore.save();
  }
  return cfgRows[0];
}

async function ficGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${FIC}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `Fatture in Cloud HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  }
  return await res.json();
}

// ── Name handling (same CF-validated split used by the manual migration) ────
function stripAcc(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function normKey(s: string): string {
  return stripAcc(s)
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}
function consonants(s: string): string {
  const clean = stripAcc(s).replace(/[^A-Za-z]/g, "").toUpperCase();
  const cons = clean.replace(/[AEIOU]/g, "");
  const vows = clean.replace(/[^AEIOU]/g, "");
  return (cons + vows + "XXX").slice(0, 3);
}
const COMPANY_RE =
  /\b(S\.?R\.?L\.?S?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|SOC(IETA)?'?|COOP|CONDOMINIO|IMPRESA|COSTRUZIONI|EDIL\w*|STUDIO|HOTEL|RISTORANTE|BAR|IMMOBILIARE|SERVICE|GROUP|ITALIA|DITTA|&)\b/i;

function splitPersona(full: string, cf: string | null): { cognome: string; nome: string } {
  const toks = full.trim().split(/\s+/);
  if (toks.length === 1) return { cognome: full, nome: full };
  if (cf && /^[A-Za-z]{6}/.test(cf)) {
    const target = cf.toUpperCase().slice(0, 3);
    for (let i = toks.length - 1; i >= 1; i--) {
      if (consonants(toks.slice(0, i).join(" ")) === target) {
        return { cognome: toks.slice(0, i).join(" "), nome: toks.slice(i).join(" ") };
      }
    }
    for (let i = 1; i < toks.length; i++) {
      if (consonants(toks.slice(i).join(" ")) === target) {
        return { cognome: toks.slice(i).join(" "), nome: toks.slice(0, i).join(" ") };
      }
    }
  }
  return { cognome: toks.slice(0, -1).join(" "), nome: toks[toks.length - 1] };
}

// ── Sync ─────────────────────────────────────────────────────────────────────
let syncing = false;

export async function runFicSync(): Promise<string> {
  const cfg = getCfg();
  if (!cfg.accessToken || !cfg.companyId) {
    throw new Error("Token o azienda non configurati");
  }
  if (syncing) throw new Error("Sincronizzazione già in corso");
  syncing = true;
  try {
    const year = new Date().getFullYear();
    const entities: Array<{ name: string; vat: string | null; cf: string | null }> = [];
    const fatture: Array<{
      id: number;
      numero: string;
      data: string;
      clienteNome: string;
      clienteVat: string | null;
      clienteCf: string | null;
      importoNetto: number;
      importoLordo: number;
      rate: RataFic[];
    }> = [];
    for (let page = 1; page <= 10; page++) {
      const j = await ficGet(
        `/c/${cfg.companyId}/issued_documents?type=invoice&per_page=100&page=${page}&fields=id,number,numeration,date,entity,amount_net,amount_gross,payments_list`,
        cfg.accessToken
      );
      const rows: any[] = j?.data ?? [];
      for (const r of rows) {
        if (!r?.date || !String(r.date).startsWith(String(year))) continue;
        const e = r.entity ?? {};
        if (!e.name) continue;
        entities.push({
          name: String(e.name).trim(),
          vat: e.vat_number ? String(e.vat_number) : null,
          cf: e.tax_code ? String(e.tax_code) : null,
        });
        fatture.push({
          id: Number(r.id),
          numero: `${r.number ?? "?"}${r.numeration ?? ""}`,
          data: String(r.date),
          clienteNome: String(e.name).trim(),
          clienteVat: e.vat_number ? String(e.vat_number) : null,
          clienteCf: e.tax_code ? String(e.tax_code) : null,
          importoNetto: Number(r.amount_net ?? 0),
          importoLordo: Number(r.amount_gross ?? 0),
          rate: (Array.isArray(r.payments_list) ? r.payments_list : []).map(
            (p: any) => ({
              importo: Number(p.amount ?? 0),
              scadenza: p.due_date ? String(p.due_date) : null,
              stato: String(p.status ?? "not_paid"),
              dataPagamento: p.paid_date ? String(p.paid_date) : null,
            })
          ),
        });
      }
      if (rows.length < 100) break;
    }

    const clienti = getClientiStore();
    const have = new Set<string>();
    for (const c of clienti) {
      have.add(normKey(`${c.cognome ?? ""} ${c.nome ?? ""}`));
    }

    let created = 0;
    const seen = new Set<string>();
    for (const e of entities) {
      const key = normKey(e.name);
      if (!key || seen.has(key) || have.has(key)) continue;
      seen.add(key);
      const isCompany = !!(e.vat && e.vat !== "0") || COMPANY_RE.test(e.name);
      if (isCompany) {
        createClienteFromSync({
          cognome: e.name,
          nome: " ",
          tipo: /condominio/i.test(e.name) ? "condominio" : "azienda",
          partitaIva: e.vat ?? undefined,
        });
      } else {
        const sp = splitPersona(e.name, e.cf);
        createClienteFromSync({
          cognome: sp.cognome,
          nome: sp.nome,
          tipo: "privato",
          codiceFiscale:
            e.cf && /^[A-Za-z0-9]{16}$/.test(e.cf) ? e.cf.toUpperCase() : undefined,
        });
      }
      created++;
    }

    // Fatture nello store locale + riconciliazione: le rate incassate su
    // FIC diventano PROPOSTE di registrazione, mai scritture dirette.
    const { nuove, aggiornate } = upsertFatture(fatture);
    const proposteCreate = generaProposteRiconciliazione();

    const result = `${new Date().toLocaleString("it-IT")}: ${entities.length} fatture ${year} (${nuove} nuove, ${aggiornate} aggiornate), ${created} nuovi clienti, ${proposteCreate} proposte di riconciliazione`;
    cfg.lastSyncAt = new Date();
    cfg.lastResult = result;
    _cfgStore.save();
    return result;
  } catch (e: any) {
    const cfg2 = getCfg();
    cfg2.lastSyncAt = new Date();
    cfg2.lastResult = `ERRORE: ${e?.message ?? "sconosciuto"}`;
    _cfgStore.save();
    throw e;
  } finally {
    syncing = false;
  }
}

// Poll every 6 hours while enabled.
let ficTimer: NodeJS.Timeout | null = null;
export function startFicScheduler(): void {
  if (ficTimer) return;
  ficTimer = setInterval(async () => {
    try {
      const cfg = getCfg();
      if (cfg.enabled && cfg.accessToken && cfg.companyId) {
        await runFicSync();
      }
    } catch (e) {
      console.error("[fic] sync automatico fallito:", e);
    }
  }, 6 * 60 * 60 * 1000);
  ficTimer.unref?.();
}

function maskToken(t: string | null): string | null {
  if (!t) return null;
  return t.length <= 10 ? "•••" : t.slice(0, 6) + "…" + t.slice(-4);
}

export const fattureInCloudRouter = router({
  status: adminProcedure.query(() => {
    const cfg = getCfg();
    return {
      configured: !!(cfg.accessToken && cfg.companyId),
      tokenMasked: maskToken(cfg.accessToken),
      companyId: cfg.companyId,
      enabled: cfg.enabled,
      lastSyncAt: cfg.lastSyncAt,
      lastResult: cfg.lastResult,
    };
  }),

  saveConfig: adminProcedure
    .input(
      z.object({
        accessToken: z.string().min(10).optional(),
        companyId: z.number().nullable().optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      const cfg = getCfg();
      if (input.accessToken !== undefined) cfg.accessToken = input.accessToken.trim();
      if (input.companyId !== undefined) cfg.companyId = input.companyId;
      if (input.enabled !== undefined) cfg.enabled = input.enabled;
      _cfgStore.save();
      return { success: true } as const;
    }),

  // Companies visible to the token — lets the UI offer a picker.
  companies: adminProcedure.mutation(async () => {
    const cfg = getCfg();
    if (!cfg.accessToken) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Salva prima il token" });
    }
    const j = await ficGet("/user/companies", cfg.accessToken);
    const list: any[] = j?.data?.companies ?? [];
    return list.map((c) => ({ id: c.id as number, name: String(c.name ?? c.id) }));
  }),

  syncNow: adminProcedure.mutation(async () => {
    return { result: await runFicSync() };
  }),
});
