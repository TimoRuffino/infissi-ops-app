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
import { getTarsConfig } from "./stores";
import { runTars } from "./loop";
import { listDaSmistare, markAnalizzate } from "./comunicazioni";

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
  const config = getTarsConfig();
  if (!config.attivo || !anthropicConfigured()) return;
  if (inCorso.has(sedeId)) return;
  const pausa = pausaFinoA.get(sedeId);
  if (pausa && Date.now() < pausa) return;

  const mails = await listDaSmistare(sedeId, MAX_MAIL_PER_RUN);
  if (mails.length === 0) return;

  inCorso.add(sedeId);
  try {
    const blocchi = mails
      .map(
        (m) => `<comunicazione id="${m.id}">
Da: ${m.mittenteNome ? `${m.mittenteNome} <${m.mittente}>` : m.mittente}
Ricevuta: ${m.receivedAt.toISOString()}
Oggetto: ${m.oggetto || "(senza oggetto)"}
Allegati: ${m.allegati.length ? m.allegati.map((a) => a.nome).join(", ") : "nessuno"}
${m.matchMotivo ? `Nota del match automatico: ${m.matchMotivo}` : ""}
<contenuto_esterno>
${m.testo.slice(0, 2500)}
</contenuto_esterno>
</comunicazione>`
      )
      .join("\n\n");

    const richiesta = `<trigger>
Tipo: smistamento_comunicazioni
Data e ora: ${new Date().toISOString()}
</trigger>

Le comunicazioni qui sotto sono arrivate nelle caselle aziendali e il collegamento
automatico non ha trovato la commessa. Per ciascuna: se dagli indizi (mittente, nomi,
indirizzi, prodotti citati) riesci a individuare la commessa giusta, verificala con gli
strumenti e usa proponi_collegamento con l'id della comunicazione. Se una mail è
chiaramente irrilevante (newsletter, spam, fornitura d'ufficio), semplicemente non
proporre nulla per lei. Se non c'è nulla da proporre per nessuna, usa nessuna_azione.

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
