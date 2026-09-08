// Worker dell'analisi azienda: una volta al giorno per sede (dalle 06:00
// ora di Roma), o su richiesta della direzione. Fail-closed: flag,
// provider governato; senza provider la sintesi è deterministica.

import { TZDate } from "@date-fns/tz";
import { tarsAttivo } from "../../platform/interruttori";
import { getCommesseStore } from "../../routers/commesse";
import { getInterventiStore } from "../../routers/interventi";
import { sediAttiveDelTenant } from "../../routers/sedi";
import { getTicketStore } from "../../routers/ticket";
import { tenantCorrente } from "../../tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../../tenants/costanti";
import { perOgniTenantAttivo } from "../../tenants/giri";
import { creaProviderPerRun, statoProvider } from "../costi/providerGovernato";
import type { TarsProvider } from "../provider";
import { analisiDeterministica, analizzaConModello, modelloAnalisi } from "./analisi";
import {
  GIORNI_MEMORIA_SCARTATE,
  giornoDiInizio,
  riscontroPerFonte,
  scartateRecenti,
  testoRiscontro,
} from "./riscontro";
import { correttivi } from "./correttivi";
import { contestoDiIndagine } from "./indagine";
import { conDestinatari, type DipendenzeDestinatari } from "./destinatari";
import { costruisciFotografia, giornoLocale, type DipendenzeFotografia } from "./fotografia";
import { repositoryAnalisiCorrente, type RepositoryAnalisiAzienda } from "./repository";
import { VERSIONE_ANALISI_AZIENDA, type RecordAnalisiAzienda } from "./types";

/** Utente di sistema delle chiamate in background (stesso dello smistamento). */
const UTENTE_SISTEMA = 0;
const ORA_MINIMA_LOCALE = 6;
const INTERVALLO_MS = 5 * 60 * 1000;
/** Un'analisi in errore si ritenta da sola dopo mezz'ora, al massimo tre volte al giorno. */
export const RITENTO_ERRORE_MS = 30 * 60 * 1000;
export const TENTATIVI_MASSIMI = 3;

export type DipendenzeAnalisi = {
  repository: RepositoryAnalisiAzienda;
  provider: (sedeId: number) => TarsProvider | null;
  modello: string;
  fotografia?: DipendenzeFotografia;
  /** Chi ha in carico la commessa e il ticket: serve a indirizzare le proposte. */
  destinatari: DipendenzeDestinatari;
  sedi: () => number[];
  now: () => Date;
};

export function analisiAziendaAttiva(): boolean {
  return tarsAttivo("tarsProactive") && tarsAttivo("tarsAnalisiAzienda");
}

export function dipendenzeAnalisiReali(): DipendenzeAnalisi {
  const modello = modelloAnalisi();
  return {
    repository: repositoryAnalisiCorrente(),
    destinatari: {
      commessa: id => (getCommesseStore() as any[]).find(c => c.id === id) ?? null,
      ticket: id => (getTicketStore() as any[]).find(t => t.id === id) ?? null,
    },
    provider: sedeId => {
      if (statoProvider(modello).tipo !== "openai") return null;
      return creaProviderPerRun({
        modello,
        sedeId,
        utenteId: UTENTE_SISTEMA,
        copioneFinto: () => ({
          tipo: "messaggio",
          testo: "{}",
          uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
        }),
        classe: "analisi_azienda",
      });
    },
    modello,
    // Il tick chiama questa funzione dentro perOgniTenantAttivo: il tenant
    // nel contesto è quello del giro corrente. Fuori da un giro (chiamata
    // diretta, script) ricade sul tenant predefinito, come tenantCorrente().
    sedi: () => sediAttiveDelTenant(tenantCorrente() ?? TENANT_PREDEFINITO_ID).map(s => s.id),
    now: () => new Date(),
  };
}

/** Genera (o rigenera) l'analisi di oggi per la sede e la salva. Non lancia: registra l'errore. */
export async function generaAnalisiAzienda(input: {
  sedeId: number;
  richiestaDa: number | null;
  deps?: DipendenzeAnalisi;
}): Promise<RecordAnalisiAzienda> {
  const deps = input.deps ?? dipendenzeAnalisiReali();
  const adesso = deps.now();
  const giorno = giornoLocale(adesso);
  try {
    // I contatori dell'ultima analisi: servono alla sezione «cosa è
    // cambiato». Se non c'è (prima analisi della sede) la sezione non
    // nasce — un confronto con il nulla non è un confronto.
    const ultima = await deps.repository.ultima(input.sedeId);
    const fotografia = await costruisciFotografia({
      sedeId: input.sedeId,
      adesso,
      deps: deps.fotografia,
      contatoriPrecedenti: ultima?.esito?.contatori ?? null,
    });
    // Le proposte rifiutate NON tornano il giorno dopo (04/09: «le proposte
    // di Tars sono inutili, se le rifiuto rimangono lì»). Fino all'08/09 la
    // memoria durava un giorno solo: adesso guarda indietro due settimane,
    // e nello stesso giro misura quali sezioni producono proposte che la
    // direzione accetta davvero (punti 4 e 12 del piano 08/09/2026).
    const recenti = await deps.repository.recenti(
      input.sedeId,
      giornoDiInizio(giorno)
    );
    const scartate = scartateRecenti(recenti);
    if (scartate.length > 0) {
      fotografia.sezioni.push({
        chiave: "proposte_scartate",
        titolo: `Già scartate dalla direzione negli ultimi ${GIORNI_MEMORIA_SCARTATE} giorni (NON riproporle, nemmeno riformulate)`,
        fatti: scartate.slice(0, 15).map((p, i) => ({
          chiave: `scartata:${i}`,
          testo: `${p.giorno}${p.fonte ? ` [${p.fonte}]` : ""}: ${p.testo}`,
          entita: [],
          link: null,
        })),
      });
    }
    // Cosa hai fatto invece (punto 24): le proposte rifiutate che poi si
    // sono avverate in un altro modo. È il segnale più forte che esista.
    const diversi = correttivi(recenti, {
      commessa: id => (getCommesseStore() as any[]).find(c => c.id === id) ?? null,
      interventiDi: commessaId =>
        (getInterventiStore() as any[]).filter(
          i => i.commessaId === commessaId && i.stato !== "annullato"
        ),
    });
    if (diversi.length > 0) {
      fotografia.sezioni.push({
        chiave: "correttivi",
        titolo: "Cosa hai fatto invece (proposte rifiutate, poi avvenute in un altro modo)",
        fatti: diversi.slice(0, 8).map(c => ({
          chiave: c.chiave,
          testo: c.testo,
          entita: [`commessa:${c.commessaId}`],
          link: `/commesse/${c.commessaId}`,
        })),
      });
    }
    // Il consuntivo di ieri (punto 6): quante proposte, quante fatte,
    // quante scartate. Tars non chiudeva mai il cerchio.
    const ieri = [...recenti]
      .filter(r => r.giorno < giorno)
      .sort((a, b) => b.giorno.localeCompare(a.giorno))[0];
    if (ieri?.esito) {
      const totali = ieri.esito.proposte.length;
      const fatte = ieri.esito.proposte.filter(
        p => p.esecuzione && p.esecuzione.stato !== "scartata"
      ).length;
      const buttate = ieri.esito.proposte.filter(
        p => p.esecuzione?.stato === "scartata"
      ).length;
      if (totali > 0) {
        fotografia.sezioni.push({
          chiave: "consuntivo",
          titolo: "Ieri (com'è andata l'analisi precedente)",
          fatti: [
            {
              chiave: "consuntivo:ieri",
              testo: `Analisi del ${ieri.giorno}: ${totali} proposte, ${fatte} eseguite, ${buttate} scartate, ${totali - fatte - buttate} lasciate lì.`,
              entita: [],
              link: null,
            },
          ],
        });
      }
    }
    const riscontro = riscontroPerFonte(recenti);
    if (riscontro.length > 0) {
      fotografia.sezioni.push({
        chiave: "riscontro_proposte",
        titolo: "Cosa accetti e cosa scarti (dove conviene spendere i sei posti)",
        fatti: riscontro.map(riga => ({
          chiave: `riscontro:${riga.fonte}`,
          testo: testoRiscontro(riga),
          entita: [],
          link: null,
        })),
      });
    }
    // Due sedi, due liste, nessun confronto (punto 15): la direzione vede
    // due analisi e non sa quale delle due stia andando peggio.
    const altreSedi = deps.sedi().filter(s => s !== input.sedeId);
    if (altreSedi.length > 0) {
      const confronti: string[] = [];
      for (const altra of altreSedi.slice(0, 3)) {
        const sua = await deps.repository.ultima(altra);
        const suoi = sua?.esito?.contatori;
        if (!suoi) continue;
        const mie = fotografia.contatori;
        const differenze = CONTATORI_CONFRONTO_SEDI.filter(
          ([chiave]) =>
            typeof mie[chiave] === "number" &&
            typeof suoi[chiave] === "number" &&
            mie[chiave] !== suoi[chiave]
        ).map(([chiave, nome]) => `${nome} ${mie[chiave]} contro ${suoi[chiave]}`);
        if (differenze.length > 0) {
          confronti.push(`sede ${altra} (analisi del ${sua!.giorno}): ${differenze.join(", ")}`);
        }
      }
      if (confronti.length > 0) {
        fotografia.sezioni.push({
          chiave: "confronto_sedi",
          titolo: "Come sta l'altra sede (stessi conti, altro cantiere)",
          fatti: confronti.map((testo, i) => ({
            chiave: `confronto:${i}`,
            testo,
            entita: [],
            link: null,
          })),
        });
      }
    }
    const provider = deps.provider(input.sedeId);
    const esito = provider
      ? await analizzaConModello({
          fotografia,
          provider,
          modello: deps.modello,
          // Il salto (punto 19): l'analisi può leggere prima di proporre.
          contestoIndagine: contestoDiIndagine(input.sedeId),
          identita: {
            runId: `analisi:${input.sedeId}:${giorno}:${adesso.getTime()}`,
            passo: 0,
            tentativo: 1,
            conversazioneId: null,
          },
        })
      : analisiDeterministica(fotografia);
    // Ogni proposta al suo destinatario: derivato da sezione e assegnatario
    // con la stessa regola T6 della chat (punto 3 del piano 08/09/2026).
    const esitoIndirizzato = conDestinatari(esito, deps.destinatari);
    return await deps.repository.salva({
      sedeId: input.sedeId,
      giorno,
      versione: VERSIONE_ANALISI_AZIENDA,
      stato: "pronta",
      esito: esitoIndirizzato,
      errore: null,
      richiestaDa: input.richiestaDa,
      now: adesso,
    });
  } catch (errore) {
    const messaggio = errore instanceof Error ? errore.message.slice(0, 300) : "errore";
    console.error(`[tars.analisi] sede ${input.sedeId}: ${messaggio}`);
    return await deps.repository.salva({
      sedeId: input.sedeId,
      giorno,
      versione: VERSIONE_ANALISI_AZIENDA,
      stato: "errore",
      esito: null,
      errore: messaggio,
      richiestaDa: input.richiestaDa,
      now: adesso,
    });
  }
}

/**
 * I contatori che, se cambiano, meritano un'analisi nuova prima delle
 * quattro ore: non lo stato del mondo, ma i fatti che cambiano cosa c'è da
 * fare oggi (punto 5 del piano 08/09/2026 — «nessun evento la sveglia»).
 */
const CONTATORI_SVEGLIA: readonly string[] = [
  "fontiCieche",
  "merceInRitardo",
  "discordanzeCritiche",
  "ticketUrgenti",
  "impegniScaduti",
  "confermeOrdineDaArchiviareSubito",
  "pronteAlPassoSuccessivo",
];
/** Almeno mezz'ora fra due analisi, anche quando il mondo cambia in fretta. */
export const INTERVALLO_MINIMO_MS = 30 * 60 * 1000;

/**
 * Qualcosa è successo da quando l'analisi è stata fatta? Confronta i
 * contatori di allora con quelli di adesso: se un fatto che conta è
 * peggiorato, non si aspetta domani mattina.
 */
export function fattoNuovo(
  esistente: RecordAnalisiAzienda,
  contatoriOra: Record<string, number>
): string | null {
  const prima = esistente.esito?.contatori ?? {};
  for (const chiave of CONTATORI_SVEGLIA) {
    const adesso = contatoriOra[chiave];
    const allora = prima[chiave];
    if (typeof adesso !== "number" || typeof allora !== "number") continue;
    if (adesso > allora) return chiave;
  }
  return null;
}

/** Dopo tante ore l'analisi di oggi è vecchia: si rifà (direzione 04/09: «non ne ho più ricevute di nuove»). */
export const RIGENERA_DOPO_MS = 4 * 60 * 60 * 1000;

/** I pochi numeri che ha senso mettere a confronto fra due sedi. */
const CONTATORI_CONFRONTO_SEDI: ReadonlyArray<readonly [string, string]> = [
  ["preventiviFermi7", "preventivi fermi"],
  ["gateMancanti", "gate scoperti"],
  ["merceInRitardo", "consegne in ritardo"],
  ["piuLenteDelSolito", "lavori più lenti del solito"],
  ["fattureNonCollegate", "fatture non collegate"],
];
/** Se tutte le proposte sono state gestite (eseguite o scartate), la prossima arriva dopo mezz'ora. */
export const RIGENERA_SE_GESTITE_DOPO_MS = 30 * 60 * 1000;

/**
 * L'analisi di oggi va rifatta? Sì se è in errore ritentabile, se è
 * vecchia di più di quattro ore, o se ogni sua proposta è già stata
 * gestita da almeno mezz'ora: una lista di proposte scartate non è lavoro,
 * e senza rigenerazione la direzione non ne riceveva più fino al giorno
 * dopo (04/09/2026: «se le rifiuto rimangono lì e non ne ho più ricevute
 * di nuove»).
 */
export function analisiDaRifare(esistente: RecordAnalisiAzienda, adesso: Date): boolean {
  const eta = adesso.getTime() - esistente.generataAt.getTime();
  if (esistente.stato === "errore") {
    return esistente.tentativi < TENTATIVI_MASSIMI && eta >= RITENTO_ERRORE_MS;
  }
  if (eta >= RIGENERA_DOPO_MS) return true;
  const proposte = esistente.esito?.proposte ?? [];
  const tutteGestite = proposte.length > 0 && proposte.every(p => p.esecuzione != null);
  return tutteGestite && eta >= RIGENERA_SE_GESTITE_DOPO_MS;
}

/** Un giro: per ogni sede, se manca l'analisi di oggi (o va rifatta) ed è passata l'ora minima, la genera. */
export async function giroAnalisi(deps: DipendenzeAnalisi): Promise<{ generate: number[]; saltate: number[] }> {
  const adesso = deps.now();
  const locale = new TZDate(adesso, "Europe/Rome");
  const generate: number[] = [];
  const saltate: number[] = [];
  if (locale.getHours() < ORA_MINIMA_LOCALE) return { generate, saltate: deps.sedi() };
  const giorno = giornoLocale(adesso);
  for (const sedeId of deps.sedi()) {
    const esistente = await deps.repository.perGiorno(sedeId, giorno);
    if (esistente && !analisiDaRifare(esistente, adesso)) {
      // Il tempo non basta più da solo: se un fatto che conta è peggiorato
      // (una fonte muta, una consegna saltata, un ticket urgente), la
      // rifacciamo subito — con almeno mezz'ora di distanza dalla scorsa.
      const eta = adesso.getTime() - esistente.generataAt.getTime();
      let sveglia: string | null = null;
      if (eta >= INTERVALLO_MINIMO_MS) {
        try {
          const ora = await costruisciFotografia({
            sedeId,
            adesso,
            deps: deps.fotografia,
          });
          sveglia = fattoNuovo(esistente, ora.contatori);
        } catch {
          sveglia = null;
        }
      }
      if (!sveglia) {
        saltate.push(sedeId);
        continue;
      }
      console.info(`[tars] analisi sede ${sedeId} rifatta: «${sveglia}» è peggiorato`);
    }
    await generaAnalisiAzienda({ sedeId, richiestaDa: null, deps });
    generate.push(sedeId);
  }
  return { generate, saltate };
}

let timer: NodeJS.Timeout | null = null;
let inCorso = false;

export function startAnalisiAziendaWorker(): void {
  if (timer) return;
  const tick = async () => {
    if (inCorso || !analisiAziendaAttiva()) return;
    inCorso = true;
    try {
      const deps = dipendenzeAnalisiReali();
      await perOgniTenantAttivo("tars-analisi", async () => {
        await giroAnalisi(deps);
      });
    } catch (errore) {
      console.error("[tars.analisi] giro fallito:", errore instanceof Error ? errore.message : errore);
    } finally {
      inCorso = false;
    }
  };
  timer = setInterval(() => void tick(), INTERVALLO_MS);
  timer.unref?.();
  setTimeout(() => void tick(), 20_000).unref?.();
}

export function stopAnalisiAziendaWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
