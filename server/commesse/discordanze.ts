// Quando il documento e il dato non dicono la stessa cosa (punto 29 del
// piano `2026-09-08-tars-piu-intelligente`).
//
// Tars estrae già dalla conferma d'ordine il numero, l'imponibile e la data
// di consegna, e li usa per far nascere costo e merce. Non li ha mai
// CONFRONTATI con quello che il CRM sa già: la data a magazzino, il costo
// registrato, e soprattutto il giorno della posa. Ogni documento che entra
// è un'occasione di riscontro, e finora il riscontro serviva solo ad
// attaccare il file alla commessa.
//
// La discordanza che costa di più è una sola: la merce arriva dopo la posa.
//
// Deterministico e in sola lettura. Nessun importo nel testo: si dice che
// due numeri non coincidono, non quali sono (regola della fotografia).

import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { getCommesseStore } from "../routers/commesse";
import { getInterventiStore } from "../routers/interventi";
import { getMagazzinoStore } from "../routers/magazzino";
import { getArchivioFornitoriStore } from "../fornitori/archivio";

/** Sotto questo scarto due importi sono lo stesso importo (arrotondamenti). */
const TOLLERANZA_IMPORTO = 1;

export type GravitaDiscordanza = "critica" | "da_guardare";

export type Discordanza = {
  /** Chiave stabile: `commessa:12:merce_dopo_posa`. */
  chiave: string;
  commessaId: number;
  testo: string;
  gravita: GravitaDiscordanza;
  link: string;
};

export type DipendenzeDiscordanze = {
  commesse: () => any[];
  interventi: () => any[];
  magazzino: () => any[];
  archivio: () => any[];
};

export function dipendenzeDiscordanzeReali(): DipendenzeDiscordanze {
  return {
    commesse: () => getCommesseStore() as any[],
    interventi: () => getInterventiStore() as any[],
    magazzino: () => getMagazzinoStore() as any[],
    archivio: () => getArchivioFornitoriStore() as any[],
  };
}

function diSede(riga: any, sedeId: number): boolean {
  return (riga.sedeId ?? DEFAULT_SEDE_ID) === sedeId;
}

function etichetta(commessa: any): string {
  return `${commessa.codice ?? `Commessa ${commessa.id}`} — ${commessa.cliente ?? "cliente non indicato"}`;
}

function giorniFra(da: string, a: string): number {
  const t1 = Date.parse(`${da}T00:00:00Z`);
  const t2 = Date.parse(`${a}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 0;
  return Math.round((t2 - t1) / 86_400_000);
}

function riferimentoOrdine(valore: unknown): string {
  return String(valore ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Le contraddizioni fra quello che dicono i documenti e quello che dice il
 * CRM, per una sede. Sola lettura: non corregge niente, dice dove guardare.
 */
export function discordanzeDiSede(input: {
  sedeId: number;
  adesso: Date;
  deps?: DipendenzeDiscordanze;
}): Discordanza[] {
  const deps = input.deps ?? dipendenzeDiscordanzeReali();
  const { sedeId } = input;
  const oggi = input.adesso.toISOString().slice(0, 10);
  const discordanze: Discordanza[] = [];

  const commesse = new Map<number, any>(
    deps
      .commesse()
      .filter(c => diSede(c, sedeId) && !c.archivedAt && c.stato !== "archiviata")
      .map(c => [c.id, c])
  );

  // 1. La merce arriva dopo la posa. È la discordanza che costa: la squadra
  //    va in cantiere e il serramento non c'è.
  const pose = new Map<number, string>();
  for (const i of deps.interventi()) {
    if (!diSede(i, sedeId) || i.stato === "annullato" || i.tipo !== "posa") continue;
    const data = i.dataPianificata ?? null;
    if (!data || data < oggi) continue;
    const attuale = pose.get(i.commessaId);
    if (!attuale || data < attuale) pose.set(i.commessaId, data);
  }
  for (const p of deps.magazzino()) {
    if (!diSede(p, sedeId) || p.arrivato) continue;
    const posa = pose.get(p.commessaId);
    const commessa = commesse.get(p.commessaId);
    if (!posa || !commessa || !p.dataConsegna) continue;
    if (p.dataConsegna <= posa) continue;
    const giorni = giorniFra(posa, p.dataConsegna);
    discordanze.push({
      chiave: `commessa:${commessa.id}:merce_dopo_posa`,
      commessaId: commessa.id,
      testo: `${etichetta(commessa)}: la posa è il ${posa} ma «${p.nome}» di ${p.fornitore ?? "fornitore non indicato"} è data in arrivo il ${p.dataConsegna}, ${giorni} giorni dopo. O si sposta la posa, o si solleicita il fornitore.`,
      gravita: "critica",
      link: `/commesse/${commessa.id}`,
    });
  }

  // 2. La conferma e il magazzino non dicono la stessa data, o lo stesso
  //    importo. La riga a magazzino nasce dalla conferma: se divergono,
  //    qualcuno ha corretto a mano da una parte sola.
  for (const voce of deps.archivio()) {
    if (!diSede(voce, sedeId) || voce.commessaId == null) continue;
    const commessa = commesse.get(voce.commessaId);
    const lettura = voce.lettura ?? null;
    if (!commessa || !lettura) continue;
    const ordine = riferimentoOrdine(lettura.numeroOrdine);
    if (ordine.length < 3) continue;

    if (lettura.dataConsegna) {
      const riga = deps
        .magazzino()
        .find(
          p =>
            diSede(p, sedeId) &&
            p.commessaId === commessa.id &&
            riferimentoOrdine(p.numeroOrdine) === ordine &&
            p.dataConsegna != null
        );
      if (riga && riga.dataConsegna !== lettura.dataConsegna) {
        discordanze.push({
          chiave: `commessa:${commessa.id}:data_conferma_magazzino:${ordine}`,
          commessaId: commessa.id,
          testo: `${etichetta(commessa)}: la conferma ${lettura.numeroOrdine} dice consegna il ${lettura.dataConsegna}, a magazzino risulta il ${riga.dataConsegna}. Una delle due è vecchia.`,
          gravita: "da_guardare",
          link: `/commesse/${commessa.id}`,
        });
      }
    }

    if (typeof lettura.imponibile === "number" && lettura.imponibile > 0) {
      const costo = (Array.isArray(commessa.costi) ? commessa.costi : []).find(
        (c: any) => riferimentoOrdine(c.numeroOrdine) === ordine
      );
      if (
        costo &&
        typeof costo.importo === "number" &&
        Math.abs(costo.importo - lettura.imponibile) > TOLLERANZA_IMPORTO
      ) {
        discordanze.push({
          chiave: `commessa:${commessa.id}:costo_conferma:${ordine}`,
          commessaId: commessa.id,
          // Mai le cifre: si dice che non coincidono, si guardano dalla scheda.
          testo: `${etichetta(commessa)}: il costo registrato per l'ordine ${lettura.numeroOrdine} non è quello che dichiara la conferma. Uno dei due va corretto dalla scheda.`,
          gravita: "da_guardare",
          link: `/commesse/${commessa.id}`,
        });
      }
    }
  }

  const ordine: Record<GravitaDiscordanza, number> = { critica: 0, da_guardare: 1 };
  return discordanze.sort((a, b) => ordine[a.gravita] - ordine[b.gravita]);
}
