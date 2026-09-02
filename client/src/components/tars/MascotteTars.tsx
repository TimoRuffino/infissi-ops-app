// Mascotte di Tars: undici clip WebM con canale alpha.
//
//   idle      cammina sul posto (in loop) — è la posa a riposo, quindi è
//             quello che Tars fa in tutti i momenti in cui non fa altro
//   indica    braccio teso verso il pannello, ferma, sbatte gli occhi (in loop)
//   + i nove siparietti elencati in @/lib/mascotteTars
//
// I siparietti partono da soli ogni tanto e poi tornano a idle: dentro una
// clip che gira in continuo Tars cadrebbe ogni pochi secondi, insopportabile
// in un CRM che qualcuno tiene aperto tutto il giorno. E si estraggono da un
// mazzo, non a caso: prima di rivedere la stessa clip si vedono le altre.
//
// CONTINUITÀ. Tre cose la rompevano, e vanno tenute tutte e tre:
//
//  1. Le clip in loop ripartivano da un fotogramma lontano dall'ultimo, e a
//     ogni giro si vedeva uno scatto. Ora idle e indica sono montate ad
//     andirivieni (avanti e a ritroso), quindi la cucitura vale zero per
//     costruzione. Vedi scripts/mascotte/mascotte-video.sh.
//  2. Un solo <video> con key={posa} veniva distrutto e ricreato a ogni
//     cambio, e la clip nuova doveva caricarsi da capo: buco visibile. Ora
//     stanno montate tutte, si scambia solo quale è in vista.
//  3. La dissolvenza sfumava prima verso il nulla e poi rientrava, così la
//     mascotte spariva per un istante. Ora le due clip si accavallano.
//
// I file nascono da scripts/mascotte/mascotte-video.sh. Sono WebM/VP9 con
// alpha vero: l'MP4 "scontornato" del generatore è opaco (soggetto su nero),
// e l'alpha viene ricostruito confrontando le due versioni degli stessi
// fotogrammi.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MAZZO_NUOVO,
  POSE_TUTTE,
  eSiparietto,
  pescaSiparietto,
  posaARiposo,
  posterDi,
  puoPartireSiparietto,
  vaInLoop,
  vaPrecaricata,
  vaSpecchiata,
  type PosaMascotte,
  type PosaOccasionale,
} from "@/lib/mascotteTars";
import { cn } from "@/lib/utils";

export type { PosaMascotte };

// Nove clip su undici si agganciano alla posa neutra e passano senza
// stacco. Restano evento e cartello, che cominciano in una posa diversa
// (una a metà inciampo, l'altra col cartello già in mano): lì serve una
// dissolvenza vera, e 220ms erano corti abbastanza da leggersi come stacco.
// Fonderle dentro la clip non è la via — due pose diverse sovrapposte danno
// un fantasma, con antenne doppie.
const DISSOLVENZA_MS = 320;
// Quanto Tars sta a riposo fra un siparietto e l'altro. La posa a riposo è
// una camminata sul posto: ogni secondo di pausa è un secondo in cui Tars
// cammina e basta. A 20-45s la pausa si prendeva l'ottanta per cento del
// tempo e sembrava che la mascotte non facesse altro; con 4-10s e clip da
// cinque secondi resta una pausa, non lo spettacolo principale.
// Intervallati, non in loop: una clip che gira in continuo farebbe cadere
// Tars ogni sei secondi.
const SIPARIETTO_PAUSA_MIN_MS = 4_000;
const SIPARIETTO_PAUSA_MAX_MS = 10_000;
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
  // Il prossimo siparietto si estrae appena finisce quello prima, non quando
  // scatta il timer: così c'è tutto il tempo di scaricarlo prima di doverlo
  // mostrare, senza precaricare in blocco 4,2 MB di clip all'apertura.
  // Si estrae da un mazzo, non a caso: v. pescaSiparietto.
  const [estratto, setEstratto] = useState(() =>
    pescaSiparietto(MAZZO_NUOVO, Math.random),
  );
  const prossimo = estratto.posa;
  // Il prossimo e quello dopo: sono i due che vanno scaldati. La seconda
  // carta è già decisa (sta in cima al mazzo) tranne che a fine giro, dove
  // il giro nuovo non è ancora mescolato: lì se ne scalda una sola.
  const inArrivo = useMemo(
    () =>
      [estratto.posa, estratto.mazzo.daGiocare[0]].filter(
        (p): p is PosaOccasionale => Boolean(p),
      ),
    [estratto],
  );
  const video = useRef(new Map<PosaMascotte, HTMLVideoElement>());

  const cambiaPosa = useCallback((nuova: PosaMascotte) => {
    setPosa(nuova);
  }, []);

  // Chi entra riparte dal principio, chi esce si ferma dov'è: resta pronto,
  // e mentre sfuma continua a mostrare l'ultimo fotogramma invece di un buco.
  useEffect(() => {
    for (const p of POSE_TUTTE) {
      const el = video.current.get(p);
      if (!el) continue;
      if (p !== posa) {
        el.pause();
        continue;
      }
      // Un siparietto riparte sempre dal principio; le pose in loop no,
      // girano già senza cucitura e riavvolgerle si vedrebbe.
      if (!vaInLoop(p)) el.currentTime = 0;
      // Il browser può rifiutare (scheda nascosta): la rete di sicurezza sotto
      // riporta comunque a riposo, non serve inseguire l'errore.
      void el.play().catch(() => {});
    }
  }, [posa]);

  const riposo = posaARiposo(attiva);

  // Il pannello comanda: aperto → indica, chiuso → torna in piedi. Un
  // siparietto in corso viene interrotto, non aspettato.
  useEffect(() => {
    setPosa(prima => (prima === riposo ? prima : riposo));
  }, [riposo]);

  useEffect(() => {
    if (!puoPartireSiparietto(posa, attiva, ridotto)) return;
    const t = setTimeout(
      () => cambiaPosa(prossimo),
      attesa(SIPARIETTO_PAUSA_MIN_MS, SIPARIETTO_PAUSA_MAX_MS),
    );
    return () => clearTimeout(t);
  }, [posa, attiva, ridotto, prossimo, cambiaPosa]);

  // Finito un siparietto se ne estrae un altro e lo si scalda: preload
  // "auto" da solo non basta su un elemento già montato, serve load().
  //
  // Si pesca solo dopo che una clip è andata davvero in onda. Pescare a
  // ogni ritorno alla posa a riposo brucerebbe una carta anche solo aprendo
  // e chiudendo il pannello, e il giro salterebbe pose che nessuno ha visto.
  const inOnda = useRef(false);
  useEffect(() => {
    if (eSiparietto(posa)) {
      inOnda.current = true;
      return;
    }
    if (!inOnda.current) return;
    inOnda.current = false;
    setEstratto(prec => pescaSiparietto(prec.mazzo, Math.random));
  }, [posa]);

  useEffect(() => {
    for (const p of inArrivo) {
      const el = video.current.get(p);
      // readyState 4 = già in memoria: un load() in più la riscaricherebbe.
      if (el && p !== posa && el.readyState < 4) el.load();
    }
  }, [inArrivo, posa]);

  // Rete di sicurezza. onEnded scatta solo se il video arriva davvero in
  // fondo: con la scheda in secondo piano il browser mette in pausa la
  // riproduzione, e se il file non carica non parte nemmeno. Senza questo
  // Tars resterebbe piantato nel siparietto — per terra o col cartello in
  // mano — finché non lo si clicca.
  useEffect(() => {
    if (posa === riposo) return;
    const t = setTimeout(() => cambiaPosa(riposo), SIPARIETTO_DURATA_MAX_MS);
    return () => clearTimeout(t);
  }, [posa, riposo, cambiaPosa]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etichetta}
      title={etichetta}
      className={cn(
        "relative block shrink-0 rounded-xl outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      {ridotto ? (
        <img
          src={`/mascotte/${posterDi(posa)}-poster.png`}
          alt=""
          draggable={false}
          className={cn(
            "block size-full select-none",
            vaSpecchiata(posa) && "-scale-x-100",
          )}
        />
      ) : (
        POSE_TUTTE.map(p => (
          <video
            key={p}
            ref={el => {
              if (el) video.current.set(p, el);
              else video.current.delete(p);
            }}
            src={`/mascotte/${p}.webm`}
            poster={`/mascotte/${posterDi(p)}-poster.png`}
            preload={vaPrecaricata(p, inArrivo) ? "auto" : "none"}
            autoPlay={p === "idle"}
            muted
            playsInline
            loop={vaInLoop(p)}
            onEnded={vaInLoop(p) ? undefined : () => cambiaPosa(riposo)}
            className={cn(
              "absolute inset-0 block size-full select-none transition-opacity",
              p === posa ? "opacity-100" : "opacity-0",
              vaSpecchiata(p) && "-scale-x-100",
            )}
            style={{ transitionDuration: `${DISSOLVENZA_MS}ms` }}
          />
        ))
      )}
    </button>
  );
}

export default MascotteTars;
