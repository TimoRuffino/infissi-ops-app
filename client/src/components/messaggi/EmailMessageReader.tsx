import ConfirmDialog from "@/components/ConfirmDialog";
import SearchSelect from "@/components/SearchSelect";
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_UI,
  type EmailCategory,
} from "@/components/messaggi/EmailMessageList";
import StatePanel from "@/components/patterns/StatePanel";
import { TarsSmistamentoBanner } from "@/components/tars/TarsSmistamento";
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
import type { EmailDetail } from "@/lib/messaggi";
import { personName } from "@/lib/name";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Archive,
  ArrowLeft,
  Bot,
  CheckCheck,
  Link2,
  Loader2,
  Mail,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  RefreshCw,
  ShieldBan,
  Tags,
  Trash2,
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
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex items-start gap-3 border-b border-border-soft px-4 py-4 sm:px-6">
        {mobile && (
          <Button
            size="icon"
            variant="ghost"
            className="-ml-2 size-11"
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
      <div className="space-y-4 p-5 sm:p-6 lg:p-8">
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
  mobile,
  focus,
  canFocus,
  onToggleFocus,
  selectionRemoved,
  canManageRules,
  onBack,
}: {
  messageId: number;
  mobile: boolean;
  focus: boolean;
  canFocus: boolean;
  onToggleFocus: () => void;
  selectionRemoved: boolean;
  canManageRules: boolean;
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.mail.email.byId.useQuery(messageId, {
    retry: false,
  });
  const message = detail.data;
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
    retry: false,
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<"cliente" | "commessa">("commessa");
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exclusion, setExclusion] = useState<
    "spam" | "offerta_marketing" | null
  >(null);

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
    // Errore del dettaglio e messaggio sparito dal CRM sono due cose diverse:
    // il primo si riprova, il secondo si torna alla coda.
    const back = (
      <Button variant="outline" className="min-h-11" onClick={onBack}>
        <ArrowLeft className="size-4" />
        Torna alla coda
      </Button>
    );
    return (
      <div className="min-h-0 min-w-0 overflow-y-auto bg-surface p-4 sm:p-6">
        {detail.isError ? (
          <StatePanel
            kind="error"
            title="Impossibile aprire l'email"
            description={
              detail.error?.message ??
              "Il dettaglio non è stato caricato. Riprova."
            }
            action={
              <>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => detail.refetch()}
                >
                  <RefreshCw className="size-4" />
                  Riprova
                </Button>
                {back}
              </>
            }
          />
        ) : (
          <StatePanel
            kind="unavailable"
            title="Email non disponibile"
            description="Il messaggio non esiste più nel CRM: potrebbe essere stato eliminato. Resta comunque nella casella di posta."
            action={back}
          />
        )}
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

  const gestita = message.stato === "gestita";

  return (
    <article className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      {/* Unica area borgogna scura del workspace: identità del messaggio.
          Corpo, allegati e form di collegamento restano su superficie chiara. */}
      <header className="shrink-0 bg-focal px-4 py-3.5 text-on-focal sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          {mobile && (
            <Button
              size="icon"
              variant="ghost"
              className="-ml-2 size-11 text-on-focal hover:bg-on-focal/15 hover:text-on-focal"
              onClick={onBack}
              aria-label="Torna all'elenco"
              title="Torna all'elenco"
            >
              <ArrowLeft className="size-5" />
            </Button>
          )}
          <div className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-on-focal/15 text-xs font-bold">
            {initials(message)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <Mail
                className="size-4 shrink-0 text-on-focal/70"
                aria-hidden="true"
              />
              <span className="min-w-0 break-words text-[15px] font-bold leading-6 [overflow-wrap:anywhere]">
                {message.mittenteNome ?? message.mittente}
              </span>
              {message.mittenteNome && (
                <span className="min-w-0 break-words text-[13px] leading-5 text-on-focal/70 [overflow-wrap:anywhere]">
                  {message.mittente}
                </span>
              )}
            </div>
            <h2 className="mt-1 break-words text-lg font-bold leading-snug [overflow-wrap:anywhere] sm:text-xl sm:leading-8">
              {message.oggetto || "(senza oggetto)"}
            </h2>
            <p className="mt-1.5 text-[13px] leading-5 text-on-focal/70">
              {new Date(message.receivedAt).toLocaleString("it-IT")}
              {mailbox
                ? ` · ricevuta su ${mailbox.nome} (${mailbox.indirizzo})`
                : ""}
            </p>
          </div>
          {canFocus && (
            <Button
              size="icon"
              variant="ghost"
              className="size-11 shrink-0 text-on-focal hover:bg-on-focal/15 hover:text-on-focal"
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
        </div>
      </header>

      {selectionRemoved && (
        <div
          role="status"
          className="shrink-0 border-b border-info/25 bg-info-soft px-4 py-2 text-[13px] leading-5 text-text-2 sm:px-6"
        >
          Questa email non compare più nella vista corrente. Puoi continuare a
          gestirla qui.
        </div>
      )}

      <div className="shrink-0 border-b border-border-soft bg-surface-2 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant={gestita ? "outline" : "default"}
            className="min-h-11"
            disabled={updateState.isPending}
            onClick={() =>
              updateState.mutate({
                id: message.id,
                stato: gestita ? "vista" : "gestita",
              })
            }
          >
            {updateState.isPending ? (
              <Loader2 className="size-4 motion-safe:animate-spin" />
            ) : (
              <CheckCheck className={cn("size-4", gestita && "text-success")} />
            )}
            {gestita ? "Riapri" : "Segna gestita"}
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setLinkOpen(value => !value)}
          >
            <Link2 className="size-4" />
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
              className="min-h-11 w-full max-w-[15rem] sm:w-[190px]"
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
          <Button
            size="icon"
            variant="dangerGhost"
            className="ml-auto size-11 shrink-0"
            aria-label="Elimina dal CRM"
            title="Elimina dal CRM"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>

        <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
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
                  variant="ghost"
                  className="min-h-11 text-xs"
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
                    {personName(
                      linkedClient.data,
                      `Cliente #${message.clienteId}`
                    )}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  className="min-h-11 text-xs"
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
        </div>

        {linkOpen && (
          <div className="mt-3 space-y-2">
            <div
              className="inline-flex rounded-[var(--radius-control)] border border-border-soft bg-surface p-1"
              aria-label="Tipo di collegamento"
            >
              <Button
                variant={linkKind === "cliente" ? "secondary" : "ghost"}
                className="min-h-11"
                onClick={() => {
                  setLinkKind("cliente");
                  setSelectedLink(null);
                }}
              >
                Cliente
              </Button>
              <Button
                variant={linkKind === "commessa" ? "secondary" : "ghost"}
                className="min-h-11"
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
                          label: personName(client, `Cliente #${client.id}`),
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
                className="min-h-11 shrink-0"
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
                  <Loader2 className="size-4 motion-safe:animate-spin" />
                ) : (
                  <Link2 className="size-4" />
                )}
                Conferma
              </Button>
            </div>
          </div>
        )}

        <TarsSmistamentoBanner
          comunicazioneId={message.id}
          abilitato={Boolean(
            interruttori.data?.tars && interruttori.data?.tarsSmistamento
          )}
        />
        {message.classificazioneMotivo &&
          message.classificazioneFonte !== "tars" && (
            <div className="mt-2 flex items-start gap-2 rounded-[var(--radius-control)] border border-border-soft bg-surface px-3 py-2.5">
              <Bot className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="min-w-0 text-[13px] leading-5 text-text-2">
                <span className="font-semibold text-text-1">
                  Classificazione automatica
                </span>{" "}
                {message.classificazioneMotivo}
              </div>
            </div>
          )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
          <div className="w-full min-w-0 space-y-5">
            <div className="max-w-[66ch] whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-base leading-[1.7] text-text-1">
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
                      className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2"
                    >
                      <Paperclip className="size-4 shrink-0 text-accent-text" />
                      <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-6 [overflow-wrap:anywhere]">
                        {attachment.nome}
                      </span>
                      <span className="shrink-0 text-[13px] text-text-3">
                        {fileSize(attachment.size)}
                      </span>
                      {message.commessaId != null && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-11 shrink-0"
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
                            <Loader2 className="size-4 motion-safe:animate-spin" />
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
              Il messaggio uscira dalla coda operativa.
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
