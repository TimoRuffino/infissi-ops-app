// server/piattaforma/inviti.ts
// Servizio degli inviti (spec §6.1): un comando lascia il suo esito in
// tenant_comandi, ma il link dell'invito è un segreto a tempo che non deve
// restare a terra — per questo l'invito è un servizio chiamato direttamente
// dal pannello (e, domani, dall'onboarding a pagamento), non un comando.
//
// `invitaProprietario` trova l'utente dentro conTenant (per id, per email, o
// l'unico con ruolo proprietario), emette il token con repo.emettiInvito
// (che annulla da solo ogni invito precedente ancora valido dello stesso
// utente), compone il link e manda la posta — senza MAI lanciare se la posta
// fallisce: il link torna comunque al chiamante, che lo mostra da copiare.
// L'evento invito_inviato porta l'esito e l'eventuale motivo, mai il token.
//
// `accettaInvito` consuma il token in modo atomico e monouso
// (repo.consumaInvito): un token già usato, annullato o scaduto dà sempre
// lo stesso messaggio (invitoNonValido), senza distinguere il motivo — non
// è un indizio da dare a chi prova un token a caso.
import { hashPassword } from "../_core/password";
import { contattoPiattaforma, inviaPosta } from "../_core/postaPiattaforma";
import { getUtentiPersistedStore, getUtentiStore } from "../routers/utenti";
import { RUOLO_PROPRIETARIO, TTL_INVITO_MS } from "../tenants/costanti";
import { conTenant } from "../tenants/contestoCorrente";
import { getTenantRepository } from "../tenants/repository";
import { attoreTesto, type Attore, type TenantInvito } from "../tenants/tipi";
import { MESSAGGI_PIATTAFORMA, VARIABILE_BASE_URL } from "./costanti";
import { testoInvito } from "./testi";

/**
 * `APP_BASE_URL` (senza barra finale) se impostata, altrimenti il ripiego
 * `req.protocol`/`req.get("host")` — lo stesso di `fattureInCloud.ts` per il
 * redirect OAuth. In produzione va impostata (spec §6.1, §12).
 */
export function baseUrlDa(req: { protocol: string; get(nome: string): string | undefined }): string {
  const configurato = process.env[VARIABILE_BASE_URL]?.trim().replace(/\/+$/, "");
  return configurato || `${req.protocol}://${req.get("host")}`;
}

/**
 * Un avviso solo, al boot (I5 della revisione finale). Senza `APP_BASE_URL`
 * il link d'invito nasce dall'Host della richiesta: di solito è l'indirizzo
 * giusto, ma dietro un proxy, su un dominio vecchio o su un'anteprima manda
 * il proprietario dove non deve — e non se ne accorge nessuno finché non
 * arriva la segnalazione. Restituisce `true` se ha avvisato, così il test
 * non deve leggere il log per sapere che cosa è successo.
 */
export function avvisaBaseUrlMancante(): boolean {
  if (process.env[VARIABILE_BASE_URL]?.trim()) return false;
  console.warn(
    `[piattaforma] ${VARIABILE_BASE_URL} non impostata: i link d'invito useranno l'host della richiesta`
  );
  return true;
}

/**
 * L'utente da invitare, dentro conTenant: per id se dato, altrimenti per
 * email se data, altrimenti l'unico utente con ruolo proprietario — con più
 * di un proprietario e nessuna scelta esplicita, l'ambiguità va a chi ha
 * chiamato (proprietarioAmbiguo). `null` se nessuno combacia.
 */
function proprietarioDa(tenantId: number, scelta: { utenteId?: number; email?: string }): any {
  return conTenant(tenantId, () => {
    const utenti = getUtentiStore().filter((u: any) => u.tenantId === tenantId);
    if (scelta.utenteId != null) return utenti.find((u: any) => u.id === scelta.utenteId) ?? null;
    if (scelta.email) {
      const email = scelta.email.trim().toLowerCase();
      return utenti.find((u: any) => u.email.toLowerCase() === email) ?? null;
    }
    const proprietari = utenti.filter((u: any) => (u.ruoli ?? []).includes(RUOLO_PROPRIETARIO));
    if (proprietari.length > 1) throw new Error(MESSAGGI_PIATTAFORMA.proprietarioAmbiguo);
    return proprietari[0] ?? null;
  });
}

export async function invitaProprietario(input: {
  tenantId: number;
  utenteId?: number;
  email?: string;
  attore: Attore;
  adesso: Date;
  baseUrl: string;
}): Promise<{
  invito: TenantInvito;
  link: string;
  inviato: boolean;
  motivo?: string;
  /** La base da cui è composto il link (I5): il pannello la mostra accanto al link. */
  baseUrl: string;
}> {
  const repo = getTenantRepository();
  const tenant = repo.perId(input.tenantId);
  if (!tenant) throw new Error("Azienda inesistente");
  const utente = proprietarioDa(input.tenantId, input);
  if (!utente) throw new Error("Proprietario non trovato");

  const { invito, token } = await repo.emettiInvito({
    tenantId: tenant.id,
    utenteId: utente.id,
    email: utente.email,
    tipo: "proprietario",
    creatoDa: attoreTesto(input.attore),
    adesso: input.adesso,
  });
  const link = `${input.baseUrl}/invito/${token}`;
  const posta = await inviaPosta({
    a: utente.email,
    ...testoInvito({
      nome: utente.nome,
      azienda: tenant.nome,
      // Il suo nome utente: nella mail va detto, non lasciato indovinare.
      email: utente.email,
      link,
      giorni: Math.round(TTL_INVITO_MS / 86_400_000),
      // La data vera dell'invito appena emesso, non un «fra 7 giorni»
      // ricalcolato a mente da chi legge il quinto giorno.
      scadeIl: invito.scadeIl,
      // La stessa base del link: il marchio della busta nasce da lì, così
      // una mail nata su un'anteprima non va a pescare l'immagine in
      // produzione (e viceversa).
      baseUrl: input.baseUrl,
      contatto: contattoPiattaforma(),
    }),
  });
  await repo.registraEvento({
    tenantId: tenant.id,
    tipo: "invito_inviato",
    attore: attoreTesto(input.attore),
    dettagli: {
      invitoId: invito.id,
      utenteId: utente.id,
      email: utente.email,
      scadeIl: invito.scadeIl.toISOString(),
      inviato: posta.inviato,
      ...(posta.inviato ? {} : { motivo: posta.motivo }),
    },
  });
  return {
    invito,
    link,
    baseUrl: input.baseUrl,
    inviato: posta.inviato,
    ...(posta.inviato ? {} : { motivo: posta.motivo }),
  };
}

/** Legge l'invito valido senza consumarlo: la pagina pubblica lo chiama per mostrare azienda, nome ed email prima della password. */
export async function anteprimaInvito(
  input: { token: string; adesso: Date }
): Promise<{ azienda: string; email: string; nome: string; scadeIl: Date } | null> {
  const repo = getTenantRepository();
  const invito = await repo.invitoPerToken(input.token, input.adesso);
  if (!invito) return null;
  const tenant = repo.perId(invito.tenantId);
  const utente = conTenant(invito.tenantId, () => getUtentiStore().find((u: any) => u.id === invito.utenteId));
  if (!tenant || !utente) return null;
  return { azienda: tenant.nome, email: invito.email, nome: utente.nome, scadeIl: invito.scadeIl };
}

export async function accettaInvito(
  input: { token: string; password: string; adesso: Date }
): Promise<{ tenantId: number; utenteId: number; email: string }> {
  const repo = getTenantRepository();
  const invito = await repo.consumaInvito(input.token, input.adesso);
  if (!invito) throw new Error(MESSAGGI_PIATTAFORMA.invitoNonValido);
  const email = conTenant(invito.tenantId, () => {
    const utente = getUtentiStore().find((u: any) => u.id === invito.utenteId);
    if (!utente) throw new Error(MESSAGGI_PIATTAFORMA.invitoNonValido);
    // Fix round 1 (Task 3, revisione): l'email sull'invito è quella di
    // quando è stato emesso. Se nel frattempo `modifica_proprietario` ha
    // cambiato l'email del proprietario FUORI dal router (es. dal giro dei
    // 30s, che non passa dal reinvio dell'invito del router), questo invito
    // resta "valido" per la sola definizione tecnica (non usato, non
    // annullato, non scaduto) ma punta a un'identità superata — chi lo
    // possiede ancora (una vecchia casella, un link salvato) potrebbe
    // impostare la password sull'account rinominato. Stesso esito generico
    // di un token scaduto o annullato, nessun dettaglio in più da dare a chi
    // tenta un vecchio link: il confronto ignora le maiuscole, come ogni
    // altro confronto email di questo servizio.
    if (String(utente.email).toLowerCase() !== invito.email.toLowerCase()) {
      throw new Error(MESSAGGI_PIATTAFORMA.invitoNonValido);
    }
    utente.password = hashPassword(input.password);
    utente.attivo = true;
    utente.updatedAt = input.adesso;
    getUtentiPersistedStore().save();
    return utente.email as string;
  });
  await repo.registraEvento({
    tenantId: invito.tenantId,
    tipo: "invito_accettato",
    attore: attoreTesto({ tipo: "utente", id: invito.utenteId }),
    dettagli: { invitoId: invito.id, utenteId: invito.utenteId },
  });
  return { tenantId: invito.tenantId, utenteId: invito.utenteId, email };
}
