// Sezione «Proposte» della pagina Tars (Tars libero, 02/09/2026): tutto
// ciò che Tars propone e aspetta una decisione umana, in un posto solo.
// Smistamento (comunicazioni da collegare) e gateway documentale
// (proposte dall'analisi dei documenti). Il server è il confine: qui si
// mostra e si decide con un click, mai si applica da soli.
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Brain,
  Check,
  ClipboardCheck,
  FileText,
  Link2,
  Loader2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ProposteDallAnalisi, useAnalisiAzienda } from "./TarsAnalisiAzienda";
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

function Gruppo({
  icona,
  titolo,
  conteggio,
  children,
}: {
  icona: React.ReactNode;
  titolo: string;
  conteggio: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border-soft py-1 last:border-b-0">
      <h3 className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold">
        {icona}
        {titolo}
        <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-2">
          {conteggio}
        </span>
      </h3>
      {children}
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
    <div className="flex shrink-0 gap-1">
      <Button
        size="icon"
        className="size-9"
        aria-label={etichettaSi}
        title={etichettaSi}
        disabled={inCorso}
        onClick={onSi}
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
        onClick={onNo}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

export function TarsProposte({
  dati,
  onApriLink,
  onSuggerimento,
}: {
  dati: ProposteTars;
  onApriLink: (link: string) => void;
  /** Precompila la chat con la richiesta di una proposta dell'analisi. */
  onSuggerimento: (testo: string) => void;
}) {
  const utils = trpc.useUtils();
  const [smistamentoInCorso, setSmistamentoInCorso] = useState<number | null>(
    null
  );
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

  if (dati.loading) {
    return (
      <p className="flex items-center gap-2 px-3 py-4 text-xs text-text-3">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        Carico le proposte…
      </p>
    );
  }

  if (dati.totale === 0) {
    return (
      <div className="px-3 py-4 text-xs leading-5 text-text-2">
        <p className="font-semibold text-text-1">Nessuna proposta in attesa.</p>
        <p>
          Tars agisce da solo dove è sicuro e lo trovi nel Registro; qui
          compare solo ciò che richiede una tua decisione: comunicazioni da
          collegare, importi, cancellazioni, effetti esterni.
        </p>
        {dati.erroreSmistamento && (
          <p className="mt-2 text-text-3">
            Smistamento non disponibile: {dati.erroreSmistamento}
          </p>
        )}
        {dati.errore && (
          <p className="mt-2 text-danger">{dati.errore}</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {dati.analisi.length > 0 && (
        <Gruppo
          icona={<Brain className="size-4 text-text-3" aria-hidden="true" />}
          titolo="Dall'analisi dell'azienda"
          conteggio={dati.analisi.length}
        >
          <ProposteDallAnalisi
            proposte={dati.analisi}
            onApriLink={onApriLink}
            onSuggerimento={onSuggerimento}
          />
        </Gruppo>
      )}

      {dati.smistamento.length > 0 && (
        <Gruppo
          icona={<Link2 className="size-4 text-text-3" aria-hidden="true" />}
          titolo="Comunicazioni da collegare"
          conteggio={dati.smistamento.length}
        >
          <ul>
            {dati.smistamento.map(voce => {
              const candidato = voce.candidati.find(c =>
                voce.collegamento.commessaId
                  ? c.tipo === "commessa" && c.id === voce.collegamento.commessaId
                  : c.tipo === "cliente" && c.id === voce.collegamento.clienteId
              );
              const inCorso = smistamentoInCorso === voce.comunicazioneId;
              return (
                <li
                  key={voce.comunicazioneId}
                  className="flex min-w-0 items-start gap-2 px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block min-w-0 max-w-full text-left hover:underline"
                      onClick={() => onApriLink(voce.link)}
                    >
                      <span className="font-semibold text-text-1">
                        {voce.oggetto || voce.mittente}
                      </span>
                      <span className="text-text-3">
                        {" "}
                        — {voce.mittente} · {dataBreve(voce.ricevutaIl)}
                      </span>
                    </button>
                    <p className="text-text-2 break-words [overflow-wrap:anywhere]">
                      → Collega a{" "}
                      <span className="font-medium text-text-1">
                        {candidato?.etichetta ??
                          (voce.collegamento.commessaId
                            ? `commessa ${voce.collegamento.commessaId}`
                            : `cliente ${voce.collegamento.clienteId}`)}
                      </span>
                      : {voce.collegamento.motivo}
                    </p>
                    {voce.allegatiDaArchiviare.length > 0 && (
                      <p className="text-[11px] text-text-3">
                        Archivia anche {voce.allegatiDaArchiviare.length}{" "}
                        {voce.allegatiDaArchiviare.length === 1
                          ? "allegato"
                          : "allegati"}
                        : {voce.allegatiDaArchiviare.join(", ")}
                      </p>
                    )}
                  </div>
                  <BottoniDecisione
                    inCorso={inCorso}
                    etichettaSi="Collega come propone Tars"
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
                </li>
              );
            })}
          </ul>
        </Gruppo>
      )}

      {dati.gateway.length > 0 && (
        <Gruppo
          icona={
            <ClipboardCheck className="size-4 text-text-3" aria-hidden="true" />
          }
          titolo="Dall'analisi dei documenti"
          conteggio={dati.gateway.length}
        >
          <ul>
            {dati.gateway.map(p => {
              const inCorso = gatewayInCorso === p.id;
              return (
                <li
                  key={p.id}
                  className="flex min-w-0 items-start gap-2 px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block min-w-0 max-w-full text-left hover:underline"
                      onClick={() => onApriLink(p.link)}
                    >
                      <span className="font-semibold text-text-1">
                        {p.etichetta}
                      </span>
                      <span className="text-text-3">
                        {" "}
                        · {dataBreve(p.creataIl)}
                      </span>
                    </button>
                    <p className="text-text-2 break-words [overflow-wrap:anywhere]">
                      {p.effetto ?? p.motivazione}
                    </p>
                    {p.valoreCorrente !== p.valoreProposto && (
                      <p
                        className={cn(
                          "text-[11px] text-text-3",
                          p.effetto && "mt-0.5"
                        )}
                      >
                        {p.valoreCorrente ?? "—"} → {p.valoreProposto}
                      </p>
                    )}
                    <p className="flex items-center gap-1 text-[11px] text-text-3">
                      <FileText className="size-3" aria-hidden="true" />
                      {p.documentoNome}
                    </p>
                  </div>
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
                </li>
              );
            })}
          </ul>
        </Gruppo>
      )}
    </div>
  );
}
