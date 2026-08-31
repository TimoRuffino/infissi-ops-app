import { createHash } from "node:crypto";
import { getClienteById } from "../../routers/clienti";
import { getCommessaById } from "../../routers/commesse";
import { getLiveComunicazione } from "../../comunicazioni/comunicazioni";
import {
  conversazioneDiUtente,
  salvaContestoConversazioneInArchivio,
} from "../archivio";
import type { ContestoRun, EsitoLettura, SuperficieTars } from "../strumenti/tipi";
import {
  contestoConversazioneVuoto,
  domandaChiarificazioneCommessa,
  analizzaContestoConversazionePersistito,
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
  const ricevuto = conversazione.contesto ?? contestoConversazioneVuoto();
  const { versione, ...payload } = ricevuto;
  const analizzato = analizzaContestoConversazionePersistito(payload);
  const normalizzato = analizzato.success
    ? { ...analizzato.data, versione }
    : { ...contestoConversazioneVuoto(), versione };
  return sanitizzaContestoConversazione(
    normalizzato,
    input.sedeId
  );
}

function versioneCommessa(commessa: any): string | null {
  if (!commessa?.updatedAt) return null;
  const millis = commessa.updatedAt instanceof Date
    ? commessa.updatedAt.getTime()
    : new Date(commessa.updatedAt).getTime();
  return Number.isFinite(millis) ? String(millis) : null;
}

async function sanitizzaContestoConversazione(
  contesto: ContestoConversazione,
  sedeId: number
): Promise<ContestoConversazione> {
  let commessaId = contesto.commessaId;
  let clienteId = contesto.clienteId;
  let comunicazioneId = contesto.comunicazioneId;
  let allegatoIndex = contesto.allegatoIndex;

  const commessa: any = commessaId == null ? null : getCommessaById(commessaId);
  if (!commessa || commessa.sedeId !== sedeId) {
    commessaId = null;
  } else if (Number.isInteger(commessa.clienteId)) {
    const parent: any = getClienteById(commessa.clienteId);
    clienteId = parent?.sedeId === sedeId ? parent.id : null;
  }
  const cliente: any = clienteId == null ? null : getClienteById(clienteId);
  if (!cliente || cliente.sedeId !== sedeId) clienteId = null;

  const comunicazione = comunicazioneId == null
    ? null
    : await getLiveComunicazione(comunicazioneId, sedeId);
  if (!comunicazione) {
    comunicazioneId = null;
    allegatoIndex = null;
  } else {
    if (
      allegatoIndex != null &&
      (allegatoIndex < 0 || allegatoIndex >= comunicazione.allegati.length)
    ) {
      allegatoIndex = null;
    }
    if (comunicazione.commessaId != null) {
      const parent: any = getCommessaById(comunicazione.commessaId);
      if (parent?.sedeId === sedeId) commessaId = parent.id;
    }
    if (comunicazione.clienteId != null) {
      const parent: any = getClienteById(comunicazione.clienteId);
      if (parent?.sedeId === sedeId) clienteId = parent.id;
    }
  }

  return {
    ...contesto,
    commessaId,
    clienteId,
    comunicazioneId,
    allegatoIndex,
  };
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
  const patch: PatchContestoConversazione = {
    ...input.patch,
    versioniEntita: input.patch.versioniEntita
      ? { ...input.patch.versioniEntita }
      : undefined,
  };
  if (patch.commessaId != null) {
    const commessa: any = getCommessaById(patch.commessaId);
    if (!commessa || commessa.sedeId !== input.sedeId) {
      throw new Error("NOT_FOUND: commessa non trovata.");
    }
    patch.clienteId = Number.isInteger(commessa.clienteId)
      ? commessa.clienteId
      : patch.clienteId ?? corrente.clienteId;
  }
  if (patch.clienteId != null) {
    const cliente: any = getClienteById(patch.clienteId);
    if (!cliente || cliente.sedeId !== input.sedeId) {
      throw new Error("NOT_FOUND: cliente non trovato.");
    }
  }
  const comunicazioneId = patch.comunicazioneId !== undefined
    ? patch.comunicazioneId
    : corrente.comunicazioneId;
  if (comunicazioneId != null) {
    const comunicazione = await getLiveComunicazione(comunicazioneId, input.sedeId);
    if (!comunicazione) {
      throw new Error("NOT_FOUND: comunicazione non trovata.");
    }
    patch.comunicazioneId = comunicazione.id;
    if (comunicazione.commessaId != null) {
      const commessa: any = getCommessaById(comunicazione.commessaId);
      if (!commessa || commessa.sedeId !== input.sedeId) {
        throw new Error("NOT_FOUND: commessa della comunicazione non trovata.");
      }
      patch.commessaId = commessa.id;
      patch.clienteId = Number.isInteger(commessa.clienteId)
        ? commessa.clienteId
        : comunicazione.clienteId;
    } else if (comunicazione.clienteId != null) {
      patch.clienteId = comunicazione.clienteId;
    }
    if (patch.clienteId != null) {
      const cliente: any = getClienteById(patch.clienteId);
      if (!cliente || cliente.sedeId !== input.sedeId) {
        throw new Error("NOT_FOUND: cliente della comunicazione non trovato.");
      }
    }
    const indice = patch.allegatoIndex !== undefined
      ? patch.allegatoIndex
      : corrente.allegatoIndex;
    if (
      indice != null &&
      (indice < 0 || indice >= comunicazione.allegati.length)
    ) {
      throw new Error("NOT_FOUND: allegato non trovato nella comunicazione.");
    }
  } else if (patch.allegatoIndex != null) {
    throw new Error("NOT_FOUND: allegato senza comunicazione.");
  } else if (patch.comunicazioneId === null) {
    patch.allegatoIndex = null;
  }
  if (patch.chiarificazionePendente) {
    const candidati = [];
    for (const candidato of patch.chiarificazionePendente.candidati) {
      const commessa: any = getCommessaById(candidato.commessaId);
      if (!commessa || commessa.sedeId !== input.sedeId) {
        throw new Error("NOT_FOUND: candidato commessa non trovato.");
      }
      candidati.push({
        commessaId: commessa.id,
        codice: String(commessa.codice),
        cliente: String(commessa.cliente),
      });
    }
    patch.chiarificazionePendente = { tipo: "commessa", candidati };
  }
  const prossimo: ContestoConversazione = {
    ...corrente,
    ...patch,
    versioniEntita: patch.versioniEntita
      ? { ...patch.versioniEntita }
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

function allegatiEvidenza(esito: any): Array<{ comunicazioneId: number; index: number }> {
  return ((esito?.evidenze ?? []) as Array<{ riferimento?: unknown }>)
    .map(e => /^allegato:(\d+):(\d+)$/.exec(String(e.riferimento ?? "")))
    .filter((match): match is RegExpExecArray => match != null)
    .map(match => ({ comunicazioneId: Number(match[1]), index: Number(match[2]) }));
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
  const allegati = allegatiEvidenza(esito);
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
    const comunicazione = await getLiveComunicazione(comunicazioni[0], input.sedeId);
    if (comunicazione) {
      const sostituita = corrente.comunicazioneId !== comunicazione.id;
      patch.comunicazioneId = comunicazione.id;
      if (sostituita) patch.allegatoIndex = null;
    }
  }
  if (allegati.length === 1) {
    const allegato = allegati[0];
    const comunicazione = await getLiveComunicazione(
      allegato.comunicazioneId,
      input.sedeId
    );
    if (comunicazione && allegato.index < comunicazione.allegati.length) {
      patch.comunicazioneId = comunicazione.id;
      patch.allegatoIndex = allegato.index;
    }
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
  const versioneAttesa = commessaVerificata
    ? persistito.versioniEntita[`commessa:${commessaVerificata.id}`]
    : null;
  const versioneCorrente = versioneCommessa(commessaVerificata);
  const statoCommessa = !commessaVerificata
    ? "assente" as const
    : versioneAttesa && versioneCorrente !== versioneAttesa
      ? "stale" as const
      : "verificato" as const;
  return {
    ...base,
    superficie: persistito.superficie ?? base.superficie,
    entitaAttiva: commessaVerificata && statoCommessa === "verificato"
      ? { tipo: "commessa", id: commessaVerificata.id }
      : base.entitaAttiva,
    contestoConversazione: {
      ...persistito,
      verifiche: {
        commessa: statoCommessa,
        cliente: persistito.clienteId == null ? "assente" : "verificato",
        comunicazione:
          persistito.comunicazioneId == null ? "assente" : "verificato",
        allegato: persistito.allegatoIndex == null ? "assente" : "verificato",
      },
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
      chiarificazionePendente: contesto.chiarificazionePendente
        ? {
            candidati: contesto.chiarificazionePendente.candidati,
            domanda: domandaChiarificazioneCommessa(
              contesto.chiarificazionePendente.candidati
            ),
          }
        : null,
      fingerprint: fingerprintContestoConversazione(contesto),
    }),
    "[/CONTESTO_CONVERSAZIONE_VERIFICATO]",
  ].join("\n");
}
