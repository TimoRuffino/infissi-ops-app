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
//
// Password del proprietario: TENANT_PROPRIETARIO_PASSWORD nell'env o prompt
// nascosto; viene hashata qui e mai scritta in chiaro. Senza --scrivi mostra
// l'anteprima e non tocca nulla. Runbook: docs/runbooks/multi-azienda.md.

import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "../server/_core/password";
import { kvSql } from "../server/_core/persistence";
import { interruttoreAttivo } from "../server/platform/interruttori";
import { anteprima, opzioni } from "../server/tenants/cli";
import {
  richiestoDa,
  schemaPayloadCrea,
  schemaPayloadProprietario,
  schemaPayloadStato,
} from "../server/tenants/comandi";
import { TENANT_PREDEFINITO_ID } from "../server/tenants/costanti";
import { getTenantRepository } from "../server/tenants/repository";
import type { TipoComando } from "../server/tenants/tipi";

const USO =
  "Uso: pnpm tenant elenco | crea | stato | proprietario (vedi docs/runbooks/multi-azienda.md)";

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
  if (env) return env;
  const digitata = (await chiediNascosto("Password del proprietario (almeno 12 caratteri): ")).trim();
  if (digitata.length < 12) throw new Error("La password deve avere almeno 12 caratteri");
  return digitata;
}

async function attendi(id: number): Promise<number> {
  const repo = getTenantRepository();
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

async function main(): Promise<number> {
  if (!kvSql) {
    console.error("DATABASE_URL mancante: lo script parla solo con il database.");
    return 2;
  }
  const { sotto, valori, flag } = opzioni(process.argv);
  const obbligatoria = (nome: string): string => {
    const v = valori[nome];
    if (!v) throw new Error(`Manca --${nome}=…\n${USO}`);
    return v;
  };
  const repo = getTenantRepository();
  await repo.ensureSchema();
  await repo.caricaCache();

  if (sotto === "elenco") {
    for (const t of repo.tutti()) console.log(`${t.id}\t${t.slug}\t${t.stato}\t${t.nome}`);
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

  if (sotto === "crea") {
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
  } else if (sotto === "proprietario") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (flag.has("assegna") === flag.has("revoca")) throw new Error("Indica --assegna oppure --revoca");
    tipo = flag.has("assegna") ? "assegna_proprietario" : "revoca_proprietario";
    tenantId = t.id;
    payload = schemaPayloadProprietario.parse({ slug, email: obbligatoria("email") });
  } else {
    console.error(USO);
    return 2;
  }

  console.log(anteprima({ tipo, tenantId, payload }));
  if (!flag.has("scrivi")) {
    console.log("Anteprima: rilancia con --scrivi per accodare il comando.");
    return 0;
  }
  if (!interruttoreAttivo("multiAzienda")) {
    console.warn("Attenzione: qui FLAG_MULTI_AZIENDA risulta spento; se lo è anche sul server, il comando resterà in attesa.");
  }
  const comando = await repo.accodaComando({ tipo, tenantId, payload, richiestoDa: richiestoDa() });
  console.log(`Comando #${comando.id} accodato (${tipo}).`);
  return flag.has("attendi") ? attendi(comando.id) : 0;
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
