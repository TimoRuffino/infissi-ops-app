// T4 — L'agenda dentro il CRM (D2, 03/09/2026): Tars legge il calendario
// (interventi CRM + eventi Google importati, finché esistono), sposta un
// intervento e lo segna fatto. «La commessa segue» ma MAI come effetto
// collaterale: l'esito consiglia la transizione (posa → finiture e saldo,
// rilievo → misure esecutive) e il modello chiama
// transizione_adiacente_commessa, dove vivono gate e Undo.

import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import {
  chiaveEvento,
  finestraMigrazione,
  pianoMigrazione,
  type EventoEsterno,
} from "../calendario/migrazione";
import { getCommessaById, getCommesseStore } from "../../routers/commesse";
import { getInterventiStore } from "../../routers/interventi";
import { getSquadreStore } from "../../routers/squadre";
import { tarsAttivo } from "../../platform/interruttori";
import { risolviEspressioneTempo } from "../tempo";
import {
  callerPer,
  evidenzaCommessa,
  fatto,
  motivoSicuro,
  nonEseguito,
} from "./comune";
import type {
  ContestoRun,
  EsitoAzione,
  EsitoLettura,
  EvidenzaTars,
  StrumentoTars,
} from "./tipi";

const FONTE_CRM = "CRM Ruffino Flow";

function assicuraL2(): void {
  if (!tarsAttivo("tarsL2Actions")) {
    throw new Error("FORBIDDEN: le azioni operative di Tars sono disattivate (kill switch).");
  }
}

function lettura<T>(input: {
  dati: T;
  evidenze?: EvidenzaTars[];
  omissioni?: string[];
}): EsitoLettura<T> {
  return {
    dati: input.dati,
    evidenze: input.evidenze ?? [],
    freschezza: new Date().toISOString(),
    fonteAutorevole: FONTE_CRM,
    omissioni: input.omissioni ?? [],
    versioniEntita: {},
  };
}

function giornoIso(d: Date): string {
  const locale = new TZDate(d, "Europe/Rome");
  const mm = String(locale.getMonth() + 1).padStart(2, "0");
  const dd = String(locale.getDate()).padStart(2, "0");
  return `${locale.getFullYear()}-${mm}-${dd}`;
}

/** «martedì prossimo» → data calendario Europe/Rome (stessa logica di pianifica_intervento). */
function dataDaQuando(quando: string, adesso: Date): { data: string; assunzioni: string[] } {
  const risoluzione = risolviEspressioneTempo(quando, adesso);
  if (risoluzione.tipo === "locale") {
    return { data: risoluzione.dataLocale, assunzioni: risoluzione.assunzioni };
  }
  return { data: giornoIso(new Date(risoluzione.iso)), assunzioni: risoluzione.assunzioni };
}

/** posa fatta → finiture e saldo; rilievo fatto → misure esecutive (D2). */
export function transizioneConsigliataPerTipo(tipo: string): string | null {
  if (tipo === "posa") return "finiture_saldo";
  if (tipo === "rilievo") return "misure_esecutive";
  return null;
}

const leggiAgenda: StrumentoTars = {
  nome: "leggi_agenda",
  versione: "1.0.0",
  categoria: "interventi",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  interruttore: "tars",
  descrizione:
    "L'agenda della sede: interventi del CRM (rilievi, pose, assistenze) e appuntamenti dei calendari Google importati, per giorno o settimana, filtrabili per squadra o commessa. Elenca anche le squadre disponibili. Gli eventi Google sono in sola lettura: si spostano solo gli interventi del CRM.",
  schemaInput: z
    .object({
      dal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      giorni: z.number().int().min(1).max(14).default(7),
      squadraId: z.number().int().positive().optional(),
      commessaId: z.number().int().positive().optional(),
    })
    .strict(),
  async esegui(contesto: ContestoRun, input: any) {
    const adesso = new Date();
    const dal = input.dal ?? giornoIso(adesso);
    const al = giornoIso(new Date(new Date(`${dal}T12:00:00`).getTime() + (input.giorni - 1) * 86_400_000));
    const squadre = (getSquadreStore() as any[])
      .filter(s => (s.sedeId ?? contesto.sedeId) === contesto.sedeId)
      .map(s => ({ id: s.id, nome: s.nome ?? `Squadra ${s.id}` }));
    const nomeSquadra = new Map(squadre.map(s => [s.id, s.nome]));
    const interventi = (getInterventiStore() as any[])
      .filter(i => i.sedeId === contesto.sedeId && i.stato !== "annullato")
      .filter(i => {
        const data = i.dataPianificata ?? i.data ?? null;
        return typeof data === "string" && data >= dal && data <= al;
      })
      .filter(i => (input.squadraId == null ? true : i.squadraId === input.squadraId))
      .filter(i => (input.commessaId == null ? true : i.commessaId === input.commessaId))
      .sort((a, b) =>
        `${a.dataPianificata ?? ""}${a.oraInizio ?? ""}`.localeCompare(
          `${b.dataPianificata ?? ""}${b.oraInizio ?? ""}`
        )
      )
      .map(i => {
        const commessa: any = i.commessaId ? getCommessaById(i.commessaId) : null;
        return {
          id: i.id,
          tipo: i.tipo,
          stato: i.stato,
          data: i.dataPianificata ?? i.data ?? null,
          oraInizio: i.oraInizio ?? null,
          oraFine: i.oraFine ?? null,
          squadraId: i.squadraId ?? null,
          squadra: i.squadraId != null ? (nomeSquadra.get(i.squadraId) ?? `Squadra ${i.squadraId}`) : null,
          commessaId: i.commessaId ?? null,
          commessa: commessa ? `${commessa.codice} — ${commessa.cliente}` : null,
          indirizzo: i.indirizzo ?? null,
          fonte: "crm" as const,
        };
      });
    // Gli appuntamenti Google importati, finché il calendario vive fuori:
    // stessa procedura del Planning, feed che può non rispondere.
    const omissioni: string[] = [];
    let esterni: any[] = [];
    try {
      const caller = await callerPer(contesto);
      esterni = ((await caller.externalCalendars.events({ from: dal, to: al })) as any[])
        .map(e => ({
          titolo: e.titolo,
          data: e.dataPianificata,
          oraInizio: e.oraInizio ?? null,
          oraFine: e.oraFine ?? null,
          luogo: e.location || null,
          calendario: e.sourceNome,
          fonte: "google" as const,
        }));
    } catch {
      omissioni.push("calendari Google importati non raggiungibili in questo momento");
    }
    return lettura({
      dati: {
        dal,
        al,
        interventi,
        appuntamentiGoogle: esterni,
        squadre,
      },
      evidenze: interventi.slice(0, 10).map(i => ({
        tipo: "entita" as const,
        riferimento: `intervento:${i.id}`,
        descrizione: `${i.tipo} il ${i.data}${i.commessa ? ` — ${i.commessa}` : ""}`,
      })),
      omissioni: [
        ...omissioni,
        "gli eventi Google sono in sola lettura: per spostarli si agisce su Google finché la migrazione non è decisa",
      ],
    });
  },
};

const spostaIntervento: StrumentoTars = {
  nome: "sposta_intervento",
  versione: "1.0.0",
  categoria: "interventi",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["intervento.plan"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Sposta un intervento del CRM: nuova data (parole dell'utente o YYYY-MM-DD), orari, squadra. Stessa procedura del calendario; la squadra richiede il permesso di assegnazione.",
  schemaInput: z
    .object({
      interventoId: z.number().int().positive(),
      quando: z.string().min(1).max(120).optional(),
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      oraInizio: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      oraFine: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      squadraId: z.number().int().positive().nullable().optional(),
      /** Chi esegue un rilievo: un utente con ruolo `tecnico_rilievi`. */
      tecnicoId: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "sposta_intervento";
    const corrente: any = (getInterventiStore() as any[]).find(
      i => i.id === input.interventoId && i.sedeId === contesto.sedeId
    );
    if (!corrente) return nonEseguito(nome, "Intervento non trovato in questa sede.");
    let data = input.data;
    const assunzioni: string[] = [];
    if (!data && input.quando) {
      try {
        const risolta = dataDaQuando(input.quando, new Date());
        data = risolta.data;
        assunzioni.push(...risolta.assunzioni);
      } catch {
        return nonEseguito(nome, `Non riesco a interpretare «${input.quando}»: indica una data precisa.`);
      }
    }
    if (
      !data &&
      input.oraInizio == null &&
      input.oraFine == null &&
      input.squadraId === undefined &&
      input.tecnicoId === undefined
    ) {
      return nonEseguito(nome, "Niente da spostare: indica data, orari o chi lo esegue.");
    }
    // Un rilievo lo fa un tecnico, il resto una squadra: il dominio azzera
    // il campo che non compete al tipo. Se lo lasciassimo passare in
    // silenzio, Tars direbbe «assegnato» e non lo sarebbe. Meglio dirlo.
    if (input.squadraId != null && corrente.tipo === "rilievo") {
      return nonEseguito(
        nome,
        "Un rilievo lo esegue un tecnico dei rilievi, non una squadra di posa: indica `tecnicoId`."
      );
    }
    if (input.tecnicoId != null && corrente.tipo !== "rilievo") {
      return nonEseguito(
        nome,
        `Un intervento di tipo «${corrente.tipo}» lo esegue una squadra di posa, non un tecnico dei rilievi: indica \`squadraId\`.`
      );
    }
    const prima = {
      data: corrente.dataPianificata ?? null,
      oraInizio: corrente.oraInizio ?? null,
      oraFine: corrente.oraFine ?? null,
      squadraId: corrente.squadraId ?? null,
      tecnicoId: corrente.tecnicoId ?? null,
    };
    try {
      const caller = await callerPer(contesto);
      const aggiornato: any = await caller.interventi.update({
        id: input.interventoId,
        ...(data ? { dataPianificata: data } : {}),
        ...(input.oraInizio != null ? { oraInizio: input.oraInizio } : {}),
        ...(input.oraFine != null ? { oraFine: input.oraFine } : {}),
        ...(input.squadraId !== undefined ? { squadraId: input.squadraId } : {}),
        ...(input.tecnicoId !== undefined ? { tecnicoId: input.tecnicoId } : {}),
      });
      const commessa: any = aggiornato.commessaId ? getCommessaById(aggiornato.commessaId) : null;
      return {
        ...fatto({
          strumento: nome,
          stato: "spostato",
          azioneId: `${nome}:intervento:${aggiornato.id}:${Date.now()}`,
          entitaToccate: [
            `intervento:${aggiornato.id}`,
            ...(aggiornato.commessaId ? [`commessa:${aggiornato.commessaId}`] : []),
          ],
          prima,
          dopo: {
            id: aggiornato.id,
            data: aggiornato.dataPianificata ?? null,
            oraInizio: aggiornato.oraInizio ?? null,
            oraFine: aggiornato.oraFine ?? null,
            squadraId: aggiornato.squadraId ?? null,
            tecnicoId: aggiornato.tecnicoId ?? null,
            link: "/planning",
          },
          evidenze: [
            {
              tipo: "entita",
              riferimento: `intervento:${aggiornato.id}`,
              descrizione: `${aggiornato.tipo} → ${aggiornato.dataPianificata ?? "stessa data"}`,
            },
            ...(commessa ? [evidenzaCommessa(commessa)] : []),
          ],
        }),
        assunzioni,
      };
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

const segnaInterventoFatto: StrumentoTars = {
  nome: "segna_intervento_fatto",
  versione: "1.0.0",
  categoria: "interventi",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["intervento.plan"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Segna un intervento come completato (stessa procedura del calendario). La commessa NON avanza da sola: l'esito consiglia la transizione (posa fatta → finiture e saldo; rilievo fatto → misure esecutive) e la esegui con transizione_adiacente_commessa, con gate e Undo.",
  schemaInput: z
    .object({
      interventoId: z.number().int().positive(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "segna_intervento_fatto";
    const corrente: any = (getInterventiStore() as any[]).find(
      i => i.id === input.interventoId && i.sedeId === contesto.sedeId
    );
    if (!corrente) return nonEseguito(nome, "Intervento non trovato in questa sede.");
    if (corrente.stato === "completato") {
      return nonEseguito(nome, "L'intervento è già segnato come completato.");
    }
    try {
      const caller = await callerPer(contesto);
      const aggiornato: any = await caller.interventi.updateStato({
        id: input.interventoId,
        stato: "completato",
      });
      const commessa: any = aggiornato.commessaId ? getCommessaById(aggiornato.commessaId) : null;
      const consigliata = commessa ? transizioneConsigliataPerTipo(aggiornato.tipo) : null;
      return fatto({
        strumento: nome,
        stato: "completato",
        azioneId: `${nome}:intervento:${aggiornato.id}:${Date.now()}`,
        entitaToccate: [
          `intervento:${aggiornato.id}`,
          ...(aggiornato.commessaId ? [`commessa:${aggiornato.commessaId}`] : []),
        ],
        prima: { stato: corrente.stato },
        dopo: {
          id: aggiornato.id,
          tipo: aggiornato.tipo,
          stato: aggiornato.stato,
          commessaId: aggiornato.commessaId ?? null,
          transizioneConsigliata:
            consigliata && commessa
              ? { commessaId: commessa.id, nuovoStato: consigliata }
              : null,
          link: "/planning",
        },
        evidenze: [
          {
            tipo: "entita",
            riferimento: `intervento:${aggiornato.id}`,
            descrizione: `${aggiornato.tipo} completato`,
          },
          ...(commessa ? [evidenzaCommessa(commessa)] : []),
        ],
        avvertenze:
          consigliata && commessa && commessa.stato !== consigliata
            ? [
                `${aggiornato.tipo === "posa" ? "Posa fatta" : "Rilievo fatto"}: la commessa può passare a «${consigliata}» — usa transizione_adiacente_commessa (gate e Undo normali).`,
              ]
            : [],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

const migraCalendarioGoogle: StrumentoTars = {
  nome: "migra_calendario_google",
  versione: "1.0.0",
  categoria: "interventi",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["intervento.plan"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Migrazione D2 (solo direzione): importa gli appuntamenti dei calendari Google collegati come interventi del CRM — storico dal 1° del mese di due mesi fa, più tutto il futuro in finestra. Rilanciabile: chi è già stato importato non si duplica. Con anteprima=true mostra il piano senza scrivere. La commessa si collega solo su match univoco (codice o cognome cliente nel titolo).",
  schemaInput: z
    .object({
      anteprima: z.boolean().default(false),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "migra_calendario_google";
    const finestra = finestraMigrazione(new Date());
    let eventi: EventoEsterno[];
    try {
      const caller = await callerPer(contesto);
      eventi = ((await caller.externalCalendars.events({
        from: finestra.da,
        to: finestra.a,
      })) as any[]).map(e => ({
        sourceId: e.sourceId,
        sourceNome: e.sourceNome,
        uid: e.id,
        titolo: e.titolo,
        location: e.location ?? null,
        dataPianificata: e.dataPianificata,
        oraInizio: e.oraInizio ?? null,
        oraFine: e.oraFine ?? null,
        allDay: Boolean(e.allDay),
      }));
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
    const esistenti = new Set<string>(
      (getInterventiStore() as any[])
        .filter(i => i.sedeId === contesto.sedeId)
        .map(i => i.origineEsterna)
        .filter((v: unknown): v is string => typeof v === "string")
    );
    const commesse = (getCommesseStore() as any[]).filter(
      c => c.sedeId === contesto.sedeId
    );
    const piano = pianoMigrazione({ eventi, commesse, esistenti });
    const senzaCommessa = piano.daCreare.filter(p => p.commessaId == null).length;
    if (input.anteprima) {
      return fatto({
        strumento: nome,
        stato: "anteprima",
        azioneId: `${nome}:anteprima:${Date.now()}`,
        entitaToccate: [],
        dopo: {
          finestra,
          eventiTrovati: eventi.length,
          daImportare: piano.daCreare.length,
          giaImportati: piano.giaImportati,
          senzaCommessa,
          esempi: piano.daCreare.slice(0, 6).map(p => ({
            titolo: p.titolo,
            data: p.data,
            tipo: p.tipo,
            commessaId: p.commessaId,
            motivoCommessa: p.motivoCommessa,
          })),
        },
        evidenze: [],
        avvertenze: ["Anteprima: nessun intervento creato. Rilancia senza anteprima per importare."],
      });
    }
    const caller = await callerPer(contesto);
    let creati = 0;
    let collegati = 0;
    const errori: string[] = [];
    const toccate: string[] = [];
    for (const p of piano.daCreare) {
      try {
        const intervento: any = await caller.interventi.create({
          commessaId: p.commessaId,
          tipo: p.tipo,
          dataPianificata: p.data,
          oraInizio: p.oraInizio,
          oraFine: p.oraFine,
          indirizzo: p.indirizzo ?? undefined,
          note: p.note,
          origineEsterna: p.chiave,
        });
        creati += 1;
        if (p.commessaId != null) collegati += 1;
        if (toccate.length < 15) toccate.push(`intervento:${intervento.id}`);
      } catch (errore) {
        if (errori.length < 3) errori.push(`${p.titolo} (${p.data}): ${motivoSicuro(errore)}`);
      }
    }
    return fatto({
      strumento: nome,
      stato: "migrato",
      azioneId: `${nome}:${finestra.da}:${Date.now()}`,
      entitaToccate: toccate,
      dopo: {
        finestra,
        creati,
        collegati,
        senzaCommessa: creati - collegati,
        giaImportati: piano.giaImportati,
        falliti: errori.length,
        link: "/planning",
      },
      evidenze: toccate.slice(0, 8).map(riferimento => ({
        tipo: "entita" as const,
        riferimento,
        descrizione: "importato da Google",
      })),
      avvertenze: [
        "Gli stessi appuntamenti ora compaiono due volte nel Planning (Google + CRM): verificato l'import, disattiva le sorgenti Google da Integrazioni.",
        ...(creati - collegati > 0
          ? [`${creati - collegati} interventi importati senza commessa: collegali con sposta/aggiorna o chiedimelo.`]
          : []),
        ...errori.map(e => `Non importato: ${e}`),
      ],
    });
  },
};

export const STRUMENTI_AGENDA: readonly StrumentoTars[] = [
  leggiAgenda,
  spostaIntervento,
  segnaInterventoFatto,
  migraCalendarioGoogle,
];
