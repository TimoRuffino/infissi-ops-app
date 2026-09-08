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
import { periodiLocali } from "../tars/costi/ledger";
import { getTenantRepository } from "../tenants/repository";
import type { StatoStorage } from "../tenants/tipi";
import { MESSAGGI_ABBONAMENTO, TOLLERANZA_PREDEFINITA_GIORNI } from "./costanti";
import type { Abbonamento } from "./tipi";

const MS_GIORNO = 86_400_000;

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
  const eventi = await repo.eventi(tenantId, { ultimi: 50 });

  if (bloccato) {
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
  return null;
}

/** Registrato al boot, subito dopo il contabile dei byte (`preparaTenants`, spec §6). */
export function registraGanciQuota(): void {
  impostaVerificaQuota(verificaCaricamento);
}
