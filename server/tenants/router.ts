// server/tenants/router.ts
import { protectedProcedure, router, sessionProcedure } from "../_core/trpc";
import {
  meseLocale,
  nanoInEur,
  percentualeBudget,
  TOLLERANZA_PREDEFINITA_GIORNI,
} from "../abbonamenti/costanti";
import { bloccoStorage } from "../abbonamenti/quota";
import { giorniAllaScadenza } from "../abbonamenti/servizio";
import { interruttoreAttivo } from "../platform/interruttori";
import { utenteAmministratore } from "../piattaforma/accesso";
import { ledgerCorrente } from "../tars/costi/ledger";
import {
  QUOTA_STORAGE_PREDEFINITA_BYTES,
  RUOLO_PROPRIETARIO,
  TENANT_PREDEFINITO_ID,
  TENANT_PREDEFINITO_NOME,
  TENANT_PREDEFINITO_SLUG,
} from "./costanti";
import { ruoliDi, tenantDelContesto } from "./regole";
import { getTenantRepository } from "./repository";
import { percentualeStorage } from "./storage";
import type { TenantRecord } from "./tipi";

const MS_GIORNO = 86_400_000;

/**
 * Euro con due decimali. Gli importi vivono in nano-dollari e tornano in euro
 * attraverso un cambio: senza arrotondare, un budget di 25 € si mostrerebbe
 * come 25,000000000000004.
 */
function euro(nano: number): number {
  return Math.round(nanoInEur(nano) * 100) / 100;
}

function tenantPredefinitoSintetico(): TenantRecord {
  const now = new Date();
  return {
    id: TENANT_PREDEFINITO_ID,
    slug: TENANT_PREDEFINITO_SLUG,
    nome: TENANT_PREDEFINITO_NOME,
    stato: "attivo",
    motivoStato: null,
    createdAt: now,
    updatedAt: now,
    storageQuotaBytes: QUOTA_STORAGE_PREDEFINITA_BYTES,
    fatturazione: {
      partitaIva: null,
      codiceFiscale: null,
      indirizzoLegale: null,
      emailAmministrativa: null,
      pec: null,
      codiceSdi: null,
    },
    note: null,
  };
}

export const tenantsRouter = router({
  /**
   * L'azienda della sessione. `sessionProcedure`: risponde anche dietro la
   * porta chiusa e in sola lettura, così il client sa sempre dove si trova.
   */
  mio: sessionProcedure.query(({ ctx }) => {
    const multiAzienda = interruttoreAttivo("multiAzienda");
    const tenant =
      ctx.tenant ??
      getTenantRepository().perId(ctx.tenantId ?? TENANT_PREDEFINITO_ID) ??
      tenantPredefinitoSintetico();
    return {
      id: tenant.id,
      slug: tenant.slug,
      nome: tenant.nome,
      stato: tenant.stato,
      // `ctx.user` è `User | LocalUser`: il ramo OAuth (`User`) non ha
      // `ruoli`/`ruolo`, quindi tsc rifiuta l'assegnazione strutturale
      // ("weak type") anche se a runtime `ruoliDi` gestisce già l'assenza.
      proprietario: ruoliDi(ctx.user as any).includes(RUOLO_PROPRIETARIO),
      multiAzienda,
      // `piattaforma` (WS6 §3.1): stesso helper della guardia
      // `requirePiattaforma` (server/_core/trpc.ts) — rilegge il record
      // dallo store del tenant 1 e richiede `loginMethod === "local"`
      // (mirror di `risolviTenantPerUtente`, tenants/contesto.ts), così un
      // utente OAuth legacy con lo stesso id numerico di un amministratore
      // non risulta mai amministratore della piattaforma.
      piattaforma: utenteAmministratore(ctx.user as any) !== null,
    };
  }),

  /** Uso dello storage dell'azienda della sessione: conta e avvisa, non blocca (spec WS3 §3.2). */
  storage: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = tenantDelContesto(ctx);
    const stato = await getTenantRepository().storageDi(tenantId);
    const quotaBytes = stato?.quotaBytes ?? getTenantRepository().perId(tenantId)?.storageQuotaBytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES;
    const bytes = stato?.bytes ?? 0;
    return {
      bytes,
      file: stato?.file ?? 0,
      quotaBytes,
      percentuale: percentualeStorage(bytes, quotaBytes),
      sogliaAvvisata: stato?.sogliaAvvisata ?? 0,
      ricalcolatoIl: stato?.ricalcolatoIl ?? null,
    };
  }),

  /**
   * Il contratto dell'azienda della sessione (spec WS4 §8): che cosa ha,
   * fino a quando, e se è in sola lettura. Un'azienda senza riga di
   * abbonamento (installazione più vecchia del WS4, o creazione a metà)
   * risponde con tutti i campi a null invece di un errore: la scheda deve
   * poter dire «nessun abbonamento», non rompersi.
   */
  abbonamento: protectedProcedure.query(({ ctx }) => {
    const tenantId = tenantDelContesto(ctx);
    const repo = getTenantRepository();
    const abbonamento = repo.abbonamentoDi(tenantId);
    const tenant = ctx.tenant ?? repo.perId(tenantId);
    return {
      tipo: abbonamento?.tipo ?? null,
      stato: abbonamento?.stato ?? null,
      periodicita: abbonamento?.periodicita ?? null,
      inizioPeriodo: abbonamento?.inizioPeriodo ?? null,
      finePeriodo: abbonamento?.finePeriodo ?? null,
      prossimoRinnovo: abbonamento?.prossimoRinnovo ?? null,
      disdettaAFinePeriodo: abbonamento?.disdettaAFinePeriodo ?? false,
      omaggio: abbonamento?.omaggio
        ? {
            scadenza: abbonamento.omaggio.scadenzaIso
              ? new Date(abbonamento.omaggio.scadenzaIso)
              : null,
          }
        : null,
      giorniAllaScadenza: abbonamento ? giorniAllaScadenza(abbonamento, new Date()) : null,
      // La sola lettura è quella del WS1: la porta la chiude lo stato del
      // tenant, non l'abbonamento (che l'ha solo decisa).
      solaLettura: tenant?.stato === "sospeso",
    };
  }),

  /**
   * Le due risorse misurate dell'azienda (spec WS4 §8): byte occupati e
   * budget Tars del mese, ciascuna con la data in cui la tolleranza scade e
   * il limite comincia a bloccare. Budget ed extra in euro li vedono solo
   * proprietario e direzione: sono numeri di contratto, non di lavoro.
   */
  consumi: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = tenantDelContesto(ctx);
    const adesso = new Date();
    const repo = getTenantRepository();
    const abbonamento = repo.abbonamentoDi(tenantId);
    const stato = await repo.storageDi(tenantId);
    const quotaBytes =
      stato?.quotaBytes ?? repo.perId(tenantId)?.storageQuotaBytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES;
    const bytes = stato?.bytes ?? 0;

    const ruoli = ruoliDi(ctx.user as any);
    const vedeGliImporti = ruoli.includes(RUOLO_PROPRIETARIO) || ruoli.includes("direzione");

    const mese = meseLocale(adesso);
    const extraNano: number | null =
      abbonamento == null
        ? null
        : abbonamento.extraTarsMese === mese
          ? Math.max(0, abbonamento.extraTarsNano)
          : 0;
    // Nessun tetto per azienda (tenant 1, piano senza budget): niente
    // percentuale da mostrare — e nessuna somma da chiedere al ledger.
    const tettoNano =
      abbonamento?.budgetTarsNanoMese == null ? null : abbonamento.budgetTarsNanoMese + (extraNano ?? 0);
    // Il ledger dei costi vive su PostgreSQL: senza database (sviluppo) la
    // lettura lancia. Una scheda che non sa dire la percentuale la dà `null`
    // — «non lo so» — invece di far fallire tutta la query o, peggio, di
    // mostrare uno zero rassicurante e falso.
    let consumoNano: number | null = null;
    if (tettoNano != null) {
      try {
        consumoNano = await ledgerCorrente().consumoAziendaMese({ tenantId, adesso });
      } catch (errore) {
        console.warn(
          `[abbonamenti] consumo Tars del tenant ${tenantId} non leggibile: ` +
            (errore instanceof Error ? errore.message : String(errore))
        );
      }
    }
    const tolleranzaTarsGiorni = abbonamento?.tolleranzaTarsGiorni ?? TOLLERANZA_PREDEFINITA_GIORNI;

    return {
      storage: {
        bytes,
        quotaBytes,
        percentuale: percentualeStorage(bytes, quotaBytes),
        // `bloccoDal` c'è già mentre la tolleranza corre: è la data che la
        // scheda mostra per dire «da qui in poi non si carica più».
        bloccoDal: stato ? bloccoStorage(stato, abbonamento, adesso).bloccoDal : null,
        tolleranzaGiorni: abbonamento?.tolleranzaStorageGiorni ?? TOLLERANZA_PREDEFINITA_GIORNI,
      },
      tars: {
        percentuale:
          tettoNano == null || consumoNano == null
            ? null
            : percentualeBudget(consumoNano, tettoNano),
        budgetEur:
          vedeGliImporti && abbonamento?.budgetTarsNanoMese != null
            ? euro(abbonamento.budgetTarsNanoMese)
            : null,
        extraEur: vedeGliImporti && extraNano != null ? euro(extraNano) : null,
        bloccoDal: abbonamento?.tarsSoglia100Dal
          ? new Date(abbonamento.tarsSoglia100Dal.getTime() + tolleranzaTarsGiorni * MS_GIORNO)
          : null,
        tolleranzaGiorni: tolleranzaTarsGiorni,
        mese,
      },
    };
  }),
});
