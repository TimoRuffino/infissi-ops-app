// Vista «Proposte» della pagina Tars (02/09/2026, sera): tutto ciò che
// Tars vuole fare ma non fa da solo, in schede larghe e leggibili — cosa
// propone, perché, con quale effetto — e una decisione a un click. Il
// server è il confine: qui si mostra e si decide, mai si applica da soli.
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Brain,
  Check,
  ClipboardCheck,
  ExternalLink,
  Inbox,
  Link2,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { useAnalisiAzienda } from "./TarsAnalisiAzienda";
import { useDecisioneSmistamento } from "./TarsSmistamento";

export function useProposteTars(abilitato: boolean) {
  const smistamento = trpc.tars.smistamentoProposte.useQuery(undefined, {
    enabled: abilitato,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const gateway = trpc.tars.proposte.useQuery(undefined, {
    enabled: abilitato,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const analisi = useAnalisiAzienda(abilitato);
  return {
    smistamento: smistamento.data ?? [],
    gateway: gateway.data ?? [],
    analisi: analisi.proposte,
    totale:
      (smistamento.data?.length ?? 0) +
      (gateway.data?.length ?? 0) +
      analisi.proposte.length,
    loading: smistamento.isLoading || gateway.isLoading,
    // Lo smistamento può essere spento (flag) senza che il resto sparisca.
    erroreSmistamento: smistamento.error?.message ?? null,
    errore: gateway.error?.message ?? null,
    ricarica: () => {
      void smistamento.refetch();
      void gateway.refetch();
    },
  };
}

export type ProposteTars = ReturnType<typeof useProposteTars>;

function dataBreve(valore: string | Date): string {
  const d = new Date(valore);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ETICHETTA_CONFIDENZA: Record<string, string> = {
  alta: "Sicurezza alta",
  media: "Sicurezza media",
  bassa: "Sicurezza bassa",
};

function classeConfidenza(confidenza: string): string {
  if (confidenza === "alta") return "bg-success-soft text-success";
  if (confidenza === "media") return "bg-warning-soft text-warning";
  return "bg-surface-2 text-text-2";
}

const ETICHETTA_URGENZA: Record<string, string> = {
  critica: "Urgenza critica",
  alta: "Urgenza alta",
};

/** Una scheda: cosa propone Tars, perché, con quale effetto, e i bottoni. */
function SchedaProposta({
  icona,
  tipo,
  badge,
  quando,
  titolo,
  sottotitolo,
  proposta,
  motivo,
  effetti,
  azioni,
  onApri,
}: {
  icona: ReactNode;
  tipo: string;
  badge?: ReactNode;
  quando?: string;
  titolo: string;
  sottotitolo?: string | null;
  proposta: ReactNode;
  motivo?: string | null;
  effetti: string[];
  azioni: ReactNode;
  onApri?: () => void;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-2.5 rounded-md border border-border-soft bg-surface p-3">
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className="flex shrink-0 items-center gap-1 font-semibold uppercase tracking-wide text-text-3">
          {icona}
          {tipo}
        </span>
        {badge}
        {quando && <span className="ml-auto shrink-0 text-text-3">{quando}</span>}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-5 text-text-1 break-words [overflow-wrap:anywhere]">
          {titolo}
        </p>
        {sottotitolo && (
          <p className="text-xs text-text-3 break-words [overflow-wrap:anywhere]">
            {sottotitolo}
          </p>
        )}
      </div>
      <div className="rounded-md bg-accent-soft px-3 py-2 text-xs leading-5 text-text-1 break-words [overflow-wrap:anywhere]">
        {proposta}
      </div>
      {motivo && (
        <p className="text-xs leading-5 text-text-2 break-words [overflow-wrap:anywhere]">
          <span className="font-semibold text-text-1">Perché: </span>
          {motivo}
        </p>
      )}
      {effetti.length > 0 && (
        <ul className="space-y-0.5 text-[11px] leading-4 text-text-3">
          {effetti.map((e, i) => (
            <li key={i} className="flex gap-1.5">
              <span aria-hidden="true">·</span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{e}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {azioni}
        {onApri && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto min-h-9"
            onClick={onApri}
          >
            <ExternalLink aria-hidden="true" />
            Apri
          </Button>
        )}
      </div>
    </article>
  );
}

function Gruppo({
  icona,
  titolo,
  descrizione,
  conteggio,
  children,
}: {
  icona: ReactNode;
  titolo: string;
  descrizione: string;
  conteggio: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={titolo} className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-text-3">{icona}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-text-1">
            {titolo}{" "}
            <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-2">
              {conteggio}
            </span>
          </h3>
          <p className="text-xs text-text-3">{descrizione}</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{children}</div>
    </section>
  );
}

function BottoniDecisione({
  inCorso,
  etichettaSi,
  onSi,
  onNo,
}: {
  inCorso: boolean;
  etichettaSi: string;
  onSi: () => void;
  onNo: () => void;
}) {
  return (
    <>
      <Button type="button" size="sm" className="min-h-9" disabled={inCorso} onClick={onSi}>
        {inCorso ? (
          <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        {etichettaSi}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-9"
        disabled={inCorso}
        onClick={onNo}
      >
        <X aria-hidden="true" />
        Rifiuta
      </Button>
    </>
  );
}

export function TarsProposteBoard({
  dati,
  onApriLink,
  onSuggerimento,
  onVaiAlRegistro,
}: {
  dati: ProposteTars;
  onApriLink: (link: string) => void;
  /** Precompila la chat con la richiesta di una proposta dell'analisi. */
  onSuggerimento: (testo: string) => void;
  onVaiAlRegistro: () => void;
}) {
  const utils = trpc.useUtils();
  const [smistamentoInCorso, setSmistamentoInCorso] = useState<number | null>(null);
  const [gatewayInCorso, setGatewayInCorso] = useState<number | null>(null);
  const decidiSmistamento = useDecisioneSmistamento(() => {
    setSmistamentoInCorso(null);
    dati.ricarica();
  });
  const approva = trpc.proposte.approvaEApplica.useMutation({
    onSuccess: esito => {
      setGatewayInCorso(null);
      dati.ricarica();
      void utils.fornitori.ordini.invalidate();
      void utils.proposte.invalidate();
      toast.success(
        esito.riusata
          ? "La proposta era già applicata: nessun doppio effetto."
          : "Proposta approvata e applicata."
      );
      if (esito.avvisoPosa) toast.warning(esito.avvisoPosa);
    },
    onError: errore => {
      setGatewayInCorso(null);
      dati.ricarica();
      toast.error(errore.message || "Applicazione non riuscita.");
    },
  });
  const rifiuta = trpc.proposte.rifiuta.useMutation({
    onSuccess: () => {
      setGatewayInCorso(null);
      dati.ricarica();
      void utils.proposte.invalidate();
      toast.success("Proposta rifiutata");
    },
    onError: errore => {
      setGatewayInCorso(null);
      toast.error(errore.message || "Rifiuto non riuscito.");
    },
  });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-text-1">
            Proposte
            {dati.totale > 0 && (
              <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
                {dati.totale}
              </span>
            )}
          </h2>
          <p className="text-xs leading-5 text-text-3">
            Qui c'è solo ciò che Tars non fa da solo: decidi con un click. Il
            resto lo fa e lo scrive nel Registro.
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 shrink-0"
          aria-label="Aggiorna le proposte"
          title="Aggiorna"
          onClick={dati.ricarica}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {dati.loading ? (
          <p className="flex items-center gap-2 text-xs text-text-3">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Carico le proposte…
          </p>
        ) : dati.totale === 0 ? (
          <div className="mx-auto max-w-md py-10 text-center">
            <Inbox className="mx-auto size-8 text-text-3" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-text-1">
              Nessuna proposta in attesa
            </p>
            <p className="mt-1 text-xs leading-5 text-text-3">
              Tars collega, archivia e aggiorna da solo quando è sicuro. Qui
              compare solo ciò che richiede una tua decisione: comunicazioni
              ambigue, importi, cancellazioni, effetti esterni.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 min-h-9"
              onClick={onVaiAlRegistro}
            >
              Vedi cosa ha fatto Tars
            </Button>
            {dati.erroreSmistamento && (
              <p className="mt-4 text-[11px] text-text-3">
                Smistamento non disponibile: {dati.erroreSmistamento}
              </p>
            )}
            {dati.errore && <p className="mt-2 text-xs text-danger">{dati.errore}</p>}
          </div>
        ) : (
          <div className="space-y-8">
            {dati.smistamento.length > 0 && (
              <Gruppo
                icona={<Link2 className="size-4" aria-hidden="true" />}
                titolo="Comunicazioni da collegare"
                descrizione="Tars ha un candidato ma non è abbastanza sicuro da collegare da solo. Approva: collega la comunicazione e archivia gli allegati riconosciuti."
                conteggio={dati.smistamento.length}
              >
                {dati.smistamento.map(voce => {
                  const candidato = voce.candidati.find(c =>
                    voce.collegamento.commessaId
                      ? c.tipo === "commessa" && c.id === voce.collegamento.commessaId
                      : c.tipo === "cliente" && c.id === voce.collegamento.clienteId
                  );
                  const destinazione =
                    candidato?.etichetta ??
                    (voce.collegamento.commessaId
                      ? `commessa ${voce.collegamento.commessaId}`
                      : `cliente ${voce.collegamento.clienteId}`);
                  const inCorso = smistamentoInCorso === voce.comunicazioneId;
                  const allegati = voce.allegatiDaArchiviare;
                  return (
                    <SchedaProposta
                      key={voce.comunicazioneId}
                      icona={<Link2 className="size-3.5" aria-hidden="true" />}
                      tipo="Collega comunicazione"
                      badge={
                        <>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 font-medium",
                              classeConfidenza(voce.collegamento.confidenza)
                            )}
                          >
                            {ETICHETTA_CONFIDENZA[voce.collegamento.confidenza] ??
                              voce.collegamento.confidenza}
                          </span>
                          {ETICHETTA_URGENZA[voce.urgenza] && (
                            <span className="shrink-0 rounded-full bg-danger-soft px-1.5 py-0.5 font-medium text-danger">
                              {ETICHETTA_URGENZA[voce.urgenza]}
                            </span>
                          )}
                        </>
                      }
                      quando={dataBreve(voce.ricevutaIl)}
                      titolo={voce.oggetto || voce.mittente}
                      sottotitolo={voce.oggetto ? `da ${voce.mittente}` : null}
                      proposta={
                        <>
                          Collega a <strong>{destinazione}</strong>
                          {voce.riepilogo ? (
                            <span className="text-text-2"> — {voce.riepilogo}</span>
                          ) : null}
                        </>
                      }
                      motivo={voce.collegamento.motivo}
                      effetti={[
                        voce.collegamento.commessaId
                          ? "Collega la comunicazione alla commessa e la segna gestita."
                          : "Aggancia la comunicazione al cliente.",
                        allegati.length > 0
                          ? `Archivia ${allegati.length} ${allegati.length === 1 ? "allegato" : "allegati"} nel fascicolo: ${allegati.join(", ")}.`
                          : "Nessun allegato da archiviare.",
                      ]}
                      azioni={
                        <BottoniDecisione
                          inCorso={inCorso}
                          etichettaSi="Collega"
                          onSi={() => {
                            setSmistamentoInCorso(voce.comunicazioneId);
                            decidiSmistamento.mutate({
                              comunicazioneId: voce.comunicazioneId,
                              decisione: "approva",
                            });
                          }}
                          onNo={() => {
                            setSmistamentoInCorso(voce.comunicazioneId);
                            decidiSmistamento.mutate({
                              comunicazioneId: voce.comunicazioneId,
                              decisione: "rifiuta",
                            });
                          }}
                        />
                      }
                      onApri={() => onApriLink(voce.link)}
                    />
                  );
                })}
              </Gruppo>
            )}

            {dati.analisi.length > 0 && (
              <Gruppo
                icona={<Brain className="size-4" aria-hidden="true" />}
                titolo="Dall'analisi dell'azienda"
                descrizione="Azioni che Tars consiglia dopo la fotografia di oggi. «Chiedi a Tars» apre la chat con la richiesta già scritta: la esegue con i suoi strumenti e la registra."
                conteggio={dati.analisi.length}
              >
                {dati.analisi.map((p, i) => (
                  <SchedaProposta
                    key={i}
                    icona={<Brain className="size-3.5" aria-hidden="true" />}
                    tipo="Analisi di oggi"
                    titolo={p.testo}
                    proposta={<span className="italic">«{p.richiestaPerTars}»</span>}
                    effetti={[
                      "Nessun effetto finché non lo chiedi: Tars agisce in chat e lo scrive nel Registro.",
                    ]}
                    azioni={
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-9"
                        onClick={() => onSuggerimento(p.richiestaPerTars)}
                      >
                        <MessageSquarePlus aria-hidden="true" />
                        Chiedi a Tars
                      </Button>
                    }
                    onApri={p.link ? () => onApriLink(p.link!) : undefined}
                  />
                ))}
              </Gruppo>
            )}

            {dati.gateway.length > 0 && (
              <Gruppo
                icona={<ClipboardCheck className="size-4" aria-hidden="true" />}
                titolo="Dall'analisi dei documenti"
                descrizione="Conferme d'ordine e documenti letti da Tars che cambierebbero dati dell'ordine: si applicano solo con la tua approvazione."
                conteggio={dati.gateway.length}
              >
                {dati.gateway.map(p => {
                  const inCorso = gatewayInCorso === p.id;
                  return (
                    <SchedaProposta
                      key={p.id}
                      icona={<ClipboardCheck className="size-3.5" aria-hidden="true" />}
                      tipo="Documento"
                      quando={dataBreve(p.creataIl)}
                      titolo={p.etichetta}
                      sottotitolo={p.documentoNome}
                      proposta={p.effetto ?? p.motivazione}
                      motivo={p.effetto ? p.motivazione : null}
                      effetti={
                        p.valoreCorrente !== p.valoreProposto
                          ? [`Da «${p.valoreCorrente ?? "—"}» a «${p.valoreProposto}».`]
                          : []
                      }
                      azioni={
                        <BottoniDecisione
                          inCorso={inCorso}
                          etichettaSi="Approva e applica"
                          onSi={() => {
                            setGatewayInCorso(p.id);
                            approva.mutate({ id: p.id, hashAnteprima: p.hashAnteprima });
                          }}
                          onNo={() => {
                            setGatewayInCorso(p.id);
                            rifiuta.mutate({ id: p.id });
                          }}
                        />
                      }
                      onApri={() => onApriLink(p.link)}
                    />
                  );
                })}
              </Gruppo>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
