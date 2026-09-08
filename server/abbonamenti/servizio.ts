// server/abbonamenti/servizio.ts
// Unico punto che cambia stato a un abbonamento (spec WS4 §4). Ogni
// transizione lascia un evento; la sola lettura resta quella del WS1
// (`sospendi`/`riattiva` del tenant): qui si decide QUANDO, non COME.
//
// Ogni funzione che ragiona sul tempo riceve `adesso`: il worker (§4.1) e i
// comandi passano l'istante, i test lo scelgono. Niente `new Date()` sparso.
import { PRODOTTO } from "@shared/brand";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { getTenantRepository } from "../tenants/repository";
import { riattiva, sospendi } from "../tenants/servizio";
import { attoreTesto, type TipoEvento } from "../tenants/tipi";
import {
  GIORNI_AVVISO,
  GIORNI_PROVA,
  GIORNI_TOLLERANZA_INSOLUTO,
  MESSAGGI_ABBONAMENTO,
  TOLLERANZA_PREDEFINITA_GIORNI,
  budgetTarsPredefinitoEur,
  dataItaliana,
  eurInNano,
  giorniInteriFino,
  meseLocale,
} from "./costanti";
import { notificaAzienda } from "./notifiche";
import type { Abbonamento, Attore, Omaggio, StatoAbbonamento } from "./tipi";
import { providerCorrente, type EventoProvider } from "./provider";

const MS_GIORNO = 86_400_000;

/** Il worker degli abbonamenti e il seed agiscono senza un utente dietro. */
const SISTEMA: Attore = { tipo: "boot" };

/** Motivo dell'omaggio del tenant 1 (spec §4). */
const MOTIVO_PROPRIETARIA = "Ruffino Group, proprietaria della piattaforma";

/**
 * Da dove si proroga una prova. La spec (§4) nomina `trialing` e `past_due`;
 * `suspended` c'è perché il runbook di §9 riapre un'azienda in sola lettura
 * «con un omaggio o con una proroga», e perché lo stesso §4 chiede alla
 * proroga di riattivare il tenant se sospeso. Un `active` non ha nulla da
 * prorogare (si allunga con `concediOmaggio`), un `cancelled` è chiuso.
 */
const STATI_PROROGABILI: readonly StatoAbbonamento[] = ["trialing", "past_due", "suspended"];

function esistente(tenantId: number): Abbonamento {
  const a = getTenantRepository().abbonamentoDi(tenantId);
  if (!a) throw new Error(`Abbonamento del tenant ${tenantId} inesistente`);
  return a;
}

function nonIlTenant1(tenantId: number): void {
  if (tenantId === TENANT_PREDEFINITO_ID) throw new Error(MESSAGGI_ABBONAMENTO.tenant1Intoccabile);
}

async function evento(
  tenantId: number,
  tipo: TipoEvento,
  attore: Attore,
  dettagli: Record<string, unknown>,
  motivo: string | null = null
): Promise<void> {
  await getTenantRepository().registraEvento({
    tenantId,
    tipo,
    attore: attoreTesto(attore),
    motivo,
    dettagli,
  });
}

/**
 * La sola transizione di stato che esiste. Salva la riga sempre; registra
 * `abbonamento_stato` SOLO quando lo stato cambia davvero (R6): un omaggio
 * concesso a un abbonamento già `active` aggiorna la riga (nuova scadenza,
 * nuovo omaggio) ma non lascia un evento `{ da: "active", a: "active" }` —
 * la transizione vera, se c'è, è quella specifica (`abbonamento_omaggio`,
 * `abbonamento_prova_prorogata`, …).
 * Accende o spegne la sola lettura del WS1:
 * - entrando in `suspended`/`cancelled` sospende il tenant, se è ancora
 *   attivo, con il motivo prefissato `abbonamento: ` (R5) — un marcatore che
 *   dice «l'ha sospesa il dominio degli abbonamenti», non un giudizio sul
 *   perché (insoluto scaduto, disdetta a fine periodo, …);
 * - uscendone lo riattiva SOLO se il tenant era sospeso con quel marcatore:
 *   una sospensione decisa a mano dall'operatore (motivo qualunque, es.
 *   «insoluto da tre mesi, blocco io») non porta il prefisso, quindi non la
 *   disfa né un omaggio né una proroga.
 * Il motivo finisce nella colonna `motivo` dell'evento (il registro la mostra
 * per ogni tipo) e nei dettagli, dove la spec §3 lo vuole insieme a `da`/`a`.
 */
async function cambiaStato(
  a: Abbonamento,
  stato: StatoAbbonamento,
  motivo: string,
  attore: Attore,
  extra: Partial<Abbonamento> = {}
): Promise<Abbonamento> {
  const repo = getTenantRepository();
  const da = a.stato;
  const salvato = await repo.salvaAbbonamento({ ...a, ...extra, stato });
  if (da !== stato) {
    await evento(a.tenantId, "abbonamento_stato", attore, { da, a: stato, motivo }, motivo);
  }
  const tenant = repo.perId(a.tenantId);
  if (stato === "suspended" || stato === "cancelled") {
    if (tenant?.stato === "attivo") await sospendi(a.tenantId, `abbonamento: ${motivo}`, attore);
  } else if (tenant?.stato === "sospeso" && (tenant.motivoStato ?? "").startsWith("abbonamento:")) {
    await riattiva(a.tenantId, motivo, attore);
  }
  return salvato;
}

/**
 * Cambio di un singolo campo, senza transizione di stato: salva e registra.
 * `campo` è un'etichetta per il registro, non necessariamente il nome della
 * proprietà sulla riga (`impostaTolleranze` usa `tolleranza_storage`/
 * `tolleranza_tars`, più leggibili di `tolleranzaStorageGiorni` nel log).
 */
async function modifica(
  a: Abbonamento,
  campo: string,
  prima: unknown,
  dopo: unknown,
  extra: Partial<Abbonamento>,
  attore: Attore,
  dettagliExtra: Record<string, unknown> = {}
): Promise<Abbonamento> {
  const salvato = await getTenantRepository().salvaAbbonamento({ ...a, ...extra });
  await evento(a.tenantId, "abbonamento_modificato", attore, { campo, prima, dopo, ...dettagliExtra });
  return salvato;
}

/**
 * Prova gratuita di 30 giorni, chiamata da `tenants.servizio.crea` subito
 * dopo l'evento `creato`. Idempotente: se l'abbonamento c'è già lo restituisce
 * senza toccarlo né registrare un secondo `abbonamento_creato`.
 */
export async function creaProva(tenantId: number, adesso: Date, attore: Attore): Promise<Abbonamento> {
  const repo = getTenantRepository();
  const gia = repo.abbonamentoDi(tenantId);
  if (gia) return gia;
  const finePeriodo = new Date(adesso.getTime() + GIORNI_PROVA * MS_GIORNO);
  const abbonamento = await repo.salvaAbbonamento({
    tenantId,
    tipo: "paid",
    // La prova non ha ancora un canone: la periodicità nasce col pagamento.
    periodicita: null,
    stato: "trialing",
    inizioPeriodo: adesso,
    finePeriodo,
    prossimoRinnovo: null,
    disdettaAFinePeriodo: false,
    budgetTarsNanoMese: eurInNano(budgetTarsPredefinitoEur()),
    extraTarsNano: 0,
    extraTarsMese: null,
    tolleranzaStorageGiorni: TOLLERANZA_PREDEFINITA_GIORNI,
    tolleranzaTarsGiorni: TOLLERANZA_PREDEFINITA_GIORNI,
    tarsSogliaAvvisata: 0,
    tarsSogliaMese: meseLocale(adesso),
    tarsSoglia100Dal: null,
    insolutoDal: null,
    provider: "nessuno",
    providerRef: null,
    omaggio: null,
    createdAt: adesso,
    updatedAt: adesso,
  });
  await evento(
    tenantId,
    "abbonamento_creato",
    attore,
    { stato: abbonamento.stato, finePeriodo: finePeriodo.toISOString() },
    `prova gratuita di ${GIORNI_PROVA} giorni`
  );
  return abbonamento;
}

/**
 * Il tenant 1 nasce omaggio senza scadenza e senza tetto Tars per azienda
 * (valgono i tetti globali `TARS_*`): nessuna transizione lo tocca mai.
 * Chiamata dal boot dopo il seed del tenant; idempotente.
 */
export async function assicuraAbbonamentoPredefinito(adesso: Date): Promise<Abbonamento> {
  const repo = getTenantRepository();
  const gia = repo.abbonamentoDi(TENANT_PREDEFINITO_ID);
  if (gia) return gia;
  const abbonamento = await repo.salvaAbbonamento({
    tenantId: TENANT_PREDEFINITO_ID,
    tipo: "complimentary",
    periodicita: null,
    stato: "active",
    inizioPeriodo: adesso,
    finePeriodo: null,
    prossimoRinnovo: null,
    disdettaAFinePeriodo: false,
    budgetTarsNanoMese: null,
    extraTarsNano: 0,
    extraTarsMese: null,
    tolleranzaStorageGiorni: TOLLERANZA_PREDEFINITA_GIORNI,
    tolleranzaTarsGiorni: TOLLERANZA_PREDEFINITA_GIORNI,
    tarsSogliaAvvisata: 0,
    tarsSogliaMese: meseLocale(adesso),
    tarsSoglia100Dal: null,
    insolutoDal: null,
    provider: "nessuno",
    providerRef: null,
    omaggio: {
      motivo: MOTIVO_PROPRIETARIA,
      attore: attoreTesto(SISTEMA),
      dataIso: adesso.toISOString(),
      scadenzaIso: null,
    },
    createdAt: adesso,
    updatedAt: adesso,
  });
  await evento(
    TENANT_PREDEFINITO_ID,
    "abbonamento_creato",
    SISTEMA,
    { stato: abbonamento.stato, finePeriodo: null },
    MOTIVO_PROPRIETARIA
  );
  return abbonamento;
}

/**
 * Omaggio: da qualunque stato, anche da `suspended` (è il modo di riaprire
 * un'azienda in sola lettura). Scadenza `null` = senza scadenza.
 */
export async function concediOmaggio(
  tenantId: number,
  input: { motivo: string; scadenza: Date | null },
  attore: Attore,
  adesso: Date
): Promise<Abbonamento> {
  nonIlTenant1(tenantId);
  const a = esistente(tenantId);
  const omaggio: Omaggio = {
    motivo: input.motivo,
    attore: attoreTesto(attore),
    dataIso: adesso.toISOString(),
    scadenzaIso: input.scadenza?.toISOString() ?? null,
  };
  const salvato = await cambiaStato(a, "active", `omaggio: ${input.motivo}`, attore, {
    tipo: "complimentary",
    periodicita: null,
    finePeriodo: input.scadenza,
    prossimoRinnovo: null,
    insolutoDal: null,
    disdettaAFinePeriodo: false,
    omaggio,
  });
  await evento(tenantId, "abbonamento_omaggio", attore, { scadenzaIso: omaggio.scadenzaIso }, input.motivo);
  return salvato;
}

/**
 * Sposta la scadenza e riporta SEMPRE a una prova piena (R6, ruling): oltre a
 * `finePeriodo` e `insolutoDal: null`, forza `tipo: "paid"`, `periodicita:
 * null`, `omaggio: null` e `disdettaAFinePeriodo: false`. Anche quando si
 * proroga un omaggio scaduto (`tipo: "complimentary"`): un omaggio con la
 * scadenza passata a cui si regalano altri giorni torna a essere una prova a
 * tutti gli effetti, non un omaggio con la data vecchia — altrimenti la
 * scheda continuerebbe a mostrare «Abbonamento omaggio» con una scadenza
 * ormai bugiarda, e una disdetta lasciata attiva scadrebbe di nuovo la prova
 * appena regalata invece di lasciarla correre.
 */
export async function prorogaProva(
  tenantId: number,
  giorni: number,
  motivo: string,
  attore: Attore,
  adesso: Date
): Promise<Abbonamento> {
  nonIlTenant1(tenantId);
  if (!Number.isFinite(giorni) || giorni <= 0) {
    throw new Error("La proroga vuole un numero di giorni maggiore di zero");
  }
  const a = esistente(tenantId);
  if (!STATI_PROROGABILI.includes(a.stato)) {
    throw new Error(`Si proroga solo una prova in corso, scaduta o sospesa (stato: ${a.stato})`);
  }
  // Si parte dalla scadenza se è ancora nel futuro, da adesso se è già
  // passata: chi proroga di 15 giorni ne regala 15 da oggi, non 15 da una
  // data morta la settimana scorsa.
  const base =
    a.finePeriodo && a.finePeriodo.getTime() > adesso.getTime() ? a.finePeriodo : adesso;
  const finePeriodo = new Date(base.getTime() + giorni * MS_GIORNO);
  const tipoPrecedente = a.tipo;
  const salvato = await cambiaStato(a, "trialing", `proroga: ${motivo}`, attore, {
    tipo: "paid",
    periodicita: null,
    omaggio: null,
    disdettaAFinePeriodo: false,
    finePeriodo,
    insolutoDal: null,
  });
  await evento(
    tenantId,
    "abbonamento_prova_prorogata",
    attore,
    { giorni, finePeriodo: finePeriodo.toISOString(), tipoPrecedente },
    motivo
  );
  return salvato;
}

/** Tetto Tars mensile dell'azienda in nano-dollari; `null` = nessun tetto. */
export async function impostaBudgetTars(
  tenantId: number,
  budgetNano: number | null,
  attore: Attore
): Promise<Abbonamento> {
  if (budgetNano != null && (!Number.isFinite(budgetNano) || budgetNano < 0)) {
    throw new Error("Il budget Tars non può essere negativo");
  }
  const a = esistente(tenantId);
  return modifica(
    a,
    "budgetTarsNanoMese",
    a.budgetTarsNanoMese,
    budgetNano,
    { budgetTarsNanoMese: budgetNano },
    attore
  );
}

/**
 * Concessione una tantum che si somma al budget del mese corrente. L'extra
 * appartiene al mese in cui è concesso: se la riga ne porta uno vecchio si
 * riparte da zero invece di sommarci sopra (il mese nuovo lo azzera comunque
 * al primo giro del worker, ma un comando può arrivare prima).
 */
export async function aggiungiExtraTars(
  tenantId: number,
  extraNano: number,
  attore: Attore,
  adesso: Date
): Promise<Abbonamento> {
  if (!Number.isFinite(extraNano) || extraNano <= 0) {
    throw new Error("L'extra Tars vuole un importo maggiore di zero");
  }
  const a = esistente(tenantId);
  const mese = meseLocale(adesso);
  const prima = a.extraTarsMese === mese ? a.extraTarsNano : 0;
  const dopo = prima + extraNano;
  return modifica(
    a,
    "extraTarsNano",
    prima,
    dopo,
    { extraTarsNano: dopo, extraTarsMese: mese },
    attore,
    { mese }
  );
}

/**
 * Giorni di tolleranza dopo il 100 % di storage e di Tars, per azienda.
 * Il `campo` nel registro è `tolleranza_storage`/`tolleranza_tars` (non il
 * nome della colonna): è quello che compare nella Situazione, ed è lo stesso
 * sia che lo cambi un umano da pannello sia che lo chiami Tars.
 */
export async function impostaTolleranze(
  tenantId: number,
  input: { storage?: number; tars?: number },
  attore: Attore
): Promise<Abbonamento> {
  let a = esistente(tenantId);
  if (input.storage != null) {
    validaTolleranza(input.storage, "storage");
    a = await modifica(
      a,
      "tolleranza_storage",
      a.tolleranzaStorageGiorni,
      input.storage,
      { tolleranzaStorageGiorni: input.storage },
      attore
    );
  }
  if (input.tars != null) {
    validaTolleranza(input.tars, "Tars");
    a = await modifica(
      a,
      "tolleranza_tars",
      a.tolleranzaTarsGiorni,
      input.tars,
      { tolleranzaTarsGiorni: input.tars },
      attore
    );
  }
  return a;
}

function validaTolleranza(giorni: number, quale: string): void {
  if (!Number.isInteger(giorni) || giorni < 0) {
    throw new Error(`La tolleranza ${quale} vuole un numero intero di giorni, zero o più`);
  }
}

/**
 * Disdetta a fine periodo: il servizio resta pieno fino a `finePeriodo`, poi
 * `valutaAbbonamento` porta a `cancelled` e il tenant in sola lettura.
 */
export async function impostaDisdetta(
  tenantId: number,
  disdetta: boolean,
  attore: Attore
): Promise<Abbonamento> {
  nonIlTenant1(tenantId);
  const a = esistente(tenantId);
  return modifica(
    a,
    "disdettaAFinePeriodo",
    a.disdettaAFinePeriodo,
    disdetta,
    { disdettaAFinePeriodo: disdetta },
    attore
  );
}

/** Giorni interi alla scadenza; `null` per un abbonamento senza scadenza. */
export function giorniAllaScadenza(a: Abbonamento, adesso: Date): number | null {
  return a.finePeriodo ? giorniInteriFino(a.finePeriodo, adesso) : null;
}

/**
 * La chiave dell'evento notificato (spec §8): identifica il FATTO, non il
 * destinatario né il giro del worker. Il worker ripassa ogni sei ore e la
 * stessa scadenza produrrebbe la stessa chiave: `notificaAzienda` la scarta.
 * `discriminante` è ciò che rende diverso un fatto dall'altro — la data di
 * fine periodo, e per gli avvisi anche la soglia (7, 3 e 1 giorno sono tre
 * avvisi distinti sulla stessa scadenza).
 */
function chiaveAvviso(tenantId: number, tipo: string, discriminante: string): string {
  return `abbonamento:${tenantId}:${tipo}:${discriminante}`;
}

const giorniScritti = (n: number) => `${n} ${n === 1 ? "giorno" : "giorni"}`;

/**
 * Sola lettura: stesso testo per `suspended` e `cancelled`. Dal posto di chi
 * lavora sono la stessa cosa — si legge, si scarica, non si scrive — e il
 * perché (insoluto scaduto o disdetta) lo racconta il registro.
 */
function avvisaSolaLettura(tenantId: number, discriminante: string, adesso: Date) {
  return notificaAzienda({
    tenantId,
    tipo: "abbonamento.sospeso",
    titolo: "Azienda in sola lettura",
    corpo:
      "L'abbonamento è sospeso: i dati restano leggibili e scaricabili, ma non si può più modificare nulla. Un omaggio o una proroga riaprono l'azienda.",
    chiave: chiaveAvviso(tenantId, "sospeso", discriminante),
    priorita: "high",
    adesso,
  });
}

/**
 * Il giro del worker su una sola azienda (spec §4.1). Nell'ordine: mese
 * nuovo, insoluto scaduto, periodo finito, avvisi — così una scadenza appena
 * superata diventa insoluto invece di produrre l'ennesimo avviso.
 * Il tenant 1 non si valuta mai: è la proprietaria della piattaforma.
 */
export async function valutaAbbonamento(
  tenantId: number,
  adesso: Date
): Promise<{ transizione: StatoAbbonamento | null; avviso: number | null }> {
  const repo = getTenantRepository();
  let a = repo.abbonamentoDi(tenantId);
  if (!a || tenantId === TENANT_PREDEFINITO_ID) return { transizione: null, avviso: null };

  // Mese nuovo: le soglie Tars ripartono da zero e l'extra del mese scorso
  // scade (l'extra di QUESTO mese resta, se qualcuno l'ha appena concesso).
  const mese = meseLocale(adesso);
  if (a.tarsSogliaMese !== mese) {
    const extraDelMese = a.extraTarsMese === mese;
    a = await repo.salvaAbbonamento({
      ...a,
      tarsSogliaAvvisata: 0,
      tarsSogliaMese: mese,
      tarsSoglia100Dal: null,
      extraTarsNano: extraDelMese ? a.extraTarsNano : 0,
      extraTarsMese: extraDelMese ? a.extraTarsMese : null,
    });
  }

  // R15: l'abbonamento è la fonte di verità. Un contratto `suspended` o
  // `cancelled` con l'azienda ATTIVA è una coppia incoerente, e il giro
  // successivo la rimette in pari risospendendo col marcatore `abbonamento: `
  // (R5). Ci si arriva per due strade, nessuna delle quali lascia un errore
  // dietro di sé: `pnpm tenant stato --riattiva` dato a mano, e il ripristino
  // archivi del WS3, che riapre il tenant che aveva sospeso mentre il worker,
  // nello stesso giro, portava il contratto a `suspended` (allora `cambiaStato`
  // salta `sospendi` perché il tenant non è attivo). Per riaprire davvero
  // un'azienda insolvente servono un omaggio o una proroga, non questo comando.
  // `cambiaStato(a, a.stato, …)` non registra un secondo `abbonamento_stato`
  // (R6: `da === a`); la traccia di audit è l'evento `sospeso` del WS1. La
  // guardia sul tenant attivo sta QUI, prima della scrittura della riga: un
  // tenant sospeso da altri (il ripristino in corso, o l'operatore con un
  // motivo suo) non si tocca, e non si riscrive nemmeno l'abbonamento.
  if (a.stato === "suspended" || a.stato === "cancelled") {
    if (repo.perId(tenantId)?.stato === "attivo") {
      const motivo =
        a.stato === "suspended"
          ? "contratto sospeso, azienda risultava attiva"
          : "contratto disdetto, azienda risultava attiva";
      await cambiaStato(a, a.stato, motivo, SISTEMA);
      return { transizione: a.stato, avviso: null };
    }
  }

  // Insoluto oltre la tolleranza: sola lettura.
  if (
    a.stato === "past_due" &&
    a.insolutoDal &&
    adesso.getTime() - a.insolutoDal.getTime() > GIORNI_TOLLERANZA_INSOLUTO * MS_GIORNO
  ) {
    const insolutoDal = a.insolutoDal;
    await cambiaStato(a, "suspended", "tolleranza dell'insoluto scaduta", SISTEMA);
    await avvisaSolaLettura(tenantId, insolutoDal.toISOString(), adesso);
    return { transizione: "suspended", avviso: null };
  }

  // Periodo finito senza pagamento né rinnovo: insoluto, o chiusura se disdetto.
  if ((a.stato === "trialing" || a.stato === "active") && a.finePeriodo && adesso.getTime() > a.finePeriodo.getTime()) {
    const fineIso = a.finePeriodo.toISOString();
    if (a.disdettaAFinePeriodo) {
      await cambiaStato(a, "cancelled", "disdetta a fine periodo", SISTEMA);
      await avvisaSolaLettura(tenantId, fineIso, adesso);
      return { transizione: "cancelled", avviso: null };
    }
    const motivo =
      a.stato === "trialing" ? "prova scaduta senza pagamento" : "periodo scaduto senza rinnovo";
    const finePeriodo = a.finePeriodo;
    await cambiaStato(a, "past_due", motivo, SISTEMA, { insolutoDal: adesso });
    await notificaAzienda({
      tenantId,
      tipo: "abbonamento.insoluto",
      titolo: `Abbonamento scaduto: ${giorniScritti(GIORNI_TOLLERANZA_INSOLUTO)} per regolarizzare`,
      corpo:
        `Il periodo è finito il ${dataItaliana(finePeriodo)}. ` +
        `Dal ${dataItaliana(new Date(adesso.getTime() + GIORNI_TOLLERANZA_INSOLUTO * MS_GIORNO))} ` +
        "l'azienda passa in sola lettura.",
      chiave: chiaveAvviso(tenantId, "insoluto", fineIso),
      priorita: "high",
      adesso,
    });
    return { transizione: "past_due", avviso: null };
  }

  // Avvisi a 7, 3 e 1 giorno interi dalla scadenza, una volta ciascuno: il
  // worker passa ogni 6 ore, la deduplicazione sugli eventi evita i doppioni.
  // Una proroga cambia `fineIso` e gli avvisi rinascono per la data nuova.
  if ((a.stato === "trialing" || a.stato === "active") && a.finePeriodo) {
    const mancano = giorniInteriFino(a.finePeriodo, adesso);
    const soglia = GIORNI_AVVISO.find(g => mancano === g);
    if (soglia != null) {
      const fineIso = a.finePeriodo.toISOString();
      const eventi = await repo.eventi(tenantId, { ultimi: 50 });
      const gia = eventi.some(
        e =>
          e.tipo === "abbonamento_avviso" &&
          e.dettagli?.giorniAllaScadenza === soglia &&
          e.dettagli?.fineIso === fineIso
      );
      if (!gia) {
        await evento(tenantId, "abbonamento_avviso", SISTEMA, {
          giorniAllaScadenza: soglia,
          fineIso,
        });
        // Un omaggio con scadenza non è «la prova»: chi l'ha ricevuto non
        // deve leggere che gli sta finendo un periodo di prova che non ha.
        const omaggio = a.tipo === "complimentary";
        await notificaAzienda({
          tenantId,
          tipo: "abbonamento.avviso",
          titolo: omaggio
            ? `L'abbonamento omaggio finisce fra ${giorniScritti(soglia)}`
            : `La prova di ${PRODOTTO} finisce fra ${giorniScritti(soglia)}`,
          corpo:
            `Scade il ${dataItaliana(a.finePeriodo)}. Dopo la scadenza l'azienda entra in ` +
            `insoluto e, passati ${giorniScritti(GIORNI_TOLLERANZA_INSOLUTO)}, in sola lettura.`,
          chiave: chiaveAvviso(tenantId, "avviso", `${soglia}:${fineIso}`),
          priorita: "normal",
          adesso,
        });
        return { transizione: null, avviso: soglia };
      }
    }
  }

  return { transizione: null, avviso: null };
}

/**
 * Punto di ingresso del provider di pagamento (spec §5): un checkout o un
 * webhook futuro normalizzano il proprio evento in `EventoProvider` e lo
 * passano qui, sempre nella stessa forma qualunque sia il provider dietro.
 * Idempotente per `evento.id`: un webhook che ripete la consegna (comune,
 * mai garantita "exactly once") trova già il marcatore `provider_evento`
 * negli ultimi 500 eventi del tenant e non applica nulla una seconda volta.
 * L'attore è lo script del provider corrente (`script:provider:<nome>`),
 * così il registro distingue un pagamento verificato dal provider da un
 * omaggio o una proroga concessi a mano. Il tenant 1 non ha un provider:
 * nessun evento può toccarlo.
 */
export async function applicaEventoProvider(
  eventoProvider: EventoProvider,
  adesso: Date
): Promise<"applicato" | "duplicato"> {
  nonIlTenant1(eventoProvider.tenantId);
  const repo = getTenantRepository();
  const attore: Attore = { tipo: "script", nome: `provider:${providerCorrente().nome}` };

  const recenti = await repo.eventi(eventoProvider.tenantId, { ultimi: 500 });
  const duplicato = recenti.some(
    e =>
      e.tipo === "abbonamento_modificato" &&
      e.dettagli?.campo === "provider_evento" &&
      e.dettagli?.evento === eventoProvider.id
  );
  if (duplicato) return "duplicato";

  const a = esistente(eventoProvider.tenantId);

  if (eventoProvider.tipo === "pagamento_riuscito") {
    const periodo = eventoProvider.periodo;
    const providerRef = { ...(a.providerRef ?? {}), ultimoEvento: eventoProvider.id };
    // Senza periodo (evento minimale) non si inventano date: si sblocca
    // l'abbonamento e si segna il pagamento, il resto arriva con l'evento
    // che porta davvero il periodo.
    const extra: Partial<Abbonamento> = periodo
      ? {
          tipo: "paid",
          periodicita: eventoProvider.periodicita ?? a.periodicita ?? "monthly",
          inizioPeriodo: periodo.inizio,
          finePeriodo: periodo.fine,
          prossimoRinnovo: periodo.fine,
          insolutoDal: null,
          omaggio: null,
          providerRef,
        }
      : {
          tipo: "paid",
          // Un pagamento verificato chiude sempre l'insoluto e l'omaggio,
          // anche quando il provider non manda il periodo (R9).
          insolutoDal: null,
          omaggio: null,
          providerRef,
        };
    await cambiaStato(a, "active", "pagamento verificato", attore, extra);
  } else if (eventoProvider.tipo === "pagamento_fallito") {
    // Già past_due o suspended: la tolleranza (o la sola lettura) sta già
    // correndo dalla prima volta, un secondo fallimento non la riavvia.
    // Solo il marcatore in fondo registra che l'evento è arrivato.
    if (a.stato === "active" || a.stato === "trialing") {
      await cambiaStato(a, "past_due", "pagamento fallito", attore, { insolutoDal: adesso });
    }
  } else if (eventoProvider.tipo === "disdetta") {
    await modifica(
      a,
      "disdettaAFinePeriodo",
      a.disdettaAFinePeriodo,
      true,
      { disdettaAFinePeriodo: true },
      attore
    );
  }

  await evento(eventoProvider.tenantId, "abbonamento_modificato", attore, {
    campo: "provider_evento",
    evento: eventoProvider.id,
    tipo: eventoProvider.tipo,
  });
  return "applicato";
}
