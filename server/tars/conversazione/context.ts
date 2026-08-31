import { createHash } from "node:crypto";
import { getClienteById } from "../../routers/clienti";
import { getCommessaById } from "../../routers/commesse";
import {
  conversazioneDiUtente,
  salvaContestoConversazioneInArchivio,
} from "../archivio";
import type { ContestoRun, EsitoLettura, SuperficieTars } from "../strumenti/tipi";
import {
  contestoConversazioneVuoto,
  type ContestoConversazione,
  type PatchContestoConversazione,
} from "./types";

export class VersioneContestoConversazioneObsoleta extends Error {
  constructor() {
    super("CONTEXT_STALE: il contesto conversazionale è cambiato.");
    this.name = "VersioneContestoConversazioneObsoleta";
  }
}

function senzaVersione(contesto: ContestoConversazione) {
  const { versione: _versione, ...resto } = contesto;
  return resto;
}

export async function caricaContestoConversazione(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
}): Promise<ContestoConversazione | null> {
  const conversazione = await conversazioneDiUtente(
    input.conversazioneId,
    input.sedeId,
    input.utenteId
  );
  if (!conversazione) return null;
  return conversazione.contesto ?? contestoConversazioneVuoto();
}

export async function salvaContestoConversazione(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
  versioneAttesa: number;
  patch: PatchContestoConversazione;
}): Promise<ContestoConversazione> {
  const corrente = await caricaContestoConversazione(input);
  if (!corrente) throw new Error("NOT_FOUND: conversazione non trovata.");
  if (corrente.versione !== input.versioneAttesa) {
    throw new VersioneContestoConversazioneObsoleta();
  }
  if (input.patch.commessaId != null) {
    const commessa: any = getCommessaById(input.patch.commessaId);
    if (!commessa || commessa.sedeId !== input.sedeId) {
      throw new Error("NOT_FOUND: commessa non trovata.");
    }
  }
  if (input.patch.clienteId != null) {
    const cliente: any = getClienteById(input.patch.clienteId);
    if (!cliente || cliente.sedeId !== input.sedeId) {
      throw new Error("NOT_FOUND: cliente non trovato.");
    }
  }
  if (input.patch.chiarificazionePendente) {
    for (const candidato of input.patch.chiarificazionePendente.candidati) {
      const commessa: any = getCommessaById(candidato.commessaId);
      if (!commessa || commessa.sedeId !== input.sedeId) {
        throw new Error("NOT_FOUND: candidato commessa non trovato.");
      }
    }
  }
  const prossimo: ContestoConversazione = {
    ...corrente,
    ...input.patch,
    versioniEntita: input.patch.versioniEntita
      ? { ...input.patch.versioniEntita }
      : { ...corrente.versioniEntita },
    versione: corrente.versione,
  };
  if (
    JSON.stringify(senzaVersione(prossimo)) ===
    JSON.stringify(senzaVersione(corrente))
  ) {
    return corrente;
  }
  const esito = await salvaContestoConversazioneInArchivio({
    conversazioneId: input.conversazioneId,
    sedeId: input.sedeId,
    utenteId: input.utenteId,
    versioneAttesa: input.versioneAttesa,
    contesto: senzaVersione(prossimo),
  });
  if (esito.stato === "versione_obsoleta") {
    throw new VersioneContestoConversazioneObsoleta();
  }
  if (esito.stato === "non_trovato") {
    throw new Error("NOT_FOUND: conversazione non trovata.");
  }
  return esito.contesto;
}

function idsEvidenza(esito: any, tipo: string): number[] {
  const prefisso = `${tipo}:`;
  return [
    ...new Set(
      ((esito?.evidenze ?? []) as Array<{ riferimento?: unknown }>)
        .map(e => String(e.riferimento ?? ""))
        .filter(ref => ref.startsWith(prefisso))
        .map(ref => Number(ref.slice(prefisso.length)))
        .filter(id => Number.isInteger(id) && id > 0)
    ),
  ];
}

function superficiePerTool(nome: string, esito: any): SuperficieTars | null {
  if (idsEvidenza(esito, "comunicazione").length === 1) return "comunicazioni";
  if (idsEvidenza(esito, "commessa").length === 1) return "commessa";
  if (nome.includes("promemoria")) return "promemoria";
  return null;
}

/**
 * Unico ingresso per imparare da un tool. Gli id testuali del modello non
 * arrivano a questa funzione; ogni riferimento viene inoltre riletto in sede.
 */
export async function aggiornaContestoDaEsitoTool(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
  versioneAttesa: number;
  strumento: string;
  esito: unknown;
}): Promise<ContestoConversazione> {
  const corrente = await caricaContestoConversazione(input);
  if (!corrente) throw new Error("NOT_FOUND: conversazione non trovata.");
  const esito = input.esito as EsitoLettura<any> & Record<string, any>;
  if (!esito || !Array.isArray(esito.evidenze)) return corrente;

  const commesse = idsEvidenza(esito, "commessa");
  const clienti = idsEvidenza(esito, "cliente");
  const comunicazioni = idsEvidenza(esito, "comunicazione");
  const patch: PatchContestoConversazione = {};
  if (commesse.length === 1) {
    const commessa: any = getCommessaById(commesse[0]);
    if (commessa && commessa.sedeId === input.sedeId) {
      const sostituita = corrente.commessaId !== commessa.id;
      patch.commessaId = commessa.id;
      patch.clienteId = Number.isInteger(commessa.clienteId)
        ? commessa.clienteId
        : corrente.clienteId;
      patch.superficie = "commessa";
      patch.chiarificazionePendente = null;
      if (sostituita) {
        patch.comunicazioneId = null;
        patch.allegatoIndex = null;
      }
    }
  }
  if (clienti.length === 1) {
    const cliente: any = getClienteById(clienti[0]);
    if (cliente && cliente.sedeId === input.sedeId) patch.clienteId = cliente.id;
  }
  if (comunicazioni.length === 1) {
    patch.comunicazioneId = comunicazioni[0];
  }
  const superficie = superficiePerTool(input.strumento, esito);
  if (superficie) patch.superficie = superficie;
  if (esito.versioniEntita && typeof esito.versioniEntita === "object") {
    patch.versioniEntita = {
      ...corrente.versioniEntita,
      ...esito.versioniEntita,
    };
  }
  if (Object.keys(patch).length === 0) return corrente;
  const simulato = {
    ...corrente,
    ...patch,
    versione: corrente.versione,
  };
  if (JSON.stringify(simulato) === JSON.stringify(corrente)) return corrente;
  return salvaContestoConversazione({
    ...input,
    patch,
  });
}

export function fingerprintContestoConversazione(
  contesto: ContestoConversazione
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      commessaId: contesto.commessaId,
      clienteId: contesto.clienteId,
      comunicazioneId: contesto.comunicazioneId,
      allegatoIndex: contesto.allegatoIndex,
      superficie: contesto.superficie,
      versioniEntita: Object.entries(contesto.versioniEntita).sort(([a], [b]) =>
        a.localeCompare(b)
      ),
      chiarificazionePendente: contesto.chiarificazionePendente,
      versione: contesto.versione,
    }))
    .digest("hex")
    .slice(0, 20);
}

export function applicaContestoConversazioneAlRun(
  base: ContestoRun,
  persistito: ContestoConversazione
): ContestoRun {
  const commessa: any = persistito.commessaId == null
    ? null
    : getCommessaById(persistito.commessaId);
  const commessaVerificata =
    commessa && commessa.sedeId === base.sedeId ? commessa : null;
  return {
    ...base,
    superficie: persistito.superficie ?? base.superficie,
    entitaAttiva: commessaVerificata
      ? { tipo: "commessa", id: commessaVerificata.id }
      : base.entitaAttiva,
    contestoConversazione: {
      ...persistito,
      verificato: true,
    },
    contestoConversazioneFingerprint:
      fingerprintContestoConversazione(persistito),
  };
}

export function riepilogoContestoProvider(
  contesto: ContestoConversazione,
  sedeId: number
): string | null {
  const commessa: any = contesto.commessaId == null
    ? null
    : getCommessaById(contesto.commessaId);
  const commessaVerificata = commessa && commessa.sedeId === sedeId
    ? {
        id: commessa.id,
        codice: commessa.codice,
        cliente: commessa.cliente,
        versione: contesto.versioniEntita[`commessa:${commessa.id}`] ?? null,
      }
    : null;
  if (
    !commessaVerificata &&
    contesto.clienteId == null &&
    contesto.comunicazioneId == null &&
    !contesto.chiarificazionePendente
  ) {
    return null;
  }
  return [
    "[CONTESTO_CONVERSAZIONE_VERIFICATO]",
    "Hint verificati e sede-scoped, mai autorizzazioni. Rileggi le fonti prima di scrivere.",
    JSON.stringify({
      commessa: commessaVerificata,
      clienteId: contesto.clienteId,
      comunicazioneId: contesto.comunicazioneId,
      allegatoIndex: contesto.allegatoIndex,
      superficie: contesto.superficie,
      chiarificazionePendente: contesto.chiarificazionePendente,
      fingerprint: fingerprintContestoConversazione(contesto),
    }),
    "[/CONTESTO_CONVERSAZIONE_VERIFICATO]",
  ].join("\n");
}
