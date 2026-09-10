import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import FeedbackDialog, { type TipoFeedback } from "./FeedbackDialog";

type ApriFeedback = (tipo?: TipoFeedback) => void;

const FeedbackContext = createContext<ApriFeedback | null>(null);

/**
 * Il dialogo delle segnalazioni vive una volta sola, nella cornice, e si apre
 * da più punti: la voce nel menu profilo e la palette dei comandi. Un
 * contesto con una sola funzione invece di un pezzo di stato per ogni punto
 * d'ingresso — e nessun bottone in più a occupare lo schermo.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [aperto, setAperto] = useState(false);
  const [tipo, setTipo] = useState<TipoFeedback>("bug");

  const apri = useCallback<ApriFeedback>((scelta = "bug") => {
    setTipo(scelta);
    setAperto(true);
  }, []);

  const valore = useMemo(() => apri, [apri]);

  return (
    <FeedbackContext.Provider value={valore}>
      {children}
      <FeedbackDialog aperto={aperto} onCambiaApertura={setAperto} tipoIniziale={tipo} />
    </FeedbackContext.Provider>
  );
}

/**
 * Apre il modulo della segnalazione. Fuori dalla cornice (pagine anonime,
 * /prova) il contesto non c'è: la funzione non fa nulla invece di lanciare,
 * così un pulsante fuori posto non spegne la pagina.
 */
export function useFeedback(): ApriFeedback {
  const apri = useContext(FeedbackContext);
  return apri ?? (() => undefined);
}
