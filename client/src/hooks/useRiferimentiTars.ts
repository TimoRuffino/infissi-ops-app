// Risoluzione dei riferimenti citati nelle risposte di Tars.
//
// Unico punto in cui il riconoscimento sintattico incontra i dati reali. Non
// esiste nessun endpoint nuovo e nessuna capability aggiuntiva: si riusano le
// due query sede-scoped che l'utente può già interrogare da qualunque altra
// pagina (`commesse.list`, `ticket.list`, entrambe filtrate dal server su
// `ctx.sedeId`). Un record di un'altra sede non arriva nel payload, quindi non
// entra nell'indice e non diventa mai un link.
//
// Le query sono di supporto e non bloccano niente: nessun `isLoading` viene
// osservato, nessuno skeleton compare, la conversazione si legge subito. Finché
// non hanno risposto il risolutore è `undefined` e ogni riferimento resta
// testo; quando rispondono, i soli codici risolti diventano link.
//
// Il gate `enabled` evita perfino le due richieste quando la conversazione non
// cita nulla che assomigli a un riferimento.

import {
  contieneRiferimenti,
  creaRisolutoreRiferimenti,
  type RisolutoreRiferimenti,
} from "@/lib/riferimentiTars";
import { trpc } from "@/lib/trpc";
import { useMemo } from "react";

type TurnoConTesto = {
  ruolo: string;
  contenuto: string;
};

export function useRiferimentiTars(
  turni: readonly TurnoConTesto[]
): RisolutoreRiferimenti | undefined {
  const daRisolvere = useMemo(
    () =>
      turni.some(
        turno => turno.ruolo !== "utente" && contieneRiferimenti(turno.contenuto)
      ),
    [turni]
  );

  const commesse = trpc.commesse.list.useQuery({}, { enabled: daRisolvere });
  const ticket = trpc.ticket.list.useQuery({}, { enabled: daRisolvere });

  const commesseDati = commesse.data;
  const ticketDati = ticket.data;

  return useMemo(() => {
    if (!daRisolvere) return undefined;
    // Un errore o un permesso mancante lascia i dati assenti: non si segnala
    // nulla in conversazione, semplicemente non compaiono link.
    if (!commesseDati && !ticketDati) return undefined;
    return creaRisolutoreRiferimenti({
      commesse: commesseDati,
      ticket: ticketDati,
    });
  }, [daRisolvere, commesseDati, ticketDati]);
}
