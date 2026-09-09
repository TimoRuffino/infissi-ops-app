// server/piattaforma/letture.ts
// Le letture del pannello piattaforma (WS6 spec §5.1), chiamate dal router:
// `elencoAziende` compone una riga per azienda con abbonamento, spazio,
// Tars, worker sospesi, ultimo backup e proprietari; `schedaAzienda`
// arricchisce la riga di una sola azienda per il dettaglio. Nessun modulo di
// dominio qui dentro (guardia server/piattaforma/confine.test.ts): solo
// control plane (server/tenants/repository.ts, il ledger dei costi) e gli
// store globali di utenti e sedi.
import { backupLog } from "../_core/driveBackup";
import {
  meseLocale,
  nanoInEur,
  percentualeBudget,
  TOLLERANZA_PREDEFINITA_GIORNI,
} from "../abbonamenti/costanti";
import { bloccoStorage } from "../abbonamenti/quota";
import { giorniAllaScadenza } from "../abbonamenti/servizio";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { ledgerCorrente } from "../tars/costi/ledger";
import { workerSospesi } from "../tenants/cli";
import { RUOLO_PROPRIETARIO } from "../tenants/costanti";
import { conTenant } from "../tenants/contestoCorrente";
import { getTenantRepository, type TenantRepository } from "../tenants/repository";
import { percentualeStorage } from "../tenants/storage";
import type {
  Abbonamento,
  Omaggio,
  Periodicita,
  StatoAbbonamento,
  StatoStorage,
  StatoTenant,
  TenantComando,
  TenantEvento,
  TenantInvito,
  TenantRecord,
  TipoAbbonamento,
} from "../tenants/tipi";

const MS_GIORNO = 86_400_000;

/**
 * Euro con due decimali (stesso helper di server/tenants/router.ts): gli
 * importi vivono in nano-dollari e senza arrotondare un budget di 25 €
 * mostrerebbe 25,000000000000004.
 */
function euro(nano: number): number {
  return Math.round(nanoInEur(nano) * 100) / 100;
}

function messaggioErrore(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type AziendaRiga = {
  id: number;
  slug: string;
  nome: string;
  stato: StatoTenant;
  motivoStato: string | null;
  createdAt: Date;
  abbonamento: {
    tipo: TipoAbbonamento;
    stato: StatoAbbonamento;
    finePeriodo: Date | null;
    prossimoRinnovo: Date | null;
    omaggio: { scadenzaIso: string | null } | null;
    insolutoDal: Date | null;
    disdettaAFinePeriodo: boolean;
  } | null;
  storage:
    | {
        bytes: number;
        file: number;
        quotaBytes: number;
        percentuale: number;
        soglia100Dal: Date | null;
        ricalcolatoIl: Date | null;
        /** Da quando i caricamenti nuovi si fermerebbero (§6): null = mai, o non ancora bloccante. */
        bloccoDal: Date | null;
      }
    | null;
  tars: {
    mese: string;
    consumoEur: number | null;
    budgetEur: number | null;
    extraEur: number;
    percentuale: number | null;
    bloccoDal: Date | null;
  };
  workerSospesi: Array<{ etichetta: string; finoA: Date; errore: string }>;
  comandiInAttesa: number;
  ultimoBackup: ReturnType<typeof backupLog>[number] | null;
  proprietari: Array<{ id: number; nome: string; cognome: string; email: string; attivo: boolean }>;
  invitoInSospeso: { email: string; scadeIl: Date } | null;
};

/** L'abbonamento completo dell'azienda, in unità umane (euro, giorni) per la scheda di dettaglio. */
export type AbbonamentoCompleto = {
  tipo: TipoAbbonamento;
  periodicita: Periodicita | null;
  stato: StatoAbbonamento;
  inizioPeriodo: Date;
  finePeriodo: Date | null;
  prossimoRinnovo: Date | null;
  disdettaAFinePeriodo: boolean;
  budgetTarsEur: number | null;
  extraTarsEur: number;
  extraTarsMese: string | null;
  tolleranzaStorageGiorni: number;
  tolleranzaTarsGiorni: number;
  giorniAllaScadenza: number | null;
  insolutoDal: Date | null;
  provider: string;
  providerRef: Record<string, unknown> | null;
  omaggio: Omaggio | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SchedaAzienda = Omit<AziendaRiga, "abbonamento"> & {
  sedi: Array<{ id: number; nome: string; attiva: boolean }>;
  abbonamento: AbbonamentoCompleto | null;
  eventi: TenantEvento[];
  comandi: TenantComando[];
  inviti: TenantInvito[];
  backup: ReturnType<typeof backupLog>;
  provider: string;
};

function abbonamentoNarrow(a: Abbonamento | null): AziendaRiga["abbonamento"] {
  if (!a) return null;
  return {
    tipo: a.tipo,
    stato: a.stato,
    finePeriodo: a.finePeriodo,
    prossimoRinnovo: a.prossimoRinnovo,
    omaggio: a.omaggio ? { scadenzaIso: a.omaggio.scadenzaIso } : null,
    insolutoDal: a.insolutoDal,
    disdettaAFinePeriodo: a.disdettaAFinePeriodo,
  };
}

function abbonamentoCompleto(a: Abbonamento | null, adesso: Date): AbbonamentoCompleto | null {
  if (!a) return null;
  return {
    tipo: a.tipo,
    periodicita: a.periodicita,
    stato: a.stato,
    inizioPeriodo: a.inizioPeriodo,
    finePeriodo: a.finePeriodo,
    prossimoRinnovo: a.prossimoRinnovo,
    disdettaAFinePeriodo: a.disdettaAFinePeriodo,
    budgetTarsEur: a.budgetTarsNanoMese == null ? null : euro(a.budgetTarsNanoMese),
    extraTarsEur: euro(a.extraTarsNano),
    extraTarsMese: a.extraTarsMese,
    tolleranzaStorageGiorni: a.tolleranzaStorageGiorni,
    tolleranzaTarsGiorni: a.tolleranzaTarsGiorni,
    giorniAllaScadenza: giorniAllaScadenza(a, adesso),
    insolutoDal: a.insolutoDal,
    provider: a.provider,
    providerRef: a.providerRef,
    omaggio: a.omaggio,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/** Storia in unità umane, con `bloccoDal` (spec §6) quando c'è un abbonamento a governarlo. */
function calcolaStorage(stato: StatoStorage | null, abbonamento: Abbonamento | null, adesso: Date): AziendaRiga["storage"] {
  if (!stato) return null;
  const blocco = abbonamento ? bloccoStorage(stato, abbonamento, adesso) : { bloccato: false, bloccoDal: null };
  return {
    bytes: stato.bytes,
    file: stato.file,
    quotaBytes: stato.quotaBytes,
    percentuale: percentualeStorage(stato.bytes, stato.quotaBytes),
    soglia100Dal: stato.soglia100Dal,
    ricalcolatoIl: stato.ricalcolatoIl,
    bloccoDal: blocco.bloccoDal,
  };
}

/** Stesso calcolo di `tenants.consumi` (server/tenants/router.ts), senza il filtro per ruolo: qui vede sempre l'amministratore. */
function calcolaTars(abbonamento: Abbonamento | null, consumoNano: number | null, adesso: Date): AziendaRiga["tars"] {
  const mese = meseLocale(adesso);
  const extraNano = abbonamento && abbonamento.extraTarsMese === mese ? Math.max(0, abbonamento.extraTarsNano) : 0;
  const tettoNano = abbonamento?.budgetTarsNanoMese == null ? null : abbonamento.budgetTarsNanoMese + extraNano;
  const tolleranzaTarsGiorni = abbonamento?.tolleranzaTarsGiorni ?? TOLLERANZA_PREDEFINITA_GIORNI;
  return {
    mese,
    consumoEur: consumoNano == null ? null : euro(consumoNano),
    budgetEur: abbonamento?.budgetTarsNanoMese == null ? null : euro(abbonamento.budgetTarsNanoMese),
    extraEur: euro(extraNano),
    percentuale: tettoNano == null || consumoNano == null ? null : percentualeBudget(consumoNano, tettoNano),
    bloccoDal: abbonamento?.tarsSoglia100Dal
      ? new Date(abbonamento.tarsSoglia100Dal.getTime() + tolleranzaTarsGiorni * MS_GIORNO)
      : null,
  };
}

/**
 * Il consumo Tars del mese per TUTTE le aziende, una query sola (spec §4.4).
 * Come `tenants.consumi` (server/tenants/router.ts): un ledger irraggiungibile
 * dà `null` — «non lo so», mai uno zero bugiardo — invece di far fallire
 * l'elenco intero. Un'azienda assente dalla mappa (nessuna riga questo
 * mese) è un vero zero, non «non lo so»: il chiamante distingue i due casi
 * su `consumi === null`.
 */
async function consumiTars(adesso: Date): Promise<Map<number, number> | null> {
  try {
    return await ledgerCorrente().consumoAziendeMese({ adesso });
  } catch (errore) {
    console.warn(`[piattaforma] consumo Tars dell'elenco aziende non leggibile: ${messaggioErrore(errore)}`);
    return null;
  }
}

async function rigaAzienda(
  repo: TenantRepository,
  t: TenantRecord,
  d: {
    storage: StatoStorage | null;
    abbonamento: Abbonamento | null;
    workerSospesi: Array<{ etichetta: string; finoA: Date; errore: string }>;
    comandiInAttesa: number;
    consumoNano: number | null;
    adesso: Date;
  }
): Promise<AziendaRiga> {
  // proprietari: control plane — chi possiede l'azienda, non i suoi dati di
  // dominio (lettura in memoria dentro il contesto dell'azienda: lo store
  // utenti è globale, ma ogni lettura per tenant passa comunque da
  // conTenant, come richiesto dalla spec §5.3).
  const proprietari = conTenant(t.id, () =>
    getUtentiStore()
      .filter((u: any) => u.tenantId === t.id && (u.ruoli ?? []).includes(RUOLO_PROPRIETARIO))
      .map((u: any) => ({ id: u.id, nome: u.nome, cognome: u.cognome, email: u.email, attivo: u.attivo !== false }))
  );
  // ultimo backup: control plane — l'ESITO dell'ultimo backup dell'azienda,
  // non i file che contiene (lettura in memoria dentro il contesto: il log
  // dei backup è per-tenant).
  const ultimoBackup = conTenant(t.id, () => backupLog(1)[0] ?? null);

  let invitoInSospeso: AziendaRiga["invitoInSospeso"] = null;
  if (!proprietari.some(p => p.attivo)) {
    // Solo le aziende senza un proprietario attivo pagano questo giro in
    // più (di solito zero): un'azienda con proprietario non ha nulla da
    // mostrare qui, e leggere gli inviti per ognuna romperebbe la regola di
    // costo dell'elenco.
    const inviti = await repo.invitiDi(t.id);
    const valido = inviti.find(i => !i.usatoIl && !i.annullatoIl && i.scadeIl.getTime() > d.adesso.getTime());
    if (valido) invitoInSospeso = { email: valido.email, scadeIl: valido.scadeIl };
  }

  return {
    id: t.id,
    slug: t.slug,
    nome: t.nome,
    stato: t.stato,
    motivoStato: t.motivoStato,
    createdAt: t.createdAt,
    abbonamento: abbonamentoNarrow(d.abbonamento),
    storage: calcolaStorage(d.storage, d.abbonamento, d.adesso),
    tars: calcolaTars(d.abbonamento, d.consumoNano, d.adesso),
    workerSospesi: d.workerSospesi,
    comandiInAttesa: d.comandiInAttesa,
    ultimoBackup,
    proprietari,
    invitoInSospeso,
  };
}

/**
 * L'elenco di tutte le aziende (spec §5.1). Regola di costo VINCOLANTE: al
 * più cinque giri di query in tutto — `storageTutti`, `eventiRecenti`,
 * `comandiInAttesa`, `consumoAziendeMese`, e `invitiDi` solo per le aziende
 * senza un proprietario attivo (di solito zero). Mai `storageDi`, `eventi`
 * (singolare) o `comandiDi` dentro il ciclo per azienda: userebbero un giro
 * a testa invece di uno per l'elenco intero (~147 ms ciascuno).
 */
export async function elencoAziende(adesso: Date): Promise<AziendaRiga[]> {
  const repo = getTenantRepository();
  const tenants = repo.tutti();
  const [storage, eventiWorker, inAttesa, consumi] = await Promise.all([
    repo.storageTutti(),
    repo.eventiRecenti({ tipi: ["worker_sospeso", "worker_riarmato"], da: new Date(adesso.getTime() - 24 * 3600_000) }),
    repo.comandiInAttesa(),
    consumiTars(adesso),
  ]);
  const storagePer = new Map(storage.map(s => [s.tenantId, s]));
  return Promise.all(
    tenants.map(t =>
      rigaAzienda(repo, t, {
        storage: storagePer.get(t.id) ?? null,
        abbonamento: repo.abbonamentoDi(t.id),
        workerSospesi: workerSospesi(
          eventiWorker.filter(e => e.tenantId === t.id),
          adesso
        ),
        comandiInAttesa: inAttesa.filter(c => c.tenantId === t.id).length,
        consumoNano: consumi?.get(t.id) ?? (consumi ? 0 : null),
        adesso,
      })
    )
  );
}

/**
 * La scheda completa di un'azienda (spec §5.1): l'elenco filtrato a una
 * riga, arricchito con sedi, abbonamento in unità umane, storia degli
 * eventi e dei comandi, inviti e ultimi backup. Non è sul percorso caldo
 * dell'elenco (una sola azienda alla volta), quindi riusa `elencoAziende`
 * invece di duplicarne la composizione dei campi. `null` per uno slug
 * sconosciuto: il NOT_FOUND lo decide il router (`oppureNotFound`), non
 * questa funzione.
 */
export async function schedaAzienda(slug: string, adesso: Date): Promise<SchedaAzienda | null> {
  const repo = getTenantRepository();
  const tenant = repo.perSlug(slug);
  if (!tenant) return null;
  const righe = await elencoAziende(adesso);
  const riga = righe.find(r => r.id === tenant.id);
  if (!riga) return null;

  const abbonamento = repo.abbonamentoDi(tenant.id);
  const [tenantSedi, eventi, comandi, inviti] = await Promise.all([
    repo.tenantSedi(),
    repo.eventi(tenant.id, { ultimi: 50 }),
    repo.comandiDi(tenant.id, { ultimi: 20 }),
    repo.invitiDi(tenant.id),
  ]);
  const idsDelTenant = new Set(tenantSedi.filter(r => r.tenantId === tenant.id).map(r => r.sedeId));
  // sedi: control plane — quali sedi appartengono all'azienda e il loro
  // nome/stato, non i dati che ci vivono dentro (lettura in memoria dentro
  // il contesto dell'azienda).
  const sedi = conTenant(tenant.id, () =>
    getSediStore()
      .filter(s => idsDelTenant.has(s.id))
      .map(s => ({ id: s.id, nome: s.nome, attiva: s.attiva }))
  );
  // backup: control plane — gli ultimi esiti di backup dell'azienda
  // (lettura in memoria dentro il contesto: il log dei backup è per-tenant).
  const backup = conTenant(tenant.id, () => backupLog(5));

  const { abbonamento: _narrow, ...restoRiga } = riga;
  return {
    ...restoRiga,
    sedi,
    abbonamento: abbonamentoCompleto(abbonamento, adesso),
    eventi,
    comandi,
    inviti,
    backup,
    provider: abbonamento?.provider ?? "nessuno",
  };
}
