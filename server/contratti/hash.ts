// Versione del contratto: computo e (piano 2) fattura salvano l'hash delle
// righe e dei parametri da cui nascono; se cambia una misura, una quantità,
// un prezzo o un parametro del cantiere, l'hash cambia e il derivato risulta
// «superato». La descrizione e le note NON entrano: correggere un refuso
// non invalida un computo. Stesso principio di server/tars/versioni.ts.
import { createHash } from "node:crypto";
import type { Contratto, RigaContratto } from "@shared/limiti/tipi";

type RigaPerHash = Pick<
  RigaContratto,
  | "ordine" | "categoria" | "tipologia" | "oscuranteIntegrato" | "oscuranteTipologia"
  | "quantita" | "larghezzaMm" | "altezzaMm" | "misuraDei" | "prezzoTotCent"
  | "beneSignificativo" | "accessori"
>;

type ParametriPerHash = Pick<
  Contratto,
  | "pattuitoCent" | "pattuitoTipo" | "posaInclusa" | "zonaClimatica" | "piano"
  | "distanzaKm" | "detrazioneTipo" | "detrazioneImmobile" | "detrazionePct"
  | "opzioniComputo"
>;

function sha(testo: string): string {
  return createHash("sha256").update(testo).digest("hex");
}

export function hashRighe(righe: ReadonlyArray<RigaPerHash>): string {
  const canoniche = righe
    .map(r => [
      r.ordine,
      r.categoria,
      r.tipologia ?? "",
      r.oscuranteIntegrato ?? "",
      r.oscuranteTipologia ?? "",
      r.quantita,
      r.larghezzaMm ?? "",
      r.altezzaMm ?? "",
      r.misuraDei ?? "",
      r.prezzoTotCent ?? "",
      r.beneSignificativo ? 1 : 0,
      [...r.accessori]
        .map(a => `${a.codice}=${a.quantita}`)
        .sort()
        .join(","),
    ].join("|"))
    .sort();
  return sha(canoniche.join("\n"));
}

export function hashParametri(c: ParametriPerHash): string {
  return sha(
    [
      c.pattuitoCent, c.pattuitoTipo, c.posaInclusa ? 1 : 0, c.zonaClimatica ?? "",
      c.piano ?? "", c.distanzaKm ?? "", c.detrazioneTipo, c.detrazioneImmobile ?? "",
      c.detrazionePct ?? "",
      // Forma canonica delle opzioni del computo: rilievo|speseProfessionali|
      // eventuali ordinati e uniti da virgola — un insieme, non una sequenza,
      // quindi l'ordine con cui l'operatore le ha spuntate non deve
      // «superare» il computo.
      c.opzioniComputo.rilievo,
      c.opzioniComputo.speseProfessionali ? 1 : 0,
      [...c.opzioniComputo.eventuali].sort().join(","),
    ].join("|")
  );
}
