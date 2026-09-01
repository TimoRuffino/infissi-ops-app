// Il volto di Tars. Era un segnaposto astratto (quadrato, glifo geometrico):
// da quando la mascotte vive nella shell su ogni pagina, tenerlo avrebbe
// lasciato due figure diverse per lo stesso agente sulla stessa schermata.
// Qui la mascotte torna ferma e tonda, e lo stato passa dall'anello.
//
// L'immagine è un asset statico: nessuna query, niente che possa aggirare il
// gate di Tars. Radix mostra il fallback finché il PNG non è caricato e la
// casella ha già la sua dimensione, quindi lo scambio non sposta il testo
// accanto.
import { Bot } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AVATAR_TARS_SRC,
  AVATAR_TARS_SRCSET,
  classeAnelloTars,
  type StatoTarsAvatar,
} from "@/lib/avatarTars";
import { cn } from "@/lib/utils";

export type { StatoTarsAvatar };

export default function TarsAvatar({
  stato = null,
  size = 40,
  nomeAccessibile,
  className,
}: {
  /**
   * Assente: identità e basta. È il caso dei turni, dove lo stato corrente
   * dell'agente non descrive una risposta già scritta.
   */
  stato?: StatoTarsAvatar | null;
  size?: number;
  /**
   * Da omettere quando accanto c'è già scritto «Tars»: in quel caso
   * l'immagine è decorativa e ripeterla infastidisce chi usa lo screen
   * reader. Da passare dove il testo vicino non nomina l'agente.
   */
  nomeAccessibile?: string;
  className?: string;
}) {
  const decorativo = nomeAccessibile == null;
  const iconaFallback = Math.max(12, Math.round(size * 0.52));
  // `flex` e non `inline-flex`: gli stati vuoti lo centrano con `mx-auto`.
  return (
    <span
      data-tars-avatar={stato ?? "identita"}
      className={cn("flex shrink-0", className)}
      style={{ width: size, height: size }}
      {...(decorativo
        ? { "aria-hidden": true as const }
        : { role: "img", "aria-label": nomeAccessibile })}
    >
      <Avatar className={cn("size-full bg-surface-2", classeAnelloTars(stato))}>
        <AvatarImage
          src={AVATAR_TARS_SRC}
          srcSet={AVATAR_TARS_SRCSET}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="object-contain select-none"
        />
        <AvatarFallback className="bg-surface-2 text-text-2">
          <Bot
            aria-hidden="true"
            style={{ width: iconaFallback, height: iconaFallback }}
          />
        </AvatarFallback>
      </Avatar>
    </span>
  );
}
