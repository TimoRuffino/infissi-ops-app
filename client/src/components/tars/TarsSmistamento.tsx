// Smistamento Tars nella UI (02/09/2026): cosa Tars ha capito di una
// comunicazione e la proposta di collegamento da decidere con un click.
// Il server è il confine (flag, capability, sede): qui si mostra e si
// chiede, mai si applica da soli.
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Archive,
  Bot,
  Check,
  Link2,
  Loader2,
  MessageCircleReply,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

const ETICHETTA_URGENZA: Record<string, string> = {
  critica: "Critica",
  alta: "Alta",
  normale: "Normale",
  bassa: "Bassa",
};

const ETICHETTA_CATEGORIA: Record<string, string> = {
  operativa: "Operativa",
  nuovo_lead: "Nuovo contatto",
  amministrativa: "Amministrativa",
  fornitore: "Fornitore",
  offerta_marketing: "Marketing",
  spam: "Spam",
  da_classificare: "Da classificare",
};

function classeUrgenza(urgenza: string): string {
  if (urgenza === "critica") return "bg-danger-soft text-danger";
  if (urgenza === "alta") return "bg-warning-soft text-warning";
  return "bg-surface-2 text-text-2";
}

export function useDecisioneSmistamento(onDeciso?: () => void) {
  const utils = trpc.useUtils();
  return trpc.tars.smistamentoDecidi.useMutation({
    onSuccess: esito => {
      if (esito.decisione === "approvata") {
        toast.success(
          esito.archiviati > 0
            ? `Collegata; ${esito.archiviati} allegati archiviati nel fascicolo`
            : "Comunicazione collegata"
        );
      } else {
        toast.success("Proposta rifiutata");
      }
      for (const avvertenza of esito.avvertenze) toast.warning(avvertenza);
      void utils.tars.briefing.invalidate();
      void utils.tars.smistamentoProposte.invalidate();
      void utils.tars.smistamentoPerComunicazione.invalidate();
      void utils.mail.email.invalidate();
      void utils.mail.comunicazioni.invalidate();
      onDeciso?.();
    },
    onError: errore => toast.error(errore.message),
  });
}

/** Banner nel lettore messaggi: riepilogo, proposta e allegati archiviati. */
export function TarsSmistamentoBanner({
  comunicazioneId,
  abilitato,
}: {
  comunicazioneId: number;
  abilitato: boolean;
}) {
  const esito = trpc.tars.smistamentoPerComunicazione.useQuery(
    { comunicazioneId },
    { enabled: abilitato, retry: false, staleTime: 30_000 }
  );
  const decidi = useDecisioneSmistamento();
  if (!abilitato || !esito.data?.esito) return null;
  const s = esito.data.esito;
  const proposta =
    esito.data.propostaStato === "aperta" && s.collegamento.esito === "proposto";
  const bersaglio = s.collegamento.commessaId
    ? s.candidati.find(
        c => c.tipo === "commessa" && c.id === s.collegamento.commessaId
      )?.etichetta ?? `commessa #${s.collegamento.commessaId}`
    : s.candidati.find(
        c => c.tipo === "cliente" && c.id === s.collegamento.clienteId
      )?.etichetta ?? `cliente #${s.collegamento.clienteId ?? "-"}`;
  const inCorso =
    decidi.isPending && decidi.variables?.comunicazioneId === comunicazioneId;

  return (
    <section
      aria-label="Smistamento Tars"
      className={cn(
        "mt-2 space-y-2 rounded-[var(--radius-control)] border px-3 py-2.5",
        proposta
          ? "border-accent/40 bg-accent-soft"
          : "border-border-soft bg-surface"
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Bot className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-[13px] leading-5 text-text-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-text-1">Tars</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                classeUrgenza(s.urgenza)
              )}
            >
              {ETICHETTA_URGENZA[s.urgenza] ?? s.urgenza}
            </span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-2">
              {ETICHETTA_CATEGORIA[s.categoria] ?? s.categoria}
            </span>
            {s.richiedeRisposta && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-warning">
                <MessageCircleReply className="size-3" aria-hidden="true" />
                attende risposta
              </span>
            )}
          </div>
          <p className="mt-1 break-words [overflow-wrap:anywhere]">{s.riepilogo}</p>
          {s.istruzione && (
            <p className="mt-0.5 text-text-3">{s.istruzione}</p>
          )}
        </div>
      </div>

      {proposta && (
        <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border-soft bg-surface px-3 py-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-[13px] leading-5">
            <span className="inline-flex items-center gap-1 font-semibold text-text-1">
              <Link2 className="size-3.5" aria-hidden="true" />
              Propone di collegare a {bersaglio}
            </span>
            <p className="text-text-3">{s.collegamento.motivo}</p>
            {s.allegati.some(a => a.archiviare) && (
              <p className="inline-flex items-center gap-1 text-text-3">
                <Archive className="size-3" aria-hidden="true" />
                Archivierà {s.allegati.filter(a => a.archiviare).length} allegati
                nel fascicolo
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              className="min-h-11"
              disabled={inCorso}
              onClick={() =>
                decidi.mutate({ comunicazioneId, decisione: "approva" })
              }
            >
              {inCorso && decidi.variables?.decisione === "approva" ? (
                <Loader2 className="size-4 motion-safe:animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Collega
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={inCorso}
              onClick={() =>
                decidi.mutate({ comunicazioneId, decisione: "rifiuta" })
              }
            >
              <X className="size-4" />
              No
            </Button>
          </div>
        </div>
      )}

      {s.archiviati.length > 0 && (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-success">
          <Archive className="size-3.5" aria-hidden="true" />
          {s.archiviati.length === 1
            ? "1 allegato archiviato nel fascicolo da Tars"
            : `${s.archiviati.length} allegati archiviati nel fascicolo da Tars`}
        </p>
      )}
      {esito.data.stato === "errore" && (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-warning">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Smistamento non riuscito: {esito.data.ultimoErrore ?? "errore"}
        </p>
      )}
    </section>
  );
}

type Voce = {
  comunicazioneId: number;
  canale: "email" | "whatsapp";
  mittente: string;
  oggetto: string;
  riepilogo: string;
  urgenza: string;
  categoria: string;
  link: string;
  proposta: {
    commessaId: number | null;
    clienteId: number | null;
    etichetta: string;
    motivo: string;
    allegatiDaArchiviare: number;
  } | null;
};

export type SmistamentoSezione = {
  daDecidere: Voce[];
  daRispondere: Voce[];
  urgenti: Voce[];
  contatori: {
    smistateOggi: number;
    proposteAperte: number;
    collegateOggi: number;
    archiviatiOggi: number;
  };
};

type Sezione = SmistamentoSezione;

export function smistamentoVuoto(s: Sezione | null | undefined): boolean {
  return (
    !s ||
    (s.daDecidere.length === 0 &&
      s.daRispondere.length === 0 &&
      s.urgenti.length === 0)
  );
}

/** Le tre liste della Situazione, con la decisione via tRPC. */
export function SmistamentoSituazione({
  smistamento,
  onApriLink,
  compatto = false,
}: {
  smistamento: Sezione;
  onApriLink?: (link: string) => void;
  compatto?: boolean;
}) {
  const decidi = useDecisioneSmistamento();
  return (
    <SmistamentoSituazioneView
      smistamento={smistamento}
      onApriLink={onApriLink}
      compatto={compatto}
      onDecidi={(comunicazioneId, decisione) =>
        decidi.mutate({ comunicazioneId, decisione })
      }
      inCorsoId={decidi.isPending ? decidi.variables?.comunicazioneId ?? null : null}
    />
  );
}

/** Vista pura (senza hook): provabile con un render statico. */
export function SmistamentoSituazioneView({
  smistamento,
  onApriLink,
  onDecidi,
  inCorsoId,
  compatto = false,
}: {
  smistamento: Sezione;
  onApriLink?: (link: string) => void;
  onDecidi: (comunicazioneId: number, decisione: "approva" | "rifiuta") => void;
  inCorsoId: number | null;
  compatto?: boolean;
}) {
  const limite = compatto ? 4 : 8;
  const c = smistamento.contatori;
  const Riga = ({ voce, azione }: { voce: Voce; azione?: ReactNode }) => (
    <li className="flex min-w-0 items-start gap-2 px-3 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block min-w-0 max-w-full text-left hover:underline"
          onClick={onApriLink ? () => onApriLink(voce.link) : undefined}
        >
          <span className="font-semibold text-text-1">
            {voce.oggetto || voce.mittente}
          </span>
          <span className="text-text-3"> — {voce.mittente}</span>
        </button>
        <p className="text-text-2 break-words [overflow-wrap:anywhere]">
          {voce.proposta
            ? `→ ${voce.proposta.etichetta}: ${voce.proposta.motivo}`
            : voce.riepilogo}
        </p>
      </div>
      {azione}
    </li>
  );

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-3">
        Oggi: {c.smistateOggi} smistate · {c.collegateOggi} collegate ·{" "}
        {c.archiviatiOggi} allegati archiviati
        {c.proposteAperte > 0 ? ` · ${c.proposteAperte} da decidere` : ""}
      </p>
      {smistamento.daDecidere.length > 0 && (
        <div className="rounded-md border border-accent/30 bg-accent-soft py-1">
          <p className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold">
            <Link2 className="size-4 text-text-3" aria-hidden="true" />
            Da decidere
          </p>
          <ul>
            {smistamento.daDecidere.slice(0, limite).map(voce => {
              const inCorso = inCorsoId === voce.comunicazioneId;
              return (
                <Riga
                  key={voce.comunicazioneId}
                  voce={voce}
                  azione={
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        className="size-9"
                        aria-label="Collega come propone Tars"
                        title="Collega"
                        disabled={inCorso}
                        onClick={() => onDecidi(voce.comunicazioneId, "approva")}
                      >
                        {inCorso ? (
                          <Loader2 className="size-4 motion-safe:animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-9"
                        aria-label="Rifiuta la proposta"
                        title="Rifiuta"
                        disabled={inCorso}
                        onClick={() => onDecidi(voce.comunicazioneId, "rifiuta")}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  }
                />
              );
            })}
          </ul>
        </div>
      )}
      {smistamento.daRispondere.length > 0 && (
        <div className="rounded-md border border-warning/25 bg-warning-soft py-1">
          <p className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-warning">
            <MessageCircleReply className="size-4" aria-hidden="true" />
            Da rispondere
          </p>
          <ul>
            {smistamento.daRispondere.slice(0, limite).map(voce => (
              <Riga key={voce.comunicazioneId} voce={voce} />
            ))}
          </ul>
        </div>
      )}
      {smistamento.urgenti.length > 0 && (
        <div className="rounded-md border border-border-soft bg-surface py-1">
          <p className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold">
            <AlertTriangle className="size-4 text-text-3" aria-hidden="true" />
            Urgenti
          </p>
          <ul>
            {smistamento.urgenti
              .filter(
                v =>
                  !smistamento.daRispondere.some(
                    r => r.comunicazioneId === v.comunicazioneId
                  ) &&
                  !smistamento.daDecidere.some(
                    d => d.comunicazioneId === v.comunicazioneId
                  )
              )
              .slice(0, limite)
              .map(voce => (
                <Riga key={voce.comunicazioneId} voce={voce} />
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
