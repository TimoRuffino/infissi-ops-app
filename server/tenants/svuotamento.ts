// server/tenants/svuotamento.ts
// La cancellazione differita del ciclo di vita (piano 10/09/2026, D5):
// eseguita SOLO dal comando `svuota_tenant`, che il giro del ciclo di vita
// accoda a fine ritenzione (o la CLI con `--forza`). L'ordine dei passi è
// pensato per il ritentativo: prima i file (idempotente: un file già assente
// non è un errore), poi le righe relazionali, poi gli archivi `kv_store`,
// poi utenti e sedi dagli store globali, e per ultima la lapide del control
// plane — finché la lapide non è scritta, rilanciare il comando rifà tutto.
import { getStorageDriver, statFile, tenantDellaChiave } from "../_core/fileStorage";
import { conTransazioneStoreAtomica, kvSql, rimuoviStoresDelTenant } from "../_core/persistence";
import { getSediPersistedStore, getSediStore } from "../routers/sedi";
import { getUtentiPersistedStore, getUtentiStore } from "../routers/utenti";
import { MESSAGGI, RITENZIONE_CANCELLAZIONE_MS, TENANT_PREDEFINITO_ID } from "./costanti";
import { conTenant } from "./contestoCorrente";
import { getTenantRepository } from "./repository";
import { perOgniFileDelTenant } from "./storage";
import { TABELLE_PER_SEDE } from "./tabelle";
import { attoreTesto, type Attore } from "./tipi";

export type EsitoSvuotamento = {
  file: number;
  fileNonCancellati: number;
  righeTabelle: number;
  store: number;
  righeKv: number;
  utenti: number;
  sedi: number;
  slug: string;
};

/**
 * Svuota un tenant `cancellato` oltre la ritenzione. Guardie (nell'ordine):
 * mai il tenant 1; il tenant esiste; stato `cancellato`; mai due volte
 * (`svuotatoIl`); ritenzione compiuta, salvo `forza` (solo CLI). Ogni rifiuto
 * è un errore del comando, tracciato come gli altri.
 */
export async function svuotaTenant(input: {
  tenantId: number;
  forza: boolean;
  attore: Attore;
  adesso?: Date;
}): Promise<EsitoSvuotamento> {
  const { tenantId } = input;
  const adesso = input.adesso ?? new Date();
  if (tenantId === TENANT_PREDEFINITO_ID) throw new Error(MESSAGGI.tenant1NonSiChiude);
  const repo = getTenantRepository();
  const tenant = repo.perId(tenantId);
  if (!tenant) throw new Error(`Tenant ${tenantId} inesistente`);
  if (tenant.svuotatoIl) throw new Error(MESSAGGI.aziendaSvuotata);
  if (tenant.stato !== "cancellato") {
    throw new Error(`Si svuota solo un'azienda cancellata (stato attuale: «${tenant.stato}»).`);
  }
  const cancellataDa = tenant.cancellatoIl ? adesso.getTime() - tenant.cancellatoIl.getTime() : 0;
  if (!input.forza && (!tenant.cancellatoIl || cancellataDa < RITENZIONE_CANCELLAZIONE_MS)) {
    throw new Error("La ritenzione di 30 giorni non è ancora compiuta.");
  }

  // 1. I file dello storage, camminando gli stessi record del ledger
  //    (`perOgniFileDelTenant`): un errore di cancellazione non ferma la
  //    camminata, ma se alla fine ne resta anche uno solo il comando
  //    fallisce e si ritenta — gli archivi sono ancora tutti al loro posto.
  let file = 0;
  let fileNonCancellati = 0;
  await conTenant(tenantId, () =>
    perOgniFileDelTenant(tenantId, async chiave => {
      // Cintura: mai una chiave di un'altra azienda (o legacy del tenant 1).
      if (tenantDellaChiave(chiave) !== tenantId) return;
      try {
        if (!(await statFile(chiave))) return; // già assente: un ritentativo non è un errore
        await getStorageDriver().delete(chiave);
        file++;
      } catch (errore) {
        fileNonCancellati++;
        console.error(
          `[svuotamento] tenant ${tenantId}: file non cancellato (${errore instanceof Error ? errore.message : errore})`
        );
      }
    })
  );
  if (fileNonCancellati > 0) {
    throw new Error(`Svuotamento interrotto: ${fileNonCancellati} file non cancellati dallo storage.`);
  }

  // 2. Le righe delle tabelle relazionali per sede: `tenant_id` timbrato, più
  //    la cintura sulle righe rimaste NULL ma di una sede del tenant. I nomi
  //    interpolati vengono SOLO da `TABELLE_PER_SEDE` (v. tabelle.ts); una
  //    tabella assente vale zero righe.
  let righeTabelle = 0;
  if (kvSql) {
    for (const t of TABELLE_PER_SEDE) {
      try {
        const esito = await kvSql.unsafe(
          `DELETE FROM ${t}
            WHERE tenant_id = $1
               OR (tenant_id IS NULL AND sede_id IN (SELECT sede_id FROM tenant_sedi WHERE tenant_id = $1))`,
          [tenantId]
        );
        righeTabelle += esito.count ?? 0;
      } catch (errore) {
        const codice = (errore as { code?: string } | null | undefined)?.code;
        if (codice !== "42P01" && codice !== "42703") throw errore; // tabella o colonna non ancora nate: zero righe
      }
    }
  }

  // 3. Gli archivi `kv_store` del tenant e le istanze in memoria.
  const { store, righeKv } = await rimuoviStoresDelTenant(tenantId);

  // 4. Utenti e sedi del tenant, via dagli store globali: le email tornano
  //    libere per una nuova iscrizione. Nessuna guardia di presidio: qui non
  //    resta nessuno da presidiare.
  let utenti = 0;
  let sedi = 0;
  await conTransazioneStoreAtomica([getSediPersistedStore(), getUtentiPersistedStore()], async commit => {
    const utentiVivi = getUtentiStore();
    for (let i = utentiVivi.length - 1; i >= 0; i--) {
      const u: any = utentiVivi[i];
      if ((typeof u.tenantId === "number" ? u.tenantId : TENANT_PREDEFINITO_ID) === tenantId) {
        utentiVivi.splice(i, 1);
        utenti++;
      }
    }
    const sediVive = getSediStore();
    for (let i = sediVive.length - 1; i >= 0; i--) {
      const s: any = sediVive[i];
      if ((typeof s.tenantId === "number" ? s.tenantId : TENANT_PREDEFINITO_ID) === tenantId) {
        sediVive.splice(i, 1);
        sedi++;
      }
    }
    await commit();
  });

  // 5. La lapide del control plane: slug liberato, PII azzerata,
  //    `svuotato_il` scritto. Da qui in poi `riattiva` rifiuta.
  const lapide = await repo.svuotaControlPlane(tenantId, adesso);

  const esito: EsitoSvuotamento = {
    file,
    fileNonCancellati,
    righeTabelle,
    store,
    righeKv,
    utenti,
    sedi,
    slug: lapide.slug,
  };
  await repo.registraEvento({
    tenantId,
    tipo: "svuotato",
    attore: attoreTesto(input.attore),
    dettagli: { ...esito, slugPrima: tenant.slug, inviti: lapide.inviti, oauthState: lapide.oauthState },
  });
  console.log(
    `[svuotamento] tenant ${tenantId} (${tenant.slug}): ${file} file, ${righeTabelle} righe, ${store} store, ${utenti} utenti, ${sedi} sedi`
  );
  return esito;
}
