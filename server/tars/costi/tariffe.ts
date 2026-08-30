// Catalogo tariffe dei modelli (cost hardening) — spec §27, decisioni
// 42-43.
//
// Contabilità in NANODOLLARI interi (1e-9 USD): mai floating point.
// Le tariffe sono `nanoUsdPerMilioneToken`, valore intero esatto per i
// prezzi correnti ($2/1M = 2_000_000_000 nano per milione di token). Il
// costo si calcola in BigInt con arrotondamento PER ECCESSO: il tetto di
// spesa deve sovrastimare, mai sottostimare.
//
// Registro CHIUSO: un modello senza tariffa attiva NON è utilizzabile
// (fail-closed). Cambiare modello richiede una voce qui, con fonte e
// data, e una decisione registrata nella spec.

export type StatoTariffa = "attiva" | "deprecata";

export type TariffaModello = {
  /** Model ID esatto usato nella chiamata API. */
  modello: string;
  /** Versione/data del listino consultato. */
  versioneTariffa: string;
  /** Unità di misura dei tre prezzi. */
  unita: "nanoUsdPerMilioneToken";
  input: number;
  cachedInput: number;
  output: number;
  fonte: string;
  stato: StatoTariffa;
};

/**
 * Prezzi verificati su developers.openai.com il 30/08/2026:
 * gpt-5.6-terra = 2,00 USD input / 0,20 USD cached input / 12,00 USD
 * output per milione di token.
 */
export const CATALOGO_TARIFFE: readonly TariffaModello[] = [
  {
    modello: "gpt-5.6-terra",
    versioneTariffa: "2026-08-30",
    unita: "nanoUsdPerMilioneToken",
    input: 2_000_000_000,
    cachedInput: 200_000_000,
    output: 12_000_000_000,
    fonte: "developers.openai.com/api/docs/pricing (consultata 30/08/2026)",
    stato: "attiva",
  },
];

/** La tariffa ATTIVA del modello, o null (→ provider indisponibile). */
export function tariffaDi(modello: string): TariffaModello | null {
  const nome = modello.trim();
  return (
    CATALOGO_TARIFFE.find(t => t.modello === nome && t.stato === "attiva") ??
    null
  );
}

const MILIONE = 1_000_000n;

/** Arrotondamento per ECCESSO su interi (prudenziale). */
function perEccesso(prodotto: bigint): bigint {
  return (prodotto + MILIONE - 1n) / MILIONE;
}

export type UsoTariffabile = {
  input: number;
  cachedInput: number;
  output: number;
};

/**
 * Costo in nanodollari (BigInt: nessun overflow con finestre da 1M
 * token). `input` è il totale dei token d'ingresso: la parte
 * `cachedInput` viene tariffata a prezzo scontato e NON sommata due
 * volte — è il contratto della Responses API (cached_tokens ⊆
 * input_tokens).
 */
export function costoNano(
  tariffa: TariffaModello,
  uso: UsoTariffabile
): bigint {
  // Difesa sul contratto (revisione): se un giorno `input_tokens`
  // smettesse di includere i cached, sottrarli produrrebbe un costo
  // molto più basso del reale, in silenzio. Meglio un errore.
  if (uso.cachedInput > uso.input) {
    throw new Error(
      "COSTO_INCOERENTE: i token cached superano quelli di input (contratto cambiato?)."
    );
  }
  const cached = BigInt(Math.max(0, Math.trunc(uso.cachedInput)));
  const inputTotale = BigInt(Math.max(0, Math.trunc(uso.input)));
  const inputPieno = inputTotale > cached ? inputTotale - cached : 0n;
  const output = BigInt(Math.max(0, Math.trunc(uso.output)));
  return (
    perEccesso(inputPieno * BigInt(tariffa.input)) +
    perEccesso(cached * BigInt(tariffa.cachedInput)) +
    perEccesso(output * BigInt(tariffa.output))
  );
}

/** USD → nanodollari, con validazione (valori non finiti o negativi = null). */
export function usdInNano(valore: number): number | null {
  if (!Number.isFinite(valore) || valore <= 0) return null;
  return Math.round(valore * 1_000_000_000);
}

export function nanoInUsd(nano: number | bigint): number {
  const n = typeof nano === "bigint" ? Number(nano) : nano;
  return Math.round((n / 1_000_000_000) * 1_000_000) / 1_000_000;
}
