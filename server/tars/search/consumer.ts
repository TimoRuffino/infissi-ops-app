import type { BusinessEventConsumer } from "../../events/registry";
import type { BusinessEvent } from "../../events/types";
import { getFeatureFlags } from "../../platform/featureFlags";
import { indexSearchSource } from "./indexer";
import { getSearchRepository, type SearchRepository } from "./repository";
import type { SearchEntityRef, VisibilityScope } from "./types";

type SearchMode = "off" | "shadow" | "active";

export type ResolvedSearchSource = {
  scope: VisibilityScope;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  text: string;
  entityRefs: SearchEntityRef[];
  occurredAt: Date | null;
};

function compactText(parts: unknown[]): string {
  return parts
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .filter(value => typeof value === "string" || typeof value === "number")
    .map(value => String(value).trim())
    .filter(Boolean)
    .join("\n");
}

function versionOf(event: BusinessEvent, value?: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return event.source.version ?? event.occurredAt.toISOString();
}

export async function resolveSearchSources(
  event: BusinessEvent
): Promise<ResolvedSearchSource[]> {
  const id = Number(event.source.id);
  if (!Number.isInteger(id) || id <= 0) return [];

  if (["comunicazione", "email", "whatsapp"].includes(event.source.type)) {
    const { getComunicazione } = await import("../comunicazioni");
    const item = await getComunicazione(id, event.sedeId);
    if (!item || item.deletedAt) return [];
    const refs: SearchEntityRef[] = [
      ...(item.clienteId
        ? [{ type: "cliente", id: String(item.clienteId) }]
        : []),
      ...(item.commessaId
        ? [{ type: "commessa", id: String(item.commessaId) }]
        : []),
    ];
    return [
      {
        scope: "operativo",
        sourceType: item.canale,
        sourceId: String(item.id),
        sourceVersion: versionOf(event, item.receivedAt.toISOString()),
        text: compactText([
          item.oggetto,
          item.mittenteNome,
          item.mittente,
          item.testo,
          item.allegati.map(allegato => allegato.nome),
        ]),
        entityRefs: refs,
        occurredAt: item.receivedAt,
      },
    ];
  }

  if (event.source.type === "cliente") {
    const { getClientiStore } = await import("../../routers/clienti");
    const item = getClientiStore().find(
      (record: any) => record.id === id && record.sedeId === event.sedeId
    );
    if (!item || item.archivedAt) return [];
    return [
      {
        scope: "operativo",
        sourceType: "cliente",
        sourceId: String(id),
        sourceVersion: versionOf(event, item.updatedAt),
        text: compactText([
          item.ragioneSociale,
          item.nome,
          item.cognome,
          item.citta,
          item.email,
          item.telefono,
          item.note,
        ]),
        entityRefs: [{ type: "cliente", id: String(id) }],
        occurredAt: item.updatedAt
          ? new Date(item.updatedAt)
          : event.occurredAt,
      },
    ];
  }

  if (event.source.type === "commessa") {
    const { getCommesseStore } = await import("../../routers/commesse");
    const item = getCommesseStore().find(
      (record: any) => record.id === id && record.sedeId === event.sedeId
    );
    if (!item || item.archivedAt) return [];
    const refs: SearchEntityRef[] = [
      { type: "commessa", id: String(id) },
      ...(item.clienteId
        ? [{ type: "cliente", id: String(item.clienteId) }]
        : []),
    ];
    return [
      {
        scope: "operativo",
        sourceType: "commessa",
        sourceId: String(id),
        sourceVersion: versionOf(event, item.updatedAt),
        text: compactText([
          item.codice,
          item.cliente,
          item.indirizzo,
          item.citta,
          item.telefono,
          item.email,
          item.stato,
          item.note,
          (item.prodotti ?? []).flatMap((product: any) => [
            product.nome,
            product.note,
          ]),
        ]),
        entityRefs: refs,
        occurredAt: item.updatedAt
          ? new Date(item.updatedAt)
          : event.occurredAt,
      },
    ];
  }

  if (event.source.type === "conoscenza") {
    const { conoscenza } = await import("../stores");
    const item = conoscenza.find(
      record => record.id === id && record.sedeId === event.sedeId
    );
    if (!item?.attiva) return [];
    return [
      {
        scope: "operativo",
        sourceType: "conoscenza",
        sourceId: String(id),
        sourceVersion: versionOf(event, item.aggiornatoAt.toISOString()),
        text: compactText([item.titolo, item.contenuto]),
        entityRefs: [],
        occurredAt: item.aggiornatoAt,
      },
    ];
  }

  const payloadText = event.payload.searchText;
  if (typeof payloadText !== "string" || !payloadText.trim()) return [];
  return [
    {
      scope:
        event.payload.searchScope === "direzione" ||
        event.payload.searchScope === "amministrazione"
          ? event.payload.searchScope
          : "operativo",
      sourceType: event.source.type,
      sourceId: event.source.id,
      sourceVersion: versionOf(event),
      text: payloadText,
      entityRefs: event.subjectRefs.map(ref => ({ ...ref })),
      occurredAt: event.occurredAt,
    },
  ];
}

export function createSearchEventConsumer(
  options: {
    repository?: SearchRepository;
    modeForSede?: (sedeId: number) => SearchMode;
    resolveSources?: typeof resolveSearchSources;
  } = {}
): BusinessEventConsumer {
  const repository = options.repository ?? getSearchRepository();
  const modeForSede =
    options.modeForSede ??
    (sedeId => getFeatureFlags(sedeId).semanticSearchMode);
  const resolveSources = options.resolveSources ?? resolveSearchSources;
  return {
    name: "tars-search-v1",
    eventTypes: "*",
    async handle(event) {
      if (modeForSede(event.sedeId) === "off") return;
      if (/\.(?:deleted|removed|hard_deleted)$/.test(event.eventType)) {
        await repository.deleteSource({
          sedeId: event.sedeId,
          sourceType: event.source.type,
          sourceId: event.source.id,
          now: event.occurredAt,
        });
        return;
      }
      for (const source of await resolveSources(event)) {
        await indexSearchSource({
          repository,
          sedeId: event.sedeId,
          ...source,
        });
      }
    },
  };
}
