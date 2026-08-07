// Card «WhatsApp Business» in Impostazioni (solo direzione).
//
// Sola lettura: i messaggi entrano nel CRM e diventano contesto per Tars.
// Nessun invio — quello sarà un passo separato, con template approvati da
// Meta e approvazione esplicita.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Check,
  Copy,
  MessageCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function WhatsAppCard() {
  const utils = trpc.useUtils();
  const lista = trpc.mail.whatsapp.list.useQuery(undefined, { retry: false });
  const webhook = trpc.mail.whatsapp.webhookUrl.useQuery(undefined, {
    retry: false,
  });

  const [aperto, setAperto] = useState(false);
  const [daEliminare, setDaEliminare] = useState<any>(null);
  const [copiato, setCopiato] = useState(false);
  const [f, setF] = useState({
    nome: "Numero aziendale",
    numero: "",
    phoneNumberId: "",
    wabaId: "",
    token: "",
    appSecret: "",
    verifyToken: "",
  });

  const invalidate = () => utils.mail.whatsapp.invalidate();
  const create = trpc.mail.whatsapp.create.useMutation({
    onSuccess: () => {
      toast.success("Numero aggiunto. Completa la verifica su Meta, poi accendilo.");
      setAperto(false);
      setF({
        nome: "Numero aziendale",
        numero: "",
        phoneNumberId: "",
        wabaId: "",
        token: "",
        appSecret: "",
        verifyToken: "",
      });
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.mail.whatsapp.update.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.mail.whatsapp.delete.useMutation({
    onSuccess: () => {
      toast.success("Numero rimosso");
      setDaEliminare(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Query direzione-only: se fallisce, la card non riguarda l'utente.
  if (lista.isError) return null;

  const rows = lista.data ?? [];
  const chiaveOk = webhook.data?.chiaveConfigurata ?? false;
  const url = webhook.data?.url ?? "";

  const copiaUrl = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiato(true);
      setTimeout(() => setCopiato(false), 2000);
    });
  };

  // Il verify token lo generiamo noi: è una stringa che Meta rimanda
  // indietro nell'handshake, non deve essere memorabile.
  const generaVerifyToken = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const t = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    setF((s) => ({ ...s, verifyToken: t }));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4 text-[#25D366]" />
            WhatsApp Business
            {rows.length > 0 && (
              <Badge variant="secondary">
                {rows.filter((c: any) => c.attiva).length}/{rows.length} attivi
              </Badge>
            )}
          </CardTitle>
          <Button size="sm" disabled={!chiaveOk} onClick={() => setAperto(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Collega un numero
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          I messaggi in arrivo entrano nel CRM e vengono agganciati alla
          commessa <strong>tramite il numero di telefono</strong>, diventando
          contesto per Tars. <strong>Solo ricezione:</strong> il CRM non invia
          nulla, e il numero resta usabile dall'app sul telefono (coexistence).
        </p>

        {!chiaveOk && (
          <div className="flex items-start gap-2 text-amber-600 dark:text-amber-500 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <code>MAIL_ENCRYPTION_KEY</code> non configurata: serve a cifrare
              il token di accesso prima di salvarlo.
            </span>
          </div>
        )}

        {/* L'URL da incollare su Meta */}
        <div className="space-y-1.5">
          <Label className="text-xs">URL del webhook (da incollare su Meta)</Label>
          <div className="flex gap-2">
            <Input readOnly value={url} className="font-mono text-xs" />
            <Button size="icon" variant="outline" onClick={copiaUrl}>
              {copiato ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {rows.map((c: any) => (
          <div key={c.id} className="rounded-lg border p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2">
                  {c.nome}
                  {c.attiva ? (
                    <Badge className="bg-green-600 hover:bg-green-600 text-xs">
                      Attivo
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">Spento</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.numero} · phone id {c.phoneNumberId}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={c.attiva}
                  onCheckedChange={(attiva) => update.mutate({ id: c.id, attiva })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setDaEliminare(c)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {c.ultimoMessaggio && (
              <p className="text-xs text-muted-foreground">
                Ultimo messaggio:{" "}
                {new Date(c.ultimoMessaggio).toLocaleString("it-IT")} ·{" "}
                {c.messaggiRicevuti} ricevuti in totale
              </p>
            )}
            {c.ultimoErrore && (
              <p className="text-xs text-destructive">{c.ultimoErrore}</p>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={aperto} onOpenChange={setAperto}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Collega un numero WhatsApp</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              I valori stanno in <strong>developers.facebook.com</strong> → la
              tua app → WhatsApp → Configurazione API. Il token deve essere
              permanente (utente di sistema), non quello temporaneo da 24 ore.
            </p>
            <div className="flex gap-2">
              <div className="space-y-1.5 flex-1">
                <Label>Etichetta</Label>
                <Input
                  value={f.nome}
                  onChange={(e) => setF({ ...f, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <Label>Numero</Label>
                <Input
                  value={f.numero}
                  onChange={(e) => setF({ ...f, numero: e.target.value })}
                  placeholder="+39 0187 872687"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Phone number ID</Label>
              <Input
                value={f.phoneNumberId}
                onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp Business Account ID</Label>
              <Input
                value={f.wabaId}
                onChange={(e) => setF({ ...f, wabaId: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Token di accesso permanente</Label>
              <Input
                type="password"
                value={f.token}
                onChange={(e) => setF({ ...f, token: e.target.value })}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>App secret</Label>
              <Input
                type="password"
                value={f.appSecret}
                onChange={(e) => setF({ ...f, appSecret: e.target.value })}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                Serve a verificare la firma di ogni webhook: senza, chiunque
                conosca l'URL potrebbe iniettare messaggi falsi.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Verify token</Label>
              <div className="flex gap-2">
                <Input
                  value={f.verifyToken}
                  onChange={(e) => setF({ ...f, verifyToken: e.target.value })}
                  className="font-mono text-xs"
                  placeholder="Genera e incolla lo stesso valore su Meta"
                />
                <Button variant="outline" onClick={generaVerifyToken}>
                  Genera
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAperto(false)}>
                Annulla
              </Button>
              <Button
                disabled={
                  !f.numero.trim() || !f.phoneNumberId.trim() ||
                  !f.wabaId.trim() || !f.token || !f.appSecret ||
                  f.verifyToken.trim().length < 8 || create.isPending
                }
                onClick={() =>
                  create.mutate({
                    nome: f.nome.trim(),
                    numero: f.numero.trim(),
                    phoneNumberId: f.phoneNumberId.trim(),
                    wabaId: f.wabaId.trim(),
                    token: f.token,
                    appSecret: f.appSecret,
                    verifyToken: f.verifyToken.trim(),
                  })
                }
              >
                Collega
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={daEliminare !== null}
        onOpenChange={(o: boolean) => !o && setDaEliminare(null)}
        title="Scollegare il numero?"
        description={`«${daEliminare?.nome}» non riceverà più messaggi nel CRM. Quelli già arrivati restano, e su WhatsApp non cambia nulla.`}
        confirmLabel="Scollega"
        onConfirm={() =>
          daEliminare &&
          remove.mutate({ id: daEliminare.id, cancellaComunicazioni: false })
        }
      />
    </Card>
  );
}
