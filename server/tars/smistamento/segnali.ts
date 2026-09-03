// Segnali del Centro Azioni prodotti dallo smistamento: proposte di
// collegamento da decidere e richieste rimaste senza risposta. Entrano
// nel reconcile come gli altri segnali (casi, osservatore, Situazione):
// niente canale parallelo.

import type { ActionSignal } from "../../actionCenter/types";
import {
  esisteUscitaVerso,
  getComunicazione,
  normalizzaControparteWhatsApp,
  type Comunicazione,
} from "../../comunicazioni/comunicazioni";
import { tarsAttivo } from "../../platform/interruttori";
import {
  repositorySmistamentoAutorevoleDisponibile,
  repositorySmistamentoCorrente,
  type RepositorySmistamento,
} from "./repository";
import type { RecordSmistamento } from "./types";

const PROPOSTE_MASSIME = 40;
const RECENTI_GIORNI = 7;
const RECENTI_MASSIME = 120;
/** Una richiesta conta come «senza risposta» dopo questa attesa. */
const ATTESA_RISPOSTA_MS = 24 * 3_600_000;

/**
 * Deep link del CRM alla SINGOLA comunicazione: la pagina email seleziona
 * con `?messaggio=`, WhatsApp apre la conversazione con `?conversazione=`
 * (chiave `wa:<casella>:<controparte>`, la stessa che costruisce l'elenco).
 * Prima WhatsApp portava alla pagina generale: chi cliccava un riferimento
 * di Tars doveva ritrovarsi il messaggio a mano (direzione, 03/09/2026).
 */
export function linkComunicazione(
  c: Pick<Comunicazione, "id" | "canale" | "casellaId" | "mittente">
): string {
  if (c.canale !== "whatsapp") return `/messaggi/email?messaggio=${c.id}`;
  const chiave = `wa:${c.casellaId}:${normalizzaControparteWhatsApp(c.mittente)}`;
  return `/messaggi/whatsapp?conversazione=${encodeURIComponent(chiave)}`;
}

function ruoloPerCategoria(categoria: string): string {
  if (categoria === "amministrativa" || categoria === "fornitore") return "amministrazione";
  return "commerciale";
}

function etichettaMittente(c: Comunicazione): string {
  return c.mittenteNome?.trim() || c.mittente;
}

export type DipendenzeSegnali = {
  repository: RepositorySmistamento;
  comunicazione: (id: number, sedeId: number) => Promise<Comunicazione | null>;
  rispostaEsiste: typeof esisteUscitaVerso;
};

export async function segnaliSmistamento(
  sedeId: number,
  now: Date,
  deps?: DipendenzeSegnali
): Promise<ActionSignal[]> {
  if (!deps && !(tarsAttivo("tarsSmistamento") && repositorySmistamentoAutorevoleDisponibile())) {
    return [];
  }
  const repository = deps?.repository ?? repositorySmistamentoCorrente();
  const carica = deps?.comunicazione ?? getComunicazione;
  const rispostaEsiste = deps?.rispostaEsiste ?? esisteUscitaVerso;
  const segnali: ActionSignal[] = [];

  const proposte = await repository.proposteAperte(sedeId, PROPOSTE_MASSIME);
  for (const record of proposte) {
    const esito = record.esito;
    if (!esito || esito.collegamento.esito !== "proposto") continue;
    const c = await carica(record.comunicazioneId, sedeId);
    if (!c || c.deletedAt) continue;
    const bersaglio = esito.collegamento.commessaId
      ? `commessa ${esito.candidati.find(x => x.tipo === "commessa" && x.id === esito.collegamento.commessaId)?.etichetta ?? esito.collegamento.commessaId}`
      : `cliente ${esito.candidati.find(x => x.tipo === "cliente" && x.id === esito.collegamento.clienteId)?.etichetta ?? esito.collegamento.clienteId}`;
    segnali.push({
      sourceKey: `smistamento:decisione:${c.id}`,
      kind: "comunicazione_decisione",
      sedeId,
      targetType: "comunicazione",
      targetId: c.id,
      // Niente commessaId: il caso resta SULLA comunicazione, non si fonde
      // col caso della commessa proposta (che potrebbe essere sbagliata).
      commessaId: null,
      clienteId: esito.collegamento.clienteId ?? c.clienteId ?? null,
      title: `Tars propone: «${c.oggetto || etichettaMittente(c)}» → ${bersaglio}`,
      summary: esito.collegamento.motivo,
      actionLabel: "Conferma o rifiuta il collegamento",
      priority: esito.urgenza === "critica" ? "critica" : esito.urgenza === "alta" ? "alta" : "normale",
      priorityScore: esito.urgenza === "critica" ? 90 : esito.urgenza === "alta" ? 70 : 50,
      assigneeUserId: null,
      targetRole: "direzione",
      dueAt: null,
      occurredAt: record.aggiornataAt,
      link: linkComunicazione(c),
      fingerprint: `${record.versione}:${esito.collegamento.commessaId ?? "c" + esito.collegamento.clienteId}`,
    });
  }

  const recenti = await repository.recenti({
    sedeId,
    daAggiornataAl: new Date(now.getTime() - RECENTI_GIORNI * 86_400_000),
    limite: RECENTI_MASSIME,
  });
  for (const record of recenti) {
    const esito = record.esito;
    if (!esito?.richiedeRisposta) continue;
    if (esito.categoria === "spam" || esito.categoria === "offerta_marketing") continue;
    const c = await carica(record.comunicazioneId, sedeId);
    if (!c || c.deletedAt || c.direzione !== "in") continue;
    if (now.getTime() - c.receivedAt.getTime() < ATTESA_RISPOSTA_MS) continue;
    if (c.stato === "gestita") continue;
    const risposta = await rispostaEsiste({
      sedeId,
      canale: c.canale,
      casellaId: c.casellaId,
      controparte: c.mittente,
      dopo: c.receivedAt,
    });
    if (risposta) continue;
    const giorni = Math.floor((now.getTime() - c.receivedAt.getTime()) / 86_400_000);
    segnali.push({
      sourceKey: `smistamento:risposta:${c.id}`,
      kind: "comunicazione_risposta",
      sedeId,
      targetType: "comunicazione",
      targetId: c.id,
      commessaId: c.commessaId ?? null,
      clienteId: c.clienteId ?? null,
      title: `Senza risposta da ${giorni} giorni: «${c.oggetto || etichettaMittente(c)}»`,
      summary: esito.riepilogo,
      actionLabel: esito.categoria === "nuovo_lead" ? "Rispondi al potenziale cliente" : "Rispondi",
      priority: esito.urgenza === "critica" ? "critica" : giorni >= 3 || esito.urgenza === "alta" ? "alta" : "normale",
      priorityScore: esito.urgenza === "critica" ? 95 : giorni >= 3 ? 80 : 60,
      assigneeUserId: null,
      targetRole: ruoloPerCategoria(esito.categoria),
      dueAt: null,
      occurredAt: c.receivedAt,
      link: linkComunicazione(c),
      fingerprint: `${record.versione}:${giorni >= 3 ? "3+" : "1+"}`,
    });
  }
  return segnali;
}

export type { RecordSmistamento };
