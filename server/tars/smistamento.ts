// Smistamento automatico — il primo trigger "su evento" di Tars.
//
// Dopo ogni sincronizzazione, le mail rimaste senza commessa (il match
// deterministico non ce l'ha fatta) vengono passate a Tars in lotto:
// lui legge, verifica con gli strumenti e propone il collegamento — o
// niente, se gli indizi non bastano. Come sempre: PROPONE, l'aggancio
// avviene solo all'approvazione.
//
// Guardrail sui costi e sul rumore:
//   - gira solo se Tars è attivo e la chiave è configurata
//   - max 10 mail per esecuzione, le più vecchie prima
//   - una sola esecuzione alla volta per sede
//   - ogni mail viene esaminata UNA volta (tars_analizzata), qualunque
//     sia l'esito: niente loop di analisi sulla stessa newsletter
//   - dopo un errore (API giù, credito finito) pausa di 15 minuti

import type { TrpcContext } from "../_core/context";
import { anthropicConfigured } from "./anthropic";
import { budgetMensileSuperato, getTarsConfig } from "./stores";
import { runTars } from "./loop";
import { listDaAnalizzare, markAnalizzate } from "./comunicazioni";
import { getCommessaById } from "../routers/commesse";

const MAX_MAIL_PER_RUN = 10;
const PAUSA_DOPO_ERRORE_MS = 15 * 60 * 1000;

const inCorso = new Set<number>();
const pausaFinoA = new Map<number, number>();

// Contesto sintetico per le esecuzioni di sistema: nessun operatore ha
// premuto un bottone. Serve solo a firmare il registro e a delimitare la
// sede; le proposte generate passano comunque dall'approvazione umana, e
// l'esecutore userà il ctx (e i permessi) di CHI approva.
function ctxSistema(sedeId: number): TrpcContext {
  return {
    user: {
      id: 0,
      openId: "tars-sistema",
      name: "Tars (automatico)",
      email: "tars@sistema.local",
      loginMethod: "local",
      role: "user",
      ruolo: "sistema",
      ruoli: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

export async function smistaComunicazioni(sedeId: number): Promise<void> {
  const config = getTarsConfig(sedeId);
  if (!config.attivo || !anthropicConfigured()) return;
  // Budget mensile finito: i lavori automatici si fermano da soli. Le mail
  // restano non analizzate e verranno riprese quando il budget riapre.
  if (budgetMensileSuperato(sedeId)) return;
  if (inCorso.has(sedeId)) return;
  const pausa = pausaFinoA.get(sedeId);
  if (pausa && Date.now() < pausa) return;

  const mails = await listDaAnalizzare(sedeId, MAX_MAIL_PER_RUN);
  if (mails.length === 0) return;

  inCorso.add(sedeId);
  try {
    const blocchi = mails
      .map((m) => {
        const commessa =
          m.commessaId != null ? getCommessaById(m.commessaId) : null;
        const rigaCommessa = commessa
          ? `Commessa collegata: ${(commessa as any).codice} (${(commessa as any).cliente})`
          : "Commessa collegata: nessuna";
        return `<comunicazione id="${m.id}" canale="${m.canale}">
Da: ${m.mittenteNome ? `${m.mittenteNome} <${m.mittente}>` : m.mittente}
Ricevuta: ${m.receivedAt.toISOString()}
Oggetto: ${m.oggetto || "(senza oggetto)"}
${rigaCommessa}
Allegati: ${m.allegati.length ? m.allegati.map((a) => a.nome).join(", ") : "nessuno"}
${m.matchMotivo ? `Nota del match automatico: ${m.matchMotivo}` : ""}
<contenuto_esterno>
${m.testo.slice(0, 2500)}
</contenuto_esterno>
</comunicazione>`;
      })
      .join("\n\n");

    const richiesta = `<trigger>
Tipo: smistamento_comunicazioni
Data e ora: ${new Date().toISOString()}
</trigger>

Le comunicazioni qui sotto sono appena arrivate nelle caselle aziendali. Per ciascuna,
in quest'ordine:

1. SE NON HA UNA COMMESSA COLLEGATA e dagli indizi (mittente, nomi, indirizzi, prodotti)
   riesci a individuarla: verificala con gli strumenti e usa proponi_collegamento.
2. SE IL CONTENUTO RICHIEDE UN'AZIONE sul gestionale, proponila — qualche esempio:
   - una richiesta di preventivo o sopralluogo è sempre un'opportunità: cerca prima
     clienti e commesse per evitare duplicati; se è davvero nuova, usa
     leggi_assegnatari e chiedi_chiarimento con l'id della comunicazione per sapere
     a chi assegnare cliente e commessa. Non proporre il lead senza assegnatario
   - il fornitore comunica o sposta una data di consegna → proponi_aggiornamento_magazzino
   - il cliente segnala un difetto o chiede assistenza → proponi_ticket
   - un bonifico o un pagamento viene dichiarato con importo e data verificabili →
     proponi_pagamento (mai da soli sospetti)
   - un'informazione operativa merita traccia sul fascicolo → proponi_nota_timeline
   - la mail merita una risposta che puoi già impostare → proponi_bozza_risposta
   Quando gli allegati possono contenere il dato (conferme d'ordine, fatture, DDT),
   leggili con leggi_allegato prima di proporre.
3. Solo se una mail è davvero irrilevante (newsletter, spam, promozione massiva senza
   richiesta operativa), non proporre nulla. Qualsiasi messaggio che può portare lavoro
   resta operativo, anche se proviene da un'azienda o contiene formule commerciali.

Verifica sempre lo stato reale con gli strumenti prima di proporre. Se non c'è nulla da
proporre per nessuna mail, usa nessuna_azione.

${blocchi}`;

    const esecuzione = await runTars({
      ctx: ctxSistema(sedeId),
      trigger: "smistamento",
      commessaId: null,
      richiesta,
    });

    if (esecuzione.esito === "errore") {
      // API irraggiungibile o credito finito: inutile martellare.
      pausaFinoA.set(sedeId, Date.now() + PAUSA_DOPO_ERRORE_MS);
      console.warn(
        `[tars] smistamento sede ${sedeId} fallito, pausa 15m: ${esecuzione.errore}`
      );
      return;
    }

    // Esaminate una volta, qualunque sia l'esito: la newsletter senza
    // proposta non deve tornare in coda a ogni sync.
    await markAnalizzate(mails.map((m) => m.id));
    if (esecuzione.proposteIds.length > 0) {
      console.log(
        `[tars] smistamento sede ${sedeId}: ${mails.length} mail esaminate, ${esecuzione.proposteIds.length} proposte`
      );
    }
  } finally {
    inCorso.delete(sedeId);
  }
}

// Debounce per sede: la sincronizzazione può importare a raffica (watcher
// + poller); si smista una volta, qualche secondo dopo l'ultima ondata.
const timers = new Map<number, NodeJS.Timeout>();
const DEBOUNCE_MS = 5_000;

export function programmaSmistamento(sedeId: number): void {
  const prev = timers.get(sedeId);
  if (prev) clearTimeout(prev);
  timers.set(
    sedeId,
    setTimeout(() => {
      timers.delete(sedeId);
      void smistaComunicazioni(sedeId).catch((e) =>
        console.error("[tars] smistamento:", e?.message ?? e)
      );
    }, DEBOUNCE_MS)
  );
}

// ── Fatture orfane ──────────────────────────────────────────────────────────
// Le fatture che il match deterministico non ha saputo abbinare (cliente
// sconosciuto in anagrafica, o più commesse plausibili) vanno a Tars: lui
// indaga con gli strumenti e propone il collegamento. Il match certo NON
// passa di qui — quello lo fa gratis il motore deterministico.

const MAX_FATTURE_PER_RUN = 10;
// Per sede, come per le mail: la pausa dopo un errore su una sede non deve
// bloccare lo smistamento dell'altra.
const fattureInCorso = new Set<number>();
const fatturePausaFinoA = new Map<number, number>();

export async function smistaFatture(sedeId: number): Promise<void> {
  const config = getTarsConfig(sedeId);
  if (!config.attivo || !anthropicConfigured()) return;
  if (budgetMensileSuperato(sedeId)) return;
  if (fattureInCorso.has(sedeId)) return;
  const pausaFatture = fatturePausaFinoA.get(sedeId);
  if (pausaFatture && Date.now() < pausaFatture) return;

  const { ficFatture, saveFicFatture, statoFattura } = await import(
    "../routers/ficFatture"
  );
  const { getCommesseStore } = await import("../routers/commesse");
  const commesse = getCommesseStore();

  const orfane = ficFatture
    .filter((f) => {
      if (f.sedeId !== sedeId) return false;
      if (f.ignorata || f.tarsAnalizzata) return false;
      return statoFattura(f, commesse).stato === "non_abbinabile";
    })
    .slice(0, MAX_FATTURE_PER_RUN);
  if (orfane.length === 0) return;

  fattureInCorso.add(sedeId);
  try {
    const blocchi = orfane
      .map((f) => {
        const incassato = f.rate
          .filter((r) => r.stato === "paid")
          .reduce((s, r) => s + r.importo, 0);
        return `<fattura ficId="${f.id}">
Numero: ${f.numero} · Data: ${f.data}
Cliente in fattura: ${f.clienteNome}${f.clienteVat ? ` · P.IVA ${f.clienteVat}` : ""}${f.clienteCf ? ` · CF ${f.clienteCf}` : ""}
Importo lordo: € ${f.importoLordo}
Incassato su FIC: € ${incassato}
Motivo del mancato abbinamento: ${statoFattura(f, commesse).motivo}
</fattura>`;
      })
      .join("\n\n");

    const richiesta = `<trigger>
Tipo: riconciliazione_fatture
Data e ora: ${new Date().toISOString()}
</trigger>

Le fatture qui sotto arrivano da Fatture in Cloud e il collegamento automatico non ha
individuato la commessa. Per ciascuna: cerca il cliente e le sue commesse con gli
strumenti (il nome in fattura può essere scritto diversamente dall'anagrafica: ragioni
sociali abbreviate, soci con cognomi diversi, condomini). Confronta importi e periodo.
Se individui la commessa giusta, usa proponi_collegamento_fattura con l'id FIC. Se una
fattura non c'entra con le commesse (consulenze, vendite al banco, altro), non proporre
nulla per lei. Se non c'è nulla da proporre, usa nessuna_azione.

${blocchi}`;

    const esecuzione = await runTars({
      ctx: ctxSistema(sedeId),
      trigger: "riconciliazione_fatture",
      commessaId: null,
      richiesta,
    });

    if (esecuzione.esito === "errore") {
      fatturePausaFinoA.set(sedeId, Date.now() + PAUSA_DOPO_ERRORE_MS);
      console.warn(
        `[tars] riconciliazione fatture fallita, pausa 15m: ${esecuzione.errore}`
      );
      return;
    }

    // Esaminate una volta, qualunque sia l'esito — come le mail.
    for (const f of orfane) f.tarsAnalizzata = true;
    saveFicFatture();
    if (esecuzione.proposteIds.length > 0) {
      console.log(
        `[tars] riconciliazione fatture: ${orfane.length} esaminate, ${esecuzione.proposteIds.length} proposte`
      );
    }
  } finally {
    fattureInCorso.delete(sedeId);
  }
}

// Un debounce per sede: il sync di una sede non deve annullare quello
// dell'altra, che è ciò che faceva un timer condiviso.
const fattureTimer = new Map<number, NodeJS.Timeout>();

export function programmaSmistamentoFatture(sedeId: number): void {
  const pendente = fattureTimer.get(sedeId);
  if (pendente) clearTimeout(pendente);
  const t = setTimeout(() => {
    fattureTimer.delete(sedeId);
    void smistaFatture(sedeId).catch((e) =>
      console.error("[tars] riconciliazione fatture:", e?.message ?? e)
    );
  }, DEBOUNCE_MS);
  fattureTimer.set(sedeId, t);
}
