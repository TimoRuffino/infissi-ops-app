// Confronto fra la bozza del CRM e la fattura vera emessa su Fatture in
// Cloud per la stessa commessa: dove la commercialista ha messo più o meno
// del CRM, voce per voce. Serve a imparare caso per caso (studio del
// 05/09/2026) senza rifare l'analisi a mano. Solo aritmetica: le righe FiC
// arrivano già lette dal client, la fattura dal repository.
import type { Fattura } from "@shared/fatturazione/tipi";
import type { RigaDocumentoFic } from "../fic/emissione";

/** Le voci del confronto: quelle del computo per i servizi, più le famiglie della fattura. */
export const VOCI_SERVIZIO_FIC: ReadonlyArray<[RegExp, string]> = [
  [/rilievo/i, "rilievo"],
  [/progettazione/i, "progettazione"],
  [/sviluppo ordine/i, "sviluppo_ordine"],
  [/protezione/i, "protezione"],
  // «Servizio di pulizia … e rimozione imballaggi»: la pulizia va letta prima della rimozione.
  [/pulizia/i, "pulizia"],
  [/rimozione.*(tapparell|cassonett)/i, "rimozione_tapparelle"],
  [/rimozione/i, "rimozione_serramenti"],
  [/smaltimento/i, "smaltimento"],
  [/trasporto e posa|trasporto.*posa in opera/i, "posa"],
  [/carico|tiro al piano|^trasporto\b/i, "tiro_piano"],
  [/assistenz[ae] murari/i, "assistenza_muraria"],
  [/posa in opera|\bposa\b/i, "posa"],
  [/elettricista|altri servizi/i, "altri_servizi"],
  [/piattaforma/i, "piattaforma"],
  [/permess/i, "permessi_suolo"],
  [/dime|centine/i, "dime"],
];

/** I codici del computo per gli stessi servizi (rilievo a foro o a pezzo sono la stessa voce in fattura). */
function voceComputoNormalizzata(codice: string | null): string | null {
  if (!codice) return null;
  if (codice === "rilievo_foro" || codice === "rilievo_pezzo") return "rilievo";
  if (codice === "trasporto") return "tiro_piano";
  return codice;
}

export type LatoConfronto = {
  beniSignificativiCent: number;
  beniAutonomiCent: number;
  speseCent: number;
  servizi: Record<string, number>;
  serviziCent: number;
  markupCent: number;
  stornoCent: number;
  imponibileCent: number;
  nonClassificate: string[];
};

const cent = (euro: number) => Math.round(euro * 100);

/** Classifica le righe di una fattura FiC con le stesse regole dello studio: testi pieni a zero, beni al 22 %, beni autonomi al 10 %, servizi per parola chiave, markup, storno, spese. */
export function classificaRigheFic(righe: RigaDocumentoFic[]): LatoConfronto {
  const lato: LatoConfronto = { beniSignificativiCent: 0, beniAutonomiCent: 0, speseCent: 0, servizi: {}, serviziCent: 0, markupCent: 0, stornoCent: 0, imponibileCent: 0, nonClassificate: [] };
  for (const r of righe) {
    const importo = cent(r.prezzoUnit * (r.quantita || 1));
    if (importo === 0) continue;
    const testo = r.descrizione;
    if (/mark-?up/i.test(testo)) { lato.markupCent += importo; lato.imponibileCent += importo; continue; }
    if (/detrazione per diversa imputazione/i.test(testo) && importo < 0) { lato.stornoCent += -importo; lato.imponibileCent += importo; continue; }
    if (/riaddebito/i.test(testo)) { lato.imponibileCent += importo; continue; }
    if (/spese professionali|documentazione|pratica enea|pratiche/i.test(testo)) { lato.speseCent += importo; lato.imponibileCent += importo; continue; }
    const voce = VOCI_SERVIZIO_FIC.find(([rx]) => rx.test(testo))?.[1];
    if (voce && r.aliquota === 10) { lato.servizi[voce] = (lato.servizi[voce] ?? 0) + importo; lato.serviziCent += importo; lato.imponibileCent += importo; continue; }
    if (importo > 0 && r.aliquota === 22) { lato.beniSignificativiCent += importo; lato.imponibileCent += importo; continue; }
    if (importo > 0 && r.aliquota === 10) { lato.beniAutonomiCent += importo; lato.imponibileCent += importo; continue; }
    lato.nonClassificate.push(`${r.aliquota ?? "?"} % ${(importo / 100).toFixed(2)} ${testo.slice(0, 60)}`);
    lato.imponibileCent += importo;
  }
  return lato;
}

/** Lo stesso spaccato per la fattura del CRM, dalle sue righe tipizzate. */
export function latoCrm(f: Pick<Fattura, "righe" | "imponibileCent" | "markupCent" | "stornoCent">): LatoConfronto {
  const lato: LatoConfronto = { beniSignificativiCent: 0, beniAutonomiCent: 0, speseCent: 0, servizi: {}, serviziCent: 0, markupCent: f.markupCent, stornoCent: f.stornoCent, imponibileCent: f.imponibileCent, nonClassificate: [] };
  for (const r of f.righe) {
    if (r.tipo === "bene") {
      if (r.voceComputoCodice === "spese_professionali") lato.speseCent += r.importoCent;
      else if (r.beneSignificativo) lato.beniSignificativiCent += r.importoCent;
      else lato.beniAutonomiCent += r.importoCent;
    } else if (r.tipo === "servizio") {
      const voce = voceComputoNormalizzata(r.voceComputoCodice) ?? VOCI_SERVIZIO_FIC.find(([rx]) => rx.test(r.descrizione))?.[1] ?? "altro";
      lato.servizi[voce] = (lato.servizi[voce] ?? 0) + r.importoCent;
      lato.serviziCent += r.importoCent;
    }
  }
  return lato;
}

export type VoceConfronto = { voce: string; etichetta: string; crmCent: number; ficCent: number; deltaCent: number };

const ETICHETTE: Record<string, string> = {
  beni_significativi: "Beni significativi (22 %)",
  beni_autonomi: "Beni autonomi (10 %)",
  spese: "Spese documentazione",
  servizi: "Servizi (totale)",
  markup: "Markup",
  storno: "Storno beni significativi",
  imponibile: "Imponibile",
  rilievo: "Rilievo", progettazione: "Progettazione", sviluppo_ordine: "Sviluppo ordine", protezione: "Protezione",
  rimozione_serramenti: "Rimozione serramenti", rimozione_tapparelle: "Rimozione tapparelle", smaltimento: "Smaltimento",
  tiro_piano: "Trasporto e tiro al piano", assistenza_muraria: "Assistenza muraria", posa: "Posa in opera", pulizia: "Pulizia",
  altri_servizi: "Altri servizi", piattaforma: "Piattaforma", permessi_suolo: "Permessi", dime: "Dime", altro: "Altri servizi manuali",
};

/** Le voci a confronto, nell'ordine in cui si leggono: blocchi, poi i singoli servizi presenti da almeno un lato. */
export function confrontaLati(crm: LatoConfronto, fic: LatoConfronto): VoceConfronto[] {
  const riga = (voce: string, crmCent: number, ficCent: number): VoceConfronto => ({ voce, etichetta: ETICHETTE[voce] ?? voce, crmCent, ficCent, deltaCent: ficCent - crmCent });
  const out: VoceConfronto[] = [
    riga("beni_significativi", crm.beniSignificativiCent, fic.beniSignificativiCent),
    riga("beni_autonomi", crm.beniAutonomiCent, fic.beniAutonomiCent),
    riga("spese", crm.speseCent, fic.speseCent),
    riga("servizi", crm.serviziCent, fic.serviziCent),
    riga("markup", crm.markupCent, fic.markupCent),
    riga("storno", crm.stornoCent, fic.stornoCent),
    riga("imponibile", crm.imponibileCent, fic.imponibileCent),
  ];
  const voci = [...new Set([...Object.keys(crm.servizi), ...Object.keys(fic.servizi)])];
  const ordine = ["rilievo", "progettazione", "sviluppo_ordine", "protezione", "rimozione_serramenti", "rimozione_tapparelle", "smaltimento", "tiro_piano", "assistenza_muraria", "posa", "pulizia", "altri_servizi", "piattaforma", "permessi_suolo", "dime", "altro"];
  voci.sort((a, b) => (ordine.indexOf(a) === -1 ? 99 : ordine.indexOf(a)) - (ordine.indexOf(b) === -1 ? 99 : ordine.indexOf(b)));
  for (const v of voci) out.push(riga(v, crm.servizi[v] ?? 0, fic.servizi[v] ?? 0));
  return out;
}
