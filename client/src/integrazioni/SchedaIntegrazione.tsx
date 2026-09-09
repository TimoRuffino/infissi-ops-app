import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  children,
}: {
  stato: StatoIntegrazione;
  titolo: string;
  descrizione: string;
  onCollega?: () => void;
  onAzione?: (azione: string) => void;
  children?: ReactNode;
}) {
  const problema = stato.problema;
  const Icona = problema ? AlertTriangle : stato.collegato ? CheckCircle2 : Circle;
  const coloreIcona = problema
    ? "text-warning"
    : stato.collegato
      ? "text-success"
      : "text-text-3";

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-start gap-3 px-1">
        <Icona aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${coloreIcona}`} />
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
          </p>
          <p className="mt-0.5 text-xs leading-5 text-text-3">{descrizione}</p>
        </div>
        {!stato.collegato && onCollega && (
          <Button size="sm" className="shrink-0" onClick={onCollega}>
            Collega
          </Button>
        )}
      </div>

      {problema && (
        <div className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
          <p className="text-sm font-semibold text-text-1">{problema.causa}</p>
          <p className="mt-1 text-sm text-text-2">{problema.rimedio}</p>
          {problema.azione && onAzione && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
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
