// Pagina /tars (T1, minimale ma reale): conversazione con l'orchestratore
// read-only, stato delle funzioni, strumenti disponibili, evidenze e
// omissioni SEMPRE mostrate. Con FLAG_TARS spento la voce di menu non
// esiste e il router rifiuta: questa pagina mostra allora lo stato.

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { BrainCircuit, Check, Loader2, Plus, Send, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Azioni eseguite nel run (T2): esito dichiarato + undo con UN click,
// direttamente sul router promemoria esistente (nessun passaggio dal
// modello). Le assunzioni del server (es. «mattina = 09:00») sono mostrate.
function AzioniTurno({ payload }: { payload: any }) {
  const [annullati, setAnnullati] = useState<number[]>([]);
  const utils = trpc.useUtils();
  const annulla = trpc.promemoria.cancel.useMutation({
    onSuccess: (_dati, variabili) => {
      setAnnullati(prev => [...prev, variabili.id]);
      utils.promemoria.due.invalidate();
      toast.success("Promemoria annullato.");
    },
    onError: e => toast.error(e.message ?? "Annullamento non riuscito"),
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
            <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                {azione.descrizione}{" "}
                <span className="text-text-3">({azione.stato})</span>
              </p>
              {(azione.assunzioni ?? []).map((a: string, j: number) => (
                <p key={j} className="text-[11px] text-text-3">
                  Assunzione: {a}
                </p>
              ))}
              {azione.motivo && (
                <p className="text-[11px] text-warning">{azione.motivo}</p>
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
        <p key={i} className="text-[11px] text-text-3">
          ◦ {e.descrizione} <span className="font-mono">({e.riferimento})</span>
        </p>
      ))}
      {omissioni.map((o: string, i: number) => (
        <p key={`o${i}`} className="text-[11px] text-warning">
          Omesso: {o}
        </p>
      ))}
    </div>
  );
}

export default function Tars() {
  const [conversazioneId, setConversazioneId] = useState<number | null>(null);
  const [messaggio, setMessaggio] = useState("");
  const fondoRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const stato = trpc.tars.stato.useQuery(undefined, { retry: false });
  const conversazioni = trpc.tars.conversazioni.useQuery(undefined, {
    retry: false,
  });
  const turni = trpc.tars.turni.useQuery(
    { conversazioneId: conversazioneId ?? 0 },
    { enabled: conversazioneId != null, retry: false }
  );

  const invia = trpc.tars.invia.useMutation({
    onSuccess: risposta => {
      setMessaggio("");
      setConversazioneId(risposta.conversazioneId);
      utils.tars.turni.invalidate({ conversazioneId: risposta.conversazioneId });
      utils.tars.conversazioni.invalidate();
      if (risposta.stato === "degradato") {
        toast.warning("Risposta in modalità degradata: il modello non era disponibile.");
      }
    },
    onError: e => toast.error(e.message ?? "Invio non riuscito"),
  });

  useEffect(() => {
    fondoRef.current?.scrollIntoView({ block: "end" });
  }, [turni.data?.length, invia.isPending]);

  if (stato.error) {
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

  const inviaOra = () => {
    const testo = messaggio.trim();
    if (!testo || invia.isPending) return;
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
          <select
            className="h-8 text-xs border border-border rounded-md bg-transparent px-2 max-w-[220px]"
            value={conversazioneId ?? ""}
            onChange={e =>
              setConversazioneId(e.target.value ? Number(e.target.value) : null)
            }
            aria-label="Conversazioni"
          >
            <option value="">Nuova conversazione</option>
            {(conversazioni.data ?? []).map(c => (
              <option key={c.id} value={c.id}>
                {c.titolo}
              </option>
            ))}
          </select>
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

      <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border p-3 space-y-3 bg-surface-1">
        {conversazioneId == null && !invia.isPending && (
          <div className="text-sm text-text-3 space-y-2">
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
              <p className="text-[11px]">
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
            <p className="text-sm whitespace-pre-wrap">{turno.contenuto}</p>
            {turno.ruolo === "tars" && (
              <>
                {(turno.payload as any)?.degradato && (
                  <Badge className="mt-1 bg-warning-soft text-warning text-[10px]">
                    degradato
                  </Badge>
                )}
                <AzioniTurno payload={turno.payload} />
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
