// Operatore → control plane del tenant (WS1). Lo script parla SOLO con il
// database: accoda un comando in `tenant_comandi` e il server vivo lo esegue
// (al boot e ogni 30 s, con FLAG_MULTI_AZIENDA acceso). Mai scritture sugli
// store JSONB da qui: il server riscrive i blob interi e le cancellerebbe.
//
//   pnpm tenant elenco
//   pnpm tenant crea --slug=acme --nome="Acme Infissi" --sede="Acme Infissi" \
//        --email=titolare@acme.it --nome-utente=Mario --cognome=Rossi [--citta=Sarzana] [--scrivi] [--attendi]
//   pnpm tenant stato --slug=acme --sospendi|--riattiva --motivo="…" [--anche-tenant-1] [--scrivi] [--attendi]
//   pnpm tenant proprietario --slug=acme --email=m.rossi@acme.it --assegna|--revoca [--scrivi] [--attendi]
//   pnpm tenant storage --slug=acme [--ricalcola] [--scrivi] [--attendi]
//   pnpm tenant ripristina --slug=acme --backup=<AAAA-MM-GG|folderId> [--solo=a,b] \
//        --prova|--scrivi [--anche-tenant-1] [--attendi]
//   pnpm tenant abbonamento --slug=acme UNA azione [--scrivi] [--attendi]:
//        --omaggio [--scadenza=AAAA-MM-GG] --motivo="…" | --proroga=<giorni> --motivo="…" |
//        --quota-gb=<n> | --budget-tars-eur=<n|nessuno> | --extra-tars-eur=<n> |
//        --tolleranza-storage=<gg> e/o --tolleranza-tars=<gg> | --disdetta|--annulla-disdetta
//        (il tenant 1 rifiuta omaggio/proroga/disdetta: è la proprietaria della piattaforma)
//   pnpm tenant modifica --slug=acme [--nome=…] [--nuovo-slug=…] [--piva=…] [--cf=…] \
//        [--sede-legale=…] [--email-amministrativa=…] [--pec=…] [--sdi=…] [--note=…] [--scrivi] [--attendi]
//        (almeno un campo oltre --slug; il tenant 1 rifiuta --nuovo-slug: è l'ancora di ogni URL)
//   pnpm tenant verifica [--json]
//
// Password del proprietario: TENANT_PROPRIETARIO_PASSWORD nell'env o prompt
// nascosto; viene hashata qui e mai scritta in chiaro. Senza --scrivi mostra
// l'anteprima e non tocca nulla. Lo schema non lo tocca mai, nemmeno per
// `elenco`: lo crea il server al boot; se manca, lo script si ferma.
//
// `ripristina` è l'unico sottocomando che accoda anche in prova: il Drive
// dell'azienda lo legge il server (ha il token), non lo script, quindi la
// prova è un comando `--prova` il cui esito (conteggi prima/dopo e anomalie)
// si legge con `--attendi`. `--scrivi` è il ripristino vero: sospende
// l'azienda, sostituisce gli archivi e la riattiva.
//
// `verifica` è l'eccezione (Task 13, design WS2 §7.2): sola lettura, gira
// PRIMA di toccare il control plane del tenant e funziona anche se il WS1
// non è mai stato distribuito su questo database. Conta gli store per
// tenant (via `leggiBlobDaDb`/`elencaChiaviDaDb` di persistence.ts: mai un
// SELECT scritto qui) e le tabelle per sede (`TABELLE_PER_SEDE`, con un JOIN
// su `tenant_sedi`); stampa un rapporto (`--json` per la versione macchina)
// ed esce con `1` se trova anomalie, `0` altrimenti. Nessun DDL.
//
// `verifica --json` per l'automazione (Fix round 1, Task 13, R15): un
// semplice `pnpm tenant verifica --json` NON è JSON valido su stdout — pnpm
// scrive il proprio banner PRIMA del `{` e, quando l'exit è 1 (anomalie
// trovate), appende ` ELIFECYCLE  Command failed with exit code 1.` DOPO il
// `}`. Le forme documentate per una pipeline sono:
//   pnpm --silent tenant verifica --json        # --silent di pnpm toglie banner e trailer
//   npx tsx scripts/tenant.ts verifica --json    # bypassa pnpm del tutto
// In entrambi i casi lo script stesso stampa SOLO il JSON su stdout (un
// avviso come "tenant_sedi assente" va sempre su stderr via console.warn,
// mai su stdout) — è pnpm/npm ad aggiungere rumore attorno, non lo script.
// L'exit resta `1` con anomalie anche con `--silent`/`npx`: una pipeline
// sotto `set -e` deve gestirlo esplicitamente (es. catturare l'output prima
// di controllare `$?`, o accettare l'exit 1 come "anomalie trovate" invece
// di un errore dello script).
// Runbook: docs/runbooks/multi-azienda.md.

import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "../server/_core/password";
import { elencaChiaviDaDb, kvSql, leggiBlobDaDb } from "../server/_core/persistence";
import { interruttoreAttivo } from "../server/platform/interruttori";
import { anteprima, opzioni, workerSospesi } from "../server/tenants/cli";
import {
  richiestoDa,
  schemaPayloadAbbonamento,
  schemaPayloadCrea,
  schemaPayloadModificaTenant,
  schemaPayloadProprietario,
  schemaPayloadRipristino,
  schemaPayloadStato,
  schemaPayloadStorage,
  type PayloadAbbonamento,
} from "../server/tenants/comandi";
import { MESSAGGI, TENANT_PREDEFINITO_ID } from "../server/tenants/costanti";
import {
  createPostgresTenantRepository,
  type TenantRepository,
} from "../server/tenants/repository";
import { percentualeStorage } from "../server/tenants/storage";
import { TABELLE_PER_SEDE } from "../server/tenants/tabelle";
import type { TipoComando } from "../server/tenants/tipi";
import {
  formattaRapporto,
  rapportoBlobNonValido,
  riassumi,
  verificaStore,
  type RapportoStore,
  type RapportoTabella,
} from "../server/tenants/verifica";

const USO =
  "Uso: pnpm tenant elenco | crea | stato | proprietario | storage | ripristina | abbonamento | modifica | verifica [--json] " +
  "(vedi docs/runbooks/multi-azienda.md). " +
  "ripristina --slug=<slug> --backup=<AAAA-MM-GG|folderId> [--solo=a,b] --prova|--scrivi [--anche-tenant-1] [--attendi]. " +
  "abbonamento --slug=<slug> UNA azione: --omaggio [--scadenza=AAAA-MM-GG] --motivo=… | --proroga=<giorni> --motivo=… | " +
  "--quota-gb=<n> | --budget-tars-eur=<n|nessuno> | --extra-tars-eur=<n> | " +
  "--tolleranza-storage=<gg> e/o --tolleranza-tars=<gg> | --disdetta|--annulla-disdetta, poi [--scrivi] [--attendi] " +
  "(il tenant 1 rifiuta omaggio/proroga/disdetta: quota, budget e tolleranze restano ammessi). " +
  "modifica --slug=<slug> [--nome=…] [--nuovo-slug=…] [--piva=…] [--cf=…] [--sede-legale=…] " +
  "[--email-amministrativa=…] [--pec=…] [--sdi=…] [--note=…], poi [--scrivi] [--attendi] " +
  "(almeno un campo oltre --slug; il tenant 1 rifiuta --nuovo-slug). " +
  "Automazione: `pnpm --silent tenant verifica --json` oppure `npx tsx scripts/tenant.ts verifica --json` " +
  "(un `pnpm tenant verifica --json` semplice non è JSON valido su stdout: pnpm ci scrive intorno il banner " +
  "e, con anomalie, il trailer ELIFECYCLE). L'exit è 1 con anomalie in ogni forma: gestirlo sotto `set -e`.";

function chiediNascosto(domanda: string): Promise<string> {
  return new Promise(resolve => {
    const muto = new Writable({ write(_chunk, _enc, cb) { cb(); } });
    const rl = createInterface({ input: process.stdin, output: muto, terminal: true });
    process.stdout.write(domanda);
    rl.question("", risposta => {
      rl.close();
      process.stdout.write("\n");
      resolve(risposta);
    });
  });
}

async function passwordProprietario(): Promise<string> {
  const env = process.env.TENANT_PROPRIETARIO_PASSWORD?.trim();
  const scelta = env || (await chiediNascosto("Password del proprietario (almeno 12 caratteri): ")).trim();
  if (scelta.length < 12) throw new Error("La password deve avere almeno 12 caratteri");
  return scelta;
}

async function attendi(repo: TenantRepository, id: number): Promise<number> {
  const scadenza = Date.now() + 90_000;
  while (Date.now() < scadenza) {
    const c = await repo.comando(id);
    if (c && c.stato !== "in_attesa") {
      console.log(`Comando #${id}: ${c.stato} ${JSON.stringify(c.esito)}`);
      return c.stato === "eseguito" ? 0 : 1;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.error(`Comando #${id} ancora in attesa dopo 90 s: il server è acceso con FLAG_MULTI_AZIENDA=on?`);
  return 1;
}

/**
 * `verifica`: sola lettura, nessun DDL. Gira PRIMA di `repo.caricaCache()`
 * (Ruling R1, Task 13) apposta: non deve pretendere che il control plane del
 * tenant (`tenants`/`tenant_eventi`/`tenant_comandi`) esista già, perché
 * contare i record degli store non dipende da quello schema.
 *
 * Se anche lo specchio `tenant_sedi` manca (database mai passato dal Task
 * 12), il JOIN sulle tabelle per sede fallisce con `undefined_table`
 * (`42P01`): lo intercettiamo, stampiamo un avviso una sola volta e per
 * quella e ogni tabella successiva ripieghiamo su un conteggio delle sole
 * righe, con `sedeSconosciuta`/`tenantNullo`/`tenantDiscorde` a 0 (non
 * calcolabili, non anomalie) — l'exit resta `0` se non c'è altro. Qualunque
 * altro errore Postgres propaga, come gli altri `ensureSchema()`.
 *
 * `leggiBlobDaDb` torna `null` quando la chiave esiste ma la sua colonna
 * `data` non è un array JSON valido: un `?? []` la tratterebbe come zero
 * record e un blob corrotto sparirebbe dal rapporto (Fix round 1, Task 13,
 * R16). Ogni chiave elencata da `elencaChiaviDaDb` che torna `null` diventa
 * una riga `rapportoBlobNonValido` invece di essere scartata silenziosamente
 * — la chiave `sedi` compresa: se il SUO blob è invalido la mappa sedeId→
 * tenantId resta vuota (ogni sedeId altrove risulterà sconosciuto, il
 * rapporto lo mostra da solo riga per riga) e la riga "sedi" del rapporto lo
 * dichiara esplicitamente invece di far finta che ci siano zero sedi.
 */
async function eseguiVerifica(sql: NonNullable<typeof kvSql>, flag: Set<string>): Promise<number> {
  const CHIAVE_SEDI = "sedi";
  const blobSedi = await leggiBlobDaDb(CHIAVE_SEDI);
  const sedi = new Map<number, number>();
  for (const s of blobSedi ?? []) {
    sedi.set(Number(s.id), typeof s.tenantId === "number" ? s.tenantId : TENANT_PREDEFINITO_ID);
  }

  const store: RapportoStore[] = [];
  for (const chiave of await elencaChiaviDaDb()) {
    if (chiave === CHIAVE_SEDI) {
      store.push(blobSedi === null ? rapportoBlobNonValido(chiave) : verificaStore(chiave, blobSedi, sedi));
      continue;
    }
    const record = await leggiBlobDaDb(chiave);
    store.push(record === null ? rapportoBlobNonValido(chiave) : verificaStore(chiave, record, sedi));
  }

  const tabelle: RapportoTabella[] = [];
  let specchioAssente = false;
  for (const t of TABELLE_PER_SEDE) {
    const presente = Boolean((await sql`SELECT to_regclass(${t}) AS r`)[0]?.r);
    if (!presente) {
      tabelle.push({ tabella: t, presente: false, conColonna: false, righe: 0, sedeSconosciuta: 0, tenantNullo: 0, tenantDiscorde: 0 });
      continue;
    }
    const conColonna =
      (
        await sql`SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ${t} AND column_name = 'tenant_id'`
      ).length > 0;

    if (specchioAssente) {
      const [r] = await sql.unsafe(`SELECT COUNT(*)::int AS righe FROM ${t}`);
      tabelle.push({ tabella: t, presente, conColonna, righe: Number(r.righe), sedeSconosciuta: 0, tenantNullo: 0, tenantDiscorde: 0 });
      continue;
    }
    try {
      const [r] = await sql.unsafe(`SELECT COUNT(*)::int AS righe,
        COUNT(*) FILTER (WHERE s.sede_id IS NULL)::int AS sede_sconosciuta,
        ${conColonna ? "COUNT(*) FILTER (WHERE t.tenant_id IS NULL)::int" : "0"} AS tenant_nullo,
        ${conColonna ? "COUNT(*) FILTER (WHERE t.tenant_id IS NOT NULL AND s.tenant_id IS NOT NULL AND t.tenant_id <> s.tenant_id)::int" : "0"} AS tenant_discorde
        FROM ${t} t LEFT JOIN tenant_sedi s ON s.sede_id = t.sede_id`);
      tabelle.push({
        tabella: t,
        presente,
        conColonna,
        righe: Number(r.righe),
        sedeSconosciuta: Number(r.sede_sconosciuta),
        tenantNullo: Number(r.tenant_nullo),
        tenantDiscorde: Number(r.tenant_discorde),
      });
    } catch (errore) {
      if ((errore as { code?: string } | null | undefined)?.code !== "42P01") throw errore;
      specchioAssente = true;
      console.warn(
        "[tenant verifica] tenant_sedi assente (control plane del tenant mai creato su questo database): " +
          "sedeSconosciuta/tenantNullo/tenantDiscorde non calcolabili sulle tabelle per sede, righe contate lo stesso."
      );
      const [r] = await sql.unsafe(`SELECT COUNT(*)::int AS righe FROM ${t}`);
      tabelle.push({ tabella: t, presente, conColonna, righe: Number(r.righe), sedeSconosciuta: 0, tenantNullo: 0, tenantDiscorde: 0 });
    }
  }

  const rapporto = riassumi(store, tabelle);
  console.log(flag.has("json") ? JSON.stringify(rapporto, null, 2) : formattaRapporto(rapporto));
  return rapporto.anomalie > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const sql = kvSql;
  if (!sql) {
    console.error("DATABASE_URL mancante: lo script parla solo con il database.");
    return 2;
  }
  const { sotto, valori, flag } = opzioni(process.argv);

  if (sotto === "verifica") return eseguiVerifica(sql, flag);

  const obbligatoria = (nome: string): string => {
    const v = valori[nome];
    if (!v) throw new Error(`Manca --${nome}=…\n${USO}`);
    return v;
  };
  // Lo schema lo crea il server al boot: qui si verifica soltanto che esista
  // (sonda in sola lettura; nessun DDL da uno script, nemmeno per `elenco`).
  const repo = createPostgresTenantRepository(sql, { creaSchema: false });
  await repo.caricaCache();

  if (sotto === "elenco") {
    for (const t of repo.tutti()) {
      console.log(`${t.id}\t${t.slug}\t${t.stato}\t${t.nome}`);
      // WS4 (Task 3): l'abbonamento viene dalla cache già caricata da
      // `caricaCache()` qui sopra, come `tutti()` — nessuna lettura in più.
      const a = repo.abbonamentoDi(t.id);
      if (a) {
        console.log(
          `  abbonamento: ${a.tipo} ${a.stato}, fine ${a.finePeriodo?.toISOString() ?? "nessuna"}, ` +
            `insoluto dal ${a.insolutoDal?.toISOString() ?? "-"}`
        );
      } else {
        console.log("  abbonamento: nessuno");
      }
      // Solo gli ultimi 200: `elenco` vuole sapere chi è fermo ADESSO, non
      // rileggere la cronologia intera di un'azienda a ogni lancio.
      for (const w of workerSospesi(await repo.eventi(t.id, { ultimi: 200 }))) {
        console.log(`  worker sospeso: ${w.etichetta} fino a ${w.finoA.toISOString()} (${w.errore})`);
      }
    }
    const attesa = await repo.comandiInAttesa();
    console.log(`${attesa.length} comandi in attesa`);
    for (const c of attesa) {
      console.log(`  #${c.id} ${c.tipo} tenant=${c.tenantId ?? "-"} da ${c.richiestoDa} il ${c.createdAt.toISOString()}`);
    }
    return 0;
  }

  let tipo: TipoComando;
  let tenantId: number | null = null;
  let payload: Record<string, unknown>;

  if (sotto === "storage") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (!flag.has("ricalcola")) {
      // Sola lettura: il ledger lo scrive solo il ricalcolo (server o
      // --ricalcola --scrivi), mai questo ramo.
      const s = await repo.storageDi(t.id);
      if (!s) {
        console.log(`${slug}: nessun ledger ancora (il server lo calcola al primo boot del WS3, oppure --ricalcola --scrivi)`);
      } else {
        console.log(`${slug}: ${s.file} file, ${s.bytes} byte su ${s.quotaBytes} (${percentualeStorage(s.bytes, s.quotaBytes)} %), soglia avvisata ${s.sogliaAvvisata} %, ricalcolato ${s.ricalcolatoIl?.toISOString() ?? "mai"}`);
      }
      return 0;
    }
    tipo = "ricalcola_storage";
    tenantId = t.id;
    payload = schemaPayloadStorage.parse({ slug });
  } else if (sotto === "crea") {
    const password = await passwordProprietario();
    payload = schemaPayloadCrea.parse({
      slug: obbligatoria("slug"),
      nome: obbligatoria("nome"),
      sede: { nome: valori.sede ?? obbligatoria("nome"), citta: valori.citta ?? null },
      proprietario: {
        nome: obbligatoria("nome-utente"),
        cognome: obbligatoria("cognome"),
        email: obbligatoria("email"),
        telefono: valori.telefono ?? null,
        passwordHash: hashPassword(password),
      },
    });
    tipo = "crea";
  } else if (sotto === "stato") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (flag.has("sospendi") === flag.has("riattiva")) throw new Error("Indica --sospendi oppure --riattiva");
    tipo = flag.has("sospendi") ? "sospendi" : "riattiva";
    tenantId = t.id;
    payload = schemaPayloadStato.parse({ slug, motivo: obbligatoria("motivo") });
    if (tipo === "sospendi" && t.id === TENANT_PREDEFINITO_ID && !flag.has("anche-tenant-1")) {
      throw new Error("Sospendere il tenant 1 mette Ruffino Group in sola lettura: aggiungi --anche-tenant-1 per confermare.");
    }
  } else if (sotto === "ripristina") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (flag.has("prova") === flag.has("scrivi")) throw new Error("Indica --prova (solo lettura da Drive) oppure --scrivi (ripristino vero)");
    if (t.id === TENANT_PREDEFINITO_ID && !flag.has("anche-tenant-1")) {
      throw new Error("Ripristinare il tenant 1 sostituisce gli archivi di Ruffino Group: aggiungi --anche-tenant-1 per confermare.");
    }
    tipo = "ripristina_archivi";
    tenantId = t.id;
    payload = schemaPayloadRipristino.parse({
      slug,
      backup: obbligatoria("backup"),
      solo: valori.solo ? valori.solo.split(",").map(s => s.trim()).filter(Boolean) : null,
      scrivi: flag.has("scrivi"),
      ancheTenant1: flag.has("anche-tenant-1"),
    });
  } else if (sotto === "proprietario") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (flag.has("assegna") === flag.has("revoca")) throw new Error("Indica --assegna oppure --revoca");
    tipo = flag.has("assegna") ? "assegna_proprietario" : "revoca_proprietario";
    tenantId = t.id;
    payload = schemaPayloadProprietario.parse({ slug, email: obbligatoria("email") });
  } else if (sotto === "abbonamento") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);

    // Un'azione per comando (spec §9): i flag si raggruppano in sette azioni
    // possibili, `--tolleranza-storage`/`--tolleranza-tars` valgono UNA sola
    // azione `tolleranze` anche insieme, `--disdetta`/`--annulla-disdetta`
    // sono le due facce della stessa azione `disdetta`.
    const gruppi: Array<{ azione: PayloadAbbonamento["azione"]; presente: boolean }> = [
      { azione: "omaggio", presente: flag.has("omaggio") },
      { azione: "proroga", presente: valori.proroga != null },
      { azione: "quota", presente: valori["quota-gb"] != null },
      { azione: "budget_tars", presente: valori["budget-tars-eur"] != null },
      { azione: "extra_tars", presente: valori["extra-tars-eur"] != null },
      { azione: "tolleranze", presente: valori["tolleranza-storage"] != null || valori["tolleranza-tars"] != null },
      { azione: "disdetta", presente: flag.has("disdetta") || flag.has("annulla-disdetta") },
    ];
    const attive = gruppi.filter(g => g.presente);
    if (attive.length !== 1) {
      throw new Error(`Un'azione per comando (trovate ${attive.length}: ${attive.map(g => g.azione).join(", ") || "nessuna"}).\n${USO}`);
    }
    const azione = attive[0].azione;

    if (azione === "disdetta" && flag.has("disdetta") === flag.has("annulla-disdetta")) {
      throw new Error("Indica --disdetta oppure --annulla-disdetta");
    }
    // Il tenant 1 è la proprietaria della piattaforma (spec §10): il
    // servizio lo rifiuta comunque, ma fermarsi qui evita di accodare un
    // comando che il server scarterebbe con un evento `comando_fallito`.
    if (t.id === TENANT_PREDEFINITO_ID && (azione === "omaggio" || azione === "proroga" || azione === "disdetta")) {
      throw new Error("Il tenant 1 è la proprietaria della piattaforma: niente omaggio, proroga o disdetta (quota, budget e tolleranze restano ammessi).");
    }

    let payloadAzione: Record<string, unknown>;
    switch (azione) {
      case "omaggio":
        payloadAzione = { azione, slug, motivo: obbligatoria("motivo"), scadenza: valori.scadenza ?? null };
        break;
      case "proroga":
        payloadAzione = { azione, slug, motivo: obbligatoria("motivo"), giorni: Number(valori.proroga) };
        break;
      case "quota":
        payloadAzione = { azione, slug, quotaGb: Number(valori["quota-gb"]) };
        break;
      case "budget_tars":
        payloadAzione = {
          azione,
          slug,
          eur: valori["budget-tars-eur"] === "nessuno" ? null : Number(valori["budget-tars-eur"]),
        };
        break;
      case "extra_tars":
        payloadAzione = { azione, slug, eur: Number(valori["extra-tars-eur"]) };
        break;
      case "tolleranze":
        payloadAzione = {
          azione,
          slug,
          storage: valori["tolleranza-storage"] != null ? Number(valori["tolleranza-storage"]) : undefined,
          tars: valori["tolleranza-tars"] != null ? Number(valori["tolleranza-tars"]) : undefined,
        };
        break;
      case "disdetta":
        payloadAzione = { azione, slug, disdetta: flag.has("disdetta") };
        break;
    }

    tipo = "imposta_abbonamento";
    tenantId = t.id;
    payload = schemaPayloadAbbonamento.parse(payloadAzione);
  } else if (sotto === "modifica") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    // Stesso criterio di `abbonamento` più sopra: fermarsi qui evita di
    // accodare un comando che il servizio scarterebbe comunque con un
    // evento `comando_fallito` (il tenant 1 è l'ancora di ogni URL e
    // comando script già in uso, mai un caso di conferma con un flag in più).
    if (valori["nuovo-slug"] != null && valori["nuovo-slug"] !== t.slug && t.id === TENANT_PREDEFINITO_ID) {
      throw new Error(MESSAGGI.tenant1SlugIntoccabile);
    }

    // Solo i flag davvero passati finiscono nell'oggetto: un flag assente
    // deve lasciare il campo (fatturazione compresa) come sta, mai un
    // `undefined` esplicito (`servizio.ts#modificaTenant` lo pretende per il
    // merge di `fatturazione`).
    const fatturazione: Record<string, string> = {};
    if (valori.piva != null) fatturazione.partitaIva = valori.piva;
    if (valori.cf != null) fatturazione.codiceFiscale = valori.cf;
    if (valori["sede-legale"] != null) fatturazione.indirizzoLegale = valori["sede-legale"];
    if (valori["email-amministrativa"] != null) fatturazione.emailAmministrativa = valori["email-amministrativa"];
    if (valori.pec != null) fatturazione.pec = valori.pec;
    if (valori.sdi != null) fatturazione.codiceSdi = valori.sdi;

    const payloadModifica: Record<string, unknown> = { slug };
    if (valori.nome != null) payloadModifica.nome = valori.nome;
    if (valori["nuovo-slug"] != null) payloadModifica.nuovoSlug = valori["nuovo-slug"];
    if (valori.note != null) payloadModifica.note = valori.note;
    if (Object.keys(fatturazione).length > 0) payloadModifica.fatturazione = fatturazione;

    if (Object.keys(payloadModifica).length === 1) {
      throw new Error(
        "Nessun campo da modificare: aggiungi almeno un flag " +
          "(--nome, --nuovo-slug, --piva, --cf, --sede-legale, --email-amministrativa, --pec, --sdi, --note)."
      );
    }

    tipo = "modifica_tenant";
    tenantId = t.id;
    payload = schemaPayloadModificaTenant.parse(payloadModifica);
  } else {
    console.error(USO);
    return 2;
  }

  console.log(anteprima({ tipo, tenantId, payload }));
  // `ripristina --prova` si accoda comunque: la prova la fa il server, che è
  // l'unico a poter leggere il Drive dell'azienda (v. il commento in testa).
  if (!flag.has("scrivi") && !(sotto === "ripristina" && flag.has("prova"))) {
    console.log("Anteprima: rilancia con --scrivi per accodare il comando.");
    return 0;
  }
  if (!interruttoreAttivo("multiAzienda")) {
    console.warn("Attenzione: qui FLAG_MULTI_AZIENDA risulta spento; se lo è anche sul server, il comando resterà in attesa.");
  }
  const comando = await repo.accodaComando({ tipo, tenantId, payload, richiestoDa: richiestoDa() });
  console.log(`Comando #${comando.id} accodato (${tipo}).`);
  return flag.has("attendi") ? attendi(repo, comando.id) : 0;
}

main().then(
  async codice => {
    await kvSql?.end({ timeout: 5 });
    process.exit(codice);
  },
  async errore => {
    console.error("tenant:", errore?.message ?? errore);
    await kvSql?.end({ timeout: 5 });
    process.exit(1);
  }
);
