import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import DataSurface from "@/components/patterns/DataSurface";
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
 * La scheda unica. Tre domande, sempre le stesse tre:
 * a cosa sono collegata · come mi collego · cosa si è rotto e cosa devo fare.
 *
 * `children` ospita il pannello specifico dell'integrazione (il modulo IMAP,
 * l'elenco delle aziende FiC): la cornice è comune, il dentro no.
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

  return (
    <DataSurface
      density="compact"
      tone={problema ? "focal" : "default"}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <Icona
            aria-hidden="true"
            className={
              problema
                ? "size-4 shrink-0 text-warning"
                : stato.collegato
                  ? "size-4 shrink-0 text-success"
                  : "size-4 shrink-0 text-text-3"
            }
          />
          <span className="truncate">{titolo}</span>
        </span>
      }
      description={descrizione}
      toolbar={
        !stato.collegato && onCollega ? (
          <Button size="sm" onClick={onCollega}>
            Collega
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm text-text-2">
        {stato.collegato ? (
          <>
            Collegato a{" "}
            <strong className="font-semibold text-text-1">
              {stato.soggetto ?? "—"}
            </strong>
          </>
        ) : (
          "Non ancora collegato."
        )}
      </p>

      {problema && (
        <div className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
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
    </DataSurface>
  );
}
