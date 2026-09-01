// SafeProductCatalog (T8): la descrizione del PRODOTTO che Tars può usare
// per ragionare sui processi — soltanto metadati già autorizzati e
// versionati. Niente sorgenti, niente variabili d'ambiente, niente
// percorsi assoluti, niente segreti, niente strumenti R4: il catalogo è
// una mappa, non una porta.

import { CAPABILITIES } from "../../authz/capabilities";
import { STATI_COMMESSA } from "../../commesse/transizioni";
import {
  AZIONI_DICHIARATE_INDISPONIBILI,
  REGISTRO_AZIONI,
  VERSIONE_REGISTRO_AZIONI,
} from "../azioni/registry";
import { VERSIONE_DETECTOR } from "../proattivita/types";
import { VERSIONE_PATTERN } from "../proattivita/patterns";

export const VERSIONE_CATALOGO_PRODOTTO = "1.0.0";

export type CatalogoProdottoSicuro = {
  versione: string;
  generato: "metadati statici autorizzati";
  domini: readonly { nome: string; descrizione: string }[];
  routeLogiche: readonly string[];
  stateMachine: { commessa: readonly string[] };
  azioniTars: readonly {
    nome: string;
    rischio: string;
    scope: string;
    capability: readonly string[];
    soloDirezione: boolean;
  }[];
  azioniIndisponibili: readonly { nome: string; motivo: string }[];
  capability: readonly string[];
  segnaliCentroAzioni: readonly string[];
  integrazioni: readonly { nome: string; natura: string }[];
  versioni: Record<string, string>;
};

const DOMINI = [
  { nome: "clienti", descrizione: "Anagrafica clienti e assegnazioni" },
  { nome: "commesse", descrizione: "Commesse con state machine e gate documentali" },
  { nome: "documenti", descrizione: "Fascicolo documentale per commessa" },
  { nome: "ordini_fornitore", descrizione: "Ordini fornitore e conferme" },
  { nome: "comunicazioni", descrizione: "Email e WhatsApp collegate" },
  { nome: "promemoria", descrizione: "Promemoria personali con scheduler" },
  { nome: "centro_azioni", descrizione: "Casi operativi riconciliati dai segnali" },
  { nome: "post_vendita", descrizione: "Ticket, garanzie e interventi" },
  { nome: "magazzino", descrizione: "Consegne e giacenze operative" },
  { nome: "produzione", descrizione: "BOM, fasi e non conformità (backend)" },
  { nome: "economia", descrizione: "Pagamenti e importi (solo con capability dedicate)" },
] as const;

const ROUTE_LOGICHE = [
  "board-commesse",
  "commessa-360",
  "clienti",
  "messaggi",
  "documenti-ordini",
  "centro-azioni",
  "post-vendita",
  "magazzino",
  "pianificazione",
  "tars",
  "impostazioni",
] as const;

const SEGNALI_CENTRO_AZIONI = [
  "priority_aging",
  "stato_daily",
  "stato_role",
  "consegna",
  "consegna_fornitore",
  "saldo",
  "garanzia",
  "ticket",
  "intervento",
  "process_experiment",
] as const;

const INTEGRAZIONI = [
  { nome: "fatture_in_cloud", natura: "OAuth authorization code, verità fiscale esterna" },
  { nome: "google_drive_backup", natura: "OAuth utente, backup notturno" },
  { nome: "email_imap", natura: "caselle in sola lettura" },
  { nome: "whatsapp_cloud_api", natura: "ricezione webhook e media" },
] as const;

export function catalogoProdottoSicuro(): CatalogoProdottoSicuro {
  return {
    versione: VERSIONE_CATALOGO_PRODOTTO,
    generato: "metadati statici autorizzati",
    domini: DOMINI,
    routeLogiche: ROUTE_LOGICHE,
    stateMachine: { commessa: STATI_COMMESSA },
    azioniTars: REGISTRO_AZIONI.map(azione => ({
      nome: azione.nome,
      rischio: azione.rischio,
      scope: azione.scope,
      capability: azione.capability.map(String),
      soloDirezione: azione.prerequisiti.direzione,
    })),
    azioniIndisponibili: AZIONI_DICHIARATE_INDISPONIBILI,
    capability: CAPABILITIES,
    segnaliCentroAzioni: SEGNALI_CENTRO_AZIONI,
    integrazioni: INTEGRAZIONI,
    versioni: {
      registroAzioni: VERSIONE_REGISTRO_AZIONI,
      detectorOsservatore: VERSIONE_DETECTOR,
      patternAzienda: VERSIONE_PATTERN,
      catalogoProdotto: VERSIONE_CATALOGO_PRODOTTO,
    },
  };
}
