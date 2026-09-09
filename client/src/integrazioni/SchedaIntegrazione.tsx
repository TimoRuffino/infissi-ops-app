import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { quandoBreve } from "@/lib/tarsDecisioniView";

type Problema = {
  causa: string;
  rimedio: string;
  azione: "ricollega" | "riprova" | "scegli" | "assistenza" | null;
};

export type StatoIntegrazione = {
  chiave: string;
  ambito: "sede" | "azienda";
  collegato: boolean;
  soggetto: string | null;
  verificatoIl: string | Date | null;
  problema: Problema | null;
};

const ETICHETTA_AZIONE: Record<string, string> = {
  ricollega: "Ricollega",
  riprova: "Riprova",
  scegli: "Scegli",
  assistenza: "Assistenza",
};

/**
 * La striscia unica dello stato. Tre domande, sempre le stesse tre:
 * a cosa sono collegata · come mi collego · cosa si è rotto e cosa devo fare.
 *
 * NON è una card, ed è deliberato: i pannelli che avvolge sono già `DataSurface`
 * e `CLAUDE.md` vieta le card annidate. La striscia sta SOPRA il pannello, come
 * sua sorella: `children` esce dal riquadro, non ci entra dentro.
 */
export function SchedaIntegrazione({
  stato,
  titolo,
  descrizione,
  onCollega,
  onAzione,
  onProva,
  provaInCorso = false,
  esitoProva,
  children,
}: {
  stato: StatoIntegrazione;
  titolo: string;
  descrizione: string;
  onCollega?: () => void;
  onAzione?: (azione: string) => void;
  /** La prova viva: chiama il fornitore per davvero (`verifica()`). */
  onProva?: () => void;
  provaInCorso?: boolean;
  /** `undefined` non ancora provato · `null` provato e a posto · altrimenti il guasto. */
  esitoProva?: Problema | null;
  children?: ReactNode;
}) {
  // Il guasto trovato dalla prova viva vale più di quello che il server sapeva
  // prima: è l'unico che sa la verità il giorno dopo una revoca.
  //
  // Ma una prova andata bene NON cancella il problema che lo stato conosce:
  // «scegli un'azienda» e «la piattaforma non è configurata» parlano d'altro
  // e restano veri anche mentre il fornitore risponde. Il verde si aggiunge,
  // non copre.
  const problema = esitoProva ?? stato.problema;
  const Icona = problema
    ? AlertTriangle
    : stato.collegato
      ? CheckCircle2
      : Circle;
  const coloreIcona = problema
    ? "text-warning"
    : stato.collegato
      ? "text-success"
      : "text-text-3";
  // Spec §6: senza il callback della piattaforma il collegamento non si
  // offre. Invitare a collegare e poi fallire a metà giro è peggio che
  // dire subito che il guasto non è del cliente.
  const assistenza = problema?.azione === "assistenza";
  const quando = quandoBreve(stato.verificatoIl);

  return (
    <div className="min-w-0 space-y-2">
      {/* `basis-64` sul blocco di sinistra e non solo `flex-1`: a 390 px il
          testo si sarebbe ristretto a un nastro di settanta pixel accanto ai
          pulsanti invece di mandarli a capo — `min-w-0` glielo permetteva.
          Con una base dichiarata i pulsanti scendono sotto, e la frase resta
          leggibile. */}
      <div className="flex min-w-0 flex-wrap items-start gap-3 px-1">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <Icona
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 ${coloreIcona}`}
          />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold text-text-1">{titolo}</span>
              <span className="text-text-2">
                {stato.collegato ? (
                  <>
                    collegato a{" "}
                    <strong className="font-semibold text-text-1">
                      {stato.soggetto ?? "—"}
                    </strong>
                  </>
                ) : (
                  "non ancora collegato"
                )}
              </span>
              <span className="text-xs text-text-3">
                {stato.ambito === "azienda" ? "per l'azienda" : "per la sede"}
                {quando ? ` · verificato il ${quando}` : ""}
              </span>
            </p>
            <p className="mt-0.5 text-xs leading-5 text-text-3">
              {descrizione}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {onProva && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={provaInCorso}
              onClick={onProva}
              title="Chiede al fornitore se il collegamento vale ancora: è l'unica prova che sa dire la verità dopo una revoca"
            >
              {provaInCorso ? (
                <Loader2
                  className="size-3.5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Stethoscope className="size-3.5" aria-hidden="true" />
              )}
              Prova il collegamento
            </Button>
          )}
          {!stato.collegato && onCollega && !assistenza && (
            <Button size="sm" className="min-h-11" onClick={onCollega}>
              Collega
            </Button>
          )}
        </div>
      </div>

      {esitoProva === null && (
        <p role="status" className="px-1 text-xs text-success">
          Il fornitore risponde: il collegamento è valido.
        </p>
      )}

      {problema && (
        <div className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
          <p className="text-sm font-semibold text-text-1">{problema.causa}</p>
          <p className="mt-1 text-sm text-text-2">{problema.rimedio}</p>
          {problema.azione && problema.azione !== "assistenza" && onAzione && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 min-h-11"
              onClick={() => onAzione(problema.azione!)}
            >
              {ETICHETTA_AZIONE[problema.azione]}
            </Button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
