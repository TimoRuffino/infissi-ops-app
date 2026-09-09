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
import { inviaPosta } from "../_core/postaPiattaforma";
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
}): Promise<{ invito: TenantInvito; link: string; inviato: boolean; motivo?: string }> {
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
      link,
      giorni: Math.round(TTL_INVITO_MS / 86_400_000),
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
  return { invito, link, inviato: posta.inviato, ...(posta.inviato ? {} : { motivo: posta.motivo }) };
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
    utente.password = hashPassword(input.password);
    utente.attivo = true;
    utente.updatedAt = input.adesso;
    getUtentiPersistedStore().save();
    return utente.email as string;
  });
  await repo.registraEvento({
    tenantId: invito.tenantId,
    tipo: "invito_accettato",
    attore: `utente:${invito.utenteId}`,
    dettagli: { invitoId: invito.id, utenteId: invito.utenteId },
  });
  return { tenantId: invito.tenantId, utenteId: invito.utenteId, email };
}
