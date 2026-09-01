// Risoluzione dei codici commessa citati nelle risposte di Tars.
//
// Unico punto in cui il riconoscimento sintattico incontra i dati reali. Non
// esiste nessun endpoint nuovo e nessuna capability aggiuntiva: si riusa la
// query sede-scoped che l'utente può già interrogare da qualunque altra pagina
// (`commesse.list`, filtrata dal server su `ctx.sedeId`). Un record di un'altra
// sede non arriva nel payload, quindi non entra nell'indice e non diventa mai
// un link.
//
// La query è di supporto e non blocca niente: nessun `isLoading` viene
// osservato, nessuno skeleton compare, la conversazione si legge subito. Finché
// non ha risposto il risolutore è `undefined` e ogni riferimento resta testo;
// quando risponde, i soli codici risolti diventano link.
//
// Il gate `enabled` evita perfino la richiesta quando la conversazione non cita
// nessun codice commessa.
//
// I ticket non sono qui di proposito: senza una rotta `/ticket/:id` il link
// porterebbe alla coda e non al record che nomina. Vedi la nota in
// `@/lib/riferimentiTars`.

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
  const commesseDati = commesse.data;

  return useMemo(() => {
    if (!daRisolvere) return undefined;
    // Un errore o un permesso mancante lascia i dati assenti: non si segnala
    // nulla in conversazione, semplicemente non compaiono link.
    if (!commesseDati) return undefined;
    return creaRisolutoreRiferimenti({ commesse: commesseDati });
  }, [daRisolvere, commesseDati]);
}
