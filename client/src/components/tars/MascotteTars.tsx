// Mascotte di Tars: quattro clip WebM con canale alpha.
//
//   idle      in piedi, respira e sbatte gli occhi (in loop)
//   evento    inciampa, cade, si rialza e ride (siparietto, una volta)
//   cartello  alza un cartello «FATTURARE» (siparietto, una volta)
//   indica    braccio teso verso il pannello, ferma, sbatte gli occhi (in loop)
//
// I siparietti partono da soli ogni tanto e poi tornano a idle: dentro una
// clip che gira in continuo Tars cadrebbe ogni pochi secondi, insopportabile
// in un CRM che qualcuno tiene aperto tutto il giorno.
//
// I file nascono da scripts/mascotte/mascotte-video.sh. Sono WebM/VP9 con
// alpha vero: l'MP4 "scontornato" del generatore è opaco (soggetto su nero),
// e l'alpha viene ricostruito confrontando le due versioni degli stessi
// fotogrammi.
//
// Un siparietto finisce su una posa diversa da quella di partenza (l'evento
// col volto che ride, il cartello col braccio alzato): il salto al rientro si
// copre con una dissolvenza breve.
import { useCallback, useEffect, useRef, useState } from "react";

import {
  posaARiposo,
  posterDi,
  puoPartireSiparietto,
  scegliSiparietto,
  vaSpecchiata,
  type PosaMascotte,
} from "@/lib/mascotteTars";
import { cn } from "@/lib/utils";

export type { PosaMascotte };

const DISSOLVENZA_MS = 180;
const SIPARIETTO_PAUSA_MIN_MS = 90_000;
const SIPARIETTO_PAUSA_MAX_MS = 180_000;
/** Oltre la durata della clip più lunga (evento, 6,6s): vedi la rete di sicurezza. */
const SIPARIETTO_DURATA_MAX_MS = 12_000;

const attesa = (min: number, max: number) => min + Math.random() * (max - min);

function useMovimentoRidotto() {
  const [ridotto, setRidotto] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applica = () => setRidotto(mq.matches);
    applica();
    mq.addEventListener("change", applica);
    return () => mq.removeEventListener("change", applica);
  }, []);
  return ridotto;
}

export type MascotteTarsProps = {
  /** A pannello aperto la mascotte indica e resta ferma: niente siparietti. */
  attiva: boolean;
  onClick: () => void;
  etichetta: string;
  className?: string;
};

export function MascotteTars({
  attiva,
  onClick,
  etichetta,
  className,
}: MascotteTarsProps) {
  const ridotto = useMovimentoRidotto();
  const [posa, setPosa] = useState<PosaMascotte>("idle");
  const [visibile, setVisibile] = useState(true);
  const dissolvenzaRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cambiaPosa = useCallback((nuova: PosaMascotte) => {
    setVisibile(false);
    clearTimeout(dissolvenzaRef.current);
    dissolvenzaRef.current = setTimeout(() => {
      setPosa(nuova);
      setVisibile(true);
    }, DISSOLVENZA_MS);
  }, []);

  useEffect(() => () => clearTimeout(dissolvenzaRef.current), []);

  const riposo = posaARiposo(attiva);

  // Il pannello comanda: aperto → indica, chiuso → torna in piedi. Un
  // siparietto in corso viene interrotto, non aspettato.
  useEffect(() => {
    setPosa(prima => {
      if (prima === riposo) return prima;
      cambiaPosa(riposo);
      return prima;
    });
  }, [riposo, cambiaPosa]);

  useEffect(() => {
    if (!puoPartireSiparietto(posa, attiva, ridotto)) return;
    const t = setTimeout(
      () => cambiaPosa(scegliSiparietto(Math.random())),
      attesa(SIPARIETTO_PAUSA_MIN_MS, SIPARIETTO_PAUSA_MAX_MS),
    );
    return () => clearTimeout(t);
  }, [posa, attiva, ridotto, cambiaPosa]);

  const inLoop = posa === "idle" || posa === "indica";
  const poster = posterDi(posa);

  // Rete di sicurezza. onEnded scatta solo se il video arriva davvero in
  // fondo: con la scheda in secondo piano il browser mette in pausa la
  // riproduzione, e se il file non carica non parte nemmeno. Senza questo
  // Tars resterebbe piantato nel siparietto — per terra o col cartello in
  // mano — finché non lo si clicca.
  useEffect(() => {
    if (inLoop) return;
    const t = setTimeout(() => cambiaPosa(riposo), SIPARIETTO_DURATA_MAX_MS);
    return () => clearTimeout(t);
  }, [inLoop, posa, riposo, cambiaPosa]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etichetta}
      title={etichetta}
      className={cn(
        "block shrink-0 rounded-xl outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      {ridotto ? (
        <img
          src={`/mascotte/${poster}-poster.png`}
          alt=""
          draggable={false}
          className={cn(
            "block size-full select-none",
            vaSpecchiata(posa) && "-scale-x-100",
          )}
        />
      ) : (
        <video
          // Rimonta l'elemento a ogni cambio posa: aggiornare src su un video
          // vivo e chiamare play() non riparte, il caricamento annulla la
          // riproduzione. Verificato nel browser.
          key={posa}
          src={`/mascotte/${posa}.webm`}
          poster={`/mascotte/${poster}-poster.png`}
          autoPlay
          muted
          playsInline
          loop={inLoop}
          onEnded={inLoop ? undefined : () => cambiaPosa(riposo)}
          className={cn(
            "block size-full select-none transition-opacity",
            visibile ? "opacity-100" : "opacity-0",
            vaSpecchiata(posa) && "-scale-x-100",
          )}
          style={{ transitionDuration: `${DISSOLVENZA_MS}ms` }}
        />
      )}
    </button>
  );
}

export default MascotteTars;
