// Card di una proposta di Tars: titolo, motivazione, payload leggibile,
// confidenza a tacche, e i tre bottoni — Approva / Rifiuta / (Rispondi per
// le domande). Usata dall'inbox e dal banner in scheda commessa.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatEuroSimbolo } from "@/lib/euro";
import { statoLabel } from "@/lib/stato";
import { Check, X, Loader2, MessageCircleQuestion, Link2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import TarsAvatar from "@/components/TarsAvatar";

const TIPO_LABEL: Record<string, string> = {
  collega_comunicazione: "Email",
  collega_fattura: "Fattura",
  rinomina_documento: "Documento",
  nota_timeline: "Timeline",
  aggiornamento_magazzino: "Magazzino",
  modifica_cliente: "Cliente",
  modifica_commessa: "Commessa",
  ticket: "Ticket",
  pagamento: "Pagamento",
  avanzamento_stato: "Stato",
  bozza_risposta: "Bozza",
  segnalazione: "Segnalazione",
  domanda: "Domanda",
};

const MOTIVI_RIFIUTO: Array<{ value: string; label: string }> = [
  { value: "dato_sbagliato", label: "Dato sbagliato" },
  { value: "commessa_sbagliata", label: "Commessa sbagliata" },
  { value: "azione_non_necessaria", label: "Non necessaria" },
  { value: "lo_faccio_io", label: "Lo faccio io" },
  { value: "altro", label: "Altro" },
];

function ConfidenzaDots({ livello }: { livello: string }) {
  const n = livello === "alta" ? 3 : livello === "media" ? 2 : 1;
  return (
    <span
      className="text-xs text-muted-foreground shrink-0"
      title={`Confidenza ${livello}`}
    >
      {"●".repeat(n)}
      <span className="opacity-30">{"●".repeat(3 - n)}</span>
    </span>
  );
}

// Payload → righe leggibili in italiano. Mai JSON a video.
function describePayload(p: any): string[] {
  const out: string[] = [];
  const pay = p.payload ?? {};
  switch (p.tipo) {
    case "collega_comunicazione":
      out.push(
        `Collega la mail a ${pay.commessaCodice ?? `commessa #${pay.commessaId}`}`
      );
      break;
    case "collega_fattura":
      out.push(
        `Collega la fattura ${pay.fatturaNumero} (${formatEuroSimbolo(pay.fatturaImporto)}) a ${pay.commessaCodice ?? `commessa #${pay.commessaId}`}`
      );
      break;
    case "rinomina_documento":
      if (pay.nome) out.push(`Nuovo nome: ${pay.nome}`);
      if (pay.tipo) out.push(`Nuovo tipo: ${pay.tipo}`);
      break;
    case "nota_timeline":
      if (pay.note) out.push(`Nota: ${pay.note}`);
      break;
    case "aggiornamento_magazzino":
    case "modifica_cliente":
    case "modifica_commessa": {
      const campi = pay.campi ?? {};
      for (const [k, v] of Object.entries(campi)) {
        if (k === "importoTotale") {
          out.push(`Importo pattuito: ${formatEuroSimbolo(v as number)}`);
        } else if (k === "arrivato") {
          out.push(`Arrivato: ${v ? "sì" : "no"}`);
        } else {
          out.push(`${k}: ${String(v)}`);
        }
      }
      break;
    }
    case "ticket":
      out.push(`Oggetto: ${pay.oggetto}`);
      if (pay.categoria) out.push(`Categoria: ${pay.categoria}`);
      if (pay.contatto) out.push(`Contatto: ${pay.contatto}`);
      break;
    case "pagamento":
      out.push(
        `${formatEuroSimbolo(pay.importo)} · ${pay.data ?? "senza data"}${pay.metodo ? ` · ${pay.metodo}` : ""}${pay.tipo ? ` · ${pay.tipo.replace("_", " ")}` : ""}`
      );
      if (pay.note) out.push(`Nota: ${pay.note}`);
      break;
    case "avanzamento_stato":
      out.push(`Nuovo stato: ${statoLabel(pay.nuovoStato)}`);
      break;
    case "bozza_risposta":
      out.push(`A: ${pay.destinatario} (${pay.canale})`);
      if (pay.testo) out.push(pay.testo);
      break;
    case "segnalazione":
      out.push(`Severità ${pay.severita}: ${pay.descrizione}`);
      break;
  }
  return out;
}

export default function TarsPropostaCard({
  proposta,
  onDecisa,
}: {
  proposta: any;
  onDecisa?: () => void;
}) {
  const utils = trpc.useUtils();
  const [rifiutoAperto, setRifiutoAperto] = useState(false);
  const [rispostaLibera, setRispostaLibera] = useState("");

  const invalidate = () => {
    utils.tars.proposte.invalidate();
    utils.ficFatture.invalidate();
    utils.economia.invalidate();
    if (proposta.commessaId) {
      // La mutation approvata può aver toccato la commessa: rinfresca tutto
      // ciò che la mostra (trappola nota: mai invalidare solo byId).
      utils.commesse.invalidate();
      utils.timeline.invalidate();
      utils.preventiviContratti.invalidate();
      utils.magazzino.invalidate();
      utils.ticket.invalidate();
    }
    onDecisa?.();
  };

  // Il seguito gira sul server dopo la risposta: quando finisce nessuno ce
  // lo dice, quindi si ripassa a chiedere. Due colpi, poi basta — se Tars è
  // più lento di così la proposta comparirà al prossimo caricamento.
  const attendiSeguito = () => {
    toast.info("Tars sta cercando l'azione che chiude la situazione…");
    setTimeout(invalidate, 10_000);
    setTimeout(invalidate, 30_000);
  };

  const approva = trpc.tars.proposte.approva.useMutation({
    onSuccess: (p: any) => {
      toast.success(p.esito ?? "Proposta approvata");
      invalidate();
      if (p.seguitoAvviato) attendiSeguito();
    },
    onError: (e) => {
      toast.error(e.message);
      invalidate(); // stato "errore" va comunque mostrato
    },
  });
  const rifiuta = trpc.tars.proposte.rifiuta.useMutation({
    onSuccess: () => {
      toast.success("Proposta rifiutata");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const rispondi = trpc.tars.proposte.rispondi.useMutation({
    onSuccess: (p: any) => {
      toast.success("Risposta registrata");
      invalidate();
      if (p?.seguitoAvviato) attendiSeguito();
    },
    onError: (e) => toast.error(e.message),
  });

  const pendente = proposta.stato === "pendente";
  const righe = describePayload(proposta);
  const busy = approva.isPending || rifiuta.isPending || rispondi.isPending;

  return (
    <div className="rounded-lg border border-amber-300/70 dark:border-amber-700/50 border-l-4 border-l-amber-500 bg-card p-3 space-y-2">
      <div className="flex items-start gap-2.5">
        <TarsAvatar size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
              {proposta.origineId != null
                ? "Tars propone come chiuderla"
                : proposta.tipo === "domanda"
                  ? "Tars chiede"
                  : "Tars propone"}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-xs">
                {TIPO_LABEL[proposta.tipo] ?? proposta.tipo}
              </Badge>
              <ConfidenzaDots livello={proposta.confidenza} />
            </div>
          </div>
          <span className="font-medium text-sm block">{proposta.titolo}</span>
          {proposta.commessaId != null && proposta.commessaCodice && (
            <Link
              href={`/commesse/${proposta.commessaId}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
            >
              <Link2 className="h-3 w-3" />
              {proposta.commessaCodice}
              {proposta.commessaCliente ? ` — ${proposta.commessaCliente}` : ""}
            </Link>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{proposta.motivazione}</p>

      {righe.length > 0 && (
        <div className="text-sm space-y-0.5">
          {righe.map((r, i) => (
            <div key={i} className="flex gap-1">
              <span className="text-muted-foreground">→</span>
              <span className="whitespace-pre-wrap break-words">{r}</span>
            </div>
          ))}
        </div>
      )}

      {!pendente && (
        <div className="text-xs text-muted-foreground">
          {proposta.stato === "approvata" && (
            <span className="text-green-600 dark:text-green-500">
              ✓ Approvata{proposta.decisaDaNome ? ` da ${proposta.decisaDaNome}` : ""}
              {proposta.esito ? ` — ${proposta.esito}` : ""}
            </span>
          )}
          {proposta.stato === "rifiutata" && (
            <span>
              ✕ Rifiutata{proposta.decisaDaNome ? ` da ${proposta.decisaDaNome}` : ""}
              {proposta.motivoRifiuto ? ` — ${proposta.motivoRifiuto.replace(/_/g, " ")}` : ""}
            </span>
          )}
          {proposta.stato === "errore" && (
            <span className="text-destructive">
              ⚠ Approvata ma fallita: {proposta.esito}
            </span>
          )}
          {proposta.stato === "risposta" && (
            <span>↩ Risposta: {proposta.risposta}</span>
          )}
        </div>
      )}

      {pendente && proposta.tipo === "domanda" && (
        <div className="space-y-2">
          {(proposta.opzioni ?? []).map((o: string) => (
            <Button
              key={o}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => rispondi.mutate({ id: proposta.id, risposta: o })}
              className="mr-2"
            >
              <MessageCircleQuestion className="h-3.5 w-3.5 mr-1" />
              {o}
            </Button>
          ))}
          <div className="flex gap-2">
            <Textarea
              placeholder="Oppure rispondi liberamente…"
              value={rispostaLibera}
              onChange={(e) => setRispostaLibera(e.target.value)}
              rows={1}
              className="text-sm"
            />
            <Button
              size="sm"
              disabled={busy || !rispostaLibera.trim()}
              onClick={() =>
                rispondi.mutate({ id: proposta.id, risposta: rispostaLibera.trim() })
              }
            >
              Invia
            </Button>
          </div>
        </div>
      )}

      {pendente && proposta.tipo !== "domanda" && !rifiutoAperto && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => approva.mutate({ id: proposta.id })}
          >
            {approva.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5 mr-1" />
            )}
            Approva
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setRifiutoAperto(true)}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Rifiuta
          </Button>
        </div>
      )}

      {pendente && rifiutoAperto && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-muted-foreground mr-1">Perché?</span>
          {MOTIVI_RIFIUTO.map((m) => (
            <Button
              key={m.value}
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() =>
                rifiuta.mutate({ id: proposta.id, motivo: m.value as any })
              }
            >
              {m.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setRifiutoAperto(false)}
          >
            Annulla
          </Button>
        </div>
      )}
    </div>
  );
}
