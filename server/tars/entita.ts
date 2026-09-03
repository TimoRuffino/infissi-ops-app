// Riferimenti di entità leggibili e apribili (03/09/2026).
//
// Tars produce riferimenti canonici (`commessa:12`, `ticket:7`,
// `comunicazione:90`) — utili al software, illeggibili per chi decide:
// «non posso ricordarmi i numeri dei ticket e delle commesse, devono
// esserci i nomi» (direzione). Qui un riferimento diventa nome + link,
// sede-scoped, leggendo i servizi di dominio. Un id di un'altra sede non
// prende nome e non prende link.

import { getComunicazioniByIds } from "../comunicazioni/comunicazioni";
import { getActionCaseRepository } from "../actionCenter/repository";
import { getClienteById } from "../routers/clienti";
import { getCommessaById } from "../routers/commesse";
import { getInterventiStore } from "../routers/interventi";
import { getDocumentoCommessaById } from "../routers/preventiviContratti";
import { getTicketById } from "../routers/ticket";
import { linkComunicazione } from "./smistamento/segnali";

export type EntitaRisolta = {
  riferimento: string;
  etichetta: string;
  link: string | null;
};

const ETICHETTA_TIPO: Record<string, string> = {
  osservazione: "Osservazione",
  pattern: "Andamento",
  documento: "Documento",
  promemoria: "Promemoria",
  proposta: "Proposta",
  fattura: "Fattura",
};

function commessaEtichetta(id: number, sedeId: number): string | null {
  const c: any = getCommessaById(id);
  if (!c || c.sedeId !== sedeId) return null;
  return `${c.codice ?? `Commessa ${id}`}${c.cliente ? ` — ${c.cliente}` : ""}`;
}

/**
 * Risolve in blocco: le comunicazioni si leggono con una sola domanda al
 * database, i casi con una lista sola, il resto è già in memoria.
 */
export async function risolviEntitaTars(
  riferimenti: readonly string[],
  sedeId: number
): Promise<Map<string, EntitaRisolta>> {
  const unici = [...new Set(riferimenti)];
  const idPerTipo = (tipo: string) =>
    unici
      .filter(r => r.startsWith(`${tipo}:`))
      .map(r => Number(r.split(":")[1]))
      .filter(id => Number.isInteger(id) && id > 0);

  const comunicazioni = idPerTipo("comunicazione").length
    ? await getComunicazioniByIds(idPerTipo("comunicazione"), sedeId)
    : new Map();
  const casi = idPerTipo("caso").length
    ? new Map(
        (
          await getActionCaseRepository().list({ sedeId, limit: 200 })
        ).items.map((c: any) => [c.id as number, c])
      )
    : new Map();

  const risolto = new Map<string, EntitaRisolta>();
  for (const riferimento of unici) {
    const [tipo, grezzo] = riferimento.split(":");
    const id = Number(grezzo);
    const valido = Number.isInteger(id) && id > 0;

    if (tipo === "commessa" && valido) {
      const etichetta = commessaEtichetta(id, sedeId);
      risolto.set(riferimento, {
        riferimento,
        etichetta: etichetta ?? `Commessa ${grezzo}`,
        link: etichetta ? `/commesse/${id}` : null,
      });
      continue;
    }
    if (tipo === "cliente" && valido) {
      const c: any = getClienteById(id);
      const suo = c && c.sedeId === sedeId;
      risolto.set(riferimento, {
        riferimento,
        etichetta: suo
          ? `${c.cognome ?? ""} ${c.nome ?? ""}`.trim() || `Cliente ${grezzo}`
          : `Cliente ${grezzo}`,
        link: suo ? `/clienti/${id}` : null,
      });
      continue;
    }
    if (tipo === "comunicazione" && valido) {
      const c: any = comunicazioni.get(id);
      const titolo = c
        ? (c.oggetto ?? "").trim() ||
          c.mittenteNome?.trim() ||
          c.mittente ||
          `#${id}`
        : null;
      risolto.set(riferimento, {
        riferimento,
        etichetta: c
          ? `${c.canale === "whatsapp" ? "WhatsApp" : "Email"}: ${titolo}`.slice(0, 80)
          : `Comunicazione ${grezzo}`,
        link: c ? linkComunicazione(c) : null,
      });
      continue;
    }
    if (tipo === "ticket" && valido) {
      const t: any = getTicketById(id);
      const suo = t && (t.sedeId ?? sedeId) === sedeId;
      const commessa = suo && t.commessaId ? commessaEtichetta(t.commessaId, sedeId) : null;
      risolto.set(riferimento, {
        riferimento,
        etichetta: suo
          ? `Ticket: ${(t.oggetto ?? t.categoria ?? "").trim() || `#${id}`}${commessa ? ` (${commessa})` : ""}`.slice(0, 80)
          : `Ticket ${grezzo}`,
        link: suo ? "/ticket" : null,
      });
      continue;
    }
    if (tipo === "caso" && valido) {
      const k: any = casi.get(id);
      risolto.set(riferimento, {
        riferimento,
        etichetta: k ? `Caso: ${k.title}`.slice(0, 80) : `Caso ${grezzo}`,
        link: k ? (k.link ?? (k.commessaId ? `/commesse/${k.commessaId}` : null)) : null,
      });
      continue;
    }
    if (tipo === "intervento" && valido) {
      const i: any = (getInterventiStore() as any[]).find(x => x.id === id);
      const suo = i && (i.sedeId ?? sedeId) === sedeId;
      const commessa = suo && i.commessaId ? commessaEtichetta(i.commessaId, sedeId) : null;
      risolto.set(riferimento, {
        riferimento,
        etichetta: suo
          ? `${String(i.tipo ?? "intervento").replace(/_/g, " ")} del ${i.data}${commessa ? ` — ${commessa}` : ""}`
          : `Intervento ${grezzo}`,
        link: suo ? "/planning" : null,
      });
      continue;
    }
    // Un file che Tars cita si deve poter APRIRE, sempre (direzione
    // 03/09/2026: «ogni volta che Tars fa riferimento a un file devo
    // poterlo aprire e vedere l'anteprima»). Il link è la rotta di
    // anteprima già servita dal CRM; la sede si verifica dalla commessa
    // del documento, come ovunque.
    if (tipo === "documento" && valido) {
      const documento = getDocumentoCommessaById(id, sedeId);
      const commessa = documento
        ? commessaEtichetta(documento.commessaId, sedeId)
        : null;
      risolto.set(riferimento, {
        riferimento,
        etichetta: documento
          ? `${documento.nome}${commessa ? ` — ${commessa}` : ""}`.slice(0, 90)
          : `Documento ${grezzo}`,
        link: documento ? `/api/documenti/${documento.id}/file` : null,
      });
      continue;
    }
    risolto.set(riferimento, {
      riferimento,
      etichetta: `${ETICHETTA_TIPO[tipo] ?? tipo}${grezzo ? ` ${grezzo}` : ""}`.trim(),
      link: null,
    });
  }
  return risolto;
}
