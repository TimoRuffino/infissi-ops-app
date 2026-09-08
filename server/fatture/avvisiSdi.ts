// server/fatture/avvisiSdi.ts
// L'allarme che insegue (§7.1). Una fattura ferma su Fatture in Cloud e non
// ancora spedita ha dodici giorni di tempo, e la tab della commessa la apri
// solo se ti ricordi di aprirla: questo modulo va a cercare l'operatore.
//
// Non c'è un evento a cui agganciarsi — lo scadere di giorni non è un
// evento — quindi la cadenza è quella della sonda, che gira già ogni
// quindici minuti in un solo processo. La deduplica è tutta nella chiave
// canonica, che porta il giorno italiano: quattro giri nella stessa ora
// producono UNA notifica.
import {
  giorniPerInvioSdi,
  toniScadenzaSdi,
} from "@shared/fatturazione/scadenzaSdi";
import { fatturaModificabile, type Fattura } from "@shared/fatturazione/tipi";
import {
  getNotificationRepository,
  type NotificationRepository,
} from "../notifications/repository";
import type { NotificationDraft } from "../notifications/types";
import { getUtentiStore } from "../routers/utenti";
import { conTenantDellaSede } from "../tenants/giri";
import { repo, type DipendenzeEmissione } from "./emissione";
import { iso } from "./servizio";

/** I giorni esatti in cui parte un avviso; sotto zero si avvisa ogni giorno. */
export const SOGLIE_AVVISO_SDI = [7, 3, 1] as const;

export function avvisoSdiDovuto(giorni: number): boolean {
  return giorni <= 0 || (SOGLIE_AVVISO_SDI as readonly number[]).includes(giorni);
}

type FatturaDaAvvisare = Pick<
  Fattura,
  "id" | "sedeId" | "commessaId" | "numero" | "data" | "emessaDa"
>;

/**
 * L'avviso di una fattura, o `null` se non c'è nessuno da avvisare: chi
 * l'ha mandata su Fatture in Cloud è il proprietario del lavoro rimasto a
 * metà, e senza di lui non si inventa un destinatario.
 */
export function bozzaAvvisoSdi(input: {
  fattura: FatturaDaAvvisare;
  giorni: number;
  oggi: Date;
}): NotificationDraft | null {
  const { fattura, giorni, oggi } = input;
  if (fattura.emessaDa == null) return null;
  const scadenza = toniScadenzaSdi(giorni);
  const nome = fattura.numero ? `Fattura ${fattura.numero}` : "Una fattura";
  return {
    sedeId: fattura.sedeId,
    recipientUserId: fattura.emessaDa,
    // Il giorno ITALIANO nella chiave: una notifica al giorno per fattura,
    // per quanti giri faccia la sonda.
    canonicalKey: `fattura-sdi:${fattura.id}:${iso(oggi)}`,
    type: "fattura.sdi_in_scadenza",
    priority: giorni <= 0 ? "critical" : "high",
    title: `${nome} da mandare allo SdI`,
    body:
      giorni <= 0
        ? `${scadenza.testo}. Aprila e spediscila: in ritardo si può ancora, non spedirla no.`
        : `${scadenza.testo}. Aprila per controllarla e spedirla.`,
    link: `/fatturazione/${fattura.commessaId}?passo=fattura`,
    groupKey: `fattura-sdi:${fattura.id}`,
    sourceEventId: null,
    entityRefs: [
      { type: "commessa", id: String(fattura.commessaId) },
      { type: "fattura", id: String(fattura.id) },
    ],
    createdAt: oggi,
    expiresAt: null,
  };
}

export type DipendenzeAvvisiSdi = DipendenzeEmissione & {
  notifiche?: NotificationRepository;
  utenti?: () => Array<{ id: number; attivo?: boolean; sediIds?: number[] }>;
  /** Il giro parte da un timer, fuori da ogni richiesta: il tenant si dichiara. */
  conTenant?: <T>(sedeId: number, azione: () => Promise<T>) => Promise<T>;
};

/**
 * Un giro su tutte le sedi. Le fatture candidate sono quelle che la sonda
 * già guarda: si tengono solo quelle ancora correggibili (su FiC e non
 * partite) e in scadenza.
 */
export async function avvisaScadenzeSdi(
  dip: DipendenzeAvvisiSdi = {}
): Promise<{ avvisate: number[] }> {
  const repository = repo(dip);
  const notifiche = dip.notifiche ?? getNotificationRepository();
  const leggiUtenti = dip.utenti ?? (getUtentiStore as DipendenzeAvvisiSdi["utenti"])!;
  const oggi = dip.now?.() ?? new Date();
  const avvisate: number[] = [];

  const conTenant = dip.conTenant ?? conTenantDellaSede;
  const righe = (await repository.daSondare()).filter(r => r.stato === "emessa");
  const utenti = leggiUtenti();

  const perSede = new Map<number, typeof righe>();
  for (const riga of righe) {
    const lista = perSede.get(riga.sedeId);
    if (lista) lista.push(riga);
    else perSede.set(riga.sedeId, [riga]);
  }

  for (const [sedeId, righeSede] of perSede) {
    await conTenant(sedeId, async () => {
      for (const riga of righeSede) {
        const fattura = await repository.perId(sedeId, riga.id);
        if (!fattura) continue;
        if (!fatturaModificabile(fattura)) continue;

        const giorni = giorniPerInvioSdi(fattura.data, oggi);
        if (giorni == null || !avvisoSdiDovuto(giorni)) continue;

        const bozza = bozzaAvvisoSdi({ fattura, giorni, oggi });
        if (!bozza) continue;

        // Stessa guardia del projector: un destinatario disattivato, o che
        // non è più di quella sede, non riceve niente.
        const destinatario = utenti.find(u => u.id === bozza.recipientUserId);
        if (
          !destinatario ||
          destinatario.attivo === false ||
          !Array.isArray(destinatario.sediIds) ||
          !destinatario.sediIds.includes(bozza.sedeId)
        ) {
          continue;
        }

        try {
          const esito = await notifiche.upsert(bozza);
          if (esito.created) avvisate.push(fattura.id);
        } catch (errore) {
          // Un avviso non riuscito non deve fermare gli altri: la fattura
          // resta lì e al giro dopo si riprova.
          console.error(
            `[fatture] avviso SdI #${fattura.id}:`,
            errore instanceof Error ? errore.message : String(errore)
          );
        }
      }
    });
  }

  return { avvisate };
}
