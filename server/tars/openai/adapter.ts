// Adapter OpenAI Responses API (T1) — l'UNICO punto del sistema che può
// generare una chiamata al provider. Regole non negoziabili:
//
//   1. si istanzia SOLO con FLAG_TARS acceso (fail-closed) e con la
//      chiave presente: senza, `creaProviderReale` lancia PRIMA di
//      qualunque I/O;
//   2. fetch nudo verso /v1/responses, nessuna dipendenza npm nuova
//      (stesso stile del driver S3);
//   3. `store: false` sempre: lo stato conversazionale vive nel CRM;
//   4. errori tipizzati e sanificati (mai il body del provider nei log
//      applicativi, mai la chiave da nessuna parte);
//   5. i parametri effettivi (modello, budget) arrivano dalla
//      configurazione, mai hardcoded qui.
//
// NOTA sul primo uso reale: la mappatura esatta dei campi di risposta va
// riverificata sulla documentazione OpenAI corrente al momento del gate
// chiave/budget della direzione. Fino ad allora ogni test usa il fake.
//
// COSTI: questo modulo NON conosce il budget. La chiamata a pagamento
// esiste solo avvolta dal governor (`costi/providerGovernato.ts`), che è
// l'unico importatore autorizzato di `creaProviderRealeGrezzo`.

import { tarsAttivo } from "../../platform/interruttori";
import {
  ErroreProvider,
  type RichiestaProvider,
  type RispostaProvider,
  type TarsProvider,
  type UsoToken,
} from "../provider";

const ENDPOINT = "https://api.openai.com/v1/responses";

// Unione dei valori delle famiglie in uso: GPT-5.x storiche accettano
// `minimal`, la 5.6 accetta `none…max` (verificato sul vivo 01/09/2026:
// `minimal` su gpt-5.6-sol è un 400). Un valore fuori set qui degrada a
// `medium`, mai a una chiamata rifiutata.
const EFFORT_AMMESSI = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** Reasoning effort approvato: `medium` salvo configurazione esplicita. */
function reasoningEffort(): string {
  const richiesto = process.env.TARS_REASONING_INTERACTIVE?.trim().toLowerCase();
  return richiesto && EFFORT_AMMESSI.has(richiesto) ? richiesto : "medium";
}

const TIER_AMMESSI = new Set(["auto", "default", "flex", "priority"]);

/** Sforzo di ragionamento: il profilo del governor, altrimenti l'env interattivo. */
function effortPer(richiesta: RichiestaProvider): string {
  const dalProfilo = richiesta.esecuzione?.reasoningEffort?.trim().toLowerCase();
  if (dalProfilo && EFFORT_AMMESSI.has(dalProfilo)) return dalProfilo;
  return reasoningEffort();
}

/** Tier: il profilo del governor (default = campo assente), altrimenti l'env. */
function tierPer(richiesta: RichiestaProvider): string | null {
  if (richiesta.esecuzione) {
    const t = richiesta.esecuzione.serviceTier;
    return t === "default" ? null : t;
  }
  return serviceTier();
}

/**
 * Service tier OpenAI opzionale (TARS_SERVICE_TIER): `priority` compra
 * latenza più bassa a tariffa doppia — coerente con la decisione «niente
 * budget» del gate §8. Assente o invalido = il campo non parte e vale il
 * default del progetto.
 */
function serviceTier(): string | null {
  const richiesto = process.env.TARS_SERVICE_TIER?.trim().toLowerCase();
  return richiesto && TIER_AMMESSI.has(richiesto) ? richiesto : null;
}

function usoDaRisposta(usage: any): UsoToken {
  // La doc corrente espone cached_tokens dentro input_tokens_details; la
  // lettura piatta resta come fallback difensivo (verificato 30/08/2026
  // su developers.openai.com, da ricontrollare al gate).
  return {
    input: Number(usage?.input_tokens ?? 0),
    output: Number(usage?.output_tokens ?? 0),
    cachedInput: Number(
      usage?.input_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? 0
    ),
    cacheWrite: Number(usage?.input_tokens_details?.cache_write_tokens ?? 0),
  };
}

/**
 * MAI usare direttamente: questo provider NON è governato dal budget.
 * L'unico importatore autorizzato è `costi/providerGovernato.ts`
 * (spec §27.41, guardia strutturale in costi/confine.test.ts).
 */
export function creaProviderRealeGrezzo(): TarsProvider {
  if (!tarsAttivo()) {
    throw new ErroreProvider(
      "Tars è disattivato (FLAG_TARS): il provider reale non può nascere.",
      "configurazione",
      false
    );
  }
  const chiave = process.env.OPENAI_API_KEY;
  if (!chiave) {
    throw new ErroreProvider(
      "OPENAI_API_KEY assente: il provider reale non può nascere.",
      "configurazione",
      false
    );
  }

  return {
    nome: "openai",
    async rispondi(richiesta: RichiestaProvider): Promise<RispostaProvider> {
      const corpo = {
        model: richiesta.modello,
        instructions: richiesta.istruzioni,
        input: richiesta.input.flatMap((m): Array<Record<string, unknown>> => {
          if (m.ruolo === "tool") {
            return [
              {
                type: "function_call_output",
                call_id: m.toolCallId,
                output: m.contenuto,
              },
            ];
          }
          if (m.ruolo === "assistant" && m.chiamate?.length) {
            // Il turno assistant con le function call precede i loro
            // output (contratto Responses).
            return m.chiamate.map(c => ({
              type: "function_call",
              call_id: c.id,
              name: c.nome,
              arguments: c.argomenti,
            }));
          }
          return [{ role: m.ruolo, content: m.contenuto }];
        }),
        tools: richiesta.strumenti.map(s => ({
          type: "function",
          name: s.nome,
          description: s.descrizione,
          parameters: s.parametri,
          // strict:true esigerebbe tutti i campi required: i nostri schemi
          // hanno opzionali con default. Da rivalutare al gate (schemi
          // all-required + nullable) — fino ad allora validazione zod
          // server-side, che resta comunque l'autorità.
          strict: false,
        })),
        max_output_tokens: richiesta.maxOutputToken,
        store: false,
        prompt_cache_key: richiesta.chiaveCachePrompt,
        reasoning: { effort: effortPer(richiesta) },
        ...(tierPer(richiesta) ? { service_tier: tierPer(richiesta) } : {}),
        ...(richiesta.formatoJson
          ? {
              text: {
                format: {
                  type: "json_schema",
                  name: richiesta.formatoJson.nome,
                  schema: richiesta.formatoJson.schema,
                  strict: true,
                },
              },
            }
          : {}),
      };

      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${chiave}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(richiesta.timeoutMs),
        });
      } catch (errore: any) {
        const timeout = errore?.name === "TimeoutError";
        throw new ErroreProvider(
          timeout ? "Timeout del provider." : "Provider non raggiungibile.",
          timeout ? "timeout" : "rete",
          true
        );
      }

      if (res.status === 429 || res.status >= 500) {
        throw new ErroreProvider(
          `Provider momentaneamente indisponibile (${res.status}).`,
          res.status === 429 ? "rate_limit" : "rete",
          true
        );
      }
      if (!res.ok) {
        throw new ErroreProvider(
          `Richiesta al provider rifiutata (${res.status}).`,
          "configurazione",
          false
        );
      }

      let dati: any;
      try {
        dati = await res.json();
      } catch {
        throw new ErroreProvider(
          "Risposta del provider non decodificabile.",
          "risposta_invalida",
          true
        );
      }

      const uscite: any[] = Array.isArray(dati?.output) ? dati.output : [];
      const chiamate = uscite
        .filter(u => u?.type === "function_call")
        .map(u => ({
          id: String(u.call_id ?? u.id ?? ""),
          nome: String(u.name ?? ""),
          argomenti: String(u.arguments ?? "{}"),
        }));
      if (chiamate.length > 0) {
        return { tipo: "tool_call", chiamate, uso: usoDaRisposta(dati.usage) };
      }

      const testo =
        typeof dati?.output_text === "string" && dati.output_text.length > 0
          ? dati.output_text
          : uscite
              .filter(u => u?.type === "message")
              .flatMap(u => (Array.isArray(u.content) ? u.content : []))
              .filter(c => c?.type === "output_text")
              .map(c => String(c.text ?? ""))
              .join("");
      if (!testo) {
        throw new ErroreProvider(
          "Il provider non ha prodotto né testo né chiamate strumento.",
          "risposta_invalida",
          true
        );
      }
      return { tipo: "messaggio", testo, uso: usoDaRisposta(dati.usage) };
    },
  };
}
