// Card di una proposta di Tars: titolo, motivazione, payload leggibile,
// confidenza a tacche, e i tre bottoni — Approva / Rifiuta / (Rispondi per
// le domande). Usata dall'inbox e dal banner in scheda commessa.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatEuroSimbolo } from "@/lib/euro";
import { statoLabel } from "@/lib/stato";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Lightbulb,
  Link2,
  Loader2,
  MessageCircleQuestion,
  PencilLine,
  Reply,
  Save,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import TarsAvatar from "@/components/TarsAvatar";
import { cn } from "@/lib/utils";
import { EvidenceList } from "@/components/tars/EvidenceList";

const TIPO_LABEL: Record<string, string> = {
  collega_comunicazione: "Email",
  crea_lead: "Nuovo lead",
  collega_fattura: "Fattura",
  archivia_allegato: "Allegato",
  rinomina_documento: "Documento",
  nota_timeline: "Timeline",
  aggiornamento_magazzino: "Magazzino",
  modifica_cliente: "Cliente",
  modifica_commessa: "Commessa",
  ticket: "Ticket",
  pagamento: "Pagamento",
  avanzamento_stato: "Stato",
  chiudi_commessa: "Chiusura",
  bozza_risposta: "Bozza",
  segnalazione: "Segnalazione",
  miglioramento_processo: "Processo",
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
      className="inline-flex shrink-0 items-center gap-1"
      title={`Confidenza ${livello}`}
      aria-label={`Confidenza ${livello}`}
    >
      {[1, 2, 3].map(i => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i <= n ? "bg-primary" : "bg-border-strong"
          )}
        />
      ))}
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
    case "crea_lead":
      out.push(
        `Crea cliente: ${pay.cliente?.cognome ?? ""} ${pay.cliente?.nome ?? ""}`.trim()
      );
      out.push(
        pay.comunicazioneId != null
          ? "Apre una commessa in preventivo e collega la comunicazione"
          : "Apre una commessa in preventivo"
      );
      if (pay.assegnatoNome) out.push(`Assegnato a: ${pay.assegnatoNome}`);
      if (pay.cliente?.email) out.push(`Email: ${pay.cliente.email}`);
      if (pay.commessa?.citta) out.push(`Città: ${pay.commessa.citta}`);
      break;
    case "collega_fattura":
      out.push(
        `Collega la fattura ${pay.fatturaNumero} (${formatEuroSimbolo(pay.fatturaImporto)}) a ${pay.commessaCodice ?? `commessa #${pay.commessaId}`}`
      );
      break;
    case "archivia_allegato":
      out.push(`File: ${pay.attachmentName ?? "Allegato"}`);
      out.push(`Archivia come: ${pay.nomeSuggerito ?? pay.attachmentName}`);
      out.push(
        `Tipo: ${String(pay.tipoDocumento ?? "altro").replace(/_/g, " ")}`
      );
      out.push(
        `Commessa: ${pay.commessaCodice ?? `#${pay.commessaId ?? p.commessaId}`}`
      );
      if (Array.isArray(pay.evidenze) && pay.evidenze.length > 0) {
        out.push(`Verifiche: ${pay.evidenze.join("; ")}`);
      }
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
    case "chiudi_commessa":
      out.push("Saldo verificato");
      out.push("Documenti obbligatori verificati");
      out.push("Nessun ticket o intervento aperto");
      out.push("Risultato: chiusura completa della commessa");
      break;
    case "bozza_risposta":
      out.push(`A: ${pay.destinatario} (${pay.canale})`);
      if (pay.testo) out.push(pay.testo);
      break;
    case "segnalazione":
      out.push(`Severità ${pay.severita}: ${pay.descrizione}`);
      break;
    case "miglioramento_processo":
      out.push(`Problema: ${pay.problema}`);
      out.push(`Impatto atteso: ${pay.impatto}`);
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
  const [correzioneAperta, setCorrezioneAperta] = useState(false);
  const [feedbackCorrezione, setFeedbackCorrezione] = useState("");
  const [azioneCorretta, setAzioneCorretta] = useState("");
  const [targetCorretto, setTargetCorretto] = useState("");
  const [responsabileCorretto, setResponsabileCorretto] = useState("");
  const [dataCorretta, setDataCorretta] = useState("");
  const pendente = proposta.stato === "pendente";
  const processo = proposta.tipo === "miglioramento_processo";
  const utenti = trpc.utenti.list.useQuery(undefined, {
    enabled: processo && pendente,
  });

  const invalidate = () => {
    utils.tars.proposte.invalidate();
    utils.tars.commandCenter.invalidate();
    utils.ficFatture.invalidate();
    utils.economia.invalidate();
    utils.mail.comunicazioni.invalidate();
    utils.clienti.invalidate();
    utils.commesse.invalidate();
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

  const attendiSeguito = () => {
    toast.info("Tars sta cercando l'azione che chiude la situazione…");
    invalidate();
  };

  const approva = trpc.tars.proposte.approva.useMutation({
    onSuccess: (p: any) => {
      toast.success(p.esito ?? "Proposta approvata");
      invalidate();
      if (p.seguitoAvviato) attendiSeguito();
    },
    onError: e => {
      toast.error(e.message);
      invalidate(); // stato "errore" va comunque mostrato
    },
  });
  const rifiuta = trpc.tars.proposte.rifiuta.useMutation({
    onSuccess: () => {
      toast.success("Proposta rifiutata");
      invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const rispondi = trpc.tars.proposte.rispondi.useMutation({
    onSuccess: (p: any) => {
      toast.success("Risposta registrata");
      invalidate();
      if (p?.seguitoAvviato) attendiSeguito();
    },
    onError: e => toast.error(e.message),
  });
  const correggiEsperimento =
    trpc.tars.proposte.correggiEsperimento.useMutation({
      onSuccess: () => {
        toast.success("Esperimento corretto. Tars terrà conto del feedback.");
        setCorrezioneAperta(false);
        setFeedbackCorrezione("");
        invalidate();
      },
      onError: e => toast.error(e.message),
    });

  const righe = describePayload(proposta);
  const busy =
    approva.isPending ||
    rifiuta.isPending ||
    rispondi.isPending ||
    correggiEsperimento.isPending;
  const utentiAssegnabili = (utenti.data ?? []).filter(
    (utente: any) => utente.attivo ?? true
  );
  const oggi = new Date();
  const minData = new Date(oggi.getTime() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const maxData = new Date(oggi.getTime() + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const apriCorrezione = () => {
    setAzioneCorretta(String(proposta.payload.azione ?? ""));
    setTargetCorretto(String(proposta.payload.targetValue ?? ""));
    setResponsabileCorretto(String(proposta.payload.responsibleId ?? ""));
    setDataCorretta(String(proposta.payload.reviewDate ?? ""));
    setFeedbackCorrezione("");
    setRifiutoAperto(false);
    setCorrezioneAperta(true);
  };

  const salvaCorrezione = () => {
    const targetValue = Number(targetCorretto);
    const responsibleId = Number(responsabileCorretto);
    if (!Number.isFinite(targetValue) || !Number.isSafeInteger(responsibleId)) {
      toast.error("Controlla obiettivo e responsabile.");
      return;
    }
    correggiEsperimento.mutate({
      id: proposta.id,
      feedback: feedbackCorrezione.trim(),
      azione: azioneCorretta.trim(),
      targetValue,
      responsibleId,
      reviewDate: dataCorretta,
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-primary/20 border-l-4 border-l-primary bg-card p-3 shadow-xs space-y-3",
        processo && "bg-[image:var(--gradient-soft)]"
      )}
    >
      <div className="flex items-start gap-2.5">
        {processo ? (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Lightbulb className="h-4 w-4" />
          </div>
        ) : (
          <TarsAvatar size="md" className="mt-0.5" />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              {proposta.origineId != null
                ? "Tars propone come chiuderla"
                : processo
                  ? "Esperimento operativo Tars"
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
          <span className="block break-words text-sm font-medium [overflow-wrap:anywhere]">
            {proposta.titolo}
          </span>
          {proposta.commessaId != null && proposta.commessaCodice && (
            <Link
              href={`/commesse/${proposta.commessaId}`}
              className="mt-0.5 inline-flex min-w-0 items-start gap-1 break-words text-xs text-primary hover:underline [overflow-wrap:anywhere]"
            >
              <Link2 className="h-3 w-3" />
              {proposta.commessaCodice}
              {proposta.commessaCliente ? ` — ${proposta.commessaCliente}` : ""}
            </Link>
          )}
        </div>
      </div>

      <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {proposta.motivazione}
      </p>

      {processo && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border/70 py-3 text-sm sm:grid-cols-4">
          <div className="min-w-0">
            <span className="block text-xs text-muted-foreground">
              Baseline
            </span>
            <strong className="block truncate text-base font-semibold">
              {proposta.payload.baselineValue} su{" "}
              {proposta.payload.baselineDenominator}
            </strong>
          </div>
          <div className="min-w-0">
            <span className="block text-xs text-muted-foreground">
              Obiettivo
            </span>
            <strong className="block truncate text-base font-semibold text-primary">
              {proposta.payload.targetValue}
            </strong>
          </div>
          <div className="min-w-0">
            <span className="block text-xs text-muted-foreground">
              Responsabile
            </span>
            <strong className="block truncate font-medium">
              {proposta.payload.responsibleName}
            </strong>
          </div>
          <div className="min-w-0">
            <span className="block text-xs text-muted-foreground">
              Verifica
            </span>
            <strong className="block truncate font-medium">
              {proposta.payload.reviewDate
                ? new Intl.DateTimeFormat("it-IT", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  }).format(new Date(`${proposta.payload.reviewDate}T12:00:00`))
                : "—"}
            </strong>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-4">
            <span className="block text-xs text-muted-foreground">
              Azione da provare
            </span>
            <strong className="block font-medium">
              {proposta.payload.azione}
            </strong>
          </div>
        </div>
      )}

      {processo && (proposta.correzioni?.length ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success-soft px-3 py-2 text-xs text-success">
          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Corretto con feedback umano
            {proposta.correzioni.at(-1)?.userName
              ? ` da ${proposta.correzioni.at(-1).userName}`
              : ""}
          </span>
        </div>
      )}

      {processo && pendente && correzioneAperta && (
        <div className="space-y-4 border-t border-border/70 pt-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <PencilLine className="h-4 w-4 text-primary" />
              Correggi l’esperimento
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              La metrica e la baseline restano quelle verificate sui dati del
              CRM.
            </p>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`tars-owner-${proposta.id}`}>Responsabile</Label>
              <Select
                value={responsabileCorretto}
                onValueChange={setResponsabileCorretto}
              >
                <SelectTrigger
                  id={`tars-owner-${proposta.id}`}
                  className="w-full"
                >
                  <SelectValue placeholder="Seleziona un utente" />
                </SelectTrigger>
                <SelectContent>
                  {utentiAssegnabili.map((utente: any) => (
                    <SelectItem key={utente.id} value={String(utente.id)}>
                      {`${utente.nome ?? ""} ${utente.cognome ?? ""}`.trim() ||
                        utente.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor={`tars-target-${proposta.id}`}>Obiettivo</Label>
                <Input
                  id={`tars-target-${proposta.id}`}
                  type="number"
                  min={0}
                  step={proposta.payload.unit === "count" ? 1 : 0.1}
                  value={targetCorretto}
                  onChange={event => setTargetCorretto(event.target.value)}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor={`tars-date-${proposta.id}`}>Verifica</Label>
                <Input
                  id={`tars-date-${proposta.id}`}
                  type="date"
                  min={minData}
                  max={maxData}
                  value={dataCorretta}
                  onChange={event => setDataCorretta(event.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`tars-action-${proposta.id}`}>
              Azione da provare
            </Label>
            <Textarea
              id={`tars-action-${proposta.id}`}
              rows={2}
              value={azioneCorretta}
              onChange={event => setAzioneCorretta(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`tars-feedback-${proposta.id}`}>
              Cosa ha sbagliato Tars?
            </Label>
            <Textarea
              id={`tars-feedback-${proposta.id}`}
              aria-describedby={`tars-feedback-help-${proposta.id}`}
              rows={2}
              maxLength={500}
              placeholder="Es. Questo controllo va assegnato a Stefano, che segue già questa fase."
              value={feedbackCorrezione}
              onChange={event => setFeedbackCorrezione(event.target.value)}
            />
            <p
              id={`tars-feedback-help-${proposta.id}`}
              className="flex justify-between gap-3 text-xs text-muted-foreground"
            >
              <span>Spiega il motivo in almeno 10 caratteri.</span>
              <span>{feedbackCorrezione.length}/500</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={
                busy ||
                feedbackCorrezione.trim().length < 10 ||
                azioneCorretta.trim().length < 8 ||
                !responsabileCorretto ||
                !dataCorretta
              }
              onClick={salvaCorrezione}
            >
              {correggiEsperimento.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Salva correzione
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setCorrezioneAperta(false)}
            >
              Annulla
            </Button>
          </div>
        </div>
      )}

      <EvidenceList items={proposta.evidenceRefs ?? []} />

      {righe.length > 0 && !processo && (
        <div className="space-y-1.5 rounded-md bg-background/70 px-3 py-2 text-sm">
          {righe.map((r, i) => (
            <div key={i} className="flex min-w-0 items-start gap-1.5">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {r}
              </span>
            </div>
          ))}
        </div>
      )}

      {!pendente && (
        <div className="border-t border-border/70 pt-2 text-xs text-muted-foreground">
          {proposta.stato === "approvata" && (
            <span className="flex items-start gap-1.5 text-success">
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Approvata
                {proposta.decisaDaNome ? ` da ${proposta.decisaDaNome}` : ""}
                {proposta.esito ? ` — ${proposta.esito}` : ""}
              </span>
            </span>
          )}
          {proposta.stato === "rifiutata" && (
            <span className="flex items-start gap-1.5">
              <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Rifiutata
                {proposta.decisaDaNome ? ` da ${proposta.decisaDaNome}` : ""}
                {proposta.motivoRifiuto
                  ? ` — ${proposta.motivoRifiuto.replace(/_/g, " ")}`
                  : ""}
              </span>
            </span>
          )}
          {proposta.stato === "errore" && (
            <span className="flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>Approvata ma fallita: {proposta.esito}</span>
            </span>
          )}
          {proposta.stato === "risposta" && (
            <span className="flex items-start gap-1.5">
              <Reply className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>Risposta: {proposta.risposta}</span>
            </span>
          )}
        </div>
      )}

      {proposta.stato === "errore" && (
        <div className="border-t border-border/70 pt-3">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => approva.mutate({ id: proposta.id })}
          >
            {approva.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            Riprendi dal punto interrotto
          </Button>
        </div>
      )}

      {pendente && proposta.tipo === "domanda" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(proposta.opzioni ?? []).map((o: string) => (
              <Button
                key={o}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  rispondi.mutate({ id: proposta.id, risposta: o })
                }
              >
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                {o}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Textarea
              placeholder="Oppure rispondi liberamente…"
              value={rispostaLibera}
              onChange={e => setRispostaLibera(e.target.value)}
              rows={1}
              className="text-sm"
            />
            <Button
              size="sm"
              disabled={busy || !rispostaLibera.trim()}
              onClick={() =>
                rispondi.mutate({
                  id: proposta.id,
                  risposta: rispostaLibera.trim(),
                })
              }
            >
              Invia
            </Button>
          </div>
        </div>
      )}

      {pendente &&
        proposta.tipo !== "domanda" &&
        !rifiutoAperto &&
        !correzioneAperta && (
          <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
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
            {processo && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={apriCorrezione}
              >
                <PencilLine className="h-3.5 w-3.5 mr-1" />
                Correggi
              </Button>
            )}
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
          {MOTIVI_RIFIUTO.map(m => (
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
