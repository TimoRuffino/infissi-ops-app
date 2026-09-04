// T3 — la proposta si esegue con un click: stesse tappe del blocco
// per-tool dell'orchestratore (catalogo per contesto, schema di input,
// ledger R1 prenota→esegui→concludi), con runId deterministico della
// proposta così il doppio click riusa l'esito invece di raddoppiare.

import { catalogoAzioniPerContesto } from "../azioni/policy";
import {
  concludiEsecuzioneR1,
  concludiEsecuzioneR1SenzaEffetto,
  prenotaEsecuzioneR1,
  segnaEsecuzioneR1Incerta,
} from "../azioni/executions";
import { descrittoreAzione } from "../azioni/registry";
import type { ContestoRun, EsitoAzione } from "../strumenti/tipi";
import { STRUMENTI_PROPOSTE_ESEGUIBILI } from "./analisi";
import { repositoryAnalisiCorrente } from "./repository";
import type {
  EsecuzionePropostaAnalisi,
  EsitoAnalisiAzienda,
  RecordAnalisiAzienda,
} from "./types";

/** La proposta non porta un'azione eseguibile: si porta in chat. */
export class PropostaNonEseguibile extends Error {}

/**
 * Scarta una proposta dell'analisi: nessun effetto sul dominio, solo la
 * decisione registrata dentro l'esito («scartata», da chi). Una proposta
 * scartata non si esegue più (il ramo `esecuzione` presente la blocca).
 */
export async function scartaPropostaAnalisi(input: {
  record: RecordAnalisiAzienda;
  indice: number;
  utenteId: number;
}): Promise<{ esecuzione: EsecuzionePropostaAnalisi; esito: EsitoAnalisiAzienda }> {
  const esitoAnalisi = input.record.esito;
  if (!esitoAnalisi) throw new PropostaNonEseguibile("L'analisi non ha un esito.");
  const proposta = esitoAnalisi.proposte[input.indice];
  if (!proposta) throw new PropostaNonEseguibile("Proposta non trovata nell'analisi.");
  if (proposta.esecuzione) {
    return { esecuzione: proposta.esecuzione, esito: esitoAnalisi };
  }
  const esecuzione: EsecuzionePropostaAnalisi = {
    stato: "scartata",
    motivo: "Scartata dall'utente: nessun effetto.",
    azioneId: null,
    entitaToccate: [],
    quando: new Date().toISOString(),
    daUtente: input.utenteId,
  };
  const aggiornato: EsitoAnalisiAzienda = {
    ...esitoAnalisi,
    proposte: esitoAnalisi.proposte.map((p, i) =>
      i === input.indice ? { ...p, esecuzione } : p
    ),
  };
  await repositoryAnalisiCorrente().aggiornaEsito(input.record.id, aggiornato);
  return { esecuzione, esito: aggiornato };
}

export async function eseguiPropostaAnalisi(input: {
  contesto: ContestoRun;
  record: RecordAnalisiAzienda;
  indice: number;
}): Promise<{ esecuzione: EsecuzionePropostaAnalisi; esito: EsitoAnalisiAzienda }> {
  const esitoAnalisi = input.record.esito;
  if (!esitoAnalisi) throw new PropostaNonEseguibile("L'analisi non ha un esito.");
  const proposta = esitoAnalisi.proposte[input.indice];
  if (!proposta) throw new PropostaNonEseguibile("Proposta non trovata nell'analisi.");
  if (proposta.esecuzione) {
    return { esecuzione: proposta.esecuzione, esito: esitoAnalisi };
  }
  if (!proposta.azione) {
    throw new PropostaNonEseguibile(
      "La proposta non ha un'azione eseguibile: portala in chat con «Chiedi a Tars»."
    );
  }
  const nome = proposta.azione.strumento;
  if (!STRUMENTI_PROPOSTE_ESEGUIBILI.includes(nome)) {
    throw new PropostaNonEseguibile(`Lo strumento «${nome}» non è proponibile.`);
  }
  const descrittore = descrittoreAzione(nome);
  if (!descrittore) {
    throw new PropostaNonEseguibile(`Lo strumento «${nome}» non è nel registro.`);
  }
  // Fail-closed sul catalogo di CHI clicca: capability, sede, flag,
  // direzione — la proposta non porta autorità, la porta l'utente.
  const nelCatalogo = catalogoAzioniPerContesto(input.contesto).some(a => a.nome === nome);
  if (!nelCatalogo) {
    throw new Error(
      "FORBIDDEN: lo strumento non è nel tuo catalogo (capability, sede o interruttori)."
    );
  }
  let grezzi: unknown;
  try {
    grezzi = JSON.parse(proposta.azione.input);
  } catch {
    throw new PropostaNonEseguibile("L'input dell'azione non è JSON valido.");
  }
  if ((grezzi as any)?.scavalcaGate) {
    throw new PropostaNonEseguibile("Lo scavalco del gate non si esegue da una proposta.");
  }
  if ((grezzi as any)?.confermaSenzaRiscontro) {
    throw new PropostaNonEseguibile(
      "Una conferma che non cita la commessa si archivia solo su conferma esplicita in chat."
    );
  }
  const argomenti = descrittore.strumento.schemaInput.parse(grezzi);

  const runId = `analisi:${input.record.id}:proposta:${input.indice}`;
  const prenotazione = await prenotaEsecuzioneR1({
    descrittore,
    contesto: input.contesto,
    runId,
    argomenti,
  });
  if (prenotazione.tipo === "incerta") {
    throw new Error(
      "ESECUZIONE_INCERTA: esiste già una reservation senza esito certo; verifica il Registro prima di riprovare."
    );
  }
  let esito: EsitoAzione;
  if (prenotazione.tipo === "riusa") {
    esito = prenotazione.esito;
  } else {
    try {
      esito = (await descrittore.strumento.esegui(input.contesto, argomenti)) as EsitoAzione;
      descrittore.schemaRisultato.parse(esito);
    } catch (errore) {
      if (prenotazione.tipo === "esegui") {
        try {
          await segnaEsecuzioneR1Incerta({
            idempotencyKey: prenotazione.idempotencyKey,
            motivo: "errore durante l'esecuzione o la validazione dell'esito",
          });
        } catch (erroreLedger) {
          console.error("[tars] reservation R1 non marcabile come incerta:", erroreLedger);
        }
      }
      throw errore;
    }
    if (prenotazione.tipo === "esegui" && esito?.tipo === "azione") {
      try {
        if (esito.stato === "non_eseguito") {
          await concludiEsecuzioneR1SenzaEffetto({
            idempotencyKey: prenotazione.idempotencyKey,
            esito,
          });
        } else {
          await concludiEsecuzioneR1({
            idempotencyKey: prenotazione.idempotencyKey,
            esito,
          });
        }
      } catch (errore) {
        try {
          await segnaEsecuzioneR1Incerta({
            idempotencyKey: prenotazione.idempotencyKey,
            motivo: "esito prodotto ma settle non confermato",
          });
        } catch (erroreLedger) {
          console.error("[tars] settle R1 fallito; reservation resta bloccante:", erroreLedger);
        }
        throw new Error(
          "ESECUZIONE_INCERTA: l'effetto può essere avvenuto ma il ledger non ha confermato; verifica il Registro."
        );
      }
    }
  }

  const esecuzione: EsecuzionePropostaAnalisi = {
    stato: esito.stato,
    motivo: esito.motivo ?? null,
    azioneId: esito.azioneId ?? null,
    entitaToccate: esito.entitaToccate ?? [],
    quando: new Date().toISOString(),
    daUtente: input.contesto.utenteId,
  };
  const aggiornato: EsitoAnalisiAzienda = {
    ...esitoAnalisi,
    proposte: esitoAnalisi.proposte.map((p, i) =>
      i === input.indice ? { ...p, esecuzione } : p
    ),
  };
  await repositoryAnalisiCorrente().aggiornaEsito(input.record.id, aggiornato);
  return { esecuzione, esito: aggiornato };
}
