// Profili strumenti (T1): al modello arriva un catalogo PICCOLO,
// deterministico e già filtrato — uno strumento esiste per il run solo se
// il principal potrebbe essere autorizzato, il livello è ammesso e i flag
// lo consentono. Ordinamento stabile per il prompt caching C2.

import { z } from "zod";
import { interruttoreAttivo } from "../platform/interruttori";
import { STRUMENTI_CASI } from "./strumenti/casi";
import { STRUMENTI_DOCUMENTI } from "./strumenti/documenti";
import { STRUMENTI_L0 } from "./strumenti/letture";
import { STRUMENTI_PROMEMORIA } from "./strumenti/promemoria";
import { STRUMENTI_PROPOSTE } from "./strumenti/proposte";
import type { ContestoRun, StrumentoTars } from "./strumenti/tipi";
import type { DefinizioneToolProvider } from "./provider";

export const PROFILO_VERSIONE = "l3-v2";

/** Il filtro di ammissione, esportato per essere provabile da solo. */
export function filtraStrumenti(
  strumenti: readonly StrumentoTars[],
  contesto: ContestoRun
): StrumentoTars[] {
  return strumenti
    .filter(strumento => {
      if (strumento.soloDirezione && !contesto.direzione) return false;
      const interruttori = Array.isArray(strumento.interruttore)
        ? strumento.interruttore
        : strumento.interruttore
          ? [strumento.interruttore]
          : [];
      if (!interruttori.every(i => interruttoreAttivo(i))) return false;
      return strumento.capability.every(c => contesto.capability.has(c));
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

export function strumentiPerContesto(
  contesto: ContestoRun
): StrumentoTars[] {
  // Ogni famiglia esiste solo col SUO interruttore: letture e promemoria
  // sono indipendenti (il singolo strumento può poi averne altri, es. DI).
  const catalogo: StrumentoTars[] = [];
  if (interruttoreAttivo("tarsReadTools")) catalogo.push(...STRUMENTI_L0);
  if (interruttoreAttivo("tarsReminders")) {
    catalogo.push(...STRUMENTI_PROMEMORIA);
  }
  if (interruttoreAttivo("tarsL2Actions")) {
    catalogo.push(...STRUMENTI_CASI, ...STRUMENTI_DOCUMENTI);
  }
  if (interruttoreAttivo("tarsProposals")) {
    catalogo.push(...STRUMENTI_PROPOSTE);
  }
  return filtraStrumenti(catalogo, contesto);
}

/** JSON Schema strict per il provider, derivato dagli schemi zod. */
export function comeDefinizioneProvider(
  strumento: StrumentoTars
): DefinizioneToolProvider {
  return {
    nome: strumento.nome,
    descrizione: strumento.descrizione,
    parametri: schemaJson(strumento.schemaInput),
  };
}

// Conversione zod→JSON Schema minima per gli schemi piatti degli
// strumenti L0 (object strict di primitivi/enum). Se in futuro servisse
// di più, si valuta una libreria dedicata — non prima.
function schemaJson(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const forma = schema.shape as Record<string, z.ZodType>;
    const proprieta: Record<string, unknown> = {};
    const obbligatori: string[] = [];
    for (const [nome, campo] of Object.entries(forma)) {
      const { json, opzionale } = campoJson(campo);
      proprieta[nome] = json;
      if (!opzionale) obbligatori.push(nome);
    }
    return {
      type: "object",
      properties: proprieta,
      required: obbligatori,
      additionalProperties: false,
    };
  }
  return { type: "object", properties: {}, additionalProperties: false };
}

function campoJson(campo: z.ZodType): {
  json: Record<string, unknown>;
  opzionale: boolean;
} {
  let opzionale = false;
  let corrente: any = campo;
  while (
    corrente instanceof z.ZodOptional ||
    corrente instanceof z.ZodDefault
  ) {
    opzionale = true;
    corrente = corrente._def.innerType;
  }
  if (corrente instanceof z.ZodNumber) {
    return { json: { type: "number" }, opzionale };
  }
  if (corrente instanceof z.ZodString) {
    return { json: { type: "string" }, opzionale };
  }
  if (corrente instanceof z.ZodBoolean) {
    return { json: { type: "boolean" }, opzionale };
  }
  if (corrente instanceof z.ZodEnum) {
    return {
      json: { type: "string", enum: [...corrente.options] },
      opzionale,
    };
  }
  return { json: {}, opzionale };
}
