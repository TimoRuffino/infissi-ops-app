import ConfirmDialog from "@/components/ConfirmDialog";
import SearchSelect from "@/components/SearchSelect";
import TarsAvatar from "@/components/TarsAvatar";
import TarsPropostaCard from "@/components/TarsPropostaCard";
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_UI,
  EmailCategoryBadge,
  type EmailCategory,
} from "@/components/messaggi/EmailMessageList";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { EmailDetail, TarsProposal } from "@/lib/messaggi";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  CheckCheck,
  Link2,
  Loader2,
  Mail,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  RefreshCw,
  Send,
  ShieldBan,
  Sparkles,
  Tags,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

function initials(message: EmailDetail): string {
  const name = (message.mittenteNome ?? message.mittente ?? "?").trim();
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function fileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReaderSkeleton({
  mobile,
  onBack,
}: {
  mobile: boolean;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className="flex items-start gap-3 border-b border-border-soft px-4 py-4 sm:px-5">
        {mobile && (
          <Button
            size="icon"
            variant="ghost"
            className="-ml-2 size-10"
            onClick={onBack}
            aria-label="Torna all'elenco"
          >
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <Skeleton className="size-10 shrink-0 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56 max-w-full" />
          <Skeleton className="mt-4 h-6 w-4/5" />
        </div>
      </div>
      <div className="space-y-4 p-5">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export default function EmailMessageReader({
  messageId,
  proposals,
  mobile,
  focus,
  canFocus,
  onToggleFocus,
  onOpenTarsWorkspace,
  selectionRemoved,
  canManageRules,
  onBack,
}: {
  messageId: number;
  proposals: TarsProposal[];
  mobile: boolean;
  focus: boolean;
  canFocus: boolean;
  onToggleFocus: () => void;
  onOpenTarsWorkspace: () => void;
  selectionRemoved: boolean;
  canManageRules: boolean;
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.mail.email.byId.useQuery(messageId, {
    retry: false,
  });
  const message = detail.data;
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<"cliente" | "commessa">("commessa");
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exclusion, setExclusion] = useState<
    "spam" | "offerta_marketing" | null
  >(null);
  const [instruction, setInstruction] = useState("");
  const [latestSummary, setLatestSummary] = useState<string | null>(null);

  const jobs = trpc.commesse.list.useQuery(undefined, { enabled: linkOpen });
  const clients = trpc.clienti.list.useQuery(
    {},
    { enabled: linkOpen && linkKind === "cliente" }
  );
  const linkedJob = trpc.commesse.byId.useQuery(message?.commessaId ?? 0, {
    enabled: message?.commessaId != null,
  });
  const linkedClient = trpc.clienti.byId.useQuery(message?.clienteId ?? 0, {
    enabled: message?.clienteId != null && message?.commessaId == null,
  });
  const mailboxes = trpc.mail.caselle.opzioni.useQuery();
  const mailbox = (mailboxes.data ?? []).find(
    item => item.id === message?.casellaId
  );

  const invalidate = () => {
    void utils.mail.email.invalidate();
    void utils.mail.comunicazioni.invalidate();
    void utils.mail.email.byId.invalidate(messageId);
    void utils.mail.comunicazioni.byId.invalidate(messageId);
  };

  const linkMessage = trpc.mail.comunicazioni.collega.useMutation({
    onSuccess: () => {
      toast.success("Email collegata");
      setLinkOpen(false);
      setSelectedLink(null);
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const updateState = trpc.mail.comunicazioni.setStato.useMutation({
    onSuccess: invalidate,
    onError: error => toast.error(error.message),
  });
  useEffect(() => {
    if (message?.stato === "nuova" && !updateState.isPending) {
      updateState.mutate({ id: message.id, stato: "vista" });
    }
  }, [message?.id, message?.stato]);
  const updateCategory = trpc.mail.comunicazioni.setCategoria.useMutation({
    onSuccess: () => {
      toast.success("Classificazione aggiornata");
      setExclusion(null);
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const deleteMessage = trpc.mail.comunicazioni.delete.useMutation({
    onSuccess: () => {
      toast.success("Eliminata dal CRM - resta nella casella di posta");
      setConfirmDelete(false);
      onBack();
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const analyze = trpc.tars.analizzaComunicazione.useMutation({
    onSuccess: result => {
      setLatestSummary(result.riepilogo);
      setInstruction("");
      toast.success(
        result.proposte.length > 0
          ? `${result.proposte.length} ${result.proposte.length === 1 ? "proposta pronta" : "proposte pronte"}`
          : "Analisi completata"
      );
      void utils.tars.proposte.invalidate();
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const archiveAttachment = trpc.mail.email.archiviaAllegato.useMutation({
    onSuccess: result => {
      toast.success(`${result.nome} archiviato nel fascicolo`);
      if (message?.commessaId != null) {
        void utils.preventiviContratti.byCommessa.invalidate(
          message.commessaId
        );
      }
    },
    onError: error => toast.error(error.message),
  });

  if (detail.isLoading)
    return <ReaderSkeleton mobile={mobile} onBack={onBack} />;

  if (detail.isError || !message) {
    return (
      <div className="grid h-full min-h-64 place-items-center bg-card px-5 text-center">
        <div>
          <AlertCircle className="mx-auto size-6 text-destructive" />
          <p className="mt-3 text-sm font-semibold">
            {detail.isError
              ? "Impossibile aprire l'email"
              : "Email non disponibile"}
          </p>
          <p className="mt-1 text-xs leading-5 text-text-3">
            {detail.error?.message ?? "Potrebbe essere stata rimossa dal CRM."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {mobile && (
              <Button size="sm" variant="outline" onClick={onBack}>
                <ArrowLeft className="size-3.5" />
                Elenco
              </Button>
            )}
            {detail.isError && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => detail.refetch()}
              >
                <RefreshCw className="size-3.5" />
                Riprova
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const chooseCategory = (category: EmailCategory) => {
    if (category === "spam" || category === "offerta_marketing") {
      setExclusion(category);
      return;
    }
    updateCategory.mutate({ id: message.id, categoria: category });
  };

  const presets =
    message.commessaId == null
      ? [
          {
            label: "Crea lead",
            icon: UserPlus,
            text: "Verifica che non esistano gia cliente e commessa. Se e una richiesta reale, mostrami gli assegnatari e chiedimi a chi affidarla; solo dopo prepara cliente, commessa in preventivo e collegamento della comunicazione.",
          },
          {
            label: "Apri ticket",
            icon: BriefcaseBusiness,
            text: "Valuta il contenuto e prepara un ticket senza commessa se serve una presa in carico, indicando priorita e contatto.",
          },
          {
            label: "Prepara risposta",
            icon: Send,
            text: "Verifica il contesto e prepara una risposta professionale. Non inventare date, prezzi o impegni.",
          },
        ]
      : [
          {
            label: "Aggiorna commessa",
            icon: BriefcaseBusiness,
            text: "Leggi la commessa collegata e proponi gli aggiornamenti operativi necessari in base a questa comunicazione.",
          },
          {
            label: "Prepara risposta",
            icon: Send,
            text: "Controlla il fascicolo della commessa e prepara una risposta coerente con lo stato reale.",
          },
          {
            label: "Analizza allegati",
            icon: Paperclip,
            text: "Analizza gli allegati operativi, confrontali con la commessa e proponi soltanto le azioni supportate dai documenti.",
          },
        ];

  const runAnalysis = () => {
    onOpenTarsWorkspace();
    analyze.mutate({
      comunicazioneId: message.id,
      istruzione: instruction.trim(),
    });
  };

  return (
    <article className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <header className="shrink-0 border-b border-border-soft px-4 py-4 sm:px-5">
        {selectionRemoved && (
          <div
            role="status"
            className="mb-3 rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs leading-5 text-text-2"
          >
            Questa email non compare piu nella vista corrente. Puoi continuare a
            gestirla qui.
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          {mobile && (
            <Button
              size="icon"
              variant="ghost"
              className="-ml-2 size-10"
              onClick={onBack}
              aria-label="Torna all'elenco"
              title="Torna all'elenco"
            >
              <ArrowLeft className="size-5" />
            </Button>
          )}
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground shadow-xs">
            {initials(message)}
          </div>
          <div className="min-w-[12rem] flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Mail
                className="size-4 shrink-0 text-text-3"
                aria-hidden="true"
              />
              <span className="min-w-0 break-words text-sm font-bold [overflow-wrap:anywhere]">
                {message.mittenteNome ?? message.mittente}
              </span>
              <EmailCategoryBadge
                categoria={message.categoria ?? "da_classificare"}
                fonte={message.classificazioneFonte}
                analizzata={message.tarsAnalizzata}
              />
            </div>
            {message.mittenteNome && (
              <div className="break-words text-xs text-text-3 [overflow-wrap:anywhere]">
                {message.mittente}
              </div>
            )}
            <div className="text-xs leading-5 text-text-3">
              {new Date(message.receivedAt).toLocaleString("it-IT")}
              {mailbox
                ? ` - ricevuta su ${mailbox.nome} (${mailbox.indirizzo})`
                : ""}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
            {canFocus && (
              <Button
                size="icon"
                variant="ghost"
                className="size-10"
                onClick={onToggleFocus}
                aria-label={focus ? "Mostra elenco email" : "Espandi email"}
                title={focus ? "Mostra elenco email" : "Espandi email"}
              >
                {focus ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="size-10"
              disabled={updateState.isPending}
              aria-label={
                message.stato === "gestita"
                  ? "Riapri email"
                  : "Segna come gestita"
              }
              title={
                message.stato === "gestita"
                  ? "Riapri email"
                  : "Segna come gestita"
              }
              onClick={() =>
                updateState.mutate({
                  id: message.id,
                  stato: message.stato === "gestita" ? "vista" : "gestita",
                })
              }
            >
              {updateState.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCheck
                  className={cn(
                    "size-4",
                    message.stato === "gestita" && "text-success"
                  )}
                />
              )}
            </Button>
            <Button
              size="icon"
              variant="dangerGhost"
              className="size-10"
              aria-label="Elimina dal CRM"
              title="Elimina dal CRM"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        <h2 className="mt-4 break-words text-lg font-bold leading-snug">
          {message.oggetto || "(senza oggetto)"}
        </h2>
      </header>

      <div className="shrink-0 border-b border-border-soft bg-surface-2/65 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            {message.commessaId != null ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link
                  href={`/commesse/${message.commessaId}`}
                  className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline"
                >
                  <Link2 className="size-3.5 shrink-0" />
                  <span className="break-words [overflow-wrap:anywhere]">
                    {linkedJob.data?.codice ??
                      `Commessa #${message.commessaId}`}
                    {linkedJob.data?.cliente
                      ? ` - ${linkedJob.data.cliente}`
                      : ""}
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-10 text-xs"
                  disabled={linkMessage.isPending}
                  onClick={() =>
                    linkMessage.mutate({
                      id: message.id,
                      commessaId: null,
                      clienteId: null,
                    })
                  }
                >
                  Scollega
                </Button>
              </div>
            ) : message.clienteId != null ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link
                  href={`/clienti/${message.clienteId}`}
                  className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline"
                >
                  <Link2 className="size-3.5 shrink-0" />
                  <span className="break-words [overflow-wrap:anywhere]">
                    {linkedClient.data
                      ? `${linkedClient.data.cognome ?? ""} ${linkedClient.data.nome ?? ""}`.trim()
                      : `Cliente #${message.clienteId}`}
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-10 text-xs"
                  disabled={linkMessage.isPending}
                  onClick={() =>
                    linkMessage.mutate({
                      id: message.id,
                      commessaId: null,
                      clienteId: null,
                    })
                  }
                >
                  Scollega
                </Button>
              </div>
            ) : (
              <span className="text-xs text-text-3">Nessun collegamento</span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-10 shrink-0"
            onClick={() => setLinkOpen(value => !value)}
          >
            <Link2 className="size-3.5" />
            {message.clienteId != null || message.commessaId != null
              ? "Cambia collegamento"
              : "Collega"}
          </Button>
          <Select
            value={message.categoria ?? "da_classificare"}
            onValueChange={value => chooseCategory(value as EmailCategory)}
            disabled={updateCategory.isPending}
          >
            <SelectTrigger
              className="h-9 w-full sm:w-[180px]"
              aria-label="Classificazione"
            >
              <Tags className="size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMAIL_CATEGORIES.map(category => (
                <SelectItem key={category} value={category}>
                  {EMAIL_CATEGORY_UI[category].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {linkOpen && (
          <div className="mt-3 space-y-2">
            <div
              className="inline-flex rounded-md border border-border-soft bg-card p-1"
              aria-label="Tipo di collegamento"
            >
              <Button
                size="sm"
                variant={linkKind === "cliente" ? "secondary" : "ghost"}
                className="h-10"
                onClick={() => {
                  setLinkKind("cliente");
                  setSelectedLink(null);
                }}
              >
                Cliente
              </Button>
              <Button
                size="sm"
                variant={linkKind === "commessa" ? "secondary" : "ghost"}
                className="h-10"
                onClick={() => {
                  setLinkKind("commessa");
                  setSelectedLink(null);
                }}
              >
                Commessa
              </Button>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <SearchSelect
                  value={selectedLink}
                  onChange={(value: string) => setSelectedLink(value)}
                  options={
                    linkKind === "commessa"
                      ? (jobs.data ?? []).map(job => ({
                          value: String(job.id),
                          label: `${job.codice} - ${job.cliente}`,
                          keywords: job.citta ?? "",
                        }))
                      : (clients.data ?? []).map(client => ({
                          value: String(client.id),
                          label:
                            `${client.cognome ?? ""} ${client.nome ?? ""}`.trim(),
                          keywords: [client.email, client.telefono]
                            .filter(Boolean)
                            .join(" "),
                        }))
                  }
                  placeholder={
                    linkKind === "commessa"
                      ? "Cerca codice, cliente o citta..."
                      : "Cerca cliente..."
                  }
                />
              </div>
              <Button
                className="h-10 shrink-0"
                disabled={!selectedLink || linkMessage.isPending}
                onClick={() =>
                  linkMessage.mutate({
                    id: message.id,
                    ...(linkKind === "commessa"
                      ? { commessaId: Number(selectedLink) }
                      : { clienteId: Number(selectedLink) }),
                  })
                }
              >
                {linkMessage.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Link2 className="size-4" />
                )}
                Conferma
              </Button>
            </div>
          </div>
        )}

        {message.classificazioneMotivo && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-border-soft bg-surface-2/60 px-3 py-2">
            <Bot className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <div className="min-w-0 text-xs leading-5 text-text-2">
              <span className="font-semibold text-foreground">
                {message.classificazioneFonte === "tars"
                  ? message.categoria === "da_classificare"
                    ? "Tars chiede una verifica"
                    : `Classificata da Tars - ${message.classificazioneScore}%`
                  : message.tarsAnalizzata
                    ? "Classificazione preliminare"
                    : "In attesa di Tars"}
              </span>{" "}
              {message.classificazioneMotivo}
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section className="order-2 border-t border-primary/15 bg-primary-soft/35 px-4 py-4 sm:px-5">
          <div className="mx-auto w-full max-w-5xl">
            <div className="flex items-center gap-2">
              <TarsAvatar size="md" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">
                  Affida questa email a Tars
                </div>
                <div className="text-xs text-text-2">
                  Verifica i dati e prepara azioni da approvare
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {presets.map(preset => (
                <Button
                  key={preset.label}
                  size="sm"
                  variant="outline"
                  className="h-8 bg-card/75 text-xs"
                  onClick={() => setInstruction(preset.text)}
                >
                  <preset.icon className="size-3.5" />
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`tars-instruction-${message.id}`}
                  className="mb-1.5 block text-xs font-semibold text-text-2"
                >
                  Istruzione per Tars
                </label>
                <Textarea
                  id={`tars-instruction-${message.id}`}
                  value={instruction}
                  onChange={event => setInstruction(event.target.value)}
                  placeholder="Es. Verifica se e un nuovo lead e prepara cio che serve."
                  className="min-h-[74px] min-w-0 resize-none bg-card"
                />
              </div>
              <Button
                className="shrink-0"
                disabled={instruction.trim().length < 2 || analyze.isPending}
                onClick={runAnalysis}
              >
                {analyze.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {analyze.isPending
                  ? "Tars sta verificando..."
                  : "Analizza e prepara"}
              </Button>
            </div>
            {(latestSummary || message.tarsRiepilogo) && (
              <div className="mt-3 whitespace-pre-wrap break-words border-l-2 border-primary pl-3 text-sm leading-6 text-text-1 [overflow-wrap:anywhere]">
                {latestSummary ?? message.tarsRiepilogo}
              </div>
            )}
          </div>
        </section>

        <div className="order-1 px-4 py-5 sm:px-5">
          <div className="mx-auto w-full max-w-5xl space-y-5">
            <div className="max-w-[78ch] whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[15px] leading-7 text-text-1">
              {message.testo || "(messaggio vuoto)"}
            </div>
            {(message.allegati?.length ?? 0) > 0 && (
              <section aria-label="Allegati" className="space-y-2">
                <div className="text-xs font-bold uppercase text-text-3">
                  Allegati
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {message.allegati.map((attachment, index) => (
                    <div
                      key={`${attachment.nome}-${index}`}
                      className="flex min-w-0 items-center gap-2 rounded-md border border-border-soft bg-surface-2 px-3 py-2.5"
                    >
                      <Paperclip className="size-4 shrink-0 text-accent-text" />
                      <span className="min-w-0 flex-1 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                        {attachment.nome}
                      </span>
                      <span className="shrink-0 text-xs text-text-3">
                        {fileSize(attachment.size)}
                      </span>
                      {message.commessaId != null && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-10 shrink-0"
                          disabled={archiveAttachment.isPending}
                          onClick={() =>
                            archiveAttachment.mutate({
                              id: message.id,
                              allegatoIndex: index,
                              commessaId: message.commessaId!,
                            })
                          }
                          aria-label={`Archivia ${attachment.nome} nel fascicolo della commessa`}
                          title="Archivia nel fascicolo"
                        >
                          {archiveAttachment.isPending &&
                          archiveAttachment.variables?.allegatoIndex ===
                            index ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Archive className="size-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {proposals.length > 0 && (
              <section aria-label="Proposte Tars" className="space-y-3">
                <div className="text-xs font-bold uppercase text-text-3">
                  Azioni preparate da Tars
                </div>
                {proposals.map(proposal => (
                  <TarsPropostaCard key={proposal.id} proposta={proposal} />
                ))}
              </section>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminare dal CRM?"
        description="L'email sparisce da qui ma resta nella casella di posta, che non viene mai toccata. Non verra re-importata."
        confirmLabel="Elimina dal CRM"
        onConfirm={() => deleteMessage.mutate({ id: message.id })}
      />
      <Dialog
        open={exclusion != null}
        onOpenChange={open => !open && setExclusion(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {exclusion === "spam"
                ? "Segnare come spam?"
                : "Escludere come newsletter inutile?"}
            </DialogTitle>
            <DialogDescription>
              Il messaggio uscira dalla coda operativa e non consumera analisi
              automatiche di Tars.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            {canManageRules && (
              <Button
                variant="outline"
                disabled={updateCategory.isPending}
                onClick={() =>
                  updateCategory.mutate({
                    id: message.id,
                    categoria: exclusion!,
                    ricordaMittente: true,
                  })
                }
              >
                {exclusion === "spam" ? (
                  <ShieldBan className="size-4" />
                ) : (
                  <Megaphone className="size-4" />
                )}
                Escludi anche i futuri
              </Button>
            )}
            <Button
              disabled={updateCategory.isPending}
              onClick={() =>
                updateCategory.mutate({ id: message.id, categoria: exclusion! })
              }
            >
              Solo questo messaggio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
