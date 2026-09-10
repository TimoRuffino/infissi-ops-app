// L'elenco di sinistra della pagina Fornitori: i fornitori dell'azienda, più
// i mittenti da cui è arrivata una conferma e che non sono ancora censiti.
//
// Vive qui e non nella pagina perché è la sola parte con una regola dentro —
// chi va in cima, chi non va mostrato due volte — e una regola si prova.
//
// Fino al 10/09/2026 quella colonna era il riepilogo dell'ARCHIVIO: i
// mittenti visti nella posta. Un fornitore dell'azienda che non ha ancora
// scritto non compariva, e uno che scriveva non si poteva censire.

/** La riga del riepilogo d'archivio, così come la manda il server. */
export type RigaRiepilogo = {
  fornitore: string;
  daCollegare: number;
  incerte: number;
  collegateTars: number;
  nelFascicolo: number;
  inArrivo: number;
  inRitardo: number;
};

export type VoceElenco =
  | {
      tipo: "anagrafica";
      id: number;
      nome: string;
      attivo: boolean;
      /** Null quando il fornitore è censito ma non ha ancora scritto. */
      riepilogo: RigaRiepilogo | null;
    }
  | {
      tipo: "candidato";
      nome: string;
      dominio: string | null;
      riepilogo: RigaRiepilogo | null;
      conferme: number;
    };

/** Quante decisioni aspettano su questa voce: è il criterio di chi va in cima. */
export function daDecidere(voce: VoceElenco): number {
  const r = voce.riepilogo;
  return r ? r.daCollegare + r.incerte : 0;
}

export function componiElencoFornitori(input: {
  anagrafica: ReadonlyArray<{ id: number; ragioneSociale: string; attivo: boolean }>;
  riepilogo: ReadonlyArray<RigaRiepilogo>;
  candidati: ReadonlyArray<{ nome: string; dominio: string | null; conferme: number }>;
}): VoceElenco[] {
  const perNome = new Map(input.riepilogo.map(r => [r.fornitore.toLowerCase(), r]));
  const censiti = new Set(input.anagrafica.map(f => f.ragioneSociale.toLowerCase()));

  const dellAzienda: VoceElenco[] = input.anagrafica.map(f => ({
    tipo: "anagrafica" as const,
    id: f.id,
    nome: f.ragioneSociale,
    attivo: f.attivo,
    riepilogo: perNome.get(f.ragioneSociale.toLowerCase()) ?? null,
  }));

  const daCensire: VoceElenco[] = input.candidati
    .filter(c => !censiti.has(c.nome.toLowerCase()))
    .map(c => ({
      tipo: "candidato" as const,
      nome: c.nome,
      dominio: c.dominio,
      riepilogo: perNome.get(c.nome.toLowerCase()) ?? null,
      conferme: c.conferme,
    }));

  const tutte = [...dellAzienda, ...daCensire];

  // Tre fasce, e sono quelle che una persona si aspetta: prima chi ha
  // qualcosa da decidere, poi il resto dei suoi fornitori, poi chi bussa
  // alla porta e non è ancora entrato.
  const fascia = (v: VoceElenco): number =>
    daDecidere(v) > 0 ? 0 : v.tipo === "anagrafica" ? 1 : 2;

  return tutte.sort(
    (a, b) =>
      fascia(a) - fascia(b) ||
      daDecidere(b) - daDecidere(a) ||
      a.nome.localeCompare(b.nome)
  );
}
