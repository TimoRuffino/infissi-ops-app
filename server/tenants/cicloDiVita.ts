// server/tenants/cicloDiVita.ts
// Il giro del ciclo di vita (piano 10/09/2026, D6): come il worker degli
// abbonamenti — dopo il `listen`, un giro subito e poi ogni 6 ore, mai un
// cron esterno. Non esegue nulla da sé: ACCODA comandi (`cancella`,
// `svuota_tenant`) che il giro dei 30 s prende dalla coda — tracciati,
// ritentabili, visibili nel pannello come ogni altro comando.
//
// Legge solo il control plane (repo.tutti(), comandiInAttesa): niente store
// per tenant, quindi niente `conTenant` qui — lo svuotamento vero, che negli
// store ci entra, dichiara il suo contesto da sé (`svuotamento.ts`).
import { interruttoreAttivo } from "../platform/interruttori";
import {
  ATTESA_ATTIVAZIONE_MS,
  RITENZIONE_CANCELLAZIONE_MS,
  TENANT_PREDEFINITO_ID,
} from "./costanti";
import { getTenantRepository } from "./repository";
import type { TenantComando, TipoComando } from "./tipi";

/** Ogni 6 ore, come gli abbonamenti: giorni interi, non minuti. */
const INTERVALLO_MS = 6 * 3_600_000;

const RICHIESTO_DA = "script:ciclo-di-vita";

export const MOTIVO_MAI_ATTIVATA = "prova mai attivata entro 14 giorni";

/**
 * Un giro: le `in_attesa` più vecchie di 14 giorni ricevono un comando
 * `cancella`; le `cancellato` oltre la ritenzione (e non ancora svuotate) un
 * `svuota_tenant`. Un comando già in coda per la stessa azienda non si
 * duplica; uno finito in `errore` viene riaccodato al giro successivo, che è
 * il retry naturale di questa coda. `adesso` è per i test.
 */
export async function giroCicloDiVita(adesso = new Date()): Promise<{ cancellazioni: number; svuotamenti: number }> {
  const esito = { cancellazioni: 0, svuotamenti: 0 };
  if (!interruttoreAttivo("multiAzienda")) return esito;
  const repo = getTenantRepository();
  const inAttesa = await repo.comandiInAttesa();
  const giaAccodato = (tipo: TipoComando, tenantId: number): boolean =>
    inAttesa.some((c: TenantComando) => c.tipo === tipo && c.tenantId === tenantId);

  for (const t of repo.tutti()) {
    if (t.id === TENANT_PREDEFINITO_ID) continue;
    if (t.stato === "in_attesa" && adesso.getTime() - t.createdAt.getTime() >= ATTESA_ATTIVAZIONE_MS) {
      if (giaAccodato("cancella", t.id)) continue;
      await repo.accodaComando({
        tipo: "cancella",
        tenantId: t.id,
        payload: { slug: t.slug, motivo: MOTIVO_MAI_ATTIVATA },
        richiestoDa: RICHIESTO_DA,
      });
      esito.cancellazioni++;
      continue;
    }
    if (
      t.stato === "cancellato" &&
      !t.svuotatoIl &&
      t.cancellatoIl &&
      adesso.getTime() - t.cancellatoIl.getTime() >= RITENZIONE_CANCELLAZIONE_MS
    ) {
      if (giaAccodato("svuota_tenant", t.id)) continue;
      await repo.accodaComando({
        tipo: "svuota_tenant",
        tenantId: t.id,
        payload: { slug: t.slug },
        richiestoDa: RICHIESTO_DA,
      });
      esito.svuotamenti++;
    }
  }
  if (esito.cancellazioni || esito.svuotamenti) {
    console.log(
      `[ciclo-di-vita] accodati ${esito.cancellazioni} cancella (mai attivate) e ${esito.svuotamenti} svuota_tenant (ritenzione compiuta)`
    );
  }
  return esito;
}

let intervallo: NodeJS.Timeout | null = null;

/** Chiamata SOLO da `_core/index.ts`, dopo il `listen`, come il worker degli abbonamenti. */
export function avviaWorkerCicloDiVita(): void {
  if (!interruttoreAttivo("multiAzienda")) return;
  if (intervallo) return;
  void giroCicloDiVita().catch(e => console.error("[ciclo-di-vita]", e instanceof Error ? e.message : e));
  intervallo = setInterval(
    () => void giroCicloDiVita().catch(e => console.error("[ciclo-di-vita]", e instanceof Error ? e.message : e)),
    INTERVALLO_MS
  );
  intervallo.unref();
}

export function fermaWorkerCicloDiVita(): void {
  if (intervallo) clearInterval(intervallo);
  intervallo = null;
}
