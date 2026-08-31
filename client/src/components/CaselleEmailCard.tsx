// Card «Caselle email» in Impostazioni (solo direzione).
//
// Ogni casella si aggiunge spenta: prima si prova la connessione, poi si
// accende. La password si scrive e non si rilegge più — il server non la
// restituisce mai, nemmeno cifrata.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DataSurface from "@/components/patterns/DataSurface";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

/**
 * Vero quando la query è stata rifiutata dal confine dei permessi: la card
 * non riguarda questo utente e resta nascosta, com'era prima. Ogni altro
 * errore è un guasto e va mostrato con un ritentativo, non nascosto.
 */
function permessoNegato(
  errore: { data?: { code?: string } | null } | null | undefined
): boolean {
  const codice = errore?.data?.code;
  return codice === "FORBIDDEN" || codice === "UNAUTHORIZED";
}

export default function CaselleEmailCard() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const stato = trpc.mail.caselle.stato.useQuery(undefined, { retry: false });
  const caselle = trpc.mail.caselle.list.useQuery(undefined, { retry: false });

  const [aperto, setAperto] = useState(false);
  const [daEliminare, setDaEliminare] = useState<any>(null);
  const [nome, setNome] = useState("");
  const [indirizzo, setIndirizzo] = useState("");
  const [host, setHost] = useState("");
  const [porta, setPorta] = useState("993");
  const [password, setPassword] = useState("");

  const invalidate = () => {
    utils.mail.caselle.invalidate();
  };

  const create = trpc.mail.caselle.create.useMutation({
    onSuccess: () => {
      toast.success("Casella aggiunta. Ora prova la connessione.");
      setAperto(false);
      setNome(""); setIndirizzo(""); setHost(""); setPorta("993"); setPassword("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.mail.caselle.update.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.mail.caselle.delete.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.cancellate > 0
          ? `Casella rimossa, ${r.cancellate} comunicazioni cancellate`
          : "Casella rimossa"
      );
      setDaEliminare(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const test = trpc.mail.caselle.test.useMutation({
    onSuccess: (r: any) => {
      if (r.ok) toast.success(`Connessione riuscita — ${r.messaggi} messaggi nella cartella`);
      else toast.error(r.errore);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const storico = trpc.mail.caselle.importaStorico.useMutation({
    onSuccess: (r: any) => {
      if (r.errore) toast.error(r.errore);
      else
        toast.success(
          `Storico importato: ${r.importate} nuove, ${r.saltate} già presenti`
        );
      invalidate();
      utils.mail.comunicazioni.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const sync = trpc.mail.caselle.sync.useMutation({
    onSuccess: (esiti: any[]) => {
      const tot = esiti.reduce((s, e) => s + e.importate, 0);
      const err = esiti.find((e) => e.errore);
      if (err) toast.error(err.errore);
      else toast.success(`${tot} nuove comunicazioni importate`);
      invalidate();
      utils.mail.comunicazioni.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Query direzione-only: un rifiuto di permesso nasconde la card, come prima.
  if (permessoNegato(caselle.error)) return null;

  const chiaveOk = stato.data?.chiaveConfigurata ?? false;
  const rows = caselle.data ?? [];
  const attive = rows.filter((c: any) => c.attiva).length;

  return (
    <DataSurface
      density="comfortable"
      tone="default"
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Mail className="size-4 shrink-0" aria-hidden="true" />
          Caselle email
          {rows.length > 0 && (
            <Badge variant="secondary">
              {attive}/{rows.length} attive
            </Badge>
          )}
        </span>
      }
      description="Il CRM legge la posta in sola lettura: apre la cartella senza marcare i messaggi come letti, e non invia né cancella nulla. Le mail vengono agganciate a cliente e commessa."
      toolbar={
        caselle.isLoading || caselle.error ? undefined : (
          <>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={sync.isPending || rows.every((c: any) => !c.attiva)}
              onClick={() => sync.mutate({})}
            >
              {sync.isPending ? (
                <Loader2
                  className="size-3.5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              Sincronizza
            </Button>
            <Button
              size="sm"
              className="min-h-11"
              disabled={!chiaveOk}
              onClick={() => setAperto(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Aggiungi
            </Button>
          </>
        )
      }
      state={
        caselle.isLoading
          ? {
              kind: "loading",
              title: "Lettura caselle configurate",
              description: "Sto chiedendo al server le caselle della sede.",
              rows: 2,
            }
          : caselle.error
            ? {
                kind: "error",
                title: "Caselle email non disponibili",
                description:
                  "Il server non ha risposto: non è possibile dire quali caselle siano collegate né se stiano importando.",
                action: (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void caselle.refetch()}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Riprova
                  </Button>
                ),
              }
            : undefined
      }
    >
      <div className="min-w-0 space-y-3 text-sm">
        {!chiaveOk && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-[var(--radius-control)] border border-warning/40 bg-warning-soft p-3 text-xs text-text-1"
          >
            <AlertCircle
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            <span>
              <code>MAIL_ENCRYPTION_KEY</code> non configurata sul server. Serve
              a cifrare le password delle caselle: senza, non si possono
              salvare — finirebbero in chiaro nel backup su Drive.
            </span>
          </div>
        )}

        {rows.length === 0 ? (
          <div
            role="status"
            className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3"
          >
            <p className="text-sm font-semibold text-text-1">
              Nessuna casella collegata
            </p>
            <p className="mt-1 text-xs leading-5 text-text-2">
              {chiaveOk
                ? "Aggiungi una casella IMAP: nasce spenta, si prova la connessione e solo dopo si accende."
                : "Configura prima MAIL_ENCRYPTION_KEY sul server: senza chiave le password non possono essere salvate."}
            </p>
          </div>
        ) : null}

        {rows.map((c: any) => (
          <div
            key={c.id}
            className="min-w-0 space-y-1.5 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2 font-medium text-text-1">
                  {c.nome}
                  {c.ultimoErrore ? (
                    <Badge variant="destructive" className="text-xs">
                      Errore
                    </Badge>
                  ) : c.attiva ? (
                    <Badge variant="success" className="text-xs">
                      Attiva
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      Spenta
                    </Badge>
                  )}
                </div>
                <div className="min-w-0 break-words text-xs text-text-2">
                  {c.indirizzo} · {c.host}:{c.porta} · {c.cartella}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11"
                  disabled={test.isPending}
                  onClick={() => test.mutate({ id: c.id })}
                >
                  {test.isPending ? (
                    <Loader2
                      className="size-3.5 motion-safe:animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  )}
                  Prova
                </Button>
                <Switch
                  aria-label={`Attiva la casella ${c.nome}`}
                  checked={c.attiva}
                  onCheckedChange={(attiva) =>
                    update.mutate({ id: c.id, attiva })
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-11"
                  aria-label={`Rimuovi la casella ${c.nome}`}
                  title="Rimuovi la casella"
                  onClick={() => setDaEliminare(c)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            {c.ultimoErrore && (
              <p className="text-xs text-danger">{c.ultimoErrore}</p>
            )}
            {c.ultimaSync && !c.ultimoErrore && (
              <p className="text-xs text-text-2">
                Ultima sincronizzazione:{" "}
                {new Date(c.ultimaSync).toLocaleString("it-IT")} ·{" "}
                {c.messaggiImportati} messaggi importati in totale
              </p>
            )}
            {!c.ultimaSync && !c.ultimoErrore && (
              <p className="text-xs text-text-3">
                Mai sincronizzata: prova la connessione, poi accendila.
              </p>
            )}
            {c.ultimaSync && (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 px-2 text-xs"
                disabled={storico.isPending}
                onClick={() => storico.mutate({ id: c.id })}
                title="Rilegge gli ultimi 6 mesi (max 1000 messaggi). Le mail già importate non si duplicano; quelle vecchie non passano dall'analisi automatica."
              >
                {storico.isPending ? (
                  <Loader2
                    className="size-3 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <RefreshCw className="size-3" aria-hidden="true" />
                )}
                {storico.isPending
                  ? "Sto importando lo storico…"
                  : "Importa storico (6 mesi)"}
              </Button>
            )}
          </div>
        ))}

        {rows.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={() => setLocation("/messaggi/email")}
          >
            Vai alle email
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      <Dialog open={aperto} onOpenChange={setAperto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aggiungi una casella</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              I dati stanno in cPanel → Email Accounts → Connect Devices. Su
              Netsons l'host è di norma <code>mail.tuodominio.it</code>, porta{" "}
              <code>993</code> con TLS.
            </p>
            <div className="space-y-1.5">
              <Label>Etichetta</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ordini"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Indirizzo (= utente IMAP)</Label>
              <Input
                value={indirizzo}
                onChange={(e) => setIndirizzo(e.target.value)}
                placeholder="ordini@ruffinogroup.it"
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <div className="space-y-1.5 flex-1">
                <Label>Server IMAP</Label>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="mail.ruffinogroup.it"
                />
              </div>
              <div className="space-y-1.5 w-24">
                <Label>Porta</Label>
                <Input
                  value={porta}
                  onChange={(e) => setPorta(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Password della casella</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                Viene cifrata prima di essere salvata e non è più leggibile da
                nessuna schermata.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAperto(false)}>
                Annulla
              </Button>
              <Button
                disabled={
                  !nome.trim() || !indirizzo.trim() || !host.trim() ||
                  !password || create.isPending
                }
                onClick={() =>
                  create.mutate({
                    nome: nome.trim(),
                    indirizzo: indirizzo.trim(),
                    host: host.trim(),
                    porta: Number(porta) || 993,
                    tls: true,
                    password,
                    cartella: "INBOX",
                  })
                }
              >
                Aggiungi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={daEliminare !== null}
        onOpenChange={(o: boolean) => !o && setDaEliminare(null)}
        title="Rimuovere la casella?"
        description={`«${daEliminare?.nome}» non verrà più letta. Le comunicazioni già importate restano.`}
        confirmLabel="Rimuovi"
        onConfirm={() =>
          daEliminare &&
          remove.mutate({ id: daEliminare.id, cancellaComunicazioni: false })
        }
      />
    </DataSurface>
  );
}
