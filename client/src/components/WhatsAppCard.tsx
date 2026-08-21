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
  Loader2,
  MessageCircle,
  Plus,
  QrCode,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Carica l'SDK Facebook una volta sola. Serve solo quando la direzione
// apre questa card: non lo si impone a ogni pagina del gestionale.
function useFacebookSdk(appId: string | undefined) {
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    if (!appId) return;
    const w = window as any;
    if (w.FB) {
      setPronto(true);
      return;
    }
    w.fbAsyncInit = function () {
      w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" });
      setPronto(true);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    document.body.appendChild(s);
  }, [appId]);
  return pronto;
}

export default function WhatsAppCard() {
  const utils = trpc.useUtils();
  const lista = trpc.mail.whatsapp.list.useQuery(undefined, { retry: false });
  const webhook = trpc.mail.whatsapp.webhookUrl.useQuery(undefined, {
    retry: false,
  });
  const app = trpc.mail.whatsapp.app.useQuery(undefined, { retry: false });

  const [aperto, setAperto] = useState(false);
  const [daEliminare, setDaEliminare] = useState<any>(null);
  const [completa, setCompleta] = useState<any>(null);
  const [copiato, setCopiato] = useState(false);
  const [tokenCopiato, setTokenCopiato] = useState(false);
  const [copiatoVt, setCopiatoVt] = useState<number | null>(null);
  const VUOTO = {
    nome: "Numero aziendale",
    numero: "",
    phoneNumberId: "",
    wabaId: "",
    token: "",
    appSecret: "",
    verifyToken: "",
  };
  const [f, setF] = useState(VUOTO);

  const invalidate = () => utils.mail.whatsapp.invalidate();
  const create = trpc.mail.whatsapp.create.useMutation({
    onSuccess: () => {
      toast.success(
        "Configurazione creata. Ora verifica il webhook su Meta con questo verify token."
      );
      setAperto(false);
      setF(VUOTO);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.mail.whatsapp.update.useMutation({
    onSuccess: () => {
      setCompleta(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const setApp = trpc.mail.whatsapp.setApp.useMutation({
    onSuccess: () => {
      toast.success("Configurazione dell'app aggiornata");
      utils.mail.whatsapp.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [esitoProva, setEsitoProva] = useState<any>(null);
  const prova = trpc.mail.whatsapp.prova.useMutation({
    onSuccess: (r: any) => {
      setEsitoProva(r);
      const riuscite = (r.chiamate ?? []).filter((c: any) => c.ok).length;
      if (r.ok) {
        toast.success(
          `${riuscite} chiamate API riuscite su ${r.chiamate?.length ?? 0}`
        );
      } else {
        toast.error(r.errore);
      }
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const syncStorico = trpc.mail.whatsapp.syncStorico.useMutation({
    onSuccess: (r: any) => {
      if (r.ok) toast.success("Storico richiesto a Meta: arriverà via webhook");
      else toast.error(r.errore);
      invalidate();
    },
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

  // ── Embedded Signup (coexistence) ────────────────────────────────────
  const sdkPronto = useFacebookSdk(app.data?.appId || undefined);
  // La WABA arriva dal postMessage del popup, il code dalla callback:
  // due canali distinti, si aspettano a vicenda.
  const wabaRef = useRef<string | null>(null);
  const numeroRef = useRef<string | null>(null);
  const [onboardingInCorso, setOnboardingInCorso] = useState(false);

  const onboarding = trpc.mail.whatsapp.onboarding.useMutation({
    onSuccess: () => {
      toast.success(
        "Numero collegato. Sto sincronizzando contatti e storico (fino a 6 mesi)."
      );
      setOnboardingInCorso(false);
      invalidate();
    },
    onError: (e) => {
      toast.error(e.message);
      setOnboardingInCorso(false);
    },
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!String(event.origin).endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data?.data?.waba_id) wabaRef.current = String(data.data.waba_id);
        // sessionInfoVersion 3 riporta anche il numero: usarlo evita di
        // indovinare quale numero della WABA è quello appena collegato.
        if (data?.data?.phone_number_id) {
          numeroRef.current = String(data.data.phone_number_id);
        }
        if (data?.event === "CANCEL" || data?.event === "ERROR") {
          setOnboardingInCorso(false);
        }
      } catch {
        /* messaggi non JSON dal popup: non ci riguardano */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const avviaSignup = () => {
    const w = window as any;
    if (!w.FB || !app.data?.configId) return;
    setOnboardingInCorso(true);
    wabaRef.current = null;
    numeroRef.current = null;
    w.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setOnboardingInCorso(false);
          return;
        }
        // Il postMessage con la WABA può arrivare un istante dopo.
        setTimeout(() => {
          if (!wabaRef.current) {
            toast.error(
              "Onboarding non completato: Meta non ha restituito l'account WhatsApp Business."
            );
            setOnboardingInCorso(false);
            return;
          }
          onboarding.mutate({
            code,
            wabaId: wabaRef.current,
            phoneNumberId: numeroRef.current ?? undefined,
          });
        }, 500);
      },
      {
        config_id: app.data.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          // Senza questo il dialog propone la registrazione classica di un
          // numero nuovo, e su un numero già usato dall'app WhatsApp Business
          // si ferma con "già registrato: migra o scollega". Con la
          // coexistence il dialog chiede invece il codice/QR da scansionare
          // dall'app sul telefono e il numero resta dov'è.
          featureType: "whatsapp_business_app_onboarding",
          // v3: la sessione riporta anche il phone_number_id.
          sessionInfoVersion: "3",
        },
      }
    );
  };

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

  const copiaToken = () => {
    const t = app.data?.verifyToken;
    if (!t) return;
    navigator.clipboard.writeText(t).then(() => {
      setTokenCopiato(true);
      setTimeout(() => setTokenCopiato(false), 2000);
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
          <div className="flex gap-2">
            {app.data?.pronta && (
              <Button
                size="sm"
                disabled={!sdkPronto || onboardingInCorso || onboarding.isPending}
                onClick={avviaSignup}
              >
                {onboardingInCorso || onboarding.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <QrCode className="h-3.5 w-3.5 mr-1" />
                )}
                Collega col QR
              </Button>
            )}
            <Button
              size="sm"
              variant={app.data?.pronta ? "outline" : "default"}
              disabled={!chiaveOk}
              onClick={() => setAperto(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              A mano
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          I messaggi in arrivo entrano nel CRM e vengono agganciati alla
          commessa <strong>tramite il numero di telefono</strong>, diventando
          contesto per Tars. <strong>Solo ricezione:</strong> il CRM non invia
          nulla, e il numero resta usabile dall'app sul telefono (coexistence).
        </p>

        {app.data?.pronta && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1.5">
            <p className="font-medium">Cosa scegliere nel popup di Meta</p>
            <p className="text-muted-foreground">
              Alla domanda su come collegare il numero scegli{" "}
              <strong>«Il numero è già sull'app WhatsApp Business»</strong> (o
              «Connect your existing WhatsApp Business app»), non la
              registrazione di un numero nuovo. Poi arriva un messaggio su
              WhatsApp e il QR da inquadrare dall'app sul telefono
              (Impostazioni → Dispositivi collegati).
            </p>
            <p className="text-muted-foreground">
              Se invece Meta risponde{" "}
              <em>«numero già registrato: migra o scollega»</em>, sei finito
              sulla registrazione classica: annulla e riparti, senza migrare
              nulla. Serve l'app WhatsApp Business aggiornata (2.24.17 o
              successiva) sul telefono che ha quel numero.
            </p>
          </div>
        )}

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
            <Input
              readOnly
              aria-label="URL del webhook da incollare su Meta"
              value={url}
              className="font-mono text-xs"
            />
            <Button size="icon" variant="outline" onClick={copiaUrl}>
              {copiato ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <Label className="text-xs pt-1 block">
            Token di verifica (stesso riquadro su Meta)
          </Label>
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label="Token di verifica del webhook"
              value={app.data?.verifyToken ?? ""}
              className="font-mono text-xs"
            />
            <Button size="icon" variant="outline" onClick={copiaToken}>
              {tokenCopiato ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Questi due campi bastano: l'URL si convalida anche prima che esista
            un numero. Poi sottoscrivi i campi <code>messages</code>,{" "}
            <code>history</code>, <code>smb_app_state_sync</code> e{" "}
            <code>smb_message_echoes</code> — gli ultimi tre servono per lo
            storico e per vedere anche i messaggi scritti dal telefono.
          </p>
          <p className="text-xs text-muted-foreground">
            Se Meta dice che non riesce a convalidare l'URL, apri{" "}
            <code className="break-all">
              {url}?hub.mode=subscribe&amp;hub.verify_token=IL_TOKEN&amp;hub.challenge=12345
            </code>{" "}
            nel browser: se stampa <code>12345</code> il CRM risponde
            correttamente e il problema è nel riquadro di Meta (spazi
            incollati, URL con http al posto di https).
          </p>
        </div>

        {/* App Meta — serve per il collegamento col QR (coexistence) */}
        <details className="rounded-lg border p-3" open={!app.data?.pronta}>
          <summary className="text-sm font-medium cursor-pointer select-none">
            App Meta {app.data?.pronta ? "✓" : "— da configurare"}
          </summary>
          <div className="space-y-3 mt-3">
            <p className="text-xs text-muted-foreground">
              Serve solo per il collegamento col QR, che mantiene il numero
              attivo sul telefono con le sue chat. Meta lo concede a chi è
              registrato come <strong>Tech Provider</strong>: senza quello
              status il popup non si apre, e resta la configurazione a mano
              (che però sposta il numero e non conserva le conversazioni).
            </p>
            <div className="flex gap-2">
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">App ID</Label>
                <Input
                  defaultValue={app.data?.appId ?? ""}
                  onBlur={(e) =>
                    setApp.mutate({ appId: e.target.value.trim() })
                  }
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">Configuration ID</Label>
                <Input
                  defaultValue={app.data?.configId ?? ""}
                  onBlur={(e) =>
                    setApp.mutate({ configId: e.target.value.trim() })
                  }
                  className="font-mono text-xs"
                  placeholder="Login for Business → Configurazioni"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                App secret {app.data?.appSecretConfigurato ? "(già impostato)" : ""}
              </Label>
              <Input
                type="password"
                placeholder={
                  app.data?.appSecretConfigurato
                    ? "Lascia vuoto per non cambiarlo"
                    : "Impostazioni app → Di base"
                }
                autoComplete="new-password"
                onBlur={(e) => {
                  if (e.target.value) {
                    setApp.mutate({ appSecret: e.target.value });
                    e.target.value = "";
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Vale per tutti i numeri: verifica la firma dei webhook e
                completa il collegamento col QR.
              </p>
            </div>
          </div>
        </details>

        {rows.map((c: any) => {
          const mancanti = [
            !c.phoneNumberId && "Phone number ID",
            !c.wabaId && "WABA ID",
            !c.tokenConfigurato && "token",
            !c.appSecretConfigurato && "app secret",
          ].filter(Boolean) as string[];
          return (
            <div key={c.id} className="rounded-lg border p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {c.nome}
                    {c.attiva ? (
                      <Badge className="bg-green-600 hover:bg-green-600 text-xs">
                        Attivo
                      </Badge>
                    ) : mancanti.length > 0 ? (
                      <Badge variant="outline" className="text-xs">
                        Da completare
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Spento</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.numero || "numero non ancora indicato"}
                    {c.phoneNumberId ? ` · phone id ${c.phoneNumberId}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={prova.isPending || !c.tokenConfigurato}
                    onClick={() => prova.mutate({ id: c.id })}
                    title="Legge account e numeri da Meta: verifica il collegamento e registra l'uso del permesso per la App Review"
                  >
                    {prova.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3 mr-1" />
                    )}
                    Prova
                  </Button>
                  <Switch
                    checked={c.attiva}
                    disabled={mancanti.length > 0}
                    onCheckedChange={(attiva) =>
                      update.mutate({ id: c.id, attiva })
                    }
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

              {/* Il verify token serve subito, prima ancora del numero:
                  è quello da incollare su Meta per verificare il webhook. */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">
                  Verify token:
                </span>
                <code className="text-xs font-mono truncate bg-muted px-1.5 py-0.5 rounded">
                  {c.verifyToken}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(c.verifyToken);
                    setCopiatoVt(c.id);
                    setTimeout(() => setCopiatoVt(null), 2000);
                  }}
                >
                  {copiatoVt === c.id ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>

              {mancanti.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-amber-600 dark:text-amber-500">
                    Da completare dopo aver registrato il numero: {mancanti.join(", ")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setF({ ...VUOTO, nome: c.nome, numero: c.numero });
                      setCompleta(c);
                    }}
                  >
                    Completa
                  </Button>
                </div>
              )}

              {/* Coexistence: lo storico va chiesto entro 24 ore. */}
              {c.onboardingAt && !c.storicoSincronizzato && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-amber-600 dark:text-amber-500">
                    Storico non ancora sincronizzato — Meta lo consente solo
                    entro 24 ore dal collegamento.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={syncStorico.isPending}
                    onClick={() => syncStorico.mutate({ id: c.id })}
                  >
                    Riprova
                  </Button>
                </div>
              )}
              {c.storicoSincronizzato && (
                <p className="text-xs text-muted-foreground">
                  Storico richiesto il{" "}
                  {new Date(c.storicoSincronizzato).toLocaleString("it-IT")}
                </p>
              )}

              {/* Esito della prova: cosa Meta ci ha risposto, chiamata per
                  chiamata. Serve a vedere quale permesso è stato esercitato
                  davvero mentre i contatori della App Review si muovono. */}
              {esitoProva && (
                <div className="rounded-md border bg-muted/40 p-2 space-y-1.5">
                  {esitoProva.account && (
                    <p className="text-xs font-medium">
                      Account: {esitoProva.account}
                    </p>
                  )}
                  {esitoProva.numeri?.map((n: any) => (
                    <p key={n.id} className="text-xs text-muted-foreground">
                      {n.numero ?? n.id}
                      {n.nome ? ` · ${n.nome}` : ""}
                      {n.qualita ? ` · qualità ${n.qualita}` : ""}
                                  {n.coesistenza
                                    ? " · coexistence attiva"
                                    : n.stato
                                      ? ` · ${n.stato}`
                          : ""}
                    </p>
                  ))}
                  <div className="space-y-0.5 pt-0.5">
                    {(esitoProva.chiamate ?? []).map((c: any, i: number) => (
                      <p
                        key={i}
                        className={cn(
                          "text-[11px] font-mono",
                          c.ok
                            ? "text-green-600 dark:text-green-500"
                            : "text-destructive"
                        )}
                      >
                        {c.ok ? "✓" : "✕"} {c.permesso} — {c.endpoint}
                        {!c.ok ? ` · ${c.dettaglio}` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {c.ultimoMessaggio && (
                <p className="text-xs text-muted-foreground">
                  Ultimo messaggio:{" "}
                  {new Date(c.ultimoMessaggio).toLocaleString("it-IT")} ·{" "}
                  {c.messaggiRicevuti} in totale
                </p>
              )}
              {c.ultimoErrore && (
                <p className="text-xs text-destructive">{c.ultimoErrore}</p>
              )}
            </div>
          );
        })}
      </CardContent>

      {/* Passo 1 — basta il verify token: su Meta il webhook si verifica
          PRIMA che il numero esista, quindi il resto arriva dopo. */}
      <Dialog open={aperto} onOpenChange={setAperto}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Collega un numero WhatsApp — passo 1</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Meta chiede di verificare il webhook <strong>prima</strong> di
              registrare il numero. Qui serve solo il verify token: lo generi,
              lo incolli su Meta, e quando il numero sarà registrato torni a
              completare gli altri campi.
            </p>
            <div className="space-y-1.5">
              <Label>Etichetta</Label>
              <Input
                value={f.nome}
                onChange={(e) => setF({ ...f, nome: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Verify token</Label>
              <div className="flex gap-2">
                <Input
                  value={f.verifyToken}
                  onChange={(e) => setF({ ...f, verifyToken: e.target.value })}
                  className="font-mono text-xs"
                  placeholder="Premi «Genera»"
                />
                <Button variant="outline" onClick={generaVerifyToken}>
                  Genera
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                È una stringa a caso, non una credenziale: Meta te la rimanda
                indietro e il CRM verifica di riconoscerla. Non confonderla col
                token di accesso, che comincia per <code>EAA…</code>.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAperto(false)}>
                Annulla
              </Button>
              <Button
                disabled={
                  !f.nome.trim() ||
                  f.verifyToken.trim().length < 8 ||
                  create.isPending
                }
                onClick={() =>
                  create.mutate({
                    nome: f.nome.trim(),
                    verifyToken: f.verifyToken.trim(),
                  })
                }
              >
                Crea
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Passo 2 — dopo la registrazione del numero su Meta. */}
      <Dialog open={completa !== null} onOpenChange={(o) => !o && setCompleta(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Completa «{completa?.nome}» — passo 2</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              I valori stanno in <strong>developers.facebook.com</strong> → la
              tua app → WhatsApp → Configurazione API, tranne l'app secret che
              è in Impostazioni app → Di base. Il token conviene sia permanente
              (utente di sistema): quello temporaneo scade in 24 ore.
            </p>
            <div className="space-y-1.5">
              <Label>Numero</Label>
              <Input
                value={f.numero}
                onChange={(e) => setF({ ...f, numero: e.target.value })}
                placeholder="+39 0187 872687"
              />
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
              <Label>Token di accesso</Label>
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
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCompleta(null)}>
                Annulla
              </Button>
              <Button
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    id: completa.id,
                    numero: f.numero.trim() || undefined,
                    phoneNumberId: f.phoneNumberId.trim() || undefined,
                    wabaId: f.wabaId.trim() || undefined,
                    token: f.token || undefined,
                    appSecret: f.appSecret || undefined,
                  })
                }
              >
                Salva
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
