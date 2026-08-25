// Audit operativo trasversale di Tars.
//
// Una volta al giorno per sede legge un quadro aggregato dell'azienda e
// cerca pattern ricorrenti: colli di bottiglia, dati incompleti, ritardi,
// rilavorazioni e rumore generato dallo stesso agente. Produce al massimo
// tre proposte di miglioramento; non modifica processi o configurazioni.

import type { TrpcContext } from "../_core/context";
import { allSedeIds } from "../routers/sedi";
import { openaiConfigured } from "./openai";
import { runTars } from "./loop";
import { budgetMensileSuperato, getTarsConfig, saveConfig } from "./stores";

const INTERVALLO_CONTROLLO_MS = 6 * 60 * 60 * 1000;
const FREQUENZA_AUDIT_MS = 22 * 60 * 60 * 1000;
const PRIMO_CONTROLLO_MS = 90 * 1000;
const inCorso = new Set<number>();

function ctxAuditSistema(sedeId: number): TrpcContext {
  return {
    user: {
      id: 0,
      openId: "tars-audit-processi",
      name: "Tars (audit processi)",
      email: "tars-audit@sistema.local",
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: {} as any,
    sedeId,
    // L'audit resta confinato alla singola sede anche se il ruolo di sistema
    // ha i permessi necessari a leggere i moduli economici e organizzativi.
    sediIds: [sedeId],
  };
}

export async function eseguiAuditProcessi(
  sedeId: number,
  opzioni: { forza?: boolean; ctx?: TrpcContext } = {}
) {
  const config = getTarsConfig(sedeId);
  if (!config.attivo || !config.auditProcessiAttivo) return null;
  if (!openaiConfigured() || budgetMensileSuperato(sedeId)) return null;
  if (inCorso.has(sedeId)) return null;

  const ultimo = config.ultimoAuditProcessiAt
    ? new Date(config.ultimoAuditProcessiAt).getTime()
    : 0;
  if (!opzioni.forza && Date.now() - ultimo < FREQUENZA_AUDIT_MS) return null;

  inCorso.add(sedeId);
  config.ultimoAuditProcessiAt = new Date();
  config.updatedAt = new Date();
  saveConfig();

  try {
    return await runTars({
      ctx: opzioni.ctx ?? ctxAuditSistema(sedeId),
      trigger: "audit_processi",
      commessaId: null,
      richiesta: `<trigger>
Tipo: audit_processi_aziendali
Data e ora: ${new Date().toISOString()}
</trigger>

Studia come sta funzionando la sede, non una singola commessa. Inizia con
leggi_quadro_azienda e cerca esclusivamente pattern misurabili e ricorrenti:
colli di bottiglia, passaggi manuali ripetuti, dati mancanti, ritardi sistematici,
rilavorazioni, comunicazioni non presidiate o regole del CRM che non riflettono il
lavoro reale.

Puoi proporre al massimo UN esperimento: scegli solo il pattern con il maggiore
impatto e prove sufficienti. Ogni proposta deve usare esattamente una voce di
metricheProcesso e riportarne metricKey, baselineValue, baselineDenominator e
sampleSize senza ricalcolarli. Definisci inoltre:
- una sola azione operativa concreta da provare;
- un target numerico che migliori la baseline;
- un responsabile valido letto con leggi_assegnatari;
- una data di verifica tra 7 e 90 giorni.

Non trasformare una singola anomalia in un processo. Non riproporre idee già pendenti
o già decise: lo strumento le blocca, ma devi anche evitare di sprecare chiamate.
Se il campione è inferiore a due o non emerge un esperimento chiaramente misurabile,
usa nessuna_azione.`,
    });
  } finally {
    inCorso.delete(sedeId);
  }
}

async function controllaTutteLeSedi(): Promise<void> {
  for (const sedeId of allSedeIds()) {
    try {
      await eseguiAuditProcessi(sedeId);
    } catch (e: any) {
      console.warn(
        `[tars] audit processi sede ${sedeId} fallito:`,
        e?.message ?? e
      );
    }
  }
}

export function avviaAuditProcessiScheduler(): void {
  const primo = setTimeout(
    () => void controllaTutteLeSedi(),
    PRIMO_CONTROLLO_MS
  );
  primo.unref?.();
  const timer = setInterval(
    () => void controllaTutteLeSedi(),
    INTERVALLO_CONTROLLO_MS
  );
  timer.unref?.();
}
