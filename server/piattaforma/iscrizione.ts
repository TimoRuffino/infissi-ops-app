// server/piattaforma/iscrizione.ts
// L'iscrizione pubblica «Prova gratuita» (ciclo di vita, piano 10/09/2026,
// D7): il modulo su /prova accoda lo STESSO comando `crea` del pannello, con
// `statoIniziale: "in_attesa"` — l'azienda si attiva solo quando l'invito
// viene accettato, e la pulizia dei 14 giorni si porta via chi non lo fa.
// Quando arriverà Stripe cambierà solo chi innesca questo flusso.
//
// Fail-closed tre volte: FLAG_ISCRIZIONE_PUBBLICA (spento di default in
// produzione), FLAG_MULTI_AZIENDA, e la posta configurata — il link
// d'invito viaggia SOLO per email, mai verso il browser anonimo: l'email è
// anche la verifica dell'indirizzo. La risposta è SEMPRE la stessa
// («controlla la casella»), anche quando l'email è già in uso o l'azienda
// non nasce: un modulo pubblico non conferma a nessuno quali email esistono.
import { randomBytes } from "node:crypto";
import { hashPassword } from "../_core/password";
import { postaConfigurata } from "../_core/postaPiattaforma";
import { interruttoreAttivo } from "../platform/interruttori";
import { getUtentiStore } from "../routers/utenti";
import { schemaPayloadCrea } from "../tenants/comandi";
import { SLUG_RE } from "../tenants/costanti";
import { getTenantRepository } from "../tenants/repository";
import { eseguiComandoSubito } from "../tenants/servizio";
import { baseUrlDa, invitaProprietario } from "./inviti";

export const RICHIESTO_DA_ISCRIZIONE = "script:iscrizione-pubblica";

export function iscrizioneDisponibile(): boolean {
  return (
    interruttoreAttivo("multiAzienda") &&
    interruttoreAttivo("iscrizionePubblica") &&
    postaConfigurata()
  );
}

/**
 * Stessa forma di `slugSuggerito` del client (client/src/lib/piattaforma.ts):
 * minuscole senza accenti, tutto il resto diventa trattino, mai ai bordi,
 * max 40. `azienda` come ripiego per un nome fatto solo di simboli.
 */
export function slugDaNome(nome: string): string {
  const slug = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return SLUG_RE.test(slug) ? slug : "azienda";
}

/**
 * Uno slug libero derivato dal nome: se quello naturale è preso (o già in
 * coda in un comando `crea` in attesa — due iscrizioni con lo stesso nome
 * non devono finire nello stesso tenant, `crea` è idempotente per slug), si
 * prova con un suffisso numerico, poi con uno casuale.
 */
export async function slugLibero(nome: string): Promise<string> {
  const repo = getTenantRepository();
  const inCoda = new Set(
    (await repo.comandiInAttesa())
      .filter(c => c.tipo === "crea")
      .map(c => String((c.payload as { slug?: unknown }).slug ?? ""))
  );
  const preso = (slug: string): boolean => Boolean(repo.perSlug(slug)) || inCoda.has(slug);
  const base = slugDaNome(nome);
  if (!preso(base)) return base;
  for (let n = 2; n <= 99; n++) {
    const candidato = `${base.slice(0, 40 - `-${n}`.length)}-${n}`;
    if (!preso(candidato)) return candidato;
  }
  return `${base.slice(0, 33)}-${randomBytes(3).toString("hex")}`;
}

export type IscrizioneInput = {
  azienda: string;
  nome: string;
  cognome: string;
  email: string;
  telefono?: string | null;
  baseUrl: string;
};

// Le iscrizioni si accodano UNA alla volta nel processo: due richieste con
// lo stesso nome sceglierebbero lo stesso slug e, con `crea` idempotente per
// slug, la seconda aggiungerebbe un proprietario all'azienda della prima.
// Il server ha una replica sola (Railway): il mutex in-process basta; con
// più repliche servirà un vincolo a livello di coda.
let codaIscrizioni: Promise<unknown> = Promise.resolve();

/**
 * Registra la prova. Ritorna sempre `{ ok: true }` quando la richiesta è
 * ben formata: chi chiama non distingue «azienda creata» da «email già in
 * uso» (in quel caso non nasce nulla e non parte nulla). Un guasto vero
 * (comando in errore, invito fallito) lancia: il router lo traduce in un
 * messaggio generico.
 */
export function registraProva(input: IscrizioneInput): Promise<{ ok: true }> {
  const esito = codaIscrizioni.then(() => registraProvaSerializzata(input));
  codaIscrizioni = esito.catch(() => {});
  return esito;
}

async function registraProvaSerializzata(input: IscrizioneInput): Promise<{ ok: true }> {
  const email = input.email.trim().toLowerCase();
  // Lo store utenti è globale: un'email già in uso — in QUALUNQUE azienda —
  // ferma tutto in silenzio. Solo una riga di log col dominio, come la posta.
  if (getUtentiStore().some((u: any) => String(u.email).toLowerCase() === email)) {
    console.warn(`[iscrizione] email già in uso (@${email.split("@")[1] ?? "?"}): nessuna azienda creata`);
    return { ok: true };
  }

  const repo = getTenantRepository();
  const slug = await slugLibero(input.azienda);
  const payload = schemaPayloadCrea.parse({
    slug,
    nome: input.azienda,
    sede: { nome: input.azienda, citta: null },
    proprietario: {
      nome: input.nome,
      cognome: input.cognome,
      email,
      telefono: input.telefono ?? null,
      // Come il pannello (spec WS6 §5.2): nessuno entra prima dell'invito.
      passwordHash: hashPassword(randomBytes(32).toString("base64url")),
    },
    statoIniziale: "in_attesa",
  });
  const comando = await repo.accodaComando({
    tipo: "crea",
    tenantId: null,
    payload,
    richiestoDa: RICHIESTO_DA_ISCRIZIONE,
  });
  const eseguito = await eseguiComandoSubito(comando.id);
  if (eseguito.stato !== "eseguito") {
    throw new Error(`iscrizione: comando crea #${comando.id} in stato ${eseguito.stato}`);
  }
  const esito = eseguito.esito as { tenantId: number; creatoOra: boolean };
  if (!esito.creatoOra) {
    // Lo slug era libero dentro il mutex, quindi qui può arrivare solo una
    // corsa con un `crea` partito da pannello o CLI nello stesso istante —
    // e `crea`, idempotente per slug, potrebbe aver aggiunto il proprietario
    // dell'iscrizione a QUELL'azienda. Si segnala forte con l'id del
    // comando: il registro eventi del tenant dice cosa è stato toccato.
    throw new Error(`iscrizione: slug ${slug} già esistente al momento del crea (comando #${comando.id})`);
  }
  const invito = await invitaProprietario({
    tenantId: esito.tenantId,
    email,
    attore: { tipo: "script", nome: RICHIESTO_DA_ISCRIZIONE },
    adesso: new Date(),
    baseUrl: input.baseUrl,
  });
  if (!invito.inviato) {
    // La posta era configurata (guardia in `iscrizioneDisponibile`) ma
    // l'invio è fallito: l'azienda resta `in_attesa` e l'amministratore può
    // reinviare dal pannello; la pulizia dei 14 giorni copre l'abbandono.
    throw new Error(`iscrizione: invito non inviato (${invito.motivo ?? "?"})`);
  }
  console.log(`[iscrizione] azienda ${slug} (tenant ${esito.tenantId}) in attesa: invito inviato`);
  return { ok: true };
}

export { baseUrlDa };
