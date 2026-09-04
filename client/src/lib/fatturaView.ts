// Presentazione pura della fattura: badge di stato, raggruppamento delle
// righe per la tab, indicatore di limite per riga di servizio, riepilogo IVA
// vivo, esito dei controlli, quadratura delle scadenze, testo delle
// diciture, etichetta della tab e nome dei file scaricabili. Nessun calcolo
// di dominio: i numeri arrivano già fatti dal server (v. server/fatture/).
import type {
  Fattura,
  RigaFattura,
  StatoFattura,
  ScadenzaFattura,
  TipoRiga,
} from "@shared/fatturazione/tipi";
import { DICITURE, type ChiaveDicitura } from "@shared/fatturazione/diciture";
import { formatCent } from "./limitiView";

type Tono = "neutro" | "ok" | "attenzione" | "errore";

const BADGE_STATO: Record<
  Exclude<StatoFattura, "emessa">,
  { testo: string; tono: Tono }
> = {
  bozza: { testo: "Bozza", tono: "neutro" },
  in_emissione: { testo: "In emissione", tono: "attenzione" },
  inviata: { testo: "Inviata allo SdI", tono: "ok" },
  consegnata: { testo: "Consegnata", tono: "ok" },
  scartata: { testo: "Scartata dallo SdI", tono: "errore" },
  rifiutata: { testo: "Rifiutata dal cliente", tono: "errore" },
  mancata_consegna: { testo: "Mancata consegna", tono: "attenzione" },
  annullata: { testo: "Annullata", tono: "neutro" },
};

/** «emessa» è l'unico stato con una seconda forma (prova SdI): resta fuori dalla tabella sopra. */
export function badgeStatoFattura(
  stato: StatoFattura,
  inviataDryRun: boolean
): { testo: string; tono: Tono } {
  if (stato === "emessa") {
    return inviataDryRun
      ? { testo: "Emessa (prova SdI)", tono: "attenzione" }
      : { testo: "Emessa", tono: "ok" };
  }
  return BADGE_STATO[stato];
}

export type GruppoRigheView = {
  chiave: "beni" | "servizi" | "derivate" | "note";
  titolo: string;
  righe: RigaFattura[];
  totaleCent: number;
};

type ChiaveGruppoRighe = GruppoRigheView["chiave"];

const ORDINE_GRUPPI: ChiaveGruppoRighe[] = [
  "beni",
  "servizi",
  "derivate",
  "note",
];
const TITOLI_GRUPPO: Record<ChiaveGruppoRighe, string> = {
  beni: "Beni",
  servizi: "Servizi",
  derivate: "Voci derivate",
  note: "Note",
};
/** A quale gruppo appartiene un tipo di riga, per tutto tranne «intestazione» (v. sotto). */
const GRUPPO_DI_TIPO: Record<
  Exclude<TipoRiga, "intestazione">,
  ChiaveGruppoRighe
> = {
  bene: "beni",
  servizio: "servizi",
  markup: "derivate",
  storno_bs: "derivate",
  riaddebito_bs: "derivate",
  nota: "note",
};

/**
 * Il generatore mette le intestazioni prima del gruppo che introducono (due
 * prima dei beni, una «Prestazioni…» prima dei servizi) e il markup subito
 * dopo l'ultimo bene, prima della prossima intestazione: nel documento le
 * righe derivate (markup, storno, riaddebito) sono quindi sparse, non
 * contigue. Qui si ricompongono in un solo gruppo «derivate» e ogni
 * intestazione segue la prima riga non-intestazione che la segue nel
 * documento — cioè il gruppo che introduce davvero.
 */
export function raggruppaRighe(righe: RigaFattura[]): GruppoRigheView[] {
  const secchi: Record<ChiaveGruppoRighe, RigaFattura[]> = {
    beni: [],
    servizi: [],
    derivate: [],
    note: [],
  };

  righe.forEach((r, i) => {
    if (r.tipo === "intestazione") {
      const prossima = righe.slice(i + 1).find(x => x.tipo !== "intestazione");
      // Il generatore non produce un'intestazione senza seguito: il
      // fallback a «note» serve solo a non perdere righe su dati anomali.
      const chiave = prossima
        ? GRUPPO_DI_TIPO[prossima.tipo as Exclude<TipoRiga, "intestazione">]
        : "note";
      secchi[chiave].push(r);
    } else {
      secchi[GRUPPO_DI_TIPO[r.tipo]].push(r);
    }
  });

  return ORDINE_GRUPPI.flatMap(chiave => {
    const mie = secchi[chiave];
    if (mie.length === 0) return [];
    return [
      {
        chiave,
        titolo: TITOLI_GRUPPO[chiave],
        righe: mie,
        totaleCent: mie.reduce((s, r) => s + r.importoCent, 0),
      },
    ];
  });
}

/**
 * Il limite riguarda solo le righe di servizio legate a una voce del
 * computo: beni, markup e note non hanno un limite da rispettare, quindi
 * restano «n_a» con un indicatore vuoto invece di un badge sempre uguale.
 */
export function indicatoreLimite(r: RigaFattura): {
  stato: "ok" | "oltre" | "n_a";
  testo: string;
} {
  if (r.tipo !== "servizio" || r.limiteCent == null) {
    return { stato: "n_a", testo: "" };
  }
  if (r.importoCent <= r.limiteCent) {
    return {
      stato: "ok",
      testo: `entro il limite (${formatCent(r.limiteCent)})`,
    };
  }
  return {
    stato: "oltre",
    testo: `oltre il limite di ${formatCent(r.importoCent - r.limiteCent)}`,
  };
}

/**
 * Righe del riepilogo vivo: una per aliquota, IVA e totale complessivi,
 * markup (in rosso se negativo: i servizi hanno superato il pattuito, è un
 * errore bloccante lato server) e, solo quando c'è uno scarto, «Δ pattuito».
 * Il confronto col pattuito arriva già fatto dal server in
 * `deltaPattuitoCent`: qui si mostra la riga solo se lo scarto non è zero,
 * senza ricalcolarlo da `pattuitoCent`/`pattuitoTipo` (accettati per
 * completezza dell'input, non riusati: la fattura resta l'unica fonte).
 */
export function riepilogoView(
  f: Pick<
    Fattura,
    | "riepilogo"
    | "imponibileCent"
    | "ivaCent"
    | "totaleCent"
    | "deltaPattuitoCent"
    | "pattuitoCent"
    | "pattuitoTipo"
    | "markupCent"
  >
): Array<{
  etichetta: string;
  valore: string;
  tono?: "attenzione" | "errore";
}> {
  const righe: Array<{
    etichetta: string;
    valore: string;
    tono?: "attenzione" | "errore";
  }> = f.riepilogo.map(r => ({
    etichetta: `${r.aliquota} %`,
    valore: `${formatCent(r.imponibileCent)} / ${formatCent(r.impostaCent)}`,
  }));

  righe.push({ etichetta: "IVA", valore: formatCent(f.ivaCent) });
  righe.push({ etichetta: "Totale", valore: formatCent(f.totaleCent) });
  righe.push({
    etichetta: "Markup",
    valore: formatCent(f.markupCent),
    ...(f.markupCent < 0 ? { tono: "errore" as const } : {}),
  });

  if (f.deltaPattuitoCent !== 0) {
    righe.push({
      etichetta: "Δ pattuito",
      valore: formatCent(f.deltaPattuitoCent),
      tono: "attenzione",
    });
  }

  return righe;
}

export function riepilogoControlli(
  controlli: Array<{ esito: "ok" | "avviso" | "errore"; messaggio: string }>
): { errori: string[]; avvisi: string[]; ok: number } {
  return {
    errori: controlli.filter(c => c.esito === "errore").map(c => c.messaggio),
    avvisi: controlli.filter(c => c.esito === "avviso").map(c => c.messaggio),
    ok: controlli.filter(c => c.esito === "ok").length,
  };
}

export function sommaScadenzeCent(s: ScadenzaFattura[]): number {
  return s.reduce((tot, x) => tot + x.importoCent, 0);
}

export function scadenzeQuadrano(
  s: ScadenzaFattura[],
  totaleCent: number
): boolean {
  return sommaScadenzeCent(s) === totaleCent;
}

export function testoDicitura(chiave: string): string {
  return chiave in DICITURE
    ? DICITURE[chiave as keyof typeof DICITURE]
    : chiave;
}

/**
 * Le diciture che si scelgono in bozza (Ruling R28): solo quelle in calce al
 * documento. Le altre chiavi di `DICITURE` sono testi di riga — il generatore
 * le stampa come righe `intestazione` o `nota` al posto giusto (v.
 * `server/fatture/generatore.ts`) — e spuntarle qui le duplicherebbe in fondo
 * alla fattura, dove non hanno senso.
 */
export const DICITURE_SELEZIONABILI: ChiaveDicitura[] = [
  "intervento_manutenzione",
  "intervento_straordinaria",
  "bonifico_ristrutturazione",
  "bonifico_ecobonus",
  "indicare_cf",
  "copia_ade",
  "pagamento_50_40_10",
  "spese_professionali_escluse",
  "pratica_edilizia",
];

/** Stati che, senza scarti né bocciature, contano come «fattura emessa con successo». */
const STATI_EMESSA_PIU: ReadonlySet<StatoFattura> = new Set([
  "emessa",
  "inviata",
  "consegnata",
]);

/**
 * Riassume lo stato delle fatture di una commessa nell'etichetta della tab.
 * Precedenza: uno scarto/rifiuto da correggere vince su tutto (utente
 * distratto da un problema), poi una bozza ancora aperta (lavoro non
 * finito), poi il successo pieno. `tipo` è nella firma per lo stesso motivo
 * degli altri Pick sulla fattura: la tab può averne bisogno in futuro.
 */
export function etichettaTabFattura(
  fatture: Array<Pick<Fattura, "stato" | "tipo" | "inviataDryRun">> | undefined
): string {
  if (!fatture || fatture.length === 0) return "Fattura";
  if (fatture.some(f => f.stato === "scartata" || f.stato === "rifiutata"))
    return "Fattura !";
  if (fatture.some(f => f.stato === "bozza")) return "Fattura · bozza";
  if (fatture.some(f => STATI_EMESSA_PIU.has(f.stato))) return "Fattura ✓";
  return "Fattura";
}

export function nomeFileFattura(
  f: Pick<Fattura, "numero" | "tipo">,
  estensione: "pdf" | "xml"
): string {
  const prefisso = f.tipo === "nota_credito" ? "Nota di credito" : "Fattura";
  const corpo = f.numero ? f.numero.replace(/\//g, "-") : "bozza";
  return `${prefisso} ${corpo}.${estensione}`;
}

/**
 * IBAN italiano: stesso controllo di `server/fatture/config.ts`
 * `ibanValido` (formato IT + 2 cifre + 1 lettera + 22 alfanumerici, modulo
 * 97 ISO 7064), duplicato qui perché il client non importa da server/. Un
 * cambio all'algoritmo va applicato in entrambi i file.
 */
export function ibanSembraValido(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(s)) return false;
  const riordinato = s.slice(4) + s.slice(0, 4);
  const numerico = riordinato.replace(/[A-Z]/g, ch =>
    String(ch.charCodeAt(0) - 55)
  );
  let resto = 0;
  for (const cifra of numerico) resto = (resto * 10 + Number(cifra)) % 97;
  return resto === 1;
}
