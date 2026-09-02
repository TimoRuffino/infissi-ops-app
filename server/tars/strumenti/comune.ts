// Helper condivisi dagli strumenti di scrittura «Tars libero» (02/09/2026).
//
// Il modello chiama lo strumento; lo strumento esegue la STESSA procedura
// canonica del router con un contesto server costruito da Tars (stesso
// utente, stessa sede, stesse capability → stessa `authorizeCoreOperation`).
// Non è un passthrough generico: ogni strumento è tipizzato, dichiara
// capability e scope, e ogni esito passa dal ledger R1.

import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import type { ContestoRun, EsitoAzione, EvidenzaTars } from "./tipi";

export function contestoServer(
  contesto: ContestoRun
): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> {
  return {
    user: {
      id: contesto.utenteId,
      role: contesto.direzione ? "admin" : "user",
      ruolo: contesto.ruoli[0] ?? null,
      ruoli: [...contesto.ruoli],
      name: `Tars per l'utente ${contesto.utenteId}`,
    } as any,
    sedeId: contesto.sedeId,
    sediIds: [contesto.sedeId],
  };
}

/** Caller tRPC con il contesto server di Tars (import lazy: i router importano Tars). */
export async function callerPer(contesto: ContestoRun) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    ...contestoServer(contesto),
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
  } as TrpcContext);
}

export function baseAzione(strumento: string): Omit<EsitoAzione, "stato" | "motivo" | "dati"> {
  return {
    tipo: "azione",
    strumento,
    azioneId: null,
    auditId: null,
    entitaToccate: [],
    prima: null,
    dopo: null,
    undoDisponibile: false,
    undoEntro: null,
    undoVia: null,
    conferma: null,
    avvertenze: [],
    assunzioni: [],
    evidenze: [],
    freschezza: new Date().toISOString(),
  };
}

export function nonEseguito(strumento: string, motivo: string): EsitoAzione<null> {
  return { ...baseAzione(strumento), stato: "non_eseguito", motivo, dati: null };
}

/** Motivo leggibile e senza leak per gli errori del dominio/policy. */
export function motivoSicuro(errore: unknown): string {
  if (errore instanceof TRPCError) {
    if (errore.code === "FORBIDDEN") return `Non autorizzato: ${errore.message}`;
    if (errore.code === "NOT_FOUND") return "Non trovato in questa sede.";
    return errore.message.slice(0, 200);
  }
  const messaggio = errore instanceof Error ? errore.message : "";
  if (/non trovat/i.test(messaggio)) return "Non trovato in questa sede.";
  if (/sede/i.test(messaggio) && /scope|altra/i.test(messaggio)) return "Non trovato in questa sede.";
  if (/FORBIDDEN|autorizz|permess/i.test(messaggio)) return "Non autorizzato per il tuo profilo.";
  return messaggio ? messaggio.slice(0, 200) : "Operazione non riuscita.";
}

export function evidenzaCommessa(commessa: any): EvidenzaTars {
  return {
    tipo: "entita",
    riferimento: `commessa:${commessa.id}`,
    descrizione: `${commessa.codice ?? `Commessa ${commessa.id}`} — ${commessa.cliente ?? "cliente non indicato"}`,
  };
}

export function evidenzaCliente(cliente: any): EvidenzaTars {
  return {
    tipo: "entita",
    riferimento: `cliente:${cliente.id}`,
    descrizione: `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim() || `Cliente ${cliente.id}`,
  };
}

/** La commessa attiva e verificata della conversazione, se c'è. */
export function commessaDalContesto(contesto: ContestoRun): number | null {
  const c = contesto.contestoConversazione;
  return c?.verifiche.commessa === "verificato" ? c.commessaId : null;
}

export function fatto<T extends Record<string, unknown>>(input: {
  strumento: string;
  stato: string;
  azioneId: string;
  entitaToccate: string[];
  prima?: Record<string, unknown> | null;
  dopo: T;
  evidenze: EvidenzaTars[];
  avvertenze?: string[];
}): EsitoAzione<T> {
  return {
    ...baseAzione(input.strumento),
    stato: input.stato,
    motivo: null,
    azioneId: input.azioneId,
    entitaToccate: input.entitaToccate,
    prima: input.prima ?? null,
    dopo: input.dopo,
    avvertenze: input.avvertenze ?? [],
    dati: input.dopo,
    evidenze: input.evidenze,
  };
}
