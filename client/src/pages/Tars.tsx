// Pagina /tars: conversazione con l'orchestratore, stato delle funzioni,
// briefing deterministico, azioni con undo/conferma a un click. Con
// FLAG_TARS spento la voce di menu non esiste, le query non partono
// nemmeno (gating su platform.interruttori: zero errori console) e la
// pagina raggiunta per URL mostra lo stato disattivato.

import { trpc } from "@/lib/trpc";
import TarsBriefing from "@/components/TarsBriefing";
import TarsOperationalPanels from "@/components/tars/TarsOperationalPanels";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  Plus,
  Send,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { classifyTarsAvailability } from "@/lib/goldenScreenContracts";

// Il briefing deterministico (T4) è condiviso con la Dashboard:
// components/TarsBriefing.tsx. Zero token, solo letture.

function IconaAzione({ azione }: { azione: any }) {
  if (azione.stato === "non_eseguito" || azione.stato === "non_necessaria") {
    return (
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
    );
  }
  if (azione.conferma) {
    return <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-text-3" />;
  }
  return <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-success" />;
}

// Azioni eseguite nel run (T2/T5): esito dichiarato + undo/conferma con
// UN click sui router esistenti (nessun passaggio dal modello). Lo stato
// «già fatto» è sollevato alla pagina (sopravvive al cambio
// conversazione); al re-mount della pagina entrambi gli endpoint restano
// idempotenti lato server (cancel su annullato e approvaEApplica su
// applicata rispondono senza doppi effetti) e l'esito onesto arriva nel
// toast.
function AzioniTurno({
  payload,
  annullati,
  applicate,
  segnaAnnullato,
  segnaApplicata,
}: {
  payload: any;
  annullati: number[];
  applicate: number[];
  segnaAnnullato: (id: number) => void;
  segnaApplicata: (id: number) => void;
}) {
  const utils = trpc.useUtils();
  const annulla = trpc.promemoria.cancel.useMutation({
    onSuccess: (_dati, variabili) => {
      segnaAnnullato(variabili.id);
      utils.promemoria.due.invalidate();
      toast.success("Promemoria annullato.");
    },
    onError: e => toast.error(e.message ?? "Annullamento non riuscito"),
  });
  // L'UNICA conferma umana delle proposte L3: un click, macchina interna
  // del gateway invariata. Dopo l'effetto reale si invalidano le cache
  // delle superfici toccate (stesso pattern di ProposteOrdine).
  const approvaEApplica = trpc.proposte.approvaEApplica.useMutation({
    onSuccess: (esito, variabili) => {
      segnaApplicata(variabili.id);
      utils.fornitori.ordini.invalidate();
      utils.proposte.invalidate();
      utils.tars.fascicolo.invalidate();
      if (esito.riusata) {
        toast.info("La proposta era già applicata: nessun doppio effetto.");
      } else {
        toast.success("Proposta approvata e applicata.");
      }
      if (esito.avvisoPosa) toast.warning(esito.avvisoPosa);
    },
    onError: e => toast.error(e.message ?? "Applicazione non riuscita"),
  });
  const azioni = payload?.azioni ?? [];
  if (!azioni.length) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {azioni.map((azione: any, i: number) => {
        const idPromemoria =
          azione.undoVia?.procedura === "promemoria.cancel"
            ? azione.undoVia.id
            : null;
        const giaAnnullato =
          idPromemoria != null && annullati.includes(idPromemoria);
        return (
          <div
            key={i}
            className="flex items-start gap-2 rounded-md bg-surface-2 px-2 py-1.5"
          >
            <IconaAzione azione={azione} />
            <div className="min-w-0 flex-1">
              <p className="text-xs break-words">
                {azione.descrizione}{" "}
                <span className="text-text-3">({azione.stato})</span>
              </p>
              {(azione.assunzioni ?? []).map((a: string, j: number) => (
                <p key={j} className="text-[11px] text-text-3 break-words">
                  Assunzione: {a}
                </p>
              ))}
              {azione.motivo && (
                <p className="text-[11px] text-warning break-words">
                  {azione.motivo}
                </p>
              )}
              {azione.conferma?.via === "proposte.approvaEApplica" && (
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  {azione.conferma.effetto && (
                    <p className="text-[11px] text-text-3 w-full break-words">
                      {azione.conferma.effetto}
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={
                      approvaEApplica.isPending ||
                      applicate.includes(azione.conferma.propostaId)
                    }
                    onClick={() =>
                      approvaEApplica.mutate({
                        id: azione.conferma.propostaId,
                      })
                    }
                  >
                    {applicate.includes(azione.conferma.propostaId)
                      ? "Applicata"
                      : "Approva e applica"}
                  </Button>
                </div>
              )}
            </div>
            {azione.undoDisponibile && idPromemoria != null && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] shrink-0"
                disabled={annulla.isPending || giaAnnullato}
                onClick={() => annulla.mutate({ id: idPromemoria })}
              >
                <Undo2 className="h-3 w-3 mr-1" />
                {giaAnnullato ? "Annullato" : "Annulla"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Etichette oneste del provider: mai far passare il dimostrativo per
// ragionamento reale.
const PROVIDER_LABEL: Record<string, string> = {
  finto: "dimostrativo",
  openai: "reale (OpenAI)",
};

// Pannello di stato: cosa può fare Tars ADESSO, con quali strumenti, e
// quanti run ha fatto la sede. Tutto deterministico, zero token.
function StatoPannello({ stato }: { stato: any }) {
  if (!stato) return null;
  return (
    <div className="rounded-md border border-border bg-surface p-3 space-y-2">
      <h2 className="text-xs font-semibold">Stato</h2>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-[11px]">
          provider: {PROVIDER_LABEL[stato.provider] ?? stato.provider}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {stato.strumentiDisponibili.length} strumenti
        </Badge>
      </div>
      <p className="text-[11px] text-text-3 tabular-nums">
        Run in sede: {stato.run.totale}
        {stato.run.degradati > 0 ? ` · ${stato.run.degradati} degradati` : ""}
      </p>
      {stato.providerDettaglio?.motivoIndisponibilita && (
        <p className="text-[11px] text-warning break-words">
          {stato.providerDettaglio.motivoIndisponibilita}
        </p>
      )}
      {stato.strumentiDisponibili.length === 0 && (
        <p className="text-[11px] text-warning">
          Nessuno strumento attivo (FLAG_TARS_READ_TOOLS spento).
        </p>
      )}
    </div>
  );
}

// Costi e budget (direzione): il server rifiuta gli altri ruoli con
// FORBIDDEN e il pannello semplicemente non esiste. Solo numeri: niente
// prompt, niente contenuti.
function CostiPannello({ enabled }: { enabled: boolean }) {
  // Il confine resta il server (tars.costi risponde FORBIDDEN agli altri):
  // qui si evita solo di chiedere ciò che verrà negato a ogni visita.
  const { user } = useAuth();
  const costi = trpc.tars.costi.useQuery(undefined, {
    enabled: enabled && isDirezione(user),
    retry: false,
    staleTime: 60_000,
  });
  if (!costi.data) return null;
  const d = costi.data;
  const eur = (v: number | null | undefined) =>
    v == null ? "—" : `${v.toFixed(2)} USD`;
  return (
    <div className="rounded-md border border-border bg-surface p-3 space-y-1.5">
      <h2 className="text-xs font-semibold">Costi e budget</h2>
      {d.riepilogo ? (
        <div className="space-y-0.5 text-[11px] text-text-2 tabular-nums">
          <p>
            Oggi:{" "}
            <span className="font-semibold text-text-1">
              {eur(d.riepilogo.spesaGiornoUsd)}
            </span>
            {d.riepilogo.residuoGiornoUsd != null && (
              <span className="text-text-3">
                {" "}
                · residuo {eur(d.riepilogo.residuoGiornoUsd)}
              </span>
            )}
          </p>
          <p>
            Mese:{" "}
            <span className="font-semibold text-text-1">
              {eur(d.riepilogo.spesaMeseUsd)}
            </span>
            {d.riepilogo.residuoMeseUsd != null && (
              <span className="text-text-3">
                {" "}
                · residuo {eur(d.riepilogo.residuoMeseUsd)}
              </span>
            )}
          </p>
          <p className="text-text-3">
            Ambito {d.riepilogo.ambito}: il tetto è unico per tutte le sedi.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-text-3">Nessuna spesa registrata.</p>
      )}
      {d.budgetConfigurato && (
        <p className="text-[11px] text-text-3 tabular-nums">
          Tetti: {d.budgetConfigurato.perRunUsd} /{" "}
          {d.budgetConfigurato.giornalieroUsd} /{" "}
          {d.budgetConfigurato.mensileUsd} USD (run / giorno / mese)
        </p>
      )}
      {d.motivoBudgetNonValido && (
        <p className="text-[11px] text-warning break-words">
          {d.motivoBudgetNonValido}
        </p>
      )}
    </div>
  );
}

function EvidenzeTurno({ payload }: { payload: any }) {
  const evidenze = payload?.evidenze ?? [];
  const omissioni = payload?.omissioni ?? [];
  if (!evidenze.length && !omissioni.length) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {evidenze.slice(0, 8).map((e: any, i: number) => (
        <p key={i} className="text-[11px] text-text-3 break-words">
          ◦ {e.descrizione}{" "}
          <span className="font-mono break-all">({e.riferimento})</span>
        </p>
      ))}
      {omissioni.map((o: string, i: number) => (
        <p key={`o${i}`} className="text-[11px] text-warning break-words">
          Omesso: {o}
        </p>
      ))}
    </div>
  );
}

export default function Tars() {
  const [conversazioneId, setConversazioneId] = useState<number | null>(null);
  const [messaggio, setMessaggio] = useState("");

  // La palette comandi arriva qui con ?q=…: il testo COMPILA il campo e
  // basta — l'invio resta un atto esplicito dell'utente (mai chiamate al
  // modello per il solo fatto di aver digitato). Il parametro si rimuove
  // subito per non ricompilare a ogni ritorno sulla pagina.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setMessaggio(q);
      window.history.replaceState(null, "", "/tars");
    }
  }, []);
  // Stato «già fatto» delle azioni, per TUTTI i turni della pagina.
  const [annullati, setAnnullati] = useState<number[]>([]);
  const [applicate, setApplicate] = useState<number[]>([]);
  const fondoRef = useRef<HTMLDivElement>(null);
  // La conversazione selezionata al momento dell'invio in volo: se
  // l'utente cambia selezione mentre aspetta, non gliela strappiamo.
  const inVoloRef = useRef<number | null>(null);
  const utils = trpc.useUtils();

  // Le query tars.* partono SOLO con i flag accesi: con Tars spento la
  // pagina (raggiunta per URL) non produce né richieste né errori console.
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const tarsAcceso = Boolean((interruttori.data as any)?.tars);

  const stato = trpc.tars.stato.useQuery(undefined, {
    retry: false,
    enabled: tarsAcceso,
  });
  const conversazioni = trpc.tars.conversazioni.useQuery(undefined, {
    retry: false,
    enabled: tarsAcceso,
  });
  const turni = trpc.tars.turni.useQuery(
    { conversazioneId: conversazioneId ?? 0 },
    { enabled: tarsAcceso && conversazioneId != null, retry: false }
  );

  const invia = trpc.tars.invia.useMutation({
    onSuccess: risposta => {
      setMessaggio("");
      setConversazioneId(prev =>
        prev === inVoloRef.current ? risposta.conversazioneId : prev
      );
      utils.tars.turni.invalidate({
        conversazioneId: risposta.conversazioneId,
      });
      utils.tars.conversazioni.invalidate();
      if (risposta.stato === "degradato") {
        // Il motivo lo dice il server (budget, limite della richiesta,
        // modello irraggiungibile): il toast non deve contraddirlo.
        toast.warning(risposta.testo);
      }
    },
    onError: e => toast.error(e.message ?? "Invio non riuscito"),
  });

  useEffect(() => {
    fondoRef.current?.scrollIntoView({ block: "end" });
  }, [turni.data?.length, invia.isPending]);

  const erroreKillSwitch =
    (stato.error as any)?.data?.code === "PRECONDITION_FAILED";
  const statoNonDisponibile = stato.error
    ? "Tars non risponde in questo momento. Il CRM funziona normalmente: riprova tra poco."
    : null;
  const platformNonDisponibile = interruttori.error
    ? "Non è possibile verificare lo stato di Tars in questo momento."
    : null;
  const availability = classifyTarsAvailability({
    enabled:
      interruttori.isPending ||
      Boolean(interruttori.error) ||
      (tarsAcceso && !erroreKillSwitch),
    pending: interruttori.isPending || (tarsAcceso && stato.isPending),
    provider: stato.data?.provider ?? null,
    unavailableReason: platformNonDisponibile || statoNonDisponibile,
  });
  const turniOperativi = (turni.data ?? []).filter(turno => {
    if (turno.ruolo !== "tars") return false;
    const payload = turno.payload as any;
    return Boolean(
      payload?.azioni?.length ||
        payload?.evidenze?.length ||
        payload?.omissioni?.length
    );
  });

  const inviaOra = () => {
    const testo = messaggio.trim();
    if (!testo || invia.isPending) return;
    inVoloRef.current = conversazioneId;
    invia.mutate({
      messaggio: testo,
      conversazioneId: conversazioneId ?? undefined,
    });
  };

  return (
    <TarsOperationalPanels
      availability={availability}
      briefing={<TarsBriefing enabled={tarsAcceso} />}
      status={<StatoPannello stato={stato.data} />}
      costs={<CostiPannello enabled={tarsAcceso} />}
      actions={
        turniOperativi.length > 0 ? (
          <div className="space-y-3">
            {turniOperativi.map(turno => (
              <section
                key={turno.id}
                aria-label={`Dettagli operativi turno ${turno.id}`}
                className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3"
              >
                <p className="codice-mono mb-2 text-text-3">
                  Turno #{turno.id}
                </p>
                <EvidenzeTurno payload={turno.payload} />
                <AzioniTurno
                  payload={turno.payload}
                  annullati={annullati}
                  applicate={applicate}
                  segnaAnnullato={id =>
                    setAnnullati(previous =>
                      previous.includes(id) ? previous : [...previous, id]
                    )
                  }
                  segnaApplicata={id =>
                    setApplicate(previous =>
                      previous.includes(id) ? previous : [...previous, id]
                    )
                  }
                />
              </section>
            ))}
          </div>
        ) : null
      }
      historyToolbar={
        <div className="flex min-w-0 items-center gap-1.5">
          <Select
            value={conversazioneId != null ? String(conversazioneId) : "nuova"}
            onValueChange={value =>
              setConversazioneId(value === "nuova" ? null : Number(value))
            }
          >
            <SelectTrigger
              className="h-9 w-[min(17rem,65vw)] text-xs"
              aria-label="Conversazioni"
            >
              <SelectValue placeholder="Nuova conversazione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nuova">Nuova conversazione</SelectItem>
              {(conversazioni.data ?? []).map(conversation => (
                <SelectItem
                  key={conversation.id}
                  value={String(conversation.id)}
                >
                  {conversation.titolo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            title="Nuova conversazione"
            aria-label="Nuova conversazione"
            onClick={() => setConversazioneId(null)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      }
      turns={
        <div
          role="log"
          aria-live="polite"
          aria-label="Conversazione con Tars"
          className="max-h-[32rem] min-h-64 space-y-3 overflow-y-auto rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3"
        >
          {conversazioneId == null && !invia.isPending ? (
            <div className="space-y-2 text-sm text-text-2">
              <p>
                Chiedi informazioni su commesse, gate e Centro Azioni. L'invio
                resta sempre un gesto esplicito.
              </p>
              {stato.data ? (
                <p className="text-xs text-text-3">
                  Strumenti attivi:{" "}
                  {stato.data.strumentiDisponibili
                    .map(tool => tool.nome)
                    .join(", ") || "nessuno (FLAG_TARS_READ_TOOLS spento)"}
                </p>
              ) : null}
            </div>
          ) : null}
          {(turni.data ?? []).map(turno => (
            <article
              key={turno.id}
              className={
                turno.ruolo === "utente"
                  ? "ml-auto max-w-[88%] rounded-[var(--radius-control)] bg-surface px-3 py-2 shadow-[var(--shadow-raised)]"
                  : "mr-auto max-w-[88%] rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2"
              }
            >
              <p className="whitespace-pre-wrap break-words text-sm">
                {turno.contenuto}
              </p>
              {turno.ruolo === "tars" && (turno.payload as any)?.degradato ? (
                <Badge className="mt-1 bg-warning-soft text-[10px] text-warning">
                  degradato
                </Badge>
              ) : null}
            </article>
          ))}
          {invia.isPending ? (
            <div className="mr-auto flex items-center gap-2 text-sm text-text-3">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              Tars sta lavorando…
            </div>
          ) : null}
          <div ref={fondoRef} />
        </div>
      }
      composer={
        tarsAcceso ? (
          <div className="flex min-w-0 items-end gap-2">
            <Textarea
              aria-label="Richiesta a Tars"
              value={messaggio}
              onChange={event => setMessaggio(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  inviaOra();
                }
              }}
              placeholder="Scrivi a Tars… (Invio per inviare)"
              className="min-h-11 max-h-40 min-w-0 text-base"
            />
            <Button
              className="h-11 shrink-0"
              disabled={!messaggio.trim() || invia.isPending}
              onClick={inviaOra}
              aria-label="Invia"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : null
      }
    />
  );
}
