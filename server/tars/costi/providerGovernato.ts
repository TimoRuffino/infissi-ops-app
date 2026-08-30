// Il CONFINE unico verso i provider a pagamento — spec §27, decisione 41.
//
// È l'unico modulo autorizzato a importare `creaProviderRealeGrezzo`.
// Chi vuole un provider chiede `creaProviderPerRun(contesto)`: riceve il
// fake (nessun costo) oppure il provider reale GIÀ avvolto dal budget
// governor. Non esiste una via che restituisca il reale non governato.
//
// Il provider reale nasce solo se TUTTE queste condizioni sono vere
// (una mancante ⇒ fake + motivo dichiarato, mai una chiamata):
//   1. TARS_PROVIDER=openai esplicito
//   2. FLAG_TARS acceso (verificato anche dentro l'adapter)
//   3. OPENAI_API_KEY presente
//   4. modello con TARIFFA ATTIVA nel catalogo
//   5. budget configurato in modo valido e coerente
//   6. ledger AUTOREVOLE disponibile (PostgreSQL)

import { tarsAttivo } from "../../platform/interruttori";
import { creaProviderRealeGrezzo } from "../openai/adapter";
import { creaProviderFinto, type PassoCopione } from "../openai/fake";
import type { TarsProvider } from "../provider";
import { avvolgiConGovernor, configurazioneBudget } from "./governor";
import { ledgerAutorevoleDisponibile } from "./ledger";
import { tariffaDi } from "./tariffe";

export type StatoProvider = {
  tipo: "openai" | "finto";
  modello: string;
  /** Perché il reale non è disponibile (null quando lo è). */
  motivoIndisponibilita: string | null;
  budget: {
    perRunUsd: number;
    giornalieroUsd: number;
    mensileUsd: number;
  } | null;
};

/**
 * Diagnostica onesta: dice se il reale è utilizzabile e, se no, perché.
 * Non tocca la chiave (ne verifica solo la presenza) e non chiama nulla.
 */
export function statoProvider(modello: string): StatoProvider {
  const richiestoOpenai =
    process.env.TARS_PROVIDER?.trim().toLowerCase() === "openai";
  const config = configurazioneBudget();
  const budget = config.ok
    ? {
        perRunUsd: config.configurazione.perRunUsd,
        giornalieroUsd: config.configurazione.giornalieroUsd,
        mensileUsd: config.configurazione.mensileUsd,
      }
    : null;

  const motivo = ((): string | null => {
    if (!richiestoOpenai) return "TARS_PROVIDER non è impostato su «openai».";
    if (!tarsAttivo()) return "FLAG_TARS è spento.";
    if (!process.env.OPENAI_API_KEY) return "OPENAI_API_KEY assente.";
    if (!tariffaDi(modello)) {
      return `Il modello «${modello}» non ha una tariffa attiva nel catalogo.`;
    }
    if (!config.ok) return `Budget non configurato correttamente: ${config.motivo}`;
    if (!ledgerAutorevoleDisponibile()) {
      return "Ledger dei costi non autorevole (serve PostgreSQL): il provider reale resta disabilitato.";
    }
    return null;
  })();

  return {
    tipo: motivo == null ? "openai" : "finto",
    modello,
    motivoIndisponibilita: motivo,
    budget,
  };
}

/**
 * L'UNICA fabbrica di provider per un run. Il reale è sempre governato.
 */
export function creaProviderPerRun(input: {
  modello: string;
  sedeId: number;
  utenteId: number;
  copioneFinto: PassoCopione;
}): TarsProvider {
  const stato = statoProvider(input.modello);
  if (stato.tipo === "finto") return creaProviderFinto(input.copioneFinto);

  const config = configurazioneBudget();
  if (!config.ok) {
    // Difesa in profondità: statoProvider l'ha già escluso.
    return creaProviderFinto(input.copioneFinto);
  }
  return avvolgiConGovernor(
    creaProviderRealeGrezzo(),
    { sedeId: input.sedeId, utenteId: input.utenteId },
    { configurazione: config.configurazione }
  );
}
