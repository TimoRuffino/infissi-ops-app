// server/abbonamenti/quota.ts
// Quota storage che blocca (spec WS4 §6): il WS3 (server/tenants/storage.ts)
// conta i byte e avvisa alle soglie 50/80/100 %; qui si decide se un
// caricamento NUOVO va rifiutato — solo a interruttore acceso, solo oltre la
// tolleranza dalla prima volta al 100 % (`soglia100Dal`, impostata da
// `applicaSoglie`), e SOLO se `registraGanciQuota()` ha agganciato questa
// funzione a `fileStorage.ts` al boot. A interruttore spento, o senza
// gancio, nessun upload viene mai rifiutato da qui.
import { impostaVerificaQuota } from "../_core/fileStorage";
import { interruttoreAttivo } from "../platform/interruttori";
import {
  impostaPoliticaTarsAzienda,
  type PoliticaTarsAzienda,
} from "../tars/costi/governor";
import { periodiLocali } from "../tars/costi/ledger";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { getTenantRepository } from "../tenants/repository";
import type { StatoStorage, TenantEvento } from "../tenants/tipi";
import { MESSAGGI_ABBONAMENTO, meseLocale, TOLLERANZA_PREDEFINITA_GIORNI } from "./costanti";
import type { Abbonamento } from "./tipi";

const MS_GIORNO = 86_400_000;

// Fix round 1 (R11): tenant visti bloccati in QUESTO processo. Serve solo a
// non perdere lo sblocco pendente quando `applicaSoglie` ha già azzerato
// `soglia100Dal` (l'azienda è scesa sotto quota) prima che `verificaCaricamento`
// abbia potuto scrivere `storage_sbloccato`. Dopo un riavvio il set riparte
// vuoto: il prossimo caricamento di un'azienda ancora bloccata lo aggiunge di
// nuovo da sé (bloccato === true), e un'azienda scesa sotto quota MENTRE il
// processo era giù semplicemente non riceve quello sblocco (accettabile: non
// è mai stata segnalata come bloccata da QUESTO processo).
const bloccatiVisti = new Set<number>();

/**
 * Puro: se lo storage è bloccato ad `adesso`, e da quando lo sarebbe (utile
 * anche quando NON è ancora bloccato, per la scheda «Abbonamento e
 * consumi», spec §8). Sotto quota, o senza quota (`quotaBytes <= 0`, piano
 * senza tetto), non blocca mai. A quota o oltre, la tolleranza (in giorni,
 * per azienda: `abbonamento.tolleranzaStorageGiorni`, predefinita
 * `TOLLERANZA_PREDEFINITA_GIORNI` se l'abbonamento manca) parte da
 * `soglia100Dal` — impostata da `applicaSoglie` al primo attraversamento del
 * 100 %. Una riga a quota ma senza `soglia100Dal` (mai vista impostare, più
 * vecchia di questa logica) non blocca subito: la tolleranza riparte da
 * `adesso`, come se il 100 % fosse appena scattato — il giro successivo la
 * vedrà davvero.
 */
export function bloccoStorage(
  stato: StatoStorage,
  abbonamento: Abbonamento | null,
  adesso: Date
): { bloccato: boolean; bloccoDal: Date | null } {
  if (stato.quotaBytes <= 0 || stato.bytes < stato.quotaBytes) {
    return { bloccato: false, bloccoDal: null };
  }
  const tolleranzaGiorni = abbonamento?.tolleranzaStorageGiorni ?? TOLLERANZA_PREDEFINITA_GIORNI;
  const dal = stato.soglia100Dal ?? adesso;
  const bloccoDal = new Date(dal.getTime() + tolleranzaGiorni * MS_GIORNO);
  return { bloccato: adesso.getTime() >= bloccoDal.getTime(), bloccoDal };
}

/**
 * Il gancio di `fileStorage.ts` (spec §6). `bytes` (la dimensione del file
 * in arrivo) fa parte del contratto di `VerificaQuota` ma non entra nel
 * calcolo: si blocca sui byte GIÀ occupati dall'azienda, non su quanto sta
 * per arrivare — un file piccolo non compra un passaggio quando l'azienda è
 * già oltre quota e tolleranza.
 *
 * Il primo rifiuto del giorno locale (Europe/Rome, `periodiLocali`) registra
 * `storage_bloccato`; tornando sotto quota si registra `storage_sbloccato`,
 * SOLO se l'ultimo dei due eventi in cronologia era un blocco — mai uno
 * sblocco ripetuto a ogni upload di un'azienda già libera.
 */
export async function verificaCaricamento(
  tenantId: number,
  bytes: number,
  adesso: Date = new Date()
): Promise<{ messaggio: string } | null> {
  if (!interruttoreAttivo("multiAzienda")) return null;
  const repo = getTenantRepository();
  const stato = await repo.storageDi(tenantId);
  if (!stato) return null; // nessun byte mai contato per questa azienda: niente da bloccare
  const abbonamento = repo.abbonamentoDi(tenantId);
  const { bloccato, bloccoDal } = bloccoStorage(stato, abbonamento, adesso);

  // Fix round 1 (R11): `repo.eventi` è un giro DB in più (~147ms, la voce di
  // costo dominante qui) ad OGNI caricamento — inutile per un'azienda
  // tranquilla che non ha mai visto il 100%. Si legge SOLO se c'è qualcosa
  // da deduplicare o da chiudere: un blocco (magari già scritto oggi), la
  // riga al 100% o oltre anche solo dentro la tolleranza (`bloccoDal` non è
  // null esattamente in quel caso — stesso confine di `bloccoStorage`),
  // `soglia100Dal` ancora valorizzata, oppure un tenant che questo processo
  // ha già visto bloccato e per cui potrebbe mancare ancora lo sblocco
  // (`bloccatiVisti`: copre il caso in cui `applicaSoglie` abbia già
  // azzerato `soglia100Dal` scendendo sotto quota).
  const potrebbeServireLaCronologia =
    bloccato || bloccoDal != null || stato.soglia100Dal != null || bloccatiVisti.has(tenantId);
  if (!potrebbeServireLaCronologia) {
    return null;
  }

  // Assunzione sulla finestra "ultimi 50": in tenant_eventi vivono solo
  // eventi rari (creazione abbonamento, soglie, blocchi/sblocchi, pagamenti,
  // ...). Un futuro tipo di evento ad alta frequenza renderebbe 50
  // insufficiente e chiederebbe un filtro per `tipo`, non gli "ultimi N".
  const eventi = await repo.eventi(tenantId, { ultimi: 50 });

  if (bloccato) {
    bloccatiVisti.add(tenantId);
    const oggi = periodiLocali(adesso).giorno;
    const giaOggi = eventi.some(
      e => e.tipo === "storage_bloccato" && periodiLocali(e.createdAt).giorno === oggi
    );
    if (!giaOggi) {
      await repo.registraEvento({
        tenantId,
        tipo: "storage_bloccato",
        attore: "sistema",
        dettagli: {
          bytes: stato.bytes,
          quotaBytes: stato.quotaBytes,
          bloccoDal: bloccoDal?.toISOString() ?? null,
        },
      });
    }
    return { messaggio: MESSAGGI_ABBONAMENTO.spazioEsaurito(Math.round(stato.quotaBytes / 1024 ** 3)) };
  }

  // Non bloccato: se l'ultimo evento di blocco/sblocco in cronologia era un
  // blocco, l'azienda si è appena liberata (spazio recuperato, o quota
  // alzata) — si registra lo sblocco una volta sola.
  const ultimo = [...eventi].reverse().find(e => e.tipo === "storage_bloccato" || e.tipo === "storage_sbloccato");
  if (ultimo?.tipo === "storage_bloccato") {
    await repo.registraEvento({
      tenantId,
      tipo: "storage_sbloccato",
      attore: "sistema",
      dettagli: { bytes: stato.bytes, quotaBytes: stato.quotaBytes },
    });
  }
  bloccatiVisti.delete(tenantId);
  return null;
}

// ── Budget Tars per azienda (spec §7) ───────────────────────────────────
//
// Stessa forma della quota storage, altra materia: il ledger dei costi
// (`server/tars/costi/`) conta i nano-dollari per azienda e per mese, qui si
// decide quanto può spendere e quando smettere. Il governor non conosce gli
// abbonamenti: riceve questa politica al boot e le chiede un numero.

export const SOGLIE_TARS = [50, 80, 100] as const;
export type SogliaTars = 0 | 50 | 80 | 100;

// Fix R11 dello storage, stessa ragione: aziende viste bloccate in QUESTO
// processo. Serve a non perdere lo sblocco quando il consumo torna sotto il
// 100 % (mese nuovo, budget alzato) — e a non leggere la cronologia a ogni
// chiamata di un'azienda tranquilla. Dopo un riavvio riparte vuoto: la
// prossima chiamata rifiutata la rimette dentro da sé.
const bloccatiTars = new Set<number>();

/**
 * La soglia più alta raggiunta dal consumo del mese, come `sogliaRaggiunta`
 * per lo storage. Nessun budget (`null`: tenant 1, piano senza tetto) =
 * nessuna soglia; un budget ZERO è un piano senza Tars incluso, quindi
 * esaurito per definizione — non una divisione per zero.
 */
export function sogliaTars(consumoNano: number, budgetNano: number | null): SogliaTars {
  if (budgetNano == null) return 0;
  if (budgetNano <= 0) return 100;
  const percentuale = (consumoNano / budgetNano) * 100;
  let raggiunta: SogliaTars = 0;
  for (const s of SOGLIE_TARS) if (percentuale >= s) raggiunta = s;
  return raggiunta;
}

/**
 * L'abbonamento che governa il budget Tars dell'azienda, o `null` quando non
 * c'è tetto per azienda: interruttore spento, tenant 1 (la proprietaria della
 * piattaforma paga i propri costi, valgono i tetti globali `TARS_*`) o piano
 * senza budget. Legge dalla cache del repository: nessun giro di database.
 */
function abbonamentoConBudget(tenantId: number): Abbonamento | null {
  if (!interruttoreAttivo("multiAzienda")) return null;
  if (tenantId === TENANT_PREDEFINITO_ID) return null;
  const abbonamento = getTenantRepository().abbonamentoDi(tenantId);
  if (!abbonamento || abbonamento.budgetTarsNanoMese == null) return null;
  return abbonamento;
}

/** Budget del piano più l'extra concesso PER QUESTO mese (spec §9). */
function tettoDelMese(abbonamento: Abbonamento, adesso: Date): number {
  const extra =
    abbonamento.extraTarsMese === meseLocale(adesso) ? abbonamento.extraTarsNano : 0;
  return (abbonamento.budgetTarsNanoMese ?? 0) + Math.max(0, extra);
}

/** Da quando il 100 % diventa un blocco (null se il 100 % non è mai scattato). */
function bloccoDa(abbonamento: Abbonamento): Date | null {
  if (!abbonamento.tarsSoglia100Dal) return null;
  const giorni = abbonamento.tolleranzaTarsGiorni ?? TOLLERANZA_PREDEFINITA_GIORNI;
  return new Date(abbonamento.tarsSoglia100Dal.getTime() + giorni * MS_GIORNO);
}

/** L'ultimo fra blocco e sblocco in cronologia: dice se c'è uno sblocco da scrivere. */
function ultimoBloccoTars(eventi: TenantEvento[]): TenantEvento | undefined {
  return [...eventi]
    .reverse()
    .find(e => e.tipo === "tars_bloccato" || e.tipo === "tars_sbloccato");
}

/**
 * La politica iniettata nel governor (spec §7). `limite` gira PRIMA di ogni
 * prenotazione e deve costare quanto una lettura in memoria; `dopoPrenotazione`
 * gira dopo, fuori dal percorso della risposta, e scrive solo quando c'è
 * davvero qualcosa di nuovo da registrare.
 */
export function politicaTarsAzienda(): PoliticaTarsAzienda {
  return {
    async limite(tenantId, adesso) {
      const abbonamento = abbonamentoConBudget(tenantId);
      if (!abbonamento) return { limiteNano: null, bloccante: false };
      const blocco = bloccoDa(abbonamento);
      return {
        limiteNano: tettoDelMese(abbonamento, adesso),
        // Prima della tolleranza il tetto conta e avvisa, non blocca: chi ha
        // finito il budget oggi continua a lavorare per i giorni concordati.
        bloccante: blocco != null && adesso.getTime() > blocco.getTime(),
      };
    },

    async dopoPrenotazione(tenantId, aziendaMeseNano, adesso, esito) {
      const abbonamento = abbonamentoConBudget(tenantId);
      if (!abbonamento) return;
      const repo = getTenantRepository();
      const mese = meseLocale(adesso);
      const tetto = tettoDelMese(abbonamento, adesso);

      // Mese nuovo: il budget si rinnova il primo del mese, quindi soglie
      // avvisate e timbro del 100 % ripartono da zero (spec §7).
      const meseCambiato = abbonamento.tarsSogliaMese !== mese;
      let prossimo: Abbonamento = meseCambiato
        ? { ...abbonamento, tarsSogliaMese: mese, tarsSogliaAvvisata: 0, tarsSoglia100Dal: null }
        : abbonamento;
      let daSalvare = meseCambiato;

      const raggiunta = sogliaTars(aziendaMeseNano, tetto);
      // Il timbro del primo 100 % non si sposta ai giri successivi (la
      // tolleranza si conta da lì) e si azzera tornando sotto: un budget
      // alzato o un mese nuovo tolgono il blocco senza intervento a mano.
      if (raggiunta === 100 && !prossimo.tarsSoglia100Dal) {
        prossimo = { ...prossimo, tarsSoglia100Dal: adesso };
        daSalvare = true;
      }
      if (raggiunta < 100 && prossimo.tarsSoglia100Dal) {
        prossimo = { ...prossimo, tarsSoglia100Dal: null };
        daSalvare = true;
      }
      if (raggiunta > prossimo.tarsSogliaAvvisata) {
        await repo.registraEvento({
          tenantId,
          tipo: "tars_soglia",
          attore: "sistema",
          dettagli: { percentuale: raggiunta, mese },
        });
        prossimo = { ...prossimo, tarsSogliaAvvisata: raggiunta };
        daSalvare = true;
      } else if (raggiunta === 0 && prossimo.tarsSogliaAvvisata > 0) {
        // Sotto il 50 % si riarma, come le soglie dello storage.
        prossimo = { ...prossimo, tarsSogliaAvvisata: 0 };
        daSalvare = true;
      }
      if (daSalvare) await repo.salvaAbbonamento(prossimo);

      // La cronologia (un giro di database) si legge SOLO quando serve: al
      // rifiuto, o quando questo processo ha già visto l'azienda bloccata e
      // potrebbe doverle uno sblocco.
      if (esito.rifiutata) {
        bloccatiTars.add(tenantId);
        const oggi = periodiLocali(adesso).giorno;
        const eventi = await repo.eventi(tenantId, { ultimi: 50 });
        const giaOggi = eventi.some(
          e => e.tipo === "tars_bloccato" && periodiLocali(e.createdAt).giorno === oggi
        );
        if (!giaOggi) {
          await repo.registraEvento({
            tenantId,
            tipo: "tars_bloccato",
            attore: "sistema",
            dettagli: {
              percentuale: raggiunta,
              mese,
              bloccoDal: bloccoDa(prossimo)?.toISOString() ?? null,
            },
          });
        }
        return;
      }
      if (!bloccatiTars.has(tenantId)) return;
      const eventi = await repo.eventi(tenantId, { ultimi: 50 });
      if (ultimoBloccoTars(eventi)?.tipo === "tars_bloccato") {
        await repo.registraEvento({
          tenantId,
          tipo: "tars_sbloccato",
          attore: "sistema",
          dettagli: { percentuale: raggiunta, mese },
        });
      }
      bloccatiTars.delete(tenantId);
    },
  };
}

/**
 * Registrato al boot, subito dopo il contabile dei byte (`preparaTenants`,
 * spec §6 e §7): senza questa chiamata `putFile` non blocca mai nulla e il
 * governor non conosce alcun tetto per azienda.
 */
export function registraGanciQuota(): void {
  impostaVerificaQuota(verificaCaricamento);
  impostaPoliticaTarsAzienda(politicaTarsAzienda());
}
