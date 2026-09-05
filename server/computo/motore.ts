// server/computo/motore.ts
// Il computo dei limiti di spesa (DM MITE 14/02/2022) come funzione pura:
// righe + parametri + tariffe → voci con limite. Nessun I/O, nessun prezzo
// nel codice. Ogni formula cita la cella del foglio «CALCOLO NUOVI
// LIMITI.xlsx» da cui è trascritta (specifica: docs/superpowers/specs/
// 2026-09-03-limiti-analisi-fogli-reali.md); le tre commesse reali della
// fixture sono il giudice.
//
// CHECK1 (Allegato A): massimali €/mq per gruppo e zona + controtelai + opere
// incluse. CHECK2 (opere compiute): listino DEI per riga (prodotto + accessori
// + oscurante abbinato) + controtelai + le stesse opere tranne quelle già nel
// prezzo DEI. Limite = il minore. Una riga senza voce DEI rende CHECK2 non
// calcolabile: limite = CHECK1, esito «incompleto» (fail-closed).
import { euroToCent } from "@shared/euroCent";
import {
  gruppoPerCategoria,
  gruppoPerOscurante,
  type CodiceOpera,
  type DetrazioneTipo,
  type EsitoComputo,
  type OpzioniComputo,
  type PattuitoTipo,
  type RigaContratto,
  type VoceComputo,
  type ZonaClimatica,
} from "@shared/limiti/tipi";
import { aggrega } from "./aggregati";
import {
  accessorio,
  massimaleEuroMq,
  prodotto,
  voceControtelaio,
  voceOpera,
  type Accessorio,
  type Coefficienti,
  type Prodotto,
  type Tariffe,
} from "./tariffe";

export type RigaMotore = Pick<
  RigaContratto,
  | "categoria" | "tipologia" | "oscuranteIntegrato" | "oscuranteTipologia" | "descrizione"
  | "quantita" | "larghezzaMm" | "altezzaMm" | "mq" | "misuraDei" | "prezzoTotCent"
  | "beneSignificativo" | "accessori"
>;

export type ParametriMotore = {
  zona: ZonaClimatica | null;
  piano: number | null;
  distanzaKm: number | null;
  pattuitoCent: number;
  pattuitoTipo: PattuitoTipo;
  detrazioneTipo: DetrazioneTipo;
  detrazionePct: number | null;
  opzioni: OpzioniComputo;
};

export type EsitoMotore = {
  voci: VoceComputo[];
  check1Cent: number;
  check2Cent: number | null;
  deiProdottiCent: number | null;
  limiteCent: number;
  esito: EsitoComputo;
  avvertenze: string[];
  detraibileCent: number | null;
  detrazioneStimataCent: number | null;
};

const arrotonda = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Mq del telo di un avvolgibile (CHECK2 BS): i mq della riga più il cassonetto,
 * che aggiunge 25 cm di telo su tutta la LARGHEZZA, e le guide, 5 cm su tutta
 * l'ALTEZZA. La maggiorazione è una volta per riga, non per pezzo, come nel
 * foglio; il minimo di fatturazione della voce si applica dopo.
 */
function mqAvvolgibile(mq: number, l: number, h: number, c: Coefficienti): number {
  if (mq <= 0) return 0;
  return (
    mq +
    c.avvolgibileExtraLarghezza * (l / 1000 + c.avvolgibileExtraLarghezzaOffset) +
    c.avvolgibileExtraAltezza * (h / 1000 + c.avvolgibileExtraAltezzaOffset)
  );
}

/** Perimetro per i coprifili (CHECK2 colonne T/W): portefinestre L + 2H, finestre 2(L + H). Metri. */
function perimetroM(p: Prodotto, l: number, h: number): number {
  return p.portafinestra ? (l + 2 * h) / 1000 : (2 * (l + h)) / 1000;
}

/**
 * L'accessorio vale per questo prodotto? Stessi predicati di `accessoriPer`
 * (`tariffe.ts`): famiglia compatibile e, se marcato, solo portefinestre.
 */
function accessorioApplicabile(a: Accessorio, p: Prodotto): boolean {
  return (
    (a.famiglie.length === 0 || a.famiglie.includes(p.famiglia)) &&
    (!a.soloPortafinestra || p.portafinestra === true)
  );
}

/** Costo di un accessorio secondo la regola del foglio (analisi §2.3). */
function costoAccessorio(
  a: Accessorio,
  prezzoUnit: number,
  mqEff: number,
  quantita: number,
  nAnte: number,
  perimetro: number
): number {
  switch (a.regola) {
    case "pct_mq": return (a.valore / 100) * prezzoUnit * mqEff;
    case "pct_pezzo": return (a.valore / 100) * prezzoUnit * quantita;
    case "cad_pezzo": return a.valore * a.moltiplicatore * quantita;
    case "cad_anta": return a.valore * nAnte * quantita;
    case "cad_fisso": return a.valore;
    case "m_perimetro": return a.valore * perimetro * quantita;
  }
}

type DeiRiga = {
  euro: number;
  /** Prodotto davvero applicato: per i cassonetti è la classe scelta, non la tipologia indicata. */
  codiceDei: string;
  descrizione: string;
  prezzoUnit: number;
  unita: Prodotto["unita"];
  dettaglio: VoceComputo["dettaglio"];
};

/**
 * Voce DEI «opere compiute» della riga (CHECK2, blocchi «Calcolo Automatici»):
 * prodotto × misura + accessori + oscurante abbinato × mq + suoi accessori.
 * null se la riga non ha un prodotto di catalogo (o l'oscurante non ce l'ha).
 */
function deiRiga(r: RigaMotore, t: Tariffe, avvertenze: string[], n: number): DeiRiga | null {
  const { gruppo, famiglia } = gruppoPerCategoria(r.categoria);
  if (!gruppo) return null;
  const p = r.tipologia ? prodotto(t, r.tipologia) : null;
  if (!p || p.gruppo !== gruppo) {
    avvertenze.push(`Riga ${n} «${r.descrizione}»: nessuna voce DEI per ${r.categoria}/${r.tipologia ?? "tipologia vuota"} — CHECK2 non calcolabile.`);
    return null;
  }
  // Quando la categoria fissa anche la famiglia (pvc, alluminio, legno), un
  // codice di un'altra famiglia sarebbe prezzato con il listino sbagliato:
  // la riga vale come senza voce DEI (fail-closed), non «quasi giusta».
  // Le finestre da tetto («velux») stanno nel blocco PVC del foglio e nel
  // capitolo PVC del DEI: una riga serramento_pvc può portarle (fogli reali
  // 2025 e 2022, fase 1 del 06/09/2026).
  const famigliaCompatibile = !famiglia || p.famiglia === famiglia || (famiglia === "pvc" && p.famiglia === "velux");
  if (!famigliaCompatibile) {
    avvertenze.push(`Riga ${n} «${r.descrizione}»: la tipologia ${p.codice} è di famiglia ${p.famiglia}, la categoria richiede ${famiglia} — CHECK2 non calcolabile.`);
    return null;
  }
  const c = t.coefficienti;
  const l = r.larghezzaMm ?? 0;
  const h = r.altezzaMm ?? 0;
  const q = r.quantita;
  const mq = r.mq;
  const dettaglio: VoceComputo["dettaglio"] = { codiceDei: p.codice, prezzoDei: p.prezzo, mq: arrotonda(mq, 4) };
  let euro = 0;
  let mqEff = mq;
  let applicato: Prodotto = p;

  switch (p.gruppo) {
    case "serramento":
    case "portoncino":
    case "persiana":
    case "scuro":
    case "schermatura": {
      // Minimo di fatturazione sul TOTALE della riga (colonna I), solo dove il foglio lo applica (PVC/alluminio).
      if (p.minimoMq && mq > 0 && mq < p.minimoMq) mqEff = p.minimoMq;
      euro = p.prezzo * mqEff;
      break;
    }
    case "avvolgibile": {
      const mqAvv = mqAvvolgibile(mq, l, h, c);
      mqEff = p.minimoMq && mqAvv > 0 && mqAvv < p.minimoMq ? p.minimoMq : mqAvv;
      euro = p.prezzo * mqEff;
      break;
    }
    case "cassonetto": {
      // AZ: la classe si sceglie per mq/pezzo dentro la SERIE della voce
      // indicata (il codice DEI prima del «-»): la stessa famiglia porta serie
      // diverse con gli stessi intervalli e prezzi diversi (C25095/C25096).
      const mqPezzo = q > 0 ? mq / q : 0;
      const serie = p.codice.split("-")[0];
      const classe = p.unita === "cad"
        ? t.prodotti.find(x => x.gruppo === "cassonetto" && x.famiglia === p.famiglia && x.codice.split("-")[0] === serie && x.mqPezzoMin != null && mqPezzo >= x.mqPezzoMin && (x.mqPezzoMax == null || mqPezzo < x.mqPezzoMax))
        : null;
      if (p.unita === "cad" && !classe) {
        // Gli intervalli del monoblocco hanno buchi: si dice, non si indovina.
        avvertenze.push(`Riga ${n} «${r.descrizione}»: nessuna classe di cassonetto copre ${arrotonda(mqPezzo, 4)} mq/pezzo, usata la voce scelta ${p.codice}.`);
      }
      const scelto = classe ?? p;
      if (scelto.unita === "cad") {
        mqEff = q;
      } else {
        // Voci a metro (C25094): la misura DEI è l'unico input, mai i mq.
        if (r.misuraDei == null) avvertenze.push(`Riga ${n} «${r.descrizione}»: misura DEI mancante, limite zero.`);
        mqEff = r.misuraDei ?? 0;
      }
      euro = scelto.prezzo * mqEff;
      applicato = scelto;
      dettaglio.voceScelta = scelto.codice;
      dettaglio.prezzoVoceScelta = scelto.prezzo;
      dettaglio.mqPezzo = arrotonda(mqPezzo, 4);
      break;
    }
    case "porta_blindata": {
      euro = p.prezzo * q;
      mqEff = q;
      break;
    }
  }
  dettaglio.mqFatturati = arrotonda(mqEff, 4);
  dettaglio.base = arrotonda(euro, 2);

  // Oscurante abbinato (blocco B/F): prodotto DEI a sé, × mq del serramento (senza minimo) o formula avvolgibile.
  // Eccezione del cassonetto: nel blocco B `oscuranteIntegrato` dice a quale
  // gruppo appartiene la riga (massimale B), non che qui vada prezzata una
  // seconda tapparella — quella è già la voce DEI della riga del serramento, e
  // il foglio fa lo stesso (la colonna «Limite Costo» di quella riga è il solo
  // cassonetto). Su ogni altro gruppo un oscurante senza voce DEI resta
  // fail-closed: CHECK2 non calcolabile.
  let po: Prodotto | null = null;
  const cassonettoAbbinato = p.gruppo === "cassonetto" && r.oscuranteTipologia == null;
  if (r.oscuranteIntegrato && !cassonettoAbbinato) {
    const gruppoOsc = gruppoPerOscurante(r.oscuranteIntegrato);
    po = r.oscuranteTipologia ? prodotto(t, r.oscuranteTipologia) : null;
    if (!po || po.gruppo !== gruppoOsc) {
      avvertenze.push(`Riga ${n} «${r.descrizione}»: oscurante ${r.oscuranteIntegrato} senza voce DEI (${r.oscuranteTipologia ?? "vuota"}) — CHECK2 non calcolabile.`);
      return null;
    }
    let mqOsc = mq;
    if (po.gruppo === "avvolgibile") {
      const mqAvv = mqAvvolgibile(mq, l, h, c);
      mqOsc = po.minimoMq && mqAvv > 0 && mqAvv < po.minimoMq ? po.minimoMq : mqAvv;
    }
    const euroOsc = po.prezzo * mqOsc;
    euro += euroOsc;
    dettaglio.oscurante = po.codice;
    dettaglio.oscuranteMq = arrotonda(mqOsc, 4);
    dettaglio.oscuranteBase = arrotonda(euroOsc, 2);
  }

  // Le finestre da tetto («velux») non prendono gli accessori del blocco PVC
  // (coprifili, ribalta): nei fogli reali la riga vale prodotto × mq e basta,
  // anche quando le caselle degli accessori restano spuntate (fase 1, 06/09/2026).
  const accessoriApplicabili = p.famiglia === "velux" ? [] : r.accessori;
  // Accessori: quelli del gruppo del prodotto si applicano al prodotto, quelli del gruppo dell'oscurante all'oscurante.
  const perimetro = perimetroM(p, l, h);
  for (const acc of accessoriApplicabili) {
    const a = accessorio(t, acc.codice);
    if (!a) {
      avvertenze.push(`Riga ${n}: accessorio «${acc.codice}» non in catalogo, ignorato nel CHECK2.`);
      continue;
    }
    // A quale prodotto si riferisce: il serramento o l'oscurante abbinato.
    const su = a.gruppo === p.gruppo ? p : po && a.gruppo === po.gruppo ? po : null;
    if (!su || !accessorioApplicabile(a, su)) {
      avvertenze.push(`Riga ${n}: accessorio «${a.nome}» non applicabile a «${(su ?? p).nome}», ignorato nel CHECK2.`);
      continue;
    }
    const extra = su === p
      ? costoAccessorio(a, p.prezzo, mqEff, acc.quantita, p.nAnte ?? 1, perimetro)
      : costoAccessorio(a, su.prezzo, dettaglio.oscuranteMq as number, acc.quantita, su.nAnte ?? 1, perimetro);
    euro += extra;
    dettaglio[`accessorio ${a.nome}`] = arrotonda(extra, 2);
  }

  return { euro, codiceDei: applicato.codice, descrizione: applicato.nome, prezzoUnit: applicato.prezzo, unita: applicato.unita, dettaglio };
}

export function calcolaLimiti(righe: RigaMotore[], p: ParametriMotore, t: Tariffe): EsitoMotore {
  const coeff = t.coefficienti;
  const a = aggrega(righe, coeff);
  const voci: VoceComputo[] = [];
  const avvertenze: string[] = [];
  let ordine = 0;
  let incompleto = false;
  const aggiungi = (v: Omit<VoceComputo, "ordine">) => voci.push({ ...v, ordine: ++ordine });

  // ── Prodotti, CHECK1 righe 6–8: massimale(zona) × mq del gruppo ──────────
  // H6 = E6 × (SERRAMENTI!H59 + EU59); H7 = E7 × (AM59 + GJ59); H8 = E8 × (CW59 + EK59).
  // I mq del massimale sono quelli del BLOCCO in cui sta la riga: un cassonetto
  // venduto col serramento è scritto nel blocco B e pesa 900 €/mq, non 780.
  const mqA = a.mq.serramenti + a.mq.cassonetti + a.mq.porteBlindate + a.mq.portoncini + a.mq.legno;
  const mqB = a.mq.serrTapp + a.mq.serrPers + a.mq.serrScuri + a.mq.cassonettiB + a.mq.portoncinoPers + a.mq.legnoTapp + a.mq.legnoPers + a.mq.legnoScuri;
  const mqC = a.mq.tapparelle + a.mq.persiane + a.mq.scuri + a.mq.veneziane + a.mq.tende + a.mq.pergole + a.mq.zanzariere;
  if (!p.zona) {
    incompleto = true;
    avvertenze.push("Zona climatica mancante: i massimali Allegato A valgono zero finché non è indicata.");
  }
  const gruppi: Array<["A" | "B" | "C", string, number]> = [
    ["A", "Serramenti, cassonetti, porte blindate (Allegato A)", mqA],
    ["B", "Serramenti + sistemi oscuranti (Allegato A)", mqB],
    ["C", "Oscuranti e schermature solari (Allegato A)", mqC],
  ];
  for (const [gruppo, descrizione, mq] of gruppi) {
    const euroMq = p.zona ? massimaleEuroMq(t, gruppo, p.zona) : 0;
    aggiungi({
      gruppo: "prodotti", codice: `massimale_${gruppo}`, descrizione, codiceDei: null, unita: "€/mq",
      prezzoUnitCent: euroToCent(euroMq), quantita: arrotonda(mq, 4), limiteCent: euroToCent(euroMq * mq),
      dettaglio: { zona: p.zona ?? "", mq: arrotonda(mq, 4), euroMq },
      inclusa: true, inCheck1: true, inCheck2: false,
    });
  }
  if (a.righeSenzaMisure > 0) {
    const quante = a.righeSenzaMisure === 1 ? "1 riga senza misure" : `${a.righeSenzaMisure} righe senza misure`;
    avvertenze.push(`${quante}: contate nei pezzi ma non nei mq.`);
  }

  // ── Controtelai, CHECK1 righe 11–18: prezzo × misura (min 1,2 mq acciaio/misto) ─
  let nControtelaio = 0;
  for (const r of righe) {
    if (r.categoria !== "controtelaio") continue;
    nControtelaio += 1;
    const v = r.tipologia ? voceControtelaio(t, r.tipologia) : null;
    if (!v) {
      incompleto = true;
      avvertenze.push(`Controtelaio «${r.descrizione}»: variante DEI non riconosciuta (${r.tipologia ?? "vuota"}).`);
      continue;
    }
    let misura = v.unita === "cad" ? r.quantita : (r.misuraDei ?? 0);
    if (v.unita !== "cad" && r.misuraDei == null) {
      avvertenze.push(`Controtelaio «${r.descrizione}»: misura DEI mancante, limite zero.`);
    }
    if (v.unita === "mq" && v.minimoMq && misura > 0 && misura < v.minimoMq) misura = v.minimoMq; // H13/H14
    aggiungi({
      gruppo: "controtelai", codice: `controtelaio_${nControtelaio}`, descrizione: `${v.famiglia} — ${v.variante}`,
      codiceDei: v.codice, unita: v.unita, prezzoUnitCent: euroToCent(v.prezzo), quantita: arrotonda(misura),
      limiteCent: euroToCent(v.prezzo * misura),
      dettaglio: { misuraDichiarata: r.misuraDei ?? r.quantita, misuraFatturata: arrotonda(misura) },
      inclusa: true, inCheck1: true, inCheck2: true,
    });
  }

  // ── Opere complementari, CHECK1 H22:H35 ──────────────────────────────────
  const n = a.n;
  const mq = a.mq;
  const nA = n.serramenti + n.cassonetti + n.porteBlindate + n.portoncini;          // SERRAMENTI!C59
  // I cassonetti del blocco B (T9/Z9) escono dal massimale A ma restano
  // cassonetti ovunque conti il prodotto: rilievo, rimozione, smaltimento.
  const mqCassonetti = mq.cassonetti + mq.cassonettiB;                                // R8 + Z9
  const nE = n.legno;                                                                 // EP59
  const nC = n.tapparelle + n.persiane + n.scuri;                                     // CR59
  const nD = n.veneziane + n.tende + n.pergole + n.zanzariere;                        // EF59
  const serramentiTutti = n.serramenti + n.legno + n.serrTapp + n.serrPers + n.serrScuri + n.legnoTapp + n.legnoPers + n.legnoScuri;
  const oreRilievoPezzo = nA / 8 + nE / 8 + n.serrTapp / 4 + n.legnoTapp / 4 + n.serrPers / 4 + n.legnoPers / 4 + n.cassonettiB / 8 + n.legnoScuri / 4 + n.serrScuri / 8 + nC / 8 + nD / 8 + n.portoncinoPers / 8 + 1; // H22
  const oreRilievoForo = serramentiTutti / 3 + 1;                                     // H23
  const oreProgettazione = a.nTotale / 2;                                            // H24
  const oreSviluppo = a.nTotale / 6 + 1 / 2;                                         // H25
  const oreProtezione = 0.5 * (n.serramenti + n.legno + n.serrTapp + n.serrPers + n.serrScuri + n.porteBlindate + n.portoncini + n.tapparelle + n.persiane + n.scuri + n.legnoTapp + n.legnoPers + n.legnoScuri + n.portoncinoPers); // H26
  const mqRimozioneSerr = mq.serramenti + mq.legno + 2 * mq.serrPers + mq.serrTapp + mq.serrScuri + mq.persiane + mq.scuri + mq.tapparelle + mq.porteBlindate + mq.portoncini + 2 * mq.legnoPers + mq.legnoTapp + mq.legnoScuri + 2 * mq.portoncinoPers; // H27
  const mqRimozioneTapp = mq.serrTapp + mqCassonetti + mq.tapparelle + mq.legnoTapp; // H28
  const mqSerrSmalt = mq.serramenti + mq.legno + mq.serrTapp + mq.serrPers + mq.serrScuri + mq.legnoTapp + mq.legnoPers + mq.legnoScuri + mq.porteBlindate + mq.portoncini + mq.portoncinoPers;
  const mqOscSmalt = mq.serrTapp + mq.serrPers + mq.serrScuri + mq.tapparelle + mq.persiane + mq.scuri;
  const mqSerrOneri = mqSerrSmalt - mq.legnoTapp - mq.legnoPers - mq.legnoScuri;
  const mqOscOneri = mqOscSmalt + mq.legnoTapp + mq.legnoPers + mq.legnoScuri;
  // H29 — la precedenza del foglio moltiplica 104,69 e 100 SOLO per il primo addendo. Si riproduce così (analisi §2.2, §5).
  const smaltimento =
    coeff.smaltimentoBaseEuro +
    coeff.smaltimentoEuroMc * coeff.smaltimentoMcSerramento * mqSerrSmalt +
    coeff.smaltimentoMcCassonetto * mqCassonetti +
    coeff.smaltimentoMcOscurante * mqOscSmalt +
    coeff.smaltimentoEuroOnere * coeff.smaltimentoOnereSerramento * mqSerrOneri +
    coeff.smaltimentoOnereCassonetto * mqCassonetti +
    coeff.smaltimentoOnereOscurante * mqOscOneri;
  const maggiorazione = p.piano != null && p.piano > coeff.maggiorazionePianoOltre ? coeff.maggiorazionePiano : 1; // H31
  if (p.distanzaKm == null) avvertenze.push("Distanza dal magazzino mancante: il limite del trasporto è zero.");

  const inclusa = (codice: CodiceOpera): boolean => {
    const o = voceOpera(t, codice);
    if (codice === "rilievo_foro") return p.opzioni.rilievo === "foro";
    if (codice === "rilievo_pezzo") return p.opzioni.rilievo === "pezzo";
    if (codice === "spese_professionali") return p.opzioni.speseProfessionali;
    if (o.gruppo === "eventuali") return p.opzioni.eventuali.includes(codice);
    return o.inclusaDefault;
  };
  const opera = (codice: CodiceOpera, quantita: number, euro: number, dettaglio: VoceComputo["dettaglio"]) => {
    const v = voceOpera(t, codice);
    aggiungi({
      gruppo: v.gruppo, codice, descrizione: v.descrizione, codiceDei: v.codiceDei, unita: v.unita,
      prezzoUnitCent: euroToCent(v.prezzo), quantita: arrotonda(quantita), limiteCent: euroToCent(Math.max(0, euro)), dettaglio,
      inclusa: inclusa(codice), inCheck1: true, inCheck2: !v.esclusaDaCheck2,
    });
  };
  const prezzo = (c: CodiceOpera) => voceOpera(t, c).prezzo;
  opera("rilievo_pezzo", oreRilievoPezzo, prezzo("rilievo_pezzo") * oreRilievoPezzo, { ore: arrotonda(oreRilievoPezzo) });
  opera("rilievo_foro", oreRilievoForo, prezzo("rilievo_foro") * oreRilievoForo, { ore: arrotonda(oreRilievoForo) });
  opera("progettazione", oreProgettazione, prezzo("progettazione") * oreProgettazione, { ore: arrotonda(oreProgettazione) });
  opera("sviluppo_ordine", oreSviluppo, prezzo("sviluppo_ordine") * oreSviluppo, { ore: arrotonda(oreSviluppo) });
  opera("protezione", oreProtezione, prezzo("protezione") * oreProtezione, { ore: arrotonda(oreProtezione) });
  opera("rimozione_serramenti", mqRimozioneSerr, prezzo("rimozione_serramenti") * mqRimozioneSerr, { mq: arrotonda(mqRimozioneSerr, 4) });
  opera("rimozione_tapparelle", mqRimozioneTapp, prezzo("rimozione_tapparelle") * mqRimozioneTapp, { mq: arrotonda(mqRimozioneTapp, 4) });
  opera("smaltimento", 1, smaltimento, { mqSerramenti: arrotonda(mqSerrSmalt, 4), mqCassonetti: arrotonda(mqCassonetti, 4), mqOscuranti: arrotonda(mqOscSmalt, 4), base: coeff.smaltimentoBaseEuro });
  opera("trasporto", p.distanzaKm ?? 0, p.distanzaKm == null ? 0 : 2 * p.distanzaKm * coeff.euroKm * a.giornatePosa, { km: p.distanzaKm ?? 0, giornate: a.giornatePosa, orePosa: arrotonda(a.orePosa) }); // H30
  opera("tiro_piano", a.oreTiro, coeff.installatori * prezzo("tiro_piano") * a.oreTiro * maggiorazione, { ore: arrotonda(a.oreTiro), piano: p.piano ?? 0, maggiorazione }); // H31
  opera("assistenza_muraria", a.larghezzaM, prezzo("assistenza_muraria") * a.larghezzaM, { metri: arrotonda(a.larghezzaM) }); // H32
  opera("posa", a.orePosa, a.orePosa * coeff.installatori * prezzo("posa"), { ore: arrotonda(a.orePosa), installatori: coeff.installatori }); // H33
  opera("pulizia", a.oreTiro, coeff.puliziaFissoEuro + a.oreTiro * prezzo("pulizia"), { ore: arrotonda(a.oreTiro), fisso: coeff.puliziaFissoEuro }); // H34
  // H35 = max(600; 4 % del fatturato). Prima della fattura la base è l'imponibile stimato del pattuito.
  const imponibileStimato = p.pattuitoTipo === "lordo" ? Math.round(p.pattuitoCent / (1 + coeff.ivaAgevolata)) : p.pattuitoCent;
  opera("spese_professionali", 1, Math.max(coeff.speseProfessionaliMinEuro, coeff.speseProfessionaliPct * (imponibileStimato / 100)), { base: imponibileStimato / 100, pct: coeff.speseProfessionaliPct, minimo: coeff.speseProfessionaliMinEuro, stima: true });

  // ── Servizi eventuali, CHECK1 H39:H43 ────────────────────────────────────
  const beniEuro = righe.filter(r => r.categoria !== "controtelaio").reduce((s, r) => s + (r.prezzoTotCent ?? 0), 0) / 100;
  opera("altri_servizi", beniEuro, beniEuro * coeff.altriServiziPct, { beni: beniEuro, pct: coeff.altriServiziPct }); // H39 (2 % dei prodotti)
  opera("assistenze_murarie_eventuali", 2 * a.nTotale, prezzo("assistenze_murarie_eventuali") * 2 * a.nTotale, { ore: 2 * a.nTotale }); // H40
  opera("dime", a.mqTotale, prezzo("dime") * a.mqTotale, { mq: arrotonda(a.mqTotale, 4) }); // H41
  opera("piattaforma", 1, prezzo("piattaforma"), { giornate: 1 }); // H42
  opera("permessi_suolo", 1, prezzo("permessi_suolo"), { giornate: 1 }); // H43

  // ── CHECK2: listino DEI «opere compiute» per riga (T6) ───────────────────
  let deiProdotti: number | null = 0;
  let iRiga = 0;
  for (const r of righe) {
    if (r.categoria === "controtelaio") continue;
    iRiga += 1;
    const { gruppo } = gruppoPerCategoria(r.categoria);
    if (!gruppo) continue; // porta_interna, accessorio, altro: senza voce DEI e senza blocco del CHECK2
    const d = deiRiga(r, t, avvertenze, iRiga);
    if (!d) {
      deiProdotti = null;
      continue;
    }
    if (deiProdotti != null) deiProdotti += d.euro;
    aggiungi({
      gruppo: "prodotti", codice: `dei_riga_${iRiga}`, descrizione: `${r.descrizione} — ${d.descrizione}`, codiceDei: d.codiceDei,
      unita: d.unita === "cad" ? "cad" : d.unita === "m" ? "m" : "mq",
      prezzoUnitCent: euroToCent(d.prezzoUnit), quantita: d.dettaglio.mqFatturati as number,
      limiteCent: euroToCent(d.euro), dettaglio: d.dettaglio, inclusa: true, inCheck1: false, inCheck2: true,
    });
  }

  // ── Totali (analisi §2.4) ────────────────────────────────────────────────
  const somma = (filtro: (v: VoceComputo) => boolean) => voci.filter(v => v.inclusa && filtro(v)).reduce((s, v) => s + v.limiteCent, 0);
  const check1Cent = somma(v => v.inCheck1);
  const deiProdottiCent = deiProdotti == null ? null : euroToCent(deiProdotti);
  const check2Cent = deiProdottiCent == null ? null : deiProdottiCent + somma(v => v.inCheck2 && v.gruppo !== "prodotti");
  if (check2Cent == null) incompleto = true;
  const limiteCent = check2Cent == null ? check1Cent : Math.min(check1Cent, check2Cent);

  // Detrazione: stima dell'imponibile dal pattuito (aliquota agevolata delle tariffe se lordo); il valore esatto arriva con la fattura (piano 2).
  let detraibileCent: number | null = null;
  let detrazioneStimataCent: number | null = null;
  if (p.detrazioneTipo !== "nessuna" && p.detrazionePct != null) {
    detraibileCent = Math.min(imponibileStimato, limiteCent);
    detrazioneStimataCent = Math.round((detraibileCent * p.detrazionePct) / 100);
  }

  return {
    voci, check1Cent, check2Cent, deiProdottiCent, limiteCent, esito: incompleto ? "incompleto" : "ok",
    avvertenze, detraibileCent, detrazioneStimataCent,
  };
}
