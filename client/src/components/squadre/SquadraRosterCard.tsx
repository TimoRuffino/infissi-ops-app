import { Briefcase, CalendarClock, Phone, UserCircle } from "lucide-react";

import StatoChip from "@/components/StatoChip";
import { Button } from "@/components/ui/button";

/** Squadra già sede-scoped dal router: la card non filtra e non autorizza. */
export type SquadraRosterSquadra = {
  id: number;
  nome: string;
  caposquadra?: string | null;
  telefono?: string | null;
  note?: string | null;
};

/** Intervento ancora aperto (pianificato o in corso), già selezionato a monte. */
export type SquadraRosterIntervento = {
  id: number;
  tipo: string;
  /** `YYYY-MM-DD` oppure null quando la data non è stata fissata. */
  dataPianificata?: string | null;
  stato: string;
};

/** Commessa assegnata e non archiviata, già selezionata a monte. */
export type SquadraRosterCommessa = {
  id: number;
  codice?: string | null;
  cliente?: string | null;
  stato: string;
};

export type SquadraRosterCardProps = {
  squadra: SquadraRosterSquadra;
  interventiAttivi: ReadonlyArray<SquadraRosterIntervento>;
  commesseAttive: ReadonlyArray<SquadraRosterCommessa>;
  /** Già risolto dal contenitore: specchio UX di `adminProcedure`. */
  canManage: boolean;
  /**
   * `false` finché interventi e commesse non sono noti (caricamento o errore):
   * un carico che non conosciamo non si scrive come zero.
   */
  caricoNoto?: boolean;
  onEdit(id: number): void;
  onDelete(id: number): void;
  onOpenCommessa?(id: number): void;
};

const TIPO_LABEL: Record<string, string> = {
  rilievo: "Rilievo",
  sopralluogo: "Rilievo",
  posa: "Posa",
  assistenza: "Assistenza",
  altro: "Altro",
};

const MAX_INTERVENTI = 3;
const MAX_COMMESSE = 4;

function etichettaTipo(tipo: string): string {
  return TIPO_LABEL[tipo] ?? tipo.replace(/_/g, " ");
}

function etichettaData(data: string | null | undefined): string {
  if (!data) return "Data da definire";
  return new Date(`${data}T12:00:00`).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
  });
}

function conteggio(n: number, singolare: string, plurale: string): string {
  return `${n} ${n === 1 ? singolare : plurale}`;
}

/**
 * Card roster di una squadra: chi è, come si contatta e su cosa è impegnata.
 *
 * Non esegue query né mutation e non conosce ruoli: riceve righe già filtrate
 * dal contenitore e `canManage` già risolto. Nessun dato economico.
 */
export default function SquadraRosterCard({
  squadra,
  interventiAttivi,
  commesseAttive,
  canManage,
  caricoNoto = true,
  onEdit,
  onDelete,
  onOpenCommessa,
}: SquadraRosterCardProps) {
  const titoloId = `squadra-${squadra.id}`;
  const interventiVisibili = interventiAttivi.slice(0, MAX_INTERVENTI);
  const commesseVisibili = commesseAttive.slice(0, MAX_COMMESSE);

  return (
    <article
      aria-labelledby={titoloId}
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-border-soft bg-surface-raised p-4"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id={titoloId}
            className="min-w-0 truncate text-base font-semibold text-text-1"
          >
            {squadra.nome}
          </h2>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-text-3">
            <UserCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
              {squadra.caposquadra || "Caposquadra non indicato"}
            </span>
          </p>
          {squadra.telefono ? (
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-text-2">
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <a
                href={`tel:${squadra.telefono}`}
                className="min-w-0 truncate rounded-[var(--radius-control)] underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/55"
              >
                {squadra.telefono}
              </a>
            </p>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => onEdit(squadra.id)}
            >
              Modifica
            </Button>
            <Button
              type="button"
              variant="dangerGhost"
              className="min-h-11"
              onClick={() => onDelete(squadra.id)}
            >
              Elimina
            </Button>
          </div>
        ) : null}
      </div>

      {squadra.note ? (
        <p className="min-w-0 break-words border-l-2 border-border-soft pl-2 text-xs text-text-3">
          {squadra.note}
        </p>
      ) : null}

      {caricoNoto ? (
        <>
          <p className="text-sm text-text-2">
            {conteggio(
              interventiAttivi.length,
              "intervento attivo",
              "interventi attivi"
            )}{" "}
            ·{" "}
            {conteggio(
              commesseAttive.length,
              "commessa attiva",
              "commesse attive"
            )}
          </p>

          <div className="min-w-0 space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-3">
              Interventi attivi
            </h3>
            {interventiVisibili.length === 0 ? (
              <p className="text-sm text-text-3">Nessun intervento pianificato</p>
            ) : (
              <ul className="min-w-0 space-y-1">
                {interventiVisibili.map(intervento => (
                  <li
                    key={intervento.id}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-text-2"
                  >
                    <CalendarClock
                      className="h-3.5 w-3.5 shrink-0 text-text-3"
                      aria-hidden="true"
                    />
                    <span className="shrink-0 font-medium text-text-1">
                      {etichettaTipo(intervento.tipo)}
                    </span>
                    <span className="shrink-0 tabular-nums text-text-3">
                      {etichettaData(intervento.dataPianificata)}
                    </span>
                    <span className="min-w-0 truncate text-xs uppercase tracking-wide text-text-3">
                      {intervento.stato.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
                {interventiAttivi.length > MAX_INTERVENTI ? (
                  <li className="text-xs text-text-3">
                    +{interventiAttivi.length - MAX_INTERVENTI} altri interventi
                  </li>
                ) : null}
              </ul>
            )}
          </div>

          <div className="min-w-0 space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-3">
              Commesse attive
            </h3>
            {commesseVisibili.length === 0 ? (
              <p className="text-sm text-text-3">Nessuna commessa assegnata</p>
            ) : (
              <ul className="min-w-0 space-y-1">
                {commesseVisibili.map(commessa => {
                  const etichetta =
                    commessa.cliente || commessa.codice || `Commessa #${commessa.id}`;
                  const riga = (
                    <>
                      <Briefcase
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block min-w-0 truncate text-sm font-medium text-text-1">
                          {etichetta}
                        </span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                          {commessa.codice ? (
                            <span className="codice-mono shrink-0 text-text-3">
                              {commessa.codice}
                            </span>
                          ) : null}
                          <StatoChip stato={commessa.stato} />
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={commessa.id} className="min-w-0">
                      {onOpenCommessa ? (
                        <button
                          type="button"
                          onClick={() => onOpenCommessa(commessa.id)}
                          className="flex min-h-11 w-full min-w-0 items-start gap-2 rounded-[var(--radius-control)] px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/55"
                        >
                          {riga}
                        </button>
                      ) : (
                        <span className="flex min-w-0 items-start gap-2 px-1.5 py-1.5">
                          {riga}
                        </span>
                      )}
                    </li>
                  );
                })}
                {commesseAttive.length > MAX_COMMESSE ? (
                  <li className="pl-1.5 text-xs text-text-3">
                    +{commesseAttive.length - MAX_COMMESSE} altre commesse
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-text-3">
          Interventi e commesse non disponibili: il carico di questa squadra non
          è stato letto.
        </p>
      )}
    </article>
  );
}
