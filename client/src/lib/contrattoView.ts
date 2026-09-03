// Presentazione pura della tab Contratto: forme vuote, formule di
// visualizzazione (mq, totali), etichette lette dal catalogo DEI, filtri del
// catalogo e validazione anticipata. Nessun React, nessuna chiamata:
// testabile a tavolino. La regola vera resta nel servizio server; qui si
// evita solo di mandare un form che verrà rifiutato — e si distingue ciò che
// blocca il salvataggio (erroriForm) da ciò che lo rende solo incompleto
// (avvisiForm: senza voce DEI il CHECK2 non si può prezzare, ma il contratto
// esiste lo stesso).
import {
  OPZIONI_COMPUTO_DEFAULT,
  gruppoPerCategoria,
  gruppoPerOscurante,
  type AccessorioRiga,
  type CategoriaRiga,
  type CodiceOpera,
  type Contratto,
  type ContrattoInput,
  type OscuranteIntegrato,
  type RataContratto,
  type RigaContratto,
  type RigaContrattoInput,
  type ZonaClimatica,
} from "@shared/limiti/tipi";
import { formatEuro } from "./euro";

export type RigaForm = RigaContrattoInput & { chiave: string };
export type RigaLegacy = {
  id: number;
  nome: string;
  tipologia: string | null;
  quantita: number;
  dimensioni: string | null;
  note: string | null;
};

// Forme strutturali del catalogo che arriva da `contratti.get`: qui bastano i
// campi usati dalla UI, così il client non importa i tipi del server.
export type ProdottoCatalogo = {
  codice: string;
  gruppo: string;
  famiglia: string;
  nome: string;
  prezzo: number;
  unita: string;
  zone?: string[] | null;
  portafinestra?: boolean;
  nAnte?: number | null;
};
export type AccessorioCatalogo = {
  codice: string;
  gruppo: string;
  famiglie: string[];
  nome: string;
  regola: string;
  valore: number;
  soloPortafinestra: boolean;
};
export type ControtelaioCatalogo = {
  codice: string;
  famiglia: string;
  variante: string;
  unita: string;
};
export type OperaCatalogo = {
  codice: CodiceOpera;
  gruppo: string;
  descrizione: string;
  inclusaDefault: boolean;
};
export type CatalogoContratto = {
  prodotti: ReadonlyArray<ProdottoCatalogo>;
  accessori: ReadonlyArray<AccessorioCatalogo>;
  controtelai: ReadonlyArray<ControtelaioCatalogo>;
  opere: ReadonlyArray<OperaCatalogo>;
};

let contatore = 0;
const nuovaChiave = () => `r-${Date.now().toString(36)}-${(contatore++).toString(36)}`;

/**
 * Un serramento è un bene significativo ai fini dell'IVA agevolata;
 * controtelai e voci generiche no. Resta modificabile: qui c'è solo il punto
 * di partenza, che segue la categoria anche quando la si cambia.
 */
export function beneSignificativoDefault(categoria: CategoriaRiga): boolean {
  return categoria !== "controtelaio" && categoria !== "altro";
}

export function rigaVuota(categoria: CategoriaRiga = "serramento_pvc"): RigaForm {
  return {
    chiave: nuovaChiave(),
    categoria,
    tipologia: null,
    oscuranteIntegrato: null,
    oscuranteTipologia: null,
    descrizione: "",
    quantita: 1,
    larghezzaMm: null,
    altezzaMm: null,
    misuraDei: null,
    prezzoUnitCent: null,
    prezzoTotCent: null,
    beneSignificativo: beneSignificativoDefault(categoria),
    accessori: [],
    note: null,
    origine: "manuale",
    evidenza: null,
  };
}

/** Stessa formula di `mqRiga` nel servizio: sei decimali, non tre. */
export function mqRigaForm(r: {
  quantita: number;
  larghezzaMm: number | null;
  altezzaMm: number | null;
}): number {
  if (r.larghezzaMm == null || r.altezzaMm == null) return 0;
  return Math.round(((r.larghezzaMm * r.altezzaMm * r.quantita) / 1e6) * 1e6) / 1e6;
}

export function totaleRigheCent(
  righe: ReadonlyArray<{ prezzoTotCent: number | null }>
): number {
  return righe.reduce((s, r) => s + (r.prezzoTotCent ?? 0), 0);
}

const CATEGORIE: Record<CategoriaRiga, string> = {
  serramento_pvc: "Serramento PVC",
  serramento_alluminio: "Serramento alluminio",
  serramento_legno: "Serramento legno",
  serramento_legno_alluminio: "Serramento legno-alluminio",
  cassonetto: "Cassonetto",
  tapparella: "Tapparella",
  persiana: "Persiana",
  scuro: "Scuro",
  schermatura: "Schermatura solare",
  zanzariera: "Zanzariera",
  tenda: "Tenda da sole",
  pergola: "Pergola",
  porta_blindata: "Porta blindata",
  portoncino: "Portoncino",
  porta_interna: "Porta interna",
  controtelaio: "Controtelaio",
  accessorio: "Accessorio",
  altro: "Altro",
};
export function etichettaCategoria(c: CategoriaRiga): string {
  return CATEGORIE[c] ?? c;
}

/** La tipologia è un codice DEI: il nome sta nel catalogo, non in un elenco fisso. */
export function etichettaTipologia(
  codice: string | null,
  prodotti: ReadonlyArray<ProdottoCatalogo>
): string {
  if (!codice) return "—";
  return prodotti.find(p => p.codice === codice)?.nome ?? codice;
}

export function etichettaAccessorio(
  codice: string,
  accessori: ReadonlyArray<AccessorioCatalogo>
): string {
  return accessori.find(a => a.codice === codice)?.nome ?? codice;
}

/**
 * Percentuali sui mq e forfait non hanno una quantità da digitare: la
 * ricavano dalla riga. Le altre regole (a pezzo, ad anta, al metro) sì.
 */
export function quantitaAccessorioModificabile(regola: string): boolean {
  return regola !== "pct_mq" && regola !== "cad_fisso";
}

/** Voci DEI proponibili per la categoria della riga, nella zona del contratto. */
export function prodottiPerRiga(
  prodotti: ReadonlyArray<ProdottoCatalogo>,
  categoria: CategoriaRiga,
  zona: ZonaClimatica | null
): ProdottoCatalogo[] {
  const { gruppo, famiglia } = gruppoPerCategoria(categoria);
  if (!gruppo) return [];
  return prodotti.filter(
    p =>
      p.gruppo === gruppo &&
      (!famiglia || p.famiglia === famiglia) &&
      (!zona || !p.zone || p.zone.includes(zona))
  );
}

/**
 * Opzioni della Select «voce DEI» di una riga. La voce già scelta compare
 * SEMPRE, anche quando i filtri la escluderebbero: un Select vuoto
 * nasconderebbe un dato salvato senza dirlo a nessuno. Il perché
 * dell'anomalia sta nell'etichetta, il rimedio negli avvisi.
 */
export type OpzioneTipologia = { codice: string; etichetta: string; anomala: boolean };

export function opzioniTipologia(
  prodotti: ReadonlyArray<ProdottoCatalogo>,
  categoria: CategoriaRiga,
  zona: ZonaClimatica | null,
  codiceCorrente: string | null
): OpzioneTipologia[] {
  const opzioni: OpzioneTipologia[] = prodottiPerRiga(prodotti, categoria, zona).map(p => ({
    codice: p.codice,
    etichetta: p.nome,
    anomala: false,
  }));
  if (!codiceCorrente || opzioni.some(o => o.codice === codiceCorrente)) return opzioni;
  const p = prodotti.find(x => x.codice === codiceCorrente) ?? null;
  const nota = !p
    ? "non in catalogo"
    : prodottiPerRiga(prodotti, categoria, null).some(x => x.codice === p.codice)
      ? "fuori zona"
      : "altra categoria";
  return [
    ...opzioni,
    { codice: codiceCorrente, etichetta: `${p?.nome ?? codiceCorrente} — ${nota}`, anomala: true },
  ];
}

export function prodottiPerOscurante(
  prodotti: ReadonlyArray<ProdottoCatalogo>,
  oscurante: OscuranteIntegrato
): ProdottoCatalogo[] {
  const gruppo = gruppoPerOscurante(oscurante);
  return prodotti.filter(p => p.gruppo === gruppo);
}

/**
 * Accessori compatibili con i prodotti della riga (serramento e, se scelto,
 * oscurante): stesso filtro di `accessoriPer` sul server — gruppo, famiglia
 * e vincolo portafinestra — senza doppioni.
 */
export function accessoriDisponibili(
  accessori: ReadonlyArray<AccessorioCatalogo>,
  prodotti: ReadonlyArray<ProdottoCatalogo | null | undefined>
): AccessorioCatalogo[] {
  const scelti: AccessorioCatalogo[] = [];
  for (const p of prodotti) {
    if (!p) continue;
    for (const a of accessori) {
      if (a.gruppo !== p.gruppo) continue;
      if (a.famiglie.length > 0 && !a.famiglie.includes(p.famiglia)) continue;
      if (a.soloPortafinestra && !p.portafinestra) continue;
      if (!scelti.some(x => x.codice === a.codice)) scelti.push(a);
    }
  }
  return scelti;
}

/** Accessori già scelti che restano compatibili con i prodotti della riga. */
export function accessoriCompatibili(
  scelti: ReadonlyArray<AccessorioRiga>,
  disponibili: ReadonlyArray<AccessorioCatalogo>
): AccessorioRiga[] {
  return scelti.filter(a => disponibili.some(d => d.codice === a.codice)).map(a => ({ ...a }));
}

export function rateDefault(): RataContratto[] {
  return [
    { numero: 1, quotaPct: 50, giorni: 0, data: null, descrizione: "All'ordine" },
    { numero: 2, quotaPct: 40, giorni: 60, data: null, descrizione: "Arrivo merce pronta" },
    { numero: 3, quotaPct: 10, giorni: 75, data: null, descrizione: "Posa in opera ultimata" },
  ];
}

export function parametriVuoti(): ContrattoInput {
  return {
    pattuitoCent: 0,
    pattuitoTipo: "lordo",
    posaInclusa: true,
    notePosa: null,
    comuneCantiere: null,
    zonaClimatica: null,
    zonaManuale: false,
    piano: null,
    distanzaKm: null,
    detrazioneTipo: "nessuna",
    detrazioneImmobile: null,
    detrazionePct: null,
    dataFirma: null,
    rate: rateDefault(),
    opzioniComputo: { ...OPZIONI_COMPUTO_DEFAULT, eventuali: [] },
    origine: "manuale",
    documentoId: null,
  };
}

/** Contratto salvato → parametri del form: senza sede, hash e firme. */
export function parametriDaServer(c: Contratto): ContrattoInput {
  return {
    pattuitoCent: c.pattuitoCent,
    pattuitoTipo: c.pattuitoTipo,
    posaInclusa: c.posaInclusa,
    notePosa: c.notePosa,
    comuneCantiere: c.comuneCantiere,
    // La zona derivata dal comune resta visibile: serve già scritta se poi
    // l'operatore passa alla scelta a mano.
    zonaClimatica: c.zonaClimatica,
    zonaManuale: c.zonaManuale,
    piano: c.piano,
    distanzaKm: c.distanzaKm,
    detrazioneTipo: c.detrazioneTipo,
    detrazioneImmobile: c.detrazioneImmobile,
    // Mai rimandare indietro la percentuale: per il servizio un valore
    // esplicito è un override manuale, e da lì in poi la detrazione non
    // seguirebbe più tipo, immobile e anno di firma. Il form la mostra e
    // basta (badge accanto a «Immobile»); a calcolarla è il server.
    detrazionePct: null,
    dataFirma: c.dataFirma,
    rate: c.rate.map(r => ({ ...r })),
    opzioniComputo: {
      rilievo: c.opzioniComputo.rilievo,
      speseProfessionali: c.opzioniComputo.speseProfessionali,
      eventuali: [...c.opzioniComputo.eventuali],
    },
    origine: c.origine,
    documentoId: c.documentoId,
  };
}

export function riepilogoContratto(
  c: Pick<Contratto, "pattuitoCent" | "pattuitoTipo" | "zonaClimatica"> | null,
  nRighe: number
): string {
  if (!c) return "Contratto non ancora inserito";
  const parti = [
    `${nRighe} ${nRighe === 1 ? "riga" : "righe"}`,
    `pattuito € ${formatEuro(c.pattuitoCent / 100)} ${c.pattuitoTipo}`,
  ];
  if (c.zonaClimatica) parti.push(`zona ${c.zonaClimatica}`);
  return parti.join(" · ");
}

/** Ciò che il servizio rifiuterebbe: blocca il salvataggio. */
export function erroriForm(
  parametri: ContrattoInput,
  righe: ReadonlyArray<RigaForm>
): string[] {
  const errori: string[] = [];
  if (!(parametri.pattuitoCent > 0)) errori.push("Il pattuito deve essere maggiore di zero.");
  if (parametri.zonaManuale && !parametri.zonaClimatica) errori.push("Zona manuale: indica la zona climatica.");
  if (parametri.rate.length > 0) {
    const somma = parametri.rate.reduce((s, r) => s + r.quotaPct, 0);
    if (Math.abs(somma - 100) > 0.01) errori.push(`Le rate sommano al ${somma}%: devono fare 100%.`);
    for (const r of parametri.rate) {
      if (r.giorni == null && r.data == null) errori.push(`Rata ${r.numero}: manca il termine in giorni o la data.`);
    }
  }
  righe.forEach((r, i) => {
    if (!r.descrizione.trim()) errori.push(`Riga ${i + 1}: descrizione mancante.`);
    if (r.quantita < 1) errori.push(`Riga ${i + 1}: quantità non valida.`);
    if ((r.larghezzaMm == null) !== (r.altezzaMm == null)) errori.push(`Riga ${i + 1}: indica sia larghezza sia altezza.`);
  });
  return errori;
}

/**
 * Ciò che il servizio accetterebbe segnalandolo (le sue `avvertenze`): senza
 * voce DEI il computo non sa prezzare la riga, ma il contratto si salva —
 * chi scrive il contratto sa cose che il catalogo non sa ancora.
 */
export function avvisiForm(
  righe: ReadonlyArray<
    Pick<RigaForm, "categoria" | "tipologia" | "oscuranteIntegrato" | "oscuranteTipologia" | "descrizione">
  >,
  prodotti: ReadonlyArray<ProdottoCatalogo>,
  zona: ZonaClimatica | null = null
): string[] {
  const perCodice = new Map(prodotti.map(p => [p.codice, p]));
  // Catalogo non ancora arrivato: si può dire che un codice manca, non che
  // un codice scritto è sbagliato.
  const catalogoAssente = perCodice.size === 0;
  const avvisoVoce = (codice: string | null, gruppo: string, mancante: string): string | null => {
    if (!codice) return mancante;
    if (catalogoAssente) return null;
    const p = perCodice.get(codice);
    if (!p || p.gruppo !== gruppo) return mancante;
    if (zona && p.zone && !p.zone.includes(zona)) {
      return `la tipologia «${p.nome}» non vale per la zona ${zona}.`;
    }
    return null;
  };

  const avvisi: string[] = [];
  righe.forEach((r, i) => {
    // Il numero della riga da solo non basta: il computo numera le proprie
    // voci con criteri suoi, la descrizione dice di quale riga si parla.
    const descrizione = r.descrizione.trim();
    const prefisso = descrizione ? `Riga ${i + 1} «${descrizione}»` : `Riga ${i + 1}`;
    const { gruppo } = gruppoPerCategoria(r.categoria);
    if (gruppo) {
      const avviso = avvisoVoce(r.tipologia, gruppo, "senza voce DEI il computo resterà incompleto.");
      if (avviso) avvisi.push(`${prefisso}: ${avviso}`);
    }
    if (r.oscuranteIntegrato) {
      const avviso = avvisoVoce(
        r.oscuranteTipologia,
        gruppoPerOscurante(r.oscuranteIntegrato),
        "oscurante senza voce DEI."
      );
      if (avviso) avvisi.push(`${prefisso}: ${avviso}`);
    }
  });
  return avvisi;
}

export function rigaDaLegacy(p: RigaLegacy): RigaForm {
  return {
    ...rigaVuota("altro"),
    descrizione: p.nome,
    // Categoria «altro»: la tipologia resta il testo libero del prodotto
    // legacy («PVC»), mostrato in un campo libero. Diventerà un codice DEI
    // quando l'operatore sceglierà la categoria vera — che azzera il campo.
    tipologia: p.tipologia,
    quantita: Math.max(1, p.quantita),
    note: [p.dimensioni, p.note].filter(Boolean).join(" · ") || null,
    origine: "prodotto_legacy",
  };
}

/** Riga salvata → riga del form: solo i campi che il form rimanda indietro. */
export function rigaDaServer(r: RigaContratto): RigaForm {
  return {
    chiave: `r-${r.id}`,
    id: r.id,
    categoria: r.categoria,
    tipologia: r.tipologia,
    oscuranteIntegrato: r.oscuranteIntegrato,
    oscuranteTipologia: r.oscuranteTipologia,
    descrizione: r.descrizione,
    quantita: r.quantita,
    larghezzaMm: r.larghezzaMm,
    altezzaMm: r.altezzaMm,
    misuraDei: r.misuraDei,
    prezzoUnitCent: r.prezzoUnitCent,
    prezzoTotCent: r.prezzoTotCent,
    beneSignificativo: r.beneSignificativo,
    accessori: r.accessori.map(a => ({ ...a })),
    note: r.note,
    origine: r.origine,
    evidenza: r.evidenza,
  };
}
