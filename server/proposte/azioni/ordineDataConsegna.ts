// Azione registrata nel gateway (D7 slice 3): aggiorna la data di
// consegna prevista di un ordine fornitore. È la PRIMA e unica azione
// applicabile della Document Intelligence: niente prezzi, quantità, righe,
// stati o configurazioni. L'esecuzione passa dal comando dedicato di
// fornitori.ts e non sposta posa, appuntamenti o stati della commessa: il
// conflitto con la posa diventa un caso del Centro Azioni, non un
// automatismo.

import {
  aggiornaDataConsegnaOrdine,
  getOrdineFornitoreById,
} from "../../routers/fornitori";
import { registraAzioneProposta, type PropostaAzione } from "../gateway";

function dataLeggibile(iso: string | null): string {
  if (!iso) return "nessuna data";
  const [anno, mese, giorno] = iso.split("-");
  return giorno && mese && anno ? `${giorno}/${mese}/${anno}` : iso;
}

function leggiOrdine(proposta: PropostaAzione) {
  const trovato = getOrdineFornitoreById(proposta.ordineId);
  if (
    !trovato ||
    ((trovato.ordine as any).sedeId ?? 1) !== proposta.sedeId
  ) {
    throw new Error("Ordine non trovato.");
  }
  return trovato.ordine;
}

registraAzioneProposta({
  tipo: "ordine_fornitore.aggiorna_data_consegna",
  etichetta: "Aggiorna la data di consegna prevista",
  capabilityFinale: "fornitore.manage_ordini",
  leggiValoreCorrente(proposta) {
    return leggiOrdine(proposta).dataConsegnaPrevista ?? null;
  },
  descriviEffetto(proposta) {
    const ordine = leggiOrdine(proposta);
    return `Data di consegna prevista dell'ordine ${ordine.codiceOrdine}: ${dataLeggibile(proposta.valoreCorrente)} → ${dataLeggibile(proposta.valoreProposto)}. Nessun altro campo viene modificato.`;
  },
  applica(proposta) {
    aggiornaDataConsegnaOrdine(
      proposta.ordineId,
      proposta.sedeId,
      proposta.valoreProposto
    );
  },
});
