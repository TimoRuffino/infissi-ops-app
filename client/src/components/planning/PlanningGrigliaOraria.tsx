// Griglia oraria: la vista Settimana e la vista Giorno.
//
// Prima erano due elenchi: un rilievo di mezz'ora e una posa di nove ore
// occupavano la stessa riga, e con sette colonne da 55px ogni nome finiva
// troncato («Bianchi ...», «Via Garb...»). Guardare il calendario non diceva
// né quanto durava un lavoro né quando la giornata fosse libera — che è
// l'unica domanda per cui si apre un calendario di cantiere.
//
// Qui l'altezza di un blocco È la sua durata, i lavori in contemporanea stanno
// affiancati, e i buchi si vedono perché sono buchi. L'aritmetica sta in
// lib/grigliaOraria.ts ed è provata a parte; qui c'è solo il disegno.

import { Lock, MapPin, Users as UsersIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  CALENDAR_COLOR_MAP,
  CALENDAR_SOFT_MAP,
  toDateStr,
} from "@/lib/calendario";
import {
  disponiSovrapposti,
  finestraOraria,
  minutiDaOra,
  oraDaMinuti,
  oreDellaFinestra,
  posizioneBlocco,
  type BloccoDisposto,
} from "@/lib/grigliaOraria";

/** Altezza di un'ora. Sotto i ~48px un blocco da mezz'ora non regge il testo. */
const PX_PER_ORA = 56;

const NOMI_GIORNO = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

export type VoceGriglia = {
  id: number;
  /** `crm` si trascina e si apre; `ext` è di sola lettura (Google). */
  fonte: "crm" | "ext";
  tipo: string;
  tipoLabel: string;
  titolo: string;
  oraInizio: string | null;
  oraFine: string | null;
  indirizzo: string | null;
  squadra: string | null;
  /** Solo per `ext`: colore del calendario di origine. */
  colore?: string;
  /** Stato diverso da `pianificato`, quando merita di essere detto. */
  statoNotevole: string | null;
  originale: any;
};

export type PlanningGrigliaOrariaProps = {
  giorni: Date[];
  /** Voci già filtrate e indicizzate per `YYYY-MM-DD`. */
  perGiorno: Record<string, VoceGriglia[]>;
  onApri: (voce: VoceGriglia) => void;
  onNuovo: (dateStr: string, ora?: string) => void;
  onDragStart: (e: React.DragEvent, voce: VoceGriglia) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, dateStr: string) => void;
  draggingId: number | null;
  canCreate: boolean;
};

/** Le voci senza ora non stanno da nessuna parte sull'asse: vanno in cima. */
function senzaOrario(voci: VoceGriglia[]): VoceGriglia[] {
  return voci.filter(v => minutiDaOra(v.oraInizio) == null);
}

export default function PlanningGrigliaOraria({
  giorni,
  perGiorno,
  onApri,
  onNuovo,
  onDragStart,
  onDragOver,
  onDrop,
  draggingId,
  canCreate,
}: PlanningGrigliaOrariaProps) {
  const tutte = useMemo(
    () => giorni.flatMap(g => perGiorno[toDateStr(g)] ?? []),
    [giorni, perGiorno]
  );
  // Una finestra sola per tutte le colonne: sette giorni con assi diversi non
  // sono confrontabili, ed è il confronto il motivo per cui si guarda la
  // settimana intera.
  const finestra = useMemo(
    () => finestraOraria(tutte.map(v => ({ id: v.id, inizio: v.oraInizio, fine: v.oraFine }))),
    [tutte]
  );
  const ore = useMemo(() => oreDellaFinestra(finestra), [finestra]);
  const altezzaPx = ((finestra.aMin - finestra.daMin) / 60) * PX_PER_ORA;
  const oggiStr = toDateStr(new Date());
  const unaColonna = giorni.length === 1;

  // La riga «adesso» si muove: senza, alle 18 sembra ancora mattina.
  const [adessoMin, setAdessoMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setAdessoMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft bg-surface [&>*:first-child]:rounded-t-[var(--radius-panel)] [&>*:last-child]:overflow-hidden [&>*:last-child]:rounded-b-[var(--radius-panel)]">
      {/* Resta agganciata sotto la barra del periodo mentre le ore scorrono:
          a metà giornata bisogna ancora poter dire che colonna si guarda.
          L'altezza della barra la misura la pagina e la passa qui. */}
      <div
        className="sticky z-10 grid border-b border-border-soft bg-surface-2"
        style={{
          gridTemplateColumns: `3.25rem repeat(${giorni.length}, minmax(0, 1fr))`,
          top: "var(--planning-barra-h, 0px)",
        }}
      >
        <div aria-hidden className="border-r border-border-soft" />
        {giorni.map((giorno, idx) => {
          const dateStr = toDateStr(giorno);
          const oggi = dateStr === oggiStr;
          const conta = (perGiorno[dateStr] ?? []).length;
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onNuovo(dateStr)}
              disabled={!canCreate}
              aria-label={
                canCreate
                  ? `Nuovo appuntamento il ${dateStr}`
                  : `${giorno.toLocaleDateString("it-IT", { weekday: "long", day: "numeric" })}`
              }
              className={`min-w-0 border-r border-border-soft px-2 py-2 text-left last:border-r-0 transition-colors ${
                canCreate ? "hover:bg-surface-3 cursor-pointer" : "cursor-default"
              } ${oggi ? "bg-primary/[0.07]" : ""}`}
            >
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className="eyebrow !text-text-3">
                  {unaColonna
                    ? giorno.toLocaleDateString("it-IT", { weekday: "long" })
                    : NOMI_GIORNO[idx % 7]}
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    oggi ? "text-primary" : "text-text-1"
                  }`}
                >
                  {giorno.getDate()}
                </span>
                {conta > 0 && (
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-text-3">
                    {conta}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Fascia «senza orario»: esiste solo se serve, per non rubare spazio. */}
      {giorni.some(g => senzaOrario(perGiorno[toDateStr(g)] ?? []).length > 0) && (
        <div
          className="grid border-b border-border-soft bg-surface-2/60"
          style={{ gridTemplateColumns: `3.25rem repeat(${giorni.length}, minmax(0, 1fr))` }}
        >
          <div className="border-r border-border-soft px-1 py-1.5 text-right text-[10px] leading-tight text-text-3">
            senza
            <br />
            orario
          </div>
          {giorni.map(giorno => {
            const dateStr = toDateStr(giorno);
            const voci = senzaOrario(perGiorno[dateStr] ?? []);
            return (
              <div
                key={dateStr}
                className="min-w-0 space-y-1 border-r border-border-soft p-1 last:border-r-0"
              >
                {voci.map(voce => (
                  <BloccoVoce
                    key={`${voce.fonte}-${voce.id}`}
                    voce={voce}
                    righe={1}
                    onApri={onApri}
                    onDragStart={onDragStart}
                    draggingId={draggingId}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Nessuno scroll qui dentro: la pagina ne ha già uno suo, e due
          contenitori annidati vogliono dire che la rotella sposta quello
          sbagliato e che l'unico modo per vedere il resto è togliere il
          mouse dal calendario. La griglia sta alta quanto le sue ore e a
          scorrere ci pensa la pagina. */}
      <div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `3.25rem repeat(${giorni.length}, minmax(0, 1fr))`,
            height: altezzaPx,
          }}
        >
          {/* Asse delle ore */}
          <div className="relative border-r border-border-soft">
            {ore.map(m => (
              <div
                key={m}
                className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-text-3"
                style={{ top: ((m - finestra.daMin) / 60) * PX_PER_ORA }}
              >
                {m === finestra.daMin ? "" : oraDaMinuti(m)}
              </div>
            ))}
          </div>

          {giorni.map(giorno => {
            const dateStr = toDateStr(giorno);
            const oggi = dateStr === oggiStr;
            const voci = (perGiorno[dateStr] ?? []).filter(
              v => minutiDaOra(v.oraInizio) != null
            );
            const blocchi = disponiSovrapposti(
              voci.map(v => ({ id: v.id, inizio: v.oraInizio, fine: v.oraFine, voce: v }))
            );
            const adessoVisibile =
              oggi && adessoMin >= finestra.daMin && adessoMin <= finestra.aMin;
            return (
              <div
                key={dateStr}
                className={`relative min-w-0 border-r border-border-soft last:border-r-0 ${
                  oggi ? "bg-primary/[0.04]" : ""
                }`}
                onDragOver={onDragOver}
                onDrop={e => onDrop(e, dateStr)}
              >
                {/* Righe delle ore: struttura, non decorazione. */}
                {ore.map(m => (
                  <div
                    key={m}
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 border-t border-border-soft/60"
                    style={{ top: ((m - finestra.daMin) / 60) * PX_PER_ORA }}
                  />
                ))}
                {/* Mezz'ore: più leggere, aiutano a stimare senza contare. */}
                {ore.slice(0, -1).map(m => (
                  <div
                    key={`h-${m}`}
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border-soft/30"
                    style={{ top: ((m + 30 - finestra.daMin) / 60) * PX_PER_ORA }}
                  />
                ))}

                {blocchi.map(blocco => {
                  const voce = (blocco.evento as any).voce as VoceGriglia;
                  const pos = posizioneBlocco(
                    blocco as BloccoDisposto<any>,
                    finestra
                  );
                  const altezzaBloccoPx = (pos.altezzaPct / 100) * altezzaPx;
                  // Quante righe di testo ci stanno davvero: scriverne tre in
                  // 28px le rende tre righe illeggibili invece di una chiara.
                  const righe =
                    altezzaBloccoPx >= 86 ? 3 : altezzaBloccoPx >= 40 ? 2 : 1;
                  return (
                    <div
                      key={`${voce.fonte}-${voce.id}`}
                      className="absolute p-[2px]"
                      style={{
                        top: `${pos.topPct}%`,
                        height: `${pos.altezzaPct}%`,
                        left: `${pos.sinistraPct}%`,
                        width: `${pos.larghezzaPct}%`,
                      }}
                    >
                      <BloccoVoce
                        voce={voce}
                        righe={righe}
                        stretto={pos.larghezzaPct < 60}
                        compatto={!unaColonna}
                        orizzontale={unaColonna}
                        onApri={onApri}
                        onDragStart={onDragStart}
                        draggingId={draggingId}
                      />
                    </div>
                  );
                })}

                {adessoVisibile && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-primary"
                    style={{
                      top: ((adessoMin - finestra.daMin) / 60) * PX_PER_ORA,
                    }}
                  >
                    <span className="absolute -left-0.5 -top-[5px] block h-2 w-2 rounded-full bg-primary" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Un appuntamento dentro la griglia.
 *
 * Il colore del tipo sta in una barra piena a sinistra, non solo nel fondo:
 * i quattro fondi tenui stanno tutti all'85% di luminosità e a distanza RGB
 * 10-24 l'uno dall'altro, cioè indistinguibili di sfuggita. Una barra satura
 * larga 3px si riconosce senza leggere.
 */
function BloccoVoce(props: {
  voce: VoceGriglia;
  /** Quante righe di testo ci stanno nell'altezza disponibile. */
  righe: 1 | 2 | 3;
  stretto?: boolean;
  /** Sette colonne invece di una: le righe secondarie vanno accorciate. */
  compatto?: boolean;
  /** Vista Giorno: c'è larghezza da vendere, il testo sta su una riga. */
  orizzontale?: boolean;
  onApri: (voce: VoceGriglia) => void;
  onDragStart: (e: React.DragEvent, voce: VoceGriglia) => void;
  draggingId: number | null;
}) {
  const { voce, righe, stretto, compatto, orizzontale } = props;
  // In settimana una colonna è ~160px: «Squadra B — Neri Alberto» e «Via
  // Napoli 33, La Spezia» ci finiscono tagliate a metà parola, che è peggio
  // che dirne una sola per intero. Si tolgono le parti che si ripetono su
  // tutte le righe — il caposquadra e la città della sede — e resta quella
  // che distingue. Il testo intero è comunque nel tooltip e nell'aria-label.
  const squadraTesto =
    compatto && voce.squadra ? voce.squadra.split(" — ")[0] : voce.squadra;
  const indirizzoTesto =
    compatto && voce.indirizzo ? voce.indirizzo.split(", ")[0] : voce.indirizzo;
  const esterno = voce.fonte === "ext";
  const colore = esterno
    ? (voce.colore ?? "var(--color-cal-altro)")
    : (CALENDAR_COLOR_MAP[voce.tipo] ?? "var(--color-cal-altro)");
  const fondo = esterno
    ? `color-mix(in srgb, ${voce.colore ?? "var(--color-cal-altro)"} 12%, var(--color-surface))`
    : (CALENDAR_SOFT_MAP[voce.tipo] ?? "var(--color-cal-altro-soft)");
  const orario = voce.oraInizio
    ? voce.oraFine
      ? `${voce.oraInizio}–${voce.oraFine}`
      : voce.oraInizio
    : null;
  const descrizione = [
    voce.tipoLabel,
    voce.titolo,
    orario,
    voce.squadra,
    voce.indirizzo,
  ]
    .filter(Boolean)
    .join(" · ");

  // Nella vista Giorno il blocco è largo quanto la pagina: tutto su una riga,
  // così anche una mezz'ora dice squadra e indirizzo invece di solo il nome.
  // In settimana la colonna è stretta e il testo si impila.
  const dettagli = (
    <>
      {squadraTesto && (
        <span className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-text-2">
          <UsersIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">{squadraTesto}</span>
        </span>
      )}
      {indirizzoTesto && (
        <span className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-text-2">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{indirizzoTesto}</span>
        </span>
      )}
    </>
  );

  return (
    <button
      type="button"
      draggable={!esterno}
      onDragStart={esterno ? undefined : e => props.onDragStart(e, voce)}
      onClick={() => props.onApri(voce)}
      title={descrizione}
      aria-label={descrizione}
      // Un blocco alto una riga (mezz'ora) impilato mostra l'ora e taglia il
      // nome: si vede che c'è qualcosa e non chi. Su una riga sola ci stanno
      // tutti e due, ed è l'unica cosa che serve sapere a colpo d'occhio.
      className={`flex h-full w-full min-w-0 overflow-hidden rounded-[6px] border border-black/[0.04] pl-2 pr-1.5 py-1 text-left outline-none transition hover:brightness-[0.97] focus-visible:ring-[3px] focus-visible:ring-ring/55 ${
        orizzontale || righe === 1
          ? "flex-row items-center gap-1.5"
          : "flex-col gap-0.5"
      } ${props.draggingId === voce.id ? "opacity-40" : ""} ${
        esterno ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      }`}
      style={{
        backgroundColor: fondo,
        // La barra del tipo: piena, satura, sempre alla stessa larghezza. I
        // quattro fondi tenui sono a distanza RGB 10-24 e non si distinguono
        // di sfuggita; una barra satura sì.
        boxShadow: `inset 3px 0 0 0 ${colore}`,
      }}
    >
      <span className="flex min-w-0 shrink-0 items-center gap-1">
        {esterno && (
          <Lock className="h-2.5 w-2.5 shrink-0 opacity-70" style={{ color: colore }} />
        )}
        {orario && (
          <span
            className="shrink-0 text-[11px] font-semibold tabular-nums leading-none"
            style={{ color: colore }}
          >
            {righe === 1 && !orizzontale ? (voce.oraInizio ?? "") : orario}
          </span>
        )}
        {!esterno && (orizzontale || (righe >= 2 && !stretto)) && (
          <span
            className="shrink-0 rounded-[3px] px-1 py-px text-[9px] font-semibold uppercase tracking-wide leading-none text-white"
            style={{ backgroundColor: colore }}
          >
            {voce.tipoLabel}
          </span>
        )}
      </span>
      <span
        className={`min-w-0 truncate text-[12px] font-semibold leading-tight text-text-1 ${
          orizzontale ? "shrink-0" : ""
        }`}
      >
        {voce.titolo}
      </span>
      {orizzontale ? (
        <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          {dettagli}
        </span>
      ) : (
        righe >= 3 && !stretto && dettagli
      )}
      {voce.statoNotevole && (righe >= 2 || orizzontale) && (
        <span
          className={`shrink-0 text-[10px] font-medium uppercase tracking-wide text-text-3 ${
            orizzontale ? "ml-auto" : "mt-auto"
          }`}
        >
          {voce.statoNotevole}
        </span>
      )}
    </button>
  );
}
