// Strumento Panorama Azienda (T7): aggregazioni deterministiche dei
// pattern, solo direzione, solo sede corrente, zero token. L'esito è un
// DATO con periodo, campione, baseline e correlazione dichiarata.

import { z } from "zod";
import { tarsAttivo } from "../../platform/interruttori";
import { calcolaPatternAzienda } from "../proattivita/patterns";
import type { EsitoLettura, StrumentoTars } from "./tipi";

const FONTE =
  "Osservazioni Tars e registro transizioni commesse (aggregazione deterministica)";

const panoramaAzienda: StrumentoTars = {
  nome: "panorama_azienda",
  versione: "1.0.0",
  categoria: "proattivita",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  soloDirezione: true,
  interruttore: "tarsProactive",
  descrizione:
    "Aggrega i pattern aziendali della sede su una finestra dichiarata: ritardi fornitore, colli di bottiglia, ricorrenze post-vendita, permanenza per fase e bypass del gate. Ogni pattern riporta periodo, campione, baseline e confidenza, ed è una correlazione, mai una causa dimostrata.",
  schemaInput: z
    .object({
      finestraGiorni: z.number().int().min(7).max(90).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoLettura<unknown>> {
    if (
      !tarsAttivo("tarsProactive") ||
      !contesto.direzione ||
      !contesto.capability.has("commessa.read")
    ) {
      throw new Error("NOT_FOUND: panorama non disponibile.");
    }
    const esito = await calcolaPatternAzienda({
      sedeId: contesto.sedeId,
      now: new Date(),
      finestraGiorni: input.finestraGiorni,
    });
    return {
      dati: esito,
      evidenze: esito.pattern.flatMap(pattern =>
        pattern.evidenze.slice(0, 3).map(evidenza => ({
          tipo: "entita" as const,
          riferimento: evidenza.riferimento,
          descrizione: `${pattern.chiave}: ${evidenza.descrizione}`,
        }))
      ),
      freschezza: new Date().toISOString(),
      fonteAutorevole: FONTE,
      omissioni: [
        "Nessun importo entra nei pattern (floor non economico dell'osservatore).",
        ...esito.soppressi.map(
          voce => `Pattern «${voce.chiave}» soppresso: ${voce.motivo}.`
        ),
      ],
      versioniEntita: {},
    };
  },
};

export const STRUMENTI_PROATTIVITA: readonly StrumentoTars[] = [
  panoramaAzienda,
];
