// Servizio di dominio del contratto: valida, calcola i mq, deriva zona e
// percentuale di detrazione, firma con gli hash, salva in modo atomico e
// specchia il pattuito sulla commessa. È l'unico percorso di scrittura:
// router tRPC oggi, lettura del contratto (piano 3) e Tars domani passano
// tutti di qui.
import { z } from "zod";
import { centToEuro } from "@shared/euroCent";
import {
  CATEGORIE_RIGA,
  CODICI_OPERA,
  DETRAZIONE_IMMOBILI,
  DETRAZIONE_TIPI,
  OPZIONI_COMPUTO_DEFAULT,
  OSCURANTI_INTEGRATI,
  PATTUITO_TIPI,
  ZONE_CLIMATICHE,
  gruppoPerCategoria,
  gruppoPerOscurante,
  type Contratto,
  type ContrattoInput,
  type RigaContratto,
  type RigaContrattoInput,
} from "@shared/limiti/tipi";
import { percentualeDetrazione, prodotto, tariffeAttive, type Tariffe } from "../computo/tariffe";
import { zonaPerComune } from "../computo/zone";
import { applicaPattuitoDaContratto, getCommessaById } from "../routers/commesse";
import { getClienteById } from "../routers/clienti";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { hashParametri, hashRighe } from "./hash";
import { getContrattiRepository, type RigaPersist } from "./repository";

export const rigaInputSchema = z.object({
  id: z.number().int().nullable().optional(),
  categoria: z.enum(CATEGORIE_RIGA),
  // Stringa libera: il catalogo DEI la convalida con un'avvertenza (v.
  // sotto), non con un blocco — chi scrive il contratto sa cose che il
  // catalogo non sa ancora.
  tipologia: z.string().trim().max(80).nullable(),
  oscuranteIntegrato: z.enum(OSCURANTI_INTEGRATI).nullable(),
  /** Codice DEI dell'oscurante abbinato (es. "C25089-a"); stessa logica di `tipologia`. */
  oscuranteTipologia: z.string().trim().max(40).nullable(),
  descrizione: z.string().trim().min(1).max(300),
  quantita: z.number().int().min(1).max(999),
  larghezzaMm: z.number().int().min(100).max(6000).nullable(),
  altezzaMm: z.number().int().min(100).max(6000).nullable(),
  misuraDei: z.number().min(0).max(9999).nullable(),
  prezzoUnitCent: z.number().int().min(0).nullable(),
  prezzoTotCent: z.number().int().min(0).nullable(),
  beneSignificativo: z.boolean(),
  // codice = codice del seed tariffe (es. "serramento.C25088-a").
  accessori: z
    .array(
      z.object({
        codice: z.string().trim().min(1).max(60),
        quantita: z.number().int().min(0).max(9999),
      })
    )
    .max(60),
  note: z.string().trim().max(500).nullable(),
  origine: z.enum(["estrazione", "manuale", "prodotto_legacy"]),
  evidenza: z
    .object({ pagina: z.number().int().min(1), frammento: z.string().max(300) })
    .nullable(),
});

export const contrattoInputSchema = z.object({
  pattuitoCent: z.number().int().min(0),
  pattuitoTipo: z.enum(PATTUITO_TIPI),
  posaInclusa: z.boolean(),
  notePosa: z.string().trim().max(500).nullable(),
  comuneCantiere: z.string().trim().max(120).nullable(),
  zonaClimatica: z.enum(ZONE_CLIMATICHE).nullable().optional(),
  zonaManuale: z.boolean(),
  piano: z.number().int().min(-2).max(60).nullable(),
  distanzaKm: z.number().min(0).max(2000).nullable(),
  detrazioneTipo: z.enum(DETRAZIONE_TIPI),
  detrazioneImmobile: z.enum(DETRAZIONE_IMMOBILI).nullable(),
  detrazionePct: z.number().min(0).max(100).nullable(),
  dataFirma: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  rate: z
    .array(
      z.object({
        numero: z.number().int().min(1),
        quotaPct: z.number().min(0).max(100),
        giorni: z.number().int().min(0).max(730).nullable(),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        descrizione: z.string().trim().max(120).nullable(),
      })
    )
    .max(12),
  // Scelte che cambiano quali opere entrano nei totali del computo (analisi
  // §3.2). Assenti in input = comportamento di default del foglio (rilievo
  // a foro, spese professionali escluse, nessuna eventuale): un contratto
  // senza scelta esplicita non deve restare senza opzioni.
  opzioniComputo: z
    .object({
      rilievo: z.enum(["foro", "pezzo"]),
      speseProfessionali: z.boolean(),
      eventuali: z.array(z.enum(CODICI_OPERA)).max(10),
    })
    .default(OPZIONI_COMPUTO_DEFAULT),
  origine: z.enum(["estrazione", "manuale"]),
  documentoId: z.number().int().nullable(),
});

export type RigaLegacy = {
  id: number;
  nome: string;
  tipologia: string | null;
  quantita: number;
  dimensioni: string | null;
  note: string | null;
};

/**
 * mq della riga: L×H×quantità/10⁶, esatto a sei decimali — non tre: un
 * serramento da 1,66×1,54 m per 2 pezzi fa 5,1128 mq, non 5,113. Con misure
 * intere in mm il rapporto ha al massimo sei decimali: l'arrotondamento qui
 * è solo una guardia contro il rumore binario della divisione, non una
 * perdita di precisione.
 */
export function mqRiga(r: {
  quantita: number;
  larghezzaMm: number | null;
  altezzaMm: number | null;
}): number {
  if (r.larghezzaMm == null || r.altezzaMm == null) return 0;
  return Math.round(((r.larghezzaMm * r.altezzaMm * r.quantita) / 1e6) * 1e6) / 1e6;
}

/**
 * Un errore di forma (zod) non torna mai grezzo al chiamante: il contratto
 * d'interfaccia del servizio è solo `NOT_FOUND:`/`VALIDAZIONE:` (R13). Il
 * percorso del primo problema — es. `righe.1.quantita` o
 * `contratto.rate.0.quotaPct` — dice subito dove guardare, senza dover
 * interpretare uno ZodError.
 */
function parseOrValidazione<T>(schema: z.ZodType<T>, valore: unknown, prefisso: string): T {
  const esito = schema.safeParse(valore);
  if (esito.success) return esito.data;
  const primo = esito.error.issues[0];
  const percorso = [prefisso, ...primo.path.map(String)].join(".");
  throw new Error(`VALIDAZIONE: ${percorso}: ${primo.message}`);
}

function commessaInSede(sedeId: number, commessaId: number): any {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new Error("NOT_FOUND: Commessa non trovata.");
  }
  return commessa;
}

function validaRate(rate: ContrattoInput["rate"]): void {
  if (rate.length === 0) return;
  const somma = rate.reduce((s, r) => s + r.quotaPct, 0);
  if (Math.abs(somma - 100) > 0.01) {
    throw new Error(`VALIDAZIONE: le rate sommano al ${somma}% invece che al 100%.`);
  }
  for (const r of rate) {
    if (r.giorni == null && r.data == null) {
      throw new Error(`VALIDAZIONE: la rata ${r.numero} non ha né giorni né data.`);
    }
  }
}

export async function salvaContratto(input: {
  sedeId: number;
  commessaId: number;
  contratto: ContrattoInput;
  righe: RigaContrattoInput[];
  actorUserId: number | null;
  now?: Date;
}): Promise<{ contratto: Contratto; righe: RigaContratto[]; avvertenze: string[] }> {
  const now = input.now ?? new Date();
  const commessa = commessaInSede(input.sedeId, input.commessaId);
  const parametri = parseOrValidazione(contrattoInputSchema, input.contratto, "contratto");
  const righeValide = input.righe.map((r, i) => parseOrValidazione(rigaInputSchema, r, `righe.${i}`));
  validaRate(parametri.rate);
  const avvertenze: string[] = [];
  let tariffe: Tariffe;
  try {
    tariffe = tariffeAttive(now);
  } catch {
    // Nessuna tariffa prima del DM 14/02/2022 (v. tariffeAttive): un errore
    // di dati sulla data del contratto, non di sede o di permessi — stesso
    // contratto VALIDAZIONE degli altri problemi di forma (R13).
    throw new Error("VALIDAZIONE: tariffe non disponibili per la data del contratto.");
  }

  // Zona: dal comune, salvo override dichiarato.
  let zona = parametri.zonaManuale ? (parametri.zonaClimatica ?? null) : null;
  let codiceIstat: string | null = null;
  if (!parametri.zonaManuale) {
    const cliente: any = commessa.clienteId ? getClienteById(commessa.clienteId) : null;
    const comune = parametri.comuneCantiere ?? cliente?.cittaLavoro ?? cliente?.citta ?? null;
    const trovato = comune ? zonaPerComune(comune) : null;
    if (trovato) {
      zona = trovato.zona;
      codiceIstat = trovato.codiceIstat;
    } else {
      avvertenze.push(
        comune
          ? `Zona climatica non derivabile dal comune «${comune}»: indicarla a mano.`
          : "Comune del cantiere mancante: la zona climatica resta vuota."
      );
    }
  }
  if (parametri.zonaManuale && !zona) {
    throw new Error("VALIDAZIONE: zona manuale senza zona indicata.");
  }

  // Percentuale di detrazione: fotografata alla data firma (o oggi).
  const anno = Number((parametri.dataFirma ?? now.toISOString().slice(0, 10)).slice(0, 4));
  const pct =
    parametri.detrazioneTipo === "nessuna"
      ? null
      : parametri.detrazionePct ??
        percentualeDetrazione(tariffe, parametri.detrazioneTipo, parametri.detrazioneImmobile, anno);
  if (parametri.detrazioneTipo !== "nessuna" && pct == null) {
    // L'anno è l'informazione che manca davvero: le tariffe hanno le aliquote
    // per anno di firma e questa non ne ha una. Dire «indicarla a mano»
    // mandava a cercare un campo che il form del contratto non offre.
    avvertenze.push(
      `Percentuale di detrazione non calcolabile per l'anno ${anno}: le tariffe non hanno un'aliquota per quell'anno, il detraibile resta vuoto.`
    );
  }

  const righePersist: RigaPersist[] = righeValide.map((r, i) => ({
    sedeId: input.sedeId,
    commessaId: input.commessaId,
    ordine: i + 1,
    categoria: r.categoria,
    tipologia: r.tipologia,
    oscuranteIntegrato: r.oscuranteIntegrato,
    oscuranteTipologia: r.oscuranteTipologia,
    descrizione: r.descrizione,
    quantita: r.quantita,
    larghezzaMm: r.larghezzaMm,
    altezzaMm: r.altezzaMm,
    mq: mqRiga(r),
    misuraDei: r.misuraDei,
    prezzoUnitCent: r.prezzoUnitCent,
    prezzoTotCent: r.prezzoTotCent ?? (r.prezzoUnitCent == null ? null : r.prezzoUnitCent * r.quantita),
    beneSignificativo: r.beneSignificativo,
    accessori: r.accessori,
    note: r.note,
    origine: r.origine,
    evidenza: r.evidenza,
  }));
  if (righePersist.some(r => r.mq === 0 && r.categoria !== "controtelaio" && r.categoria !== "accessorio" && r.categoria !== "altro")) {
    avvertenze.push("Alcune righe non hanno misure: il computo le conterà senza mq.");
  }

  // Catalogo DEI: una riga il cui gruppo entra nei prodotti (CHECK2) ma con
  // una tipologia assente o non riconosciuta non può essere prezzata dal
  // computo — lo diciamo, non rifiutiamo il salvataggio: chi scrive il
  // contratto sa cose che il catalogo non sa ancora (analisi §3.2).
  for (const r of righePersist) {
    const { gruppo } = gruppoPerCategoria(r.categoria);
    if (gruppo) {
      const prodottoRiga = r.tipologia ? prodotto(tariffe, r.tipologia) : null;
      if (!prodottoRiga || prodottoRiga.gruppo !== gruppo) {
        avvertenze.push(`Riga ${r.ordine}: tipologia DEI mancante o non valida: il CHECK2 sarà incompleto.`);
      }
    }
    if (r.oscuranteIntegrato) {
      const gruppoOscurante = gruppoPerOscurante(r.oscuranteIntegrato);
      const prodottoOscurante = r.oscuranteTipologia ? prodotto(tariffe, r.oscuranteTipologia) : null;
      if (!prodottoOscurante || prodottoOscurante.gruppo !== gruppoOscurante) {
        avvertenze.push(`Riga ${r.ordine}: oscurante senza voce DEI.`);
      }
    }
  }

  const precedente = await getContrattiRepository().getContratto(input.sedeId, input.commessaId);
  const contrattoPersist = {
    commessaId: input.commessaId,
    sedeId: input.sedeId,
    ...parametri,
    zonaClimatica: zona,
    codiceIstat,
    detrazionePct: pct,
    hashRighe: hashRighe(righePersist),
    hashParametri: "",
    createdBy: precedente?.createdBy ?? input.actorUserId,
    updatedBy: input.actorUserId,
  };
  contrattoPersist.hashParametri = hashParametri(contrattoPersist);

  const esito = await getContrattiRepository().salva({
    contratto: contrattoPersist,
    righe: righePersist,
    now,
  });

  try {
    const specchio = applicaPattuitoDaContratto(input.commessaId, {
      importoTotale: centToEuro(parametri.pattuitoCent),
      rate: parametri.rate,
    });
    if (!specchio.applicato && specchio.motivo) avvertenze.push(specchio.motivo);
  } catch (error) {
    // Il contratto è già salvato (sopra): niente rollback tra store diversi
    // in questo CRM — non esiste una transazione cross-store (R12). Il
    // contratto resta la fonte di verità; il prossimo salvataggio ritenta
    // lo specchio sulla commessa.
    const messaggio = error instanceof Error ? error.message : String(error);
    avvertenze.push(`Pattuito non aggiornato sulla commessa: ${messaggio}`);
  }

  return { ...esito, avvertenze };
}

export async function leggiContratto(
  sedeId: number,
  commessaId: number
): Promise<{ contratto: Contratto | null; righe: RigaContratto[]; righeLegacy: RigaLegacy[] }> {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    return { contratto: null, righe: [], righeLegacy: [] };
  }
  const repo = getContrattiRepository();
  const [contratto, righe] = await Promise.all([
    repo.getContratto(sedeId, commessaId),
    repo.listRighe(sedeId, commessaId),
  ]);
  const righeLegacy: RigaLegacy[] = (Array.isArray(commessa.prodotti) ? commessa.prodotti : []).map((p: any) => ({
    id: Number(p.id),
    nome: String(p.nome ?? ""),
    tipologia: p.tipologia ?? null,
    quantita: Number(p.quantita ?? 1),
    dimensioni: p.dimensioni ?? null,
    note: p.note ?? null,
  }));
  return { contratto, righe, righeLegacy };
}
