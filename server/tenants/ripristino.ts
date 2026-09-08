// server/tenants/ripristino.ts
// Ripristino degli archivi di un'azienda dal SUO Drive (WS3, spec §4.4).
// Comando del control plane: lo esegue il server, unico scrittore. Gli
// archivi si sostituiscono interi (nessun merge); i file non si ricaricano.
import { driveElencaFigli, driveScaricaJson, tokenERadiceDelTenant } from "../_core/driveBackup";
import { getAllStoreSnapshots, sostituisciStore, storeDi } from "../_core/persistence";
import { sediDelTenant } from "../routers/sedi";
import { conTenant } from "./contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "./costanti";
import { getTenantRepository } from "./repository";
import { riattiva, sospendi } from "./servizio";
import { attoreTesto, type Attore } from "./tipi";

/**
 * Store che il ripristino non tocca MAI, nemmeno se il dump c'è: la
 * configurazione del backup, il suo registro e — soprattutto — il refresh
 * token cifrato del Drive. Riscriverli con una fotografia vecchia
 * scollegherebbe l'azienda dal Drive da cui sta ripristinando.
 */
export const STORE_ESCLUSI_DAL_RIPRISTINO = new Set(["backup_config", "backup_oauth", "backup_log"]);

/** Il `backup` del comando è una data (`Backup CRM <data>`) oppure un id di cartella. */
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export type DriveRipristino = {
  /** "AAAA-MM-GG" → `Backup CRM <data>` sotto la radice dell'azienda; altrimenti l'id di una cartella. */
  cartellaBackup(riferimento: string): Promise<{ id: string; nome: string } | null>;
  /** I `<nome>.json` dentro `database/` di quel backup. */
  dumpDisponibili(cartellaId: string): Promise<Array<{ nome: string; scarica: () => Promise<unknown> }>>;
};

export type EsitoRipristino = {
  dryRun: boolean;
  backup: { id: string; nome: string };
  store: Array<{ nome: string; prima: number; dopo: number; sostituito: boolean }>;
  anomalie: string[];
};

export type OpzioniRipristino = {
  tenantId: number;
  backup: string;
  solo: string[] | null;
  scrivi: boolean;
  ancheTenant1?: boolean;
  attore: Attore;
};

export function driveRipristinoReale(): DriveRipristino {
  return {
    async cartellaBackup(riferimento) {
      const { token, rootId } = await tokenERadiceDelTenant();
      if (RE_DATA.test(riferimento)) {
        const [c] = await driveElencaFigli(token, rootId, { nome: `Backup CRM ${riferimento}`, soloCartelle: true });
        return c ? { id: c.id, nome: c.name } : null;
      }
      // Un id di cartella arbitrario: vale come backup solo se contiene
      // `database/`. Così un id sbagliato dice «non trovato» invece di
      // ripristinare zero store in silenzio.
      const figli = await driveElencaFigli(token, riferimento, { nome: "database", soloCartelle: true });
      return figli.length ? { id: riferimento, nome: riferimento } : null;
    },
    async dumpDisponibili(cartellaId) {
      const { token } = await tokenERadiceDelTenant();
      const [db] = await driveElencaFigli(token, cartellaId, { nome: "database", soloCartelle: true });
      if (!db) return [];
      const file = await driveElencaFigli(token, db.id);
      return file
        .filter(f => f.name.endsWith(".json"))
        .map(f => ({ nome: f.name.slice(0, -".json".length), scarica: () => driveScaricaJson(token, f.id) }));
    },
  };
}

// Il Drive finto dei test del comando: `eseguiComando` non passa un
// `DriveRipristino`, e in un test non c'è nessun Drive da chiamare.
let driveDiProva: DriveRipristino | null = null;
export function __impostaDriveRipristinoPerTest(drive: DriveRipristino | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_DRIVE_RIPRISTINO");
  driveDiProva = drive;
}

/** Chi chiama senza `drive`: il Drive vero, tranne che nei test con l'iniezione attiva. */
function driveImplicito(): DriveRipristino {
  if (process.env.NODE_ENV === "test" && driveDiProva) return driveDiProva;
  return driveRipristinoReale();
}

/**
 * Un dump è buono se è un array di record con id numerico e unico, di sedi
 * dell'azienda e (dove il campo c'è) dell'azienda stessa. Un record senza id
 * non si può nemmeno nominare: lo si indica per posizione e non si guarda
 * oltre. Gli altri controlli non si fermano al primo: chi legge il rapporto
 * vuole sapere TUTTO quello che non torna in quel record, non una cosa sola.
 */
export function validaDump(
  nome: string,
  dati: unknown,
  tenantId: number,
  sediAmmesse: Set<number>
): { items: any[]; anomalie: string[] } {
  if (!Array.isArray(dati)) return { items: [], anomalie: [`${nome}: il dump non è un array`] };
  const anomalie: string[] = [];
  const visti = new Set<number>();
  for (let i = 0; i < dati.length; i++) {
    const r = dati[i];
    const id = r && typeof r === "object" ? (r as any).id : undefined;
    if (typeof id !== "number") {
      anomalie.push(`${nome}: record senza id numerico (posizione ${i})`);
      continue;
    }
    if (visti.has(id)) anomalie.push(`${nome}: id duplicato ${id}`);
    visti.add(id);
    const sedeId = (r as any).sedeId;
    if (typeof sedeId === "number" && !sediAmmesse.has(sedeId)) {
      anomalie.push(`${nome}: record ${id} con sedeId ${sedeId} non dell'azienda`);
    }
    const tenantDelRecord = (r as any).tenantId;
    if (typeof tenantDelRecord === "number" && tenantDelRecord !== tenantId) {
      anomalie.push(`${nome}: record ${id} con tenantId ${tenantDelRecord} di un'altra azienda`);
    }
  }
  return { items: dati, anomalie };
}

/**
 * Sostituisce gli archivi dell'azienda con quelli del backup indicato.
 *
 * Senza `scrivi` è una prova: legge il Drive, valida e confronta i conteggi,
 * non tocca niente. Con `scrivi` l'azienda va prima in sola lettura
 * (`sospendi`), poi ogni store viene sostituito e il blob scritto subito, poi
 * l'azienda torna com'era. Se qualcosa cede a metà l'azienda resta SOSPESA e
 * il messaggio dice quali store erano già stati sostituiti: metà archivio
 * nuovo e metà vecchio non è uno stato in cui far rientrare la gente.
 */
export async function ripristinaArchivi(
  opzioni: OpzioniRipristino,
  drive: DriveRipristino = driveImplicito()
): Promise<EsitoRipristino> {
  const { tenantId } = opzioni;
  if (tenantId === TENANT_PREDEFINITO_ID && !opzioni.ancheTenant1) {
    throw new Error("Il tenant 1 si ripristina solo con --anche-tenant-1");
  }
  return conTenant(tenantId, async () => {
    const cartella = await drive.cartellaBackup(opzioni.backup);
    if (!cartella) throw new Error(`Backup ${opzioni.backup} non trovato sul Drive dell'azienda`);
    // Gli store che questa azienda ha davvero: un dump di una famiglia
    // globale (sedi, utenti) o di un nome che qui non esiste non si ripristina.
    const perTenant = new Set(getAllStoreSnapshots().filter(s => s.tenantId === tenantId).map(s => s.nome));
    const disponibili = await drive.dumpDisponibili(cartella.id);
    const richiesti =
      opzioni.solo ?? disponibili.map(d => d.nome).filter(n => perTenant.has(n) && !STORE_ESCLUSI_DAL_RIPRISTINO.has(n));
    const assenti = richiesti.filter(n => !disponibili.some(d => d.nome === n));
    if (assenti.length) throw new Error(`Store richiesti assenti dal backup: ${assenti.join(", ")}`);

    const anomalie: string[] = [];
    const daSostituire: Array<{ nome: string; items: any[] }> = [];
    const sedi = new Set(sediDelTenant(tenantId).map(s => s.id));
    for (const d of disponibili) {
      const scelto = richiesti.includes(d.nome);
      // Uno store saltato si dichiara: con `--solo` solo se l'operatore
      // l'aveva chiesto, altrimenti sempre — nella prova serve a spiegare
      // perché un dump presente sul Drive non compare fra quelli sostituiti.
      if (STORE_ESCLUSI_DAL_RIPRISTINO.has(d.nome)) {
        if (!opzioni.solo || scelto) anomalie.push(`${d.nome}: escluso dal ripristino`);
        continue;
      }
      if (!perTenant.has(d.nome)) {
        if (!opzioni.solo || scelto) anomalie.push(`${d.nome}: non è uno store per azienda`);
        continue;
      }
      if (!scelto) continue;
      const v = validaDump(d.nome, await d.scarica(), tenantId, sedi);
      anomalie.push(...v.anomalie);
      daSostituire.push({ nome: d.nome, items: v.items });
    }

    // «Saltato» è una nota, non un difetto: solo il resto blocca la scrittura.
    const invalidi = anomalie.filter(a => !a.endsWith("escluso dal ripristino") && !a.endsWith("non è uno store per azienda"));
    const esito: EsitoRipristino = {
      dryRun: !opzioni.scrivi,
      backup: cartella,
      store: daSostituire.map(s => ({ nome: s.nome, prima: storeDi(tenantId, s.nome).length, dopo: s.items.length, sostituito: false })),
      anomalie,
    };
    if (!opzioni.scrivi) return esito;
    if (invalidi.length) throw new Error(`Dump non valido: ${invalidi.join("; ")}`);

    const repo = getTenantRepository();
    // Un'azienda già sospesa resta sospesa: il ripristino non la riapre.
    const eraAttivo = repo.perId(tenantId)?.stato === "attivo";
    if (eraAttivo) await sospendi(tenantId, "ripristino archivi in corso", opzioni.attore);
    const sostituiti: string[] = [];
    try {
      for (const s of daSostituire) {
        await sostituisciStore(tenantId, s.nome, s.items);
        sostituiti.push(s.nome);
        esito.store.find(x => x.nome === s.nome)!.sostituito = true;
      }
    } catch (e) {
      throw new Error(
        `Ripristino interrotto dopo ${sostituiti.join(", ") || "nessuno store"}: ${e instanceof Error ? e.message : String(e)} (azienda lasciata sospesa)`
      );
    }
    if (eraAttivo) await riattiva(tenantId, "ripristino archivi completato", opzioni.attore);
    await repo.registraEvento({
      tenantId,
      tipo: "archivi_ripristinati",
      attore: attoreTesto(opzioni.attore),
      dettagli: { backup: cartella, store: esito.store.map(({ nome, prima, dopo }) => ({ nome, prima, dopo })) },
    });
    return esito;
  });
}
