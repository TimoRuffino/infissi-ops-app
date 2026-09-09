// server/tenants/servizio.ts
// Servizio di dominio del tenant (WS1, spec §6). Unico punto che crea
// tenant, sedi e proprietari fuori dai router: lo usano il boot, il ciclo
// dei comandi e, dal WS6, il pannello del Platform Admin.
import { conTransazioneStoreAtomica, istanziaStoresPerTenant } from "../_core/persistence";
import { interruttoreAttivo } from "../platform/interruttori";
import { creaSedeInterna, getSediPersistedStore, getSediStore, sediDelTenant } from "../routers/sedi";
import { creaUtenteInterno, getUtentiPersistedStore, getUtentiStore } from "../routers/utenti";
import { MESSAGGI, RUOLO_PROPRIETARIO, TENANT_PREDEFINITO_ID } from "./costanti";
import {
  schemaPayloadAbbonamento,
  schemaPayloadCrea,
  schemaPayloadProprietario,
  schemaPayloadRipristino,
  schemaPayloadStato,
  schemaPayloadStorage,
} from "./comandi";
import {
  contaPresidi,
  motivoRifiutoPresidio,
  presidioDi,
  righeTenantSedi,
  ruoliDi,
  slugValido,
} from "./regole";
import { getTenantRepository } from "./repository";
import { ricalcolaStorage } from "./storage";
import { attoreTesto, type Attore, type TenantComando, type TenantRecord } from "./tipi";

export type CreaTenantInput = {
  slug: string;
  nome: string;
  sede: { nome: string; citta?: string | null };
  proprietario: {
    nome: string;
    cognome: string;
    email: string;
    telefono?: string | null;
    passwordHash: string;
  };
};

export type EsitoCrea = {
  tenant: TenantRecord;
  sedeId: number;
  utenteId: number;
  creatoOra: boolean;
};

function utenteDelTenant(tenantId: number, utenteId: number): any {
  const utente = getUtentiStore().find(
    (u: any) => u.id === utenteId && presidioDi(u).tenantId === tenantId
  );
  if (!utente) throw new Error(`Utente ${utenteId} inesistente nel tenant ${tenantId}`);
  return utente;
}

function tenantEsistente(tenantId: number): TenantRecord {
  const tenant = getTenantRepository().perId(tenantId);
  if (!tenant) throw new Error(`Tenant ${tenantId} inesistente`);
  return tenant;
}

function tenantDaSlug(slug: string): TenantRecord {
  const tenant = getTenantRepository().perSlug(slug);
  if (!tenant) throw new Error(`Tenant ${slug} inesistente`);
  return tenant;
}

/** Idempotente per slug: completa ciò che manca (sede, proprietario) e non duplica. */
export async function crea(input: CreaTenantInput, attore: Attore): Promise<EsitoCrea> {
  if (!slugValido(input.slug)) throw new Error(`Slug non valido: ${input.slug}`);
  const repo = getTenantRepository();
  let tenant = repo.perSlug(input.slug);
  const utenti = getUtentiStore();
  const email = input.proprietario.email.toLowerCase();
  let utente: any = utenti.find((u: any) => u.email.toLowerCase() === email) ?? null;
  if (utente && (!tenant || presidioDi(utente).tenantId !== tenant.id)) {
    throw new Error("Email già in uso da un'altra azienda");
  }
  let creatoOra = false;
  if (!tenant) {
    tenant = await repo.inserisci({ slug: input.slug, nome: input.nome });
    creatoOra = true;
    // Subito dopo l'inserimento: la riga in `tenants` è già un fatto, a
    // prescindere da come va la transazione di sede/utente qui sotto.
    await repo.registraEvento({
      tenantId: tenant.id,
      tipo: "creato",
      attore: attoreTesto(attore),
      dettagli: { slug: input.slug, nome: input.nome },
    });
  }
  const tenantId = tenant.id;
  // Prova gratuita di 30 giorni (WS4 spec §4), SEMPRE — anche per un tenant
  // già esistente (comando `crea` idempotente per lo stesso slug), non solo
  // per quello appena inserito qui sopra (Task 3 fix round 1, Ruling R8): un
  // tenant non deve mai restare senza abbonamento. `creaProva` è idempotente
  // (ritorna la riga esistente se c'è già), quindi se un giro precedente di
  // `crea` fosse arrivato fin qui e avesse fallito PROPRIO su `creaProva`
  // (es. un guasto del repository), rilanciare `crea` con lo stesso slug
  // ripara l'abbonamento mancante senza duplicare nulla (né una seconda riga
  // `tenants`, né una seconda sede o utente, che restano sotto la
  // transazione qui sotto). Prima della transazione di sede/utente: se
  // quella fallisse la prova resterebbe comunque, come l'evento `creato`
  // sopra per un tenant nuovo. Import dinamico: `abbonamenti/servizio.ts`
  // importa `sospendi`/`riattiva` da QUESTO file, e un import statico
  // chiuderebbe il ciclo fra i due moduli (come `ripristina_archivi` più
  // sotto).
  const { creaProva } = await import("../abbonamenti/servizio");
  await creaProva(tenantId, new Date(), attore);
  let sedeId: number | null = sediDelTenant(tenantId)[0]?.id ?? null;
  let utenteCreato = false;
  // Riferimenti a ciò che QUESTO giro spinge negli array vivi: se il commit
  // fallisce li togliamo con splice, per non lasciare una sede o un utente
  // orfani che nessun evento racconta (il tenant invece resta: è già un fatto).
  let sedeCreataQuiId: number | null = null;
  let utenteCreatoQui: any = null;

  try {
    await conTransazioneStoreAtomica(
      [getSediPersistedStore(), getUtentiPersistedStore()],
      async commit => {
        if (sedeId == null) {
          const nuovaSede = creaSedeInterna({
            tenantId,
            nome: input.sede.nome,
            citta: input.sede.citta ?? null,
          });
          sedeId = nuovaSede.id;
          sedeCreataQuiId = nuovaSede.id;
        }
        // Store del tenant (Task 6): idempotente, non fa nulla se il tenant
        // è già noto (es. riesecuzione di un comando `crea` idempotente per
        // slug). Se fallisce, il catch sotto toglie sede/utente spinti in
        // questo giro; il tenant (già un fatto) resta senza store, e un
        // comando successivo può riprovare.
        await istanziaStoresPerTenant(tenantId);
        if (!utente) {
          utente = creaUtenteInterno({
            tenantId,
            nome: input.proprietario.nome,
            cognome: input.proprietario.cognome,
            email: input.proprietario.email,
            telefono: input.proprietario.telefono ?? null,
            ruoli: [RUOLO_PROPRIETARIO, "direzione"],
            sediIds: [sedeId],
            passwordHash: input.proprietario.passwordHash,
          });
          utenteCreato = true;
          utenteCreatoQui = utente;
        }
        await commit();
      }
    );
  } catch (e) {
    if (sedeCreataQuiId != null) {
      const sediVive = getSediStore();
      const idx = sediVive.findIndex(s => s.id === sedeCreataQuiId);
      if (idx !== -1) sediVive.splice(idx, 1);
    }
    if (utenteCreatoQui) {
      const utentiVivi = getUtentiStore();
      const idx = utentiVivi.findIndex((u: any) => u.id === utenteCreatoQui.id);
      if (idx !== -1) utentiVivi.splice(idx, 1);
    }
    throw e;
  }

  // Transazione riuscita: la sede esiste ed è del tenant. Lo specchio va
  // allineato PRIMA che qualcuno scriva righe per quella sede, altrimenti il
  // trigger le lascia con `tenant_id` NULL fino al backfill del boot.
  await repo.sincronizzaTenantSedi(righeTenantSedi(getSediStore()));

  if (utenteCreato) {
    await repo.registraEvento({
      tenantId,
      tipo: "proprietario_assegnato",
      attore: attoreTesto(attore),
      dettagli: { utenteId: utente.id, primo: true },
    });
  }
  return { tenant, sedeId: sedeId!, utenteId: utente.id, creatoOra };
}

export async function sospendi(tenantId: number, motivo: string, attore: Attore): Promise<TenantRecord> {
  tenantEsistente(tenantId);
  const repo = getTenantRepository();
  const tenant = await repo.aggiornaStato(tenantId, "sospeso", motivo);
  await repo.registraEvento({ tenantId, tipo: "sospeso", attore: attoreTesto(attore), motivo });
  return tenant;
}

export async function riattiva(tenantId: number, motivo: string, attore: Attore): Promise<TenantRecord> {
  tenantEsistente(tenantId);
  const repo = getTenantRepository();
  const tenant = await repo.aggiornaStato(tenantId, "attivo", motivo);
  await repo.registraEvento({ tenantId, tipo: "riattivato", attore: attoreTesto(attore), motivo });
  return tenant;
}

export async function assegnaProprietario(tenantId: number, utenteId: number, attore: Attore): Promise<void> {
  tenantEsistente(tenantId);
  const utente = utenteDelTenant(tenantId, utenteId);
  const ruoli = ruoliDi(utente);
  if (ruoli.includes(RUOLO_PROPRIETARIO)) return;
  if (ruoli.length >= 3) throw new Error(`L'utente ${utenteId} ha già tre ruoli: liberane uno prima`);
  utente.ruoli = [...ruoli, RUOLO_PROPRIETARIO];
  utente.updatedAt = new Date();
  getUtentiPersistedStore().save();
  await getTenantRepository().registraEvento({
    tenantId,
    tipo: "proprietario_assegnato",
    attore: attoreTesto(attore),
    dettagli: { utenteId },
  });
}

export async function revocaProprietario(tenantId: number, utenteId: number, attore: Attore): Promise<void> {
  tenantEsistente(tenantId);
  const utente = utenteDelTenant(tenantId, utenteId);
  const ruoli = ruoliDi(utente);
  if (!ruoli.includes(RUOLO_PROPRIETARIO)) return;
  const dopo = { ...presidioDi(utente), ruoli: ruoli.filter(r => r !== RUOLO_PROPRIETARIO) };
  const motivo = motivoRifiutoPresidio(presidioDi(utente), dopo, getUtentiStore().map(presidioDi));
  if (motivo) throw new Error(motivo);
  utente.ruoli = dopo.ruoli;
  utente.updatedAt = new Date();
  getUtentiPersistedStore().save();
  await getTenantRepository().registraEvento({
    tenantId,
    tipo: "proprietario_revocato",
    attore: attoreTesto(attore),
    dettagli: { utenteId },
  });
}

/**
 * Al boot con interruttore acceso, DOPO che gli store sono caricati (spec
 * §4.3; Task 6: chiamata da `completaTenants`, mai da `preparaTenants` — qui
 * `utenti`/`sedi` esistono già): ogni tenant senza proprietari attivi dà il
 * ruolo alla prima direzione attiva (id più basso) con meno di 3 ruoli;
 * altrimenti lo dice nel log. Il seed della riga `tenants` predefinita è
 * compito di `preparaTenants` (`repo.assicuraTenantPredefinito()`, control
 * plane puro, PRIMA che gli store esistano).
 */
export async function allineaTenantPredefinito(): Promise<void> {
  const repo = getTenantRepository();
  const utenti = getUtentiStore();
  for (const tenant of repo.tutti()) {
    if (contaPresidi(utenti.map(presidioDi), tenant.id).proprietari > 0) continue;
    const candidato = utenti
      .filter((u: any) => {
        const p = presidioDi(u);
        return p.tenantId === tenant.id && p.attivo && p.ruoli.includes("direzione") && p.ruoli.length < 3;
      })
      .sort((a: any, b: any) => a.id - b.id)[0];
    if (!candidato) {
      console.warn(
        `[tenants] tenant ${tenant.id} (${tenant.slug}) senza proprietario: usa \`pnpm tenant proprietario --slug=${tenant.slug} --email=… --assegna --scrivi\``
      );
      continue;
    }
    candidato.ruoli = [...ruoliDi(candidato), RUOLO_PROPRIETARIO];
    candidato.updatedAt = new Date();
    getUtentiPersistedStore().save();
    await repo.registraEvento({
      tenantId: tenant.id,
      tipo: "proprietario_assegnato",
      attore: attoreTesto({ tipo: "boot" }),
      dettagli: { utenteId: candidato.id, ripiego: true },
    });
    console.log(`[tenants] tenant ${tenant.id}: proprietario di ripiego = utente ${candidato.id}`);
  }
  const t1 = repo.perId(TENANT_PREDEFINITO_ID);
  const utentiT1 = utenti.filter((u: any) => presidioDi(u).tenantId === TENANT_PREDEFINITO_ID).length;
  console.log(
    `[tenants] tenant ${TENANT_PREDEFINITO_ID} (${t1?.slug}) pronto: ${utentiT1} utenti, ${sediDelTenant(TENANT_PREDEFINITO_ID).length} sedi`
  );
}

async function eseguiComando(comando: TenantComando): Promise<Record<string, unknown>> {
  // WS6 (pannello piattaforma, spec §4.3): un comando accodato dal pannello
  // porta `richiestoDa: "piattaforma:<email>"`; l'attore diventa
  // `{ tipo: "piattaforma", email }` così `tenant_eventi` dice
  // «piattaforma:t.ruffino@…», non «script:…». Ogni altro produttore
  // (script CLI compresi) resta un attore script, comportamento invariato.
  const attore: Attore = comando.richiestoDa.startsWith("piattaforma:")
    ? { tipo: "piattaforma", email: comando.richiestoDa.slice("piattaforma:".length) }
    : { tipo: "script", nome: comando.richiestoDa };
  try {
    switch (comando.tipo) {
      case "crea": {
        const p = schemaPayloadCrea.parse(comando.payload);
        const e = await crea(p, attore);
        return { tenantId: e.tenant.id, sedeId: e.sedeId, utenteId: e.utenteId, creatoOra: e.creatoOra };
      }
      case "sospendi":
      case "riattiva": {
        const p = schemaPayloadStato.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        const t = comando.tipo === "sospendi" ? await sospendi(id, p.motivo, attore) : await riattiva(id, p.motivo, attore);
        return { tenantId: t.id, stato: t.stato };
      }
      case "assegna_proprietario":
      case "revoca_proprietario": {
        const p = schemaPayloadProprietario.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        const utente = getUtentiStore().find(
          (u: any) => u.email.toLowerCase() === p.email.toLowerCase() && presidioDi(u).tenantId === id
        );
        if (!utente) throw new Error(`Nessun utente ${p.email} nel tenant ${id}`);
        if (comando.tipo === "assegna_proprietario") await assegnaProprietario(id, utente.id, attore);
        else await revocaProprietario(id, utente.id, attore);
        return { tenantId: id, utenteId: utente.id };
      }
      case "ricalcola_storage": {
        const p = schemaPayloadStorage.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        const stato = await ricalcolaStorage(id, attoreTesto(attore));
        return { tenantId: id, bytes: stato.bytes, file: stato.file };
      }
      case "ripristina_archivi": {
        const p = schemaPayloadRipristino.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        // Import dinamico: `ripristino.ts` importa `sospendi`/`riattiva` da
        // qui, e un import statico chiuderebbe il ciclo fra i due moduli.
        const { ripristinaArchivi } = await import("./ripristino");
        const esito = await ripristinaArchivi({
          tenantId: id,
          backup: p.backup,
          solo: p.solo ?? null,
          scrivi: p.scrivi,
          ancheTenant1: p.ancheTenant1,
          attore,
        });
        return { tenantId: id, ...esito };
      }
      case "imposta_abbonamento": {
        const p = schemaPayloadAbbonamento.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        const adesso = new Date();
        // Import dinamico: stesso ciclo di `crea` più sopra fra
        // `tenants/servizio.ts` e `abbonamenti/servizio.ts` (che importa
        // `sospendi`/`riattiva` da qui). `costanti.ts` non lo richiederebbe
        // (nessun percorso di ritorno verso questo file), ma lo importiamo
        // allo stesso modo per restare a un solo stile in questo case.
        const {
          concediOmaggio,
          prorogaProva,
          impostaBudgetTars,
          aggiungiExtraTars,
          impostaTolleranze,
          impostaDisdetta,
        } = await import("../abbonamenti/servizio");
        const { eurInNano } = await import("../abbonamenti/costanti");
        const repoAbbonamenti = getTenantRepository();
        switch (p.azione) {
          case "omaggio":
            await concediOmaggio(
              id,
              {
                motivo: p.motivo,
                // Fine giornata in Europe/Rome; l'ora legale (+01:00 in
                // inverno) non si considera qui: per un comando manuale
                // un'ora di scarto sulla scadenza non è un problema, ed è
                // la stessa approssimazione che la CLI propone all'operatore.
                scadenza: p.scadenza ? new Date(`${p.scadenza}T23:59:59+02:00`) : null,
              },
              attore,
              adesso
            );
            break;
          case "proroga":
            await prorogaProva(id, p.giorni, p.motivo, attore, adesso);
            break;
          case "quota": {
            // La quota vive su `tenants.storage_quota_bytes` (WS3), non
            // sull'abbonamento: qui solo l'evento del registro, in GB come
            // lo scrive un umano (`campo` è un'etichetta di lettura, non il
            // nome della colonna — stesso criterio di `impostaTolleranze`).
            const primaBytes = repoAbbonamenti.perId(id)?.storageQuotaBytes ?? null;
            await repoAbbonamenti.impostaQuotaStorage(id, p.quotaGb * 1024 ** 3);
            await repoAbbonamenti.registraEvento({
              tenantId: id,
              tipo: "abbonamento_modificato",
              attore: attoreTesto(attore),
              dettagli: {
                campo: "quota_storage_gb",
                prima: primaBytes != null ? primaBytes / 1024 ** 3 : null,
                dopo: p.quotaGb,
              },
            });
            break;
          }
          case "budget_tars":
            await impostaBudgetTars(id, p.eur == null ? null : eurInNano(p.eur), attore);
            break;
          case "extra_tars":
            await aggiungiExtraTars(id, eurInNano(p.eur), attore, adesso);
            break;
          case "tolleranze":
            await impostaTolleranze(id, { storage: p.storage, tars: p.tars }, attore);
            break;
          case "disdetta":
            await impostaDisdetta(id, p.disdetta, attore);
            break;
        }
        const a = repoAbbonamenti.abbonamentoDi(id);
        return {
          tenantId: id,
          azione: p.azione,
          tipo: a?.tipo ?? null,
          stato: a?.stato ?? null,
          finePeriodo: a?.finePeriodo?.toISOString() ?? null,
        };
      }
      // «Modifica azienda» (piano 09/09/2026): il Task 1 aggiunge solo il
      // tipo al control plane (colonne di fatturazione, CHECK allargato,
      // `aggiornaTenant`); nessun produttore accoda ancora questi comandi.
      // Il Task 2 implementa `modificaTenant`/`modificaProprietario` qui.
      case "modifica_tenant":
      case "modifica_proprietario":
        throw new Error(`Comando "${comando.tipo}" non ancora implementato`);
    }
  } catch (e) {
    const tenantId = comando.tenantId ?? getTenantRepository().perSlug(String((comando.payload as any)?.slug ?? ""))?.id;
    if (tenantId != null) {
      await getTenantRepository().registraEvento({
        tenantId,
        tipo: "comando_fallito",
        attore: attoreTesto(attore),
        motivo: e instanceof Error ? e.message : String(e),
        dettagli: { comandoId: comando.id, tipo: comando.tipo },
      });
    }
    throw e;
  }
}

/** Solo con interruttore acceso; un comando alla volta, senza retry automatico. */
export async function eseguiComandiInAttesa(): Promise<{ eseguiti: number; falliti: number }> {
  let eseguiti = 0;
  let falliti = 0;
  if (!interruttoreAttivo("multiAzienda")) return { eseguiti, falliti };
  const repo = getTenantRepository();
  for (let giro = 0; giro < 50; giro++) {
    const esito = await repo.prendiEdEsegui(eseguiComando);
    if (esito === "nessuno") break;
    if (esito === "eseguito") eseguiti++;
    else falliti++;
  }
  return { eseguiti, falliti };
}

/**
 * WS6: il pannello accoda e vuole l'esito subito. Stessa funzione del giro,
 * preso in carico per id (FOR UPDATE SKIP LOCKED): se il giro lo ha già
 * preso, si aspetta che chiuda invece di rieseguire.
 */
export async function eseguiComandoSubito(
  id: number,
  opzioni: { attesaMs?: number; passoMs?: number } = {}
): Promise<TenantComando> {
  if (!interruttoreAttivo("multiAzienda")) throw new Error(MESSAGGI.comandiSpenti);
  const repo = getTenantRepository();
  await repo.prendiEdEsegui(eseguiComando, { soloId: id });
  const scadenza = Date.now() + (opzioni.attesaMs ?? 10_000);
  const passo = opzioni.passoMs ?? 500;
  for (;;) {
    const c = await repo.comando(id);
    if (!c) throw new Error(`Comando #${id} inesistente`);
    if (c.stato !== "in_attesa" || Date.now() >= scadenza) return c;
    await new Promise(r => setTimeout(r, passo));
  }
}
