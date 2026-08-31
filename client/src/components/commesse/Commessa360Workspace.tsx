import type { ReactNode } from "react";

export type Commessa360WorkspaceProps = {
  overview?: ReactNode;
  timeline: ReactNode;
  documents: ReactNode;
  operations: ReactNode;
  economy?: ReactNode;
  communications?: ReactNode;
  tars?: ReactNode;
  details?: ReactNode;
};

/**
 * Griglia Record 360. Mantiene P0/P1 nel flusso principale e sposta il
 * contesto secondario nell'inspector desktop senza duplicare il contenuto.
 */
export default function Commessa360Workspace({
  overview,
  timeline,
  documents,
  operations,
  economy,
  communications,
  tars,
  details,
}: Commessa360WorkspaceProps) {
  const hasInspector = Boolean(operations || economy || communications || tars);

  return (
    <div
      data-page="commessa-360"
      className="grid min-w-0 items-start gap-4 sm:gap-5 min-[1200px]:grid-cols-12"
    >
      <div
        className={
          hasInspector
            ? "min-w-0 space-y-4 sm:space-y-5 min-[1200px]:col-span-8"
            : "min-w-0 space-y-4 sm:space-y-5 min-[1200px]:col-span-12"
        }
      >
        {overview ? (
          <section aria-label="Sintesi commessa" className="min-w-0">
            {overview}
          </section>
        ) : null}

        <section
          aria-label="Timeline della commessa"
          data-mobile-priority="p1"
          className="min-w-0"
        >
          {timeline}
        </section>

        <section
          aria-label="Sezioni della commessa"
          data-mobile-priority="p1"
          className="min-w-0"
        >
          {documents}
        </section>
      </div>

      {hasInspector ? (
        <aside
          aria-label="Contesto della commessa"
          className="min-w-0 space-y-4 sm:space-y-5 min-[1200px]:sticky min-[1200px]:top-5 min-[1200px]:col-span-4"
        >
          {operations ? (
            <section
              aria-label="Operatività"
              data-mobile-priority="p1"
              className="min-w-0"
            >
              {operations}
            </section>
          ) : null}
          {economy ? (
            <section
              aria-label="Economia"
              data-mobile-priority="p2"
              className="min-w-0"
            >
              {economy}
            </section>
          ) : null}
          {communications ? (
            <section
              aria-label="Comunicazioni"
              data-mobile-priority="p2"
              className="min-w-0"
            >
              {communications}
            </section>
          ) : null}
          {tars ? (
            <section
              aria-label="Tars"
              data-mobile-priority="p2"
              className="min-w-0"
            >
              {tars}
            </section>
          ) : null}
        </aside>
      ) : null}

      {details ? (
        <section
          aria-label="Dettagli commessa"
          data-mobile-priority="p2"
          className="min-w-0 min-[1200px]:col-span-12"
        >
          {details}
        </section>
      ) : null}
    </div>
  );
}
