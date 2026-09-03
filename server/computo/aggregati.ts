// Dalle righe del contratto ai numeri che il foglio tiene in «Calcolo
// Automatici» (conteggi e mq per gruppo) e in «Tempi» (ore di tiro al
// piano e di posa). Le chiavi portano il nome della cella d'origine nei
// commenti: ogni formula del motore si confronta con l'originale.
import type { RigaContratto } from "@shared/limiti/tipi";
import type { Coefficienti } from "./tariffe";

export type ChiaveAggregato =
  | "serramenti"      // L7/R7   block A, PVC/alluminio senza oscurante
  | "cassonetti"      // L8/R8 (+T9/Z9)
  | "porteBlindate"   // L9/R9
  | "portoncini"      // L10/R10
  | "serrTapp"        // T7/Z7
  | "serrPers"        // T8/Z8
  | "serrScuri"       // T10/Z10
  | "portoncinoPers"  // T11/Z11
  | "tapparelle"      // AB7/AG7
  | "persiane"        // AB8/AG8
  | "scuri"           // AB9/AG9
  | "veneziane"       // AI7/AN7  schermature (veneziane, frangisole)
  | "tende"           // AI8/AN8
  | "pergole"         // AI9/AN9
  | "zanzariere"      // AI10/AN10
  | "legno"           // AP7/AV7  legno e legno-alluminio senza oscurante
  | "legnoTapp"       // AX7/BD7
  | "legnoPers"       // AX8/BD8
  | "legnoScuri";     // AX9/BD9

export type RigaAggregabile = Pick<
  RigaContratto,
  "categoria" | "oscuranteIntegrato" | "quantita" | "larghezzaMm" | "mq"
>;

export type Aggregati = {
  n: Record<ChiaveAggregato, number>;
  mq: Record<ChiaveAggregato, number>;
  larghezzaM: number;
  oreTiro: number;
  orePosa: number;
  giornatePosa: number;
  nTotale: number;
  mqTotale: number;
  righeSenzaMisure: number;
};

const CHIAVI: ChiaveAggregato[] = [
  "serramenti", "cassonetti", "porteBlindate", "portoncini", "serrTapp", "serrPers",
  "serrScuri", "portoncinoPers", "tapparelle", "persiane", "scuri", "veneziane", "tende",
  "pergole", "zanzariere", "legno", "legnoTapp", "legnoPers", "legnoScuri",
];

const SERRAMENTO_NON_LEGNO = new Set(["serramento_pvc", "serramento_alluminio"]);
const SERRAMENTO_LEGNO = new Set(["serramento_legno", "serramento_legno_alluminio"]);

/** La chiave del foglio per una riga, o null se la riga non entra negli aggregati. */
export function chiaveDi(r: RigaAggregabile): ChiaveAggregato | null {
  const o = r.oscuranteIntegrato;
  if (SERRAMENTO_NON_LEGNO.has(r.categoria)) {
    return o === "tapparella" ? "serrTapp" : o === "persiana" ? "serrPers" : o === "scuro" ? "serrScuri" : "serramenti";
  }
  if (SERRAMENTO_LEGNO.has(r.categoria)) {
    return o === "tapparella" ? "legnoTapp" : o === "persiana" ? "legnoPers" : o === "scuro" ? "legnoScuri" : "legno";
  }
  switch (r.categoria) {
    case "cassonetto": return "cassonetti";
    case "porta_blindata": return "porteBlindate";
    case "portoncino": return o === "persiana" ? "portoncinoPers" : "portoncini";
    case "tapparella": return "tapparelle";
    case "persiana": return "persiane";
    case "scuro": return "scuri";
    case "schermatura": return "veneziane";
    case "tenda": return "tende";
    case "pergola": return "pergole";
    case "zanzariera": return "zanzariere";
    default: return null; // controtelaio, porta_interna, accessorio, altro
  }
}

export function aggrega(
  righe: ReadonlyArray<RigaAggregabile>,
  coeff: Coefficienti
): Aggregati {
  const n = Object.fromEntries(CHIAVI.map(k => [k, 0])) as Record<ChiaveAggregato, number>;
  const mq = Object.fromEntries(CHIAVI.map(k => [k, 0])) as Record<ChiaveAggregato, number>;
  let larghezzaM = 0;
  let righeSenzaMisure = 0;
  for (const r of righe) {
    const k = chiaveDi(r);
    if (!k) continue;
    n[k] += r.quantita;
    mq[k] += r.mq;
    // Righe aggregate (contate in n) ma senza misure (mq 0): es. una
    // persiana rilevata solo a pezzo. Un controtelaio non ha chiave (k
    // null, sopra) quindi non entra qui: non ha misure per natura, non è
    // "un pezzo senza mq" nel senso del warning che questo numero alimenta.
    if (r.mq === 0) righeSenzaMisure += 1;
    // Q13: larghezza dei soli serramenti (blocchi A, B, E, F).
    const serramento = SERRAMENTO_NON_LEGNO.has(r.categoria) || SERRAMENTO_LEGNO.has(r.categoria);
    if (serramento && r.larghezzaMm != null) larghezzaM += (r.larghezzaMm * r.quantita) / 1000;
  }

  // Tempi!C4..C13 → ore di tiro al piano (F14)
  const serramentiTutti = n.serramenti + n.serrTapp + n.serrPers + n.serrScuri + n.legno + n.legnoTapp + n.legnoPers + n.legnoScuri;
  const tapparelleECassonetti = n.serrTapp + n.cassonetti + n.tapparelle + n.legnoTapp;
  const persianeTutte = n.serrPers + n.persiane + n.legnoPers + n.portoncinoPers;
  const scuriTutti = n.serrScuri + n.scuri + n.legnoScuri;
  const oreTiro =
    serramentiTutti * coeff.oreTiro.serramento +
    tapparelleECassonetti * coeff.oreTiro.tapparella +
    persianeTutte * coeff.oreTiro.persiana +
    scuriTutti * coeff.oreTiro.scuro +
    coeff.oreTiro.materialiPosa +
    n.porteBlindate * coeff.oreTiro.porta_blindata +
    (n.portoncini + n.portoncinoPers) * coeff.oreTiro.portoncino +
    (n.veneziane + n.zanzariere) * coeff.oreTiro.schermatura +
    n.tende * coeff.oreTiro.tenda +
    n.pergole * coeff.oreTiro.pergola;

  // Tempi!L4..L11 → ore di posa (O12)
  const oscurantiTutti = n.tapparelle + n.persiane + n.scuri + n.serrTapp + n.serrPers + n.serrScuri + n.legnoTapp + n.legnoPers + n.legnoScuri + n.portoncinoPers;
  const orePosa =
    serramentiTutti * coeff.orePosa.serramento +
    n.cassonetti * coeff.orePosa.cassonetto +
    oscurantiTutti * coeff.orePosa.oscurante +
    (n.veneziane + n.zanzariere) * coeff.orePosa.schermatura +
    n.tende * coeff.orePosa.tenda +
    n.pergole * coeff.orePosa.pergola +
    n.porteBlindate * coeff.orePosa.porta_blindata +
    (n.portoncini + n.portoncinoPers) * coeff.orePosa.portoncino;

  const nTotale = CHIAVI.reduce((s, k) => s + n[k], 0);
  const mqTotale = CHIAVI.reduce((s, k) => s + mq[k], 0);
  return {
    n,
    mq,
    larghezzaM,
    oreTiro,
    orePosa,
    giornatePosa: Math.ceil(orePosa / coeff.oreGiornata),
    nTotale,
    mqTotale,
    righeSenzaMisure,
  };
}
