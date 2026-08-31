// Pagina /tars: conversazione con l'orchestratore, stato delle funzioni,
// briefing deterministico, azioni con undo/conferma a un click. Con
// FLAG_TARS spento la voce di menu non esiste, le query non partono
// nemmeno (gating su platform.interruttori: zero errori console) e la
// pagina raggiunta per URL mostra lo stato disattivato.

import { trpc } from "@/lib/trpc";
import TarsBriefing from "@/components/TarsBriefing";
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
  BrainCircuit,
  Check,
  Clock,
  Loader2,
  Plus,
  Send,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// Il briefing deterministico (T4) è condiviso con la Dashboard:
// components/TarsBriefing.tsx. Zero token, solo letture.

function IconaAzione({ azione }: { azione: any }) {
  if (azione.stato === "non_eseguito" || azione.stato === "non_necessaria") {
    return <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />;
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
      utils.tars.turni.invalidate({ conversazioneId: risposta.conversazioneId });
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
  if ((interruttori.data && !tarsAcceso) || erroreKillSwitch) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <BrainCircuit className="h-5 w-5" /> Tars
        </h1>
        <p className="text-sm text-text-3 mt-2">
          Tars è disattivato su questa installazione (kill switch). Il CRM
          funziona normalmente senza di lui.
        </p>
      </div>
    );
  }
  if (stato.error) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <BrainCircuit className="h-5 w-5" /> Tars
        </h1>
        <p className="text-sm text-text-3 mt-2">
          Tars non risponde in questo momento. Il CRM funziona normalmente:
          riprova tra poco.
        </p>
      </div>
    );
  }

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
    <div className="p-4 md:p-6 h-full flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <BrainCircuit className="h-5 w-5 shrink-0" />
        <h1 className="text-lg font-semibold">Tars</h1>
        {stato.data && (
          <>
            <Badge variant="outline" className="text-[11px]">
              provider: {stato.data.provider}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {stato.data.strumentiDisponibili.length} strumenti
            </Badge>
            <span className="text-[11px] text-text-3">
              run in sede: {stato.data.run.totale}
              {stato.data.run.degradati > 0
                ? ` (${stato.data.run.degradati} degradati)`
                : ""}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Select
            value={conversazioneId != null ? String(conversazioneId) : "nuova"}
            onValueChange={valore =>
              setConversazioneId(valore === "nuova" ? null : Number(valore))
            }
          >
            <SelectTrigger
              className="h-8 text-xs w-[220px]"
              aria-label="Conversazioni"
            >
              <SelectValue placeholder="Nuova conversazione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nuova">Nuova conversazione</SelectItem>
              {(conversazioni.data ?? []).map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.titolo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Nuova conversazione"
            aria-label="Nuova conversazione"
            onClick={() => setConversazioneId(null)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border p-3 space-y-3 bg-surface">
        {conversazioneId == null && !invia.isPending && (
          <div className="text-sm text-text-3 space-y-2">
            <TarsBriefing enabled={tarsAcceso} />
            <p>
              Chiedimi delle commesse, dei gate, degli ordini fornitori, del
              Centro Azioni.
              {stato.data?.strumentiDisponibili.some(
                s => s.nome === "crea_promemoria"
              )
                ? " Posso anche creare, spostare e annullare i tuoi promemoria personali («ricordami domani alle 9 di…»)."
                : " In questa versione leggo soltanto: non modifico nulla."}
            </p>
            {stato.data && (
              <p className="text-[11px] break-words">
                Strumenti attivi:{" "}
                {stato.data.strumentiDisponibili.map(s => s.nome).join(", ") ||
                  "nessuno (FLAG_TARS_READ_TOOLS spento)"}
              </p>
            )}
          </div>
        )}
        {(turni.data ?? []).map(turno => (
          <div
            key={turno.id}
            className={
              turno.ruolo === "utente"
                ? "ml-auto max-w-[85%] rounded-md bg-surface-2 px-3 py-2"
                : "mr-auto max-w-[85%] rounded-md border border-border px-3 py-2"
            }
          >
            <p className="text-sm whitespace-pre-wrap break-words">
              {turno.contenuto}
            </p>
            {turno.ruolo === "tars" && (
              <>
                {(turno.payload as any)?.degradato && (
                  <Badge className="mt-1 bg-warning-soft text-warning text-[10px]">
                    degradato
                  </Badge>
                )}
                <AzioniTurno
                  payload={turno.payload}
                  annullati={annullati}
                  applicate={applicate}
                  segnaAnnullato={id =>
                    setAnnullati(prev =>
                      prev.includes(id) ? prev : [...prev, id]
                    )
                  }
                  segnaApplicata={id =>
                    setApplicate(prev =>
                      prev.includes(id) ? prev : [...prev, id]
                    )
                  }
                />
                <EvidenzeTurno payload={turno.payload} />
              </>
            )}
          </div>
        ))}
        {invia.isPending && (
          <div className="mr-auto flex items-center gap-2 text-text-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Tars sta lavorando…
          </div>
        )}
        <div ref={fondoRef} />
      </div>

      <div className="flex gap-2 items-end">
        <Textarea
          value={messaggio}
          onChange={e => setMessaggio(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              inviaOra();
            }
          }}
          placeholder="Scrivi a Tars… (Invio per inviare)"
          className="min-h-[44px] max-h-40 text-sm"
        />
        <Button
          className="h-10"
          disabled={!messaggio.trim() || invia.isPending}
          onClick={inviaOra}
          aria-label="Invia"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
