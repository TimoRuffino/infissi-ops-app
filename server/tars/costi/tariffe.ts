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
  /**
   * Scrittura in cache. Su GPT-5.6 e successivi NON è gratuita: costa
   * 1,25× la tariffa di input non cachato (fonte: guida ufficiale
   * «Prompt caching», consultata 31/08/2026). Ignorarla significa
   * contabilizzare meno di quanto OpenAI fattura davvero.
   */
  cacheWrite: number;
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
    // Flagship «complex professional work»: la scelta per il cervello
    // operativo (decisione della direzione del 30/08/2026). I prezzi
    // registrati sono quelli di LISTINO, non quelli promozionali in
    // corso ($4,00/$0,40/$20,00 fino al 21/11/2026): il tetto di spesa
    // deve sovrastimare, e alla scadenza della promo non serve toccare
    // nulla.
    modello: "gpt-5.6-sol",
    versioneTariffa: "2026-08-31",
    unita: "nanoUsdPerMilioneToken",
    input: 5_000_000_000,
    cachedInput: 500_000_000,
    cacheWrite: 6_250_000_000, // 1,25 × input
    output: 30_000_000_000,
    fonte: "developers.openai.com/api/docs/pricing (consultata 30/08/2026)",
    stato: "attiva",
  },
  {
    modello: "gpt-5.6-terra",
    versioneTariffa: "2026-08-31",
    unita: "nanoUsdPerMilioneToken",
    input: 2_000_000_000,
    cachedInput: 200_000_000,
    cacheWrite: 2_500_000_000, // 1,25 × input
    output: 12_000_000_000,
    fonte: "developers.openai.com/api/docs/pricing (consultata 30/08/2026)",
    stato: "attiva",
  },
];

/**
 * Moltiplicatore del service tier (TARS_SERVICE_TIER, stesso env letto
 * dall'adapter): `priority` costa 2× su tutti i token, `flex` 0,5×
 * (fonte: pagina pricing «Service tiers», consultata 01/09/2026). Un
 * valore sconosciuto vale 1× — l'adapter in quel caso non manda il campo
 * e la chiamata viaggia sul tier di default, quindi i numeri combaciano.
 */
export type ServiceTier = "default" | "priority" | "flex";

/** Il tier chiesto dall'ambiente (TARS_SERVICE_TIER): vale SOLO per la chat interattiva. */
export function tierDaEnv(): ServiceTier {
  const tier = process.env.TARS_SERVICE_TIER?.trim().toLowerCase();
  if (tier === "priority" || tier === "flex") return tier;
  return "default";
}

function moltiplicatoreTierPerMille(tier: ServiceTier): bigint {
  if (tier === "priority") return 2000n;
  if (tier === "flex") return 500n;
  return 1000n;
}

function scalaPerTier(nanoPerMilione: number, tier: ServiceTier): number {
  return Number((BigInt(nanoPerMilione) * moltiplicatoreTierPerMille(tier)) / 1000n);
}

/**
 * La tariffa ATTIVA del modello, o null (→ provider indisponibile), già
 * scalata sul service tier configurato: stima, prenotazione e
 * riconciliazione restano un soffitto anche quando `priority` raddoppia
 * il listino (gate §4: un numero raccolto non è un numero controllato).
 */
export function tariffaDi(
  modello: string,
  tier: ServiceTier = tierDaEnv()
): TariffaModello | null {
  const nome = modello.trim();
  const base =
    CATALOGO_TARIFFE.find(t => t.modello === nome && t.stato === "attiva") ??
    null;
  if (!base) return null;
  const moltiplicatore = moltiplicatoreTierPerMille(tier);
  if (moltiplicatore === 1000n) return base;
  return {
    ...base,
    input: scalaPerTier(base.input, tier),
    cachedInput: scalaPerTier(base.cachedInput, tier),
    cacheWrite: scalaPerTier(base.cacheWrite, tier),
    output: scalaPerTier(base.output, tier),
  };
}

const MILIONE = 1_000_000n;

/** Arrotondamento per ECCESSO su interi (prudenziale). */
function perEccesso(prodotto: bigint): bigint {
  return (prodotto + MILIONE - 1n) / MILIONE;
}

export type UsoTariffabile = {
  input: number;
  cachedInput: number;
  /** Token scritti in cache: tariffati 1,25×, non a prezzo pieno. */
  cacheWrite?: number;
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
  const scritti = Math.max(0, Math.trunc(uso.cacheWrite ?? 0));
  if (uso.cachedInput + scritti > uso.input) {
    throw new Error(
      "COSTO_INCOERENTE: i token cached più quelli scritti in cache superano quelli di input (contratto cambiato?)."
    );
  }
  const cached = BigInt(Math.max(0, Math.trunc(uso.cachedInput)));
  const cacheWrite = BigInt(scritti);
  const inputTotale = BigInt(Math.max(0, Math.trunc(uso.input)));
  // I token scritti in cache sono input a tariffa MAGGIORATA, non input
  // normale: vanno sottratti dalla quota a prezzo pieno, non sommati.
  const giaTariffati = cached + cacheWrite;
  const inputPieno =
    inputTotale > giaTariffati ? inputTotale - giaTariffati : 0n;
  const output = BigInt(Math.max(0, Math.trunc(uso.output)));
  return (
    perEccesso(inputPieno * BigInt(tariffa.input)) +
    perEccesso(cached * BigInt(tariffa.cachedInput)) +
    perEccesso(cacheWrite * BigInt(tariffa.cacheWrite)) +
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
