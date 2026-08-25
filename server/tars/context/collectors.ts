import { getAllStoreSnapshots } from "../../_core/persistence";
import { getActionCaseRepository } from "../../actionCenter/repository";
import { getClientiStore } from "../../routers/clienti";
import { getCommesseStore } from "../../routers/commesse";
import { ficFatture } from "../../routers/ficFatture";
import { getInterventiStore } from "../../routers/interventi";
import { getTicketStore } from "../../routers/ticket";
import { listComunicazioni } from "../comunicazioni";
import type { ContextFact, EntityContextKey, EvidenceRef } from "./types";

type DateLike = Date | string | null | undefined;

export type CollectorCliente = {
  id: number;
  sedeId: number;
  nome?: string | null;
  cognome?: string | null;
  email?: string | null;
  telefono?: string | null;
  codiceFiscale?: string | null;
  partitaIva?: string | null;
  assegnatoA?: number | null;
  updatedAt?: DateLike;
};

export type CollectorCommessa = {
  id: number;
  sedeId: number;
  clienteId?: number | null;
  codice?: string | null;
  cliente?: string | null;
  stato?: string | null;
  priorita?: string | null;
  assegnatoA?: number | null;
  prodotti?: Array<{ id?: number; nome?: string; quantita?: number }>;
  importoTotale?: number | null;
  importoIncassato?: number | null;
  costoPosaStimato?: number | null;
  costi?: Array<{ id?: number; importo?: number; categoria?: string }>;
  pagamenti?: Array<{ id?: number; importo?: number; data?: string | null }>;
  updatedAt?: DateLike;
};

export type CollectorComunicazione = {
  id: number;
  sedeId: number;
  clienteId?: number | null;
  commessaId?: number | null;
  canale: string;
  direzione: string;
  oggetto?: string | null;
  categoria?: string | null;
  receivedAt: DateLike;
  testo?: string;
  allegati?: Array<{ nome?: string; storageKey?: string | null }>;
};

export type CollectorFattura = {
  id: number;
  sedeId: number;
  clienteId?: number | null;
  commessaId?: number | null;
  numero: string;
  data: string;
  importoLordo: number;
  rate?: Array<{ importo: number; stato: string; scadenza?: string | null }>;
  aggiornataAt?: DateLike;
};

export type CollectorTicket = {
  id: number;
  sedeId: number;
  clienteId?: number | null;
  commessaId?: number | null;
  stato: string;
  priorita?: string | null;
  oggetto?: string | null;
  updatedAt?: DateLike;
};

export type CollectorIntervento = {
  id: number;
  sedeId: number;
  commessaId?: number | null;
  tipo: string;
  stato: string;
  dataPianificata?: string | null;
  oraInizio?: string | null;
  updatedAt?: DateLike;
};

export type CollectorDocumento = {
  id: number;
  sedeId?: number;
  commessaId: number;
  tipo: string;
  nome: string;
  updatedAt?: DateLike;
  createdAt?: DateLike;
  dataBase64?: string;
  storageKey?: string | null;
};

export type CollectorActionCase = {
  id: number;
  sedeId: number;
  entityType?: string;
  entityId?: number;
  commessaId?: number | null;
  clienteId?: number | null;
  title: string;
  status: string;
  priority?: string | number;
  priorityScore?: number;
  updatedAt?: DateLike;
};

export type ContextCollectorSource = {
  getCliente(id: number): Promise<CollectorCliente | null>;
  getCommessa(id: number): Promise<CollectorCommessa | null>;
  listCommesseByCliente?(
    clienteId: number,
    sedeId: number
  ): Promise<CollectorCommessa[]>;
  listComunicazioni(input: {
    sedeId: number;
    clienteId?: number;
    commessaId?: number;
    limit: number;
  }): Promise<CollectorComunicazione[]>;
  listFatture(input: {
    sedeId: number;
    clienteId?: number;
    commessaId?: number;
  }): Promise<CollectorFattura[]>;
  listTickets(input: {
    sedeId: number;
    clienteId?: number;
    commessaId?: number;
  }): Promise<CollectorTicket[]>;
  listInterventi(input: {
    sedeId: number;
    commessaId?: number;
  }): Promise<CollectorIntervento[]>;
  listDocumenti(input: {
    sedeId: number;
    commessaId?: number;
  }): Promise<CollectorDocumento[]>;
  listActionCases(input: {
    sedeId: number;
    clienteId?: number;
    commessaId?: number;
  }): Promise<CollectorActionCase[]>;
};

function iso(value: DateLike): string {
  if (!value) return "unknown";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function latest(values: DateLike[]): string {
  const normalized = values
    .map(iso)
    .filter(value => value !== "unknown")
    .sort();
  return normalized.at(-1) ?? "none";
}

function evidence(
  sourceType: string,
  sourceId: number | string,
  label: string,
  version: DateLike,
  link?: string
): EvidenceRef {
  return {
    sourceType,
    sourceId: String(sourceId),
    label,
    version: iso(version),
    ...(link ? { link } : {}),
  };
}

function fact(key: string, value: unknown, refs: EvidenceRef[]): ContextFact {
  return { key, value, confidence: "certain", evidence: refs };
}

function defaultSource(): ContextCollectorSource {
  return {
    async getCliente(id) {
      return (
        (getClientiStore().find(item => item.id === id) as
          | CollectorCliente
          | undefined) ?? null
      );
    },
    async getCommessa(id) {
      return (
        (getCommesseStore().find(item => item.id === id) as
          | CollectorCommessa
          | undefined) ?? null
      );
    },
    async listCommesseByCliente(clienteId, sedeId) {
      return getCommesseStore().filter(
        item => item.sedeId === sedeId && item.clienteId === clienteId
      ) as CollectorCommessa[];
    },
    async listComunicazioni(input) {
      return (await listComunicazioni({
        ...input,
        includiEscluse: false,
      })) as CollectorComunicazione[];
    },
    async listFatture(input) {
      return ficFatture.filter(
        item =>
          item.sedeId === input.sedeId &&
          (input.commessaId == null || item.commessaId === input.commessaId) &&
          (input.clienteId == null || item.clienteId === input.clienteId)
      );
    },
    async listTickets(input) {
      return getTicketStore().filter(
        item =>
          item.sedeId === input.sedeId &&
          (input.commessaId == null || item.commessaId === input.commessaId) &&
          (input.clienteId == null || item.clienteId === input.clienteId)
      ) as CollectorTicket[];
    },
    async listInterventi(input) {
      return getInterventiStore().filter(
        item =>
          item.sedeId === input.sedeId &&
          (input.commessaId == null || item.commessaId === input.commessaId)
      ) as CollectorIntervento[];
    },
    async listDocumenti(input) {
      const documents =
        getAllStoreSnapshots().find(
          snapshot => snapshot.key === "preventivi_documenti"
        )?.items ?? [];
      return documents.filter(
        item => input.commessaId == null || item.commessaId === input.commessaId
      ) as CollectorDocumento[];
    },
    async listActionCases(input) {
      const result = await getActionCaseRepository().list({
        sedeId: input.sedeId,
        limit: 100,
      });
      return result.items
        .filter(
          item =>
            input.commessaId == null || item.commessaId === input.commessaId
        )
        .filter(
          item => input.clienteId == null || item.clienteId === input.clienteId
        )
        .map(item => ({
          id: item.id,
          sedeId: item.sedeId,
          commessaId: item.commessaId,
          clienteId: item.clienteId,
          entityType: item.targetType,
          entityId: item.targetId,
          title: item.title,
          status: item.status,
          priority: item.priority,
          priorityScore: item.priorityScore,
          updatedAt: item.updatedAt,
        }));
    },
  };
}

export async function collectEntityFacts(
  key: EntityContextKey,
  options: { source?: ContextCollectorSource } = {}
): Promise<{
  facts: ContextFact[];
  sourceVersions: Record<string, string>;
} | null> {
  const source = options.source ?? defaultSource();
  const commessa =
    key.entityType === "commessa"
      ? await source.getCommessa(key.entityId)
      : null;
  const clienteId =
    key.entityType === "cliente"
      ? key.entityId
      : (commessa?.clienteId ?? undefined);
  const cliente = clienteId == null ? null : await source.getCliente(clienteId);
  if (
    key.entityType === "commessa" &&
    (!commessa || commessa.sedeId !== key.sedeId)
  )
    return null;
  if (
    key.entityType === "cliente" &&
    (!cliente || cliente.sedeId !== key.sedeId)
  )
    return null;

  const relatedJobs =
    key.entityType === "cliente"
      ? ((await source.listCommesseByCliente?.(key.entityId, key.sedeId)) ?? [])
      : commessa
        ? [commessa]
        : [];
  const commessaId = commessa?.id;
  const query = {
    sedeId: key.sedeId,
    ...(clienteId == null ? {} : { clienteId }),
    ...(commessaId == null ? {} : { commessaId }),
  };
  const relatedJobIds = relatedJobs.map(item => item.id);
  const interventionsPromise =
    commessaId != null
      ? source.listInterventi({ sedeId: key.sedeId, commessaId })
      : Promise.all(
          relatedJobIds.map(id =>
            source.listInterventi({ sedeId: key.sedeId, commessaId: id })
          )
        ).then(groups => groups.flat());
  const documentsPromise =
    commessaId != null
      ? source.listDocumenti({ sedeId: key.sedeId, commessaId })
      : Promise.all(
          relatedJobIds.map(id =>
            source.listDocumenti({ sedeId: key.sedeId, commessaId: id })
          )
        ).then(groups => groups.flat());
  const [
    communications,
    invoices,
    tickets,
    interventions,
    documents,
    actionCases,
  ] = await Promise.all([
    source.listComunicazioni({ ...query, limit: 40 }),
    source.listFatture(query),
    source.listTickets(query),
    interventionsPromise,
    documentsPromise,
    source.listActionCases(query),
  ]);
  const facts: ContextFact[] = [];

  if (cliente) {
    facts.push(
      fact(
        "cliente.identita",
        {
          id: cliente.id,
          nome: cliente.nome ?? null,
          cognome: cliente.cognome ?? null,
          email: cliente.email ?? null,
          telefono: cliente.telefono ?? null,
          codiceFiscale: cliente.codiceFiscale ?? null,
          partitaIva: cliente.partitaIva ?? null,
          assegnatoA: cliente.assegnatoA ?? null,
        },
        [
          evidence(
            "cliente",
            cliente.id,
            "Anagrafica cliente",
            cliente.updatedAt,
            `/clienti/${cliente.id}`
          ),
        ]
      )
    );
  }
  if (commessa) {
    const commessaEvidence = evidence(
      "commessa",
      commessa.id,
      "Scheda commessa",
      commessa.updatedAt,
      `/commesse/${commessa.id}`
    );
    facts.push(
      fact(
        "commessa.identita",
        {
          id: commessa.id,
          codice: commessa.codice ?? null,
          clienteId: commessa.clienteId ?? null,
          cliente: commessa.cliente ?? null,
        },
        [commessaEvidence]
      ),
      fact(
        "commessa.stato",
        {
          stato: commessa.stato ?? null,
          priorita: commessa.priorita ?? null,
          assegnatoA: commessa.assegnatoA ?? null,
        },
        [commessaEvidence]
      )
    );
    if ((commessa.prodotti?.length ?? 0) > 0) {
      facts.push(
        fact(
          "commessa.prodotti",
          commessa.prodotti!.map(item => ({
            id: item.id ?? null,
            nome: item.nome ?? null,
            quantita: item.quantita ?? null,
          })),
          [commessaEvidence]
        )
      );
    }
  } else if (relatedJobs.length > 0) {
    facts.push(
      fact(
        "cliente.commesse",
        relatedJobs.map(item => ({
          id: item.id,
          codice: item.codice ?? null,
          stato: item.stato ?? null,
          assegnatoA: item.assegnatoA ?? null,
        })),
        relatedJobs.map(item =>
          evidence(
            "commessa",
            item.id,
            item.codice ?? `Commessa ${item.id}`,
            item.updatedAt,
            `/commesse/${item.id}`
          )
        )
      )
    );
  }

  if (communications.length > 0) {
    facts.push(
      fact(
        "comunicazioni.riferimenti",
        communications.map(item => ({
          id: item.id,
          canale: item.canale,
          direzione: item.direzione,
          oggetto: item.oggetto ?? null,
          categoria: item.categoria ?? null,
          receivedAt: iso(item.receivedAt),
          hasAttachments: (item.allegati?.length ?? 0) > 0,
        })),
        communications.map(item =>
          evidence(
            "comunicazione",
            item.id,
            `${item.canale}: ${item.oggetto || "messaggio"}`,
            item.receivedAt
          )
        )
      )
    );
  }
  if (documents.length > 0) {
    facts.push(
      fact(
        "documenti.riferimenti",
        documents.map(item => ({
          id: item.id,
          tipo: item.tipo,
          nome: item.nome,
        })),
        documents.map(item =>
          evidence(
            "documento",
            item.id,
            item.nome,
            item.updatedAt ?? item.createdAt,
            commessaId ? `/commesse/${commessaId}` : undefined
          )
        )
      )
    );
  }
  if (tickets.length > 0) {
    facts.push(
      fact(
        "ticket.aperti",
        tickets.map(item => ({
          id: item.id,
          stato: item.stato,
          priorita: item.priorita ?? null,
          oggetto: item.oggetto ?? null,
        })),
        tickets.map(item =>
          evidence(
            "ticket",
            item.id,
            item.oggetto ?? `Ticket ${item.id}`,
            item.updatedAt,
            `/ticket/${item.id}`
          )
        )
      )
    );
  }
  if (interventions.length > 0) {
    facts.push(
      fact(
        "interventi.pianificati",
        interventions.map(item => ({
          id: item.id,
          tipo: item.tipo,
          stato: item.stato,
          data: item.dataPianificata ?? null,
          ora: item.oraInizio ?? null,
        })),
        interventions.map(item =>
          evidence(
            "intervento",
            item.id,
            `${item.tipo} ${item.dataPianificata ?? ""}`.trim(),
            item.updatedAt
          )
        )
      )
    );
  }
  if (actionCases.length > 0) {
    facts.push(
      fact(
        "centro_azioni.casi",
        actionCases.map(item => ({
          id: item.id,
          titolo: item.title,
          stato: item.status,
          priorita: item.priorityScore ?? item.priority ?? null,
        })),
        actionCases.map(item =>
          evidence(
            "caso_azione",
            item.id,
            item.title,
            item.updatedAt,
            "/notifiche"
          )
        )
      )
    );
  }

  if (key.scope !== "operativo") {
    if (invoices.length > 0) {
      facts.push(
        fact(
          "fatture.riepilogo",
          invoices.map(item => ({
            id: item.id,
            numero: item.numero,
            data: item.data,
            importoLordo: item.importoLordo,
            rate: (item.rate ?? []).map(rate => ({
              importo: rate.importo,
              stato: rate.stato,
              scadenza: rate.scadenza ?? null,
            })),
          })),
          invoices.map(item =>
            evidence(
              "fattura_fic",
              item.id,
              `Fattura ${item.numero}`,
              item.aggiornataAt
            )
          )
        )
      );
    }
    if ((commessa?.pagamenti?.length ?? 0) > 0) {
      facts.push(
        fact(
          "pagamenti.riepilogo",
          commessa!.pagamenti!.map(item => ({
            id: item.id ?? null,
            importo: item.importo ?? 0,
            data: item.data ?? null,
          })),
          [
            evidence(
              "commessa",
              commessa!.id,
              "Registro pagamenti",
              commessa!.updatedAt,
              `/commesse/${commessa!.id}`
            ),
          ]
        )
      );
    }
  }
  if (key.scope === "direzione" && commessa) {
    const totalCosts = (commessa.costi ?? []).reduce(
      (sum, item) => sum + (item.importo ?? 0),
      0
    );
    facts.push(
      fact(
        "economia.direzione",
        {
          importoTotale: commessa.importoTotale ?? null,
          importoIncassato: commessa.importoIncassato ?? 0,
          costoPosaStimato: commessa.costoPosaStimato ?? null,
          totaleCostiRegistrati: totalCosts,
        },
        [
          evidence(
            "commessa",
            commessa.id,
            "Dati economici commessa",
            commessa.updatedAt,
            `/commesse/${commessa.id}`
          ),
        ]
      )
    );
  }

  return {
    facts,
    sourceVersions: {
      ...(cliente ? { cliente: iso(cliente.updatedAt) } : {}),
      ...(commessa ? { commessa: iso(commessa.updatedAt) } : {}),
      ...(relatedJobs.length > 0
        ? { commesse: latest(relatedJobs.map(item => item.updatedAt)) }
        : {}),
      comunicazioni: latest(communications.map(item => item.receivedAt)),
      fatture: latest(invoices.map(item => item.aggiornataAt)),
      ticket: latest(tickets.map(item => item.updatedAt)),
      interventi: latest(
        interventions.map(item => item.updatedAt ?? item.dataPianificata)
      ),
      documenti: latest(
        documents.map(item => item.updatedAt ?? item.createdAt)
      ),
      centroAzioni: latest(actionCases.map(item => item.updatedAt)),
    },
  };
}
