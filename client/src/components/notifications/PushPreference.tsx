import { useEffect, useState } from "react";
import { BellRing, BellOff, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, char => char.charCodeAt(0));
}

export function PushPreference() {
  const utils = trpc.useUtils();
  const status = trpc.notifiche.push.status.useQuery();
  const preferences = trpc.notifiche.preferences.get.useQuery();
  const subscribe = trpc.notifiche.push.subscribe.useMutation();
  const unsubscribe = trpc.notifiche.push.unsubscribe.useMutation();
  const savePreferences = trpc.notifiche.preferences.set.useMutation();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPermission(
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "unsupported"
    );
  }, []);

  const persistPushPreference = async (pushEnabled: boolean) => {
    const current = preferences.data;
    if (!current) return;
    await savePreferences.mutateAsync({ ...current, pushEnabled });
    await utils.notifiche.invalidate();
  };

  const enable = async () => {
    if (!status.data?.enabled || !status.data.publicKey) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.register("/notification-sw.js");
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") return;
      const pushSubscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(status.data.publicKey),
        }));
      const json = pushSubscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("PUSH_SUBSCRIPTION_INVALID");
      }
      await subscribe.mutateAsync({
        endpoint: json.endpoint,
        expirationTime: json.expirationTime ?? null,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      await persistPushPreference(true);
      toast.success("Notifiche push attivate");
    } catch {
      toast.error("Non riesco ad attivare le notifiche push");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/notification-sw.js");
      const pushSubscription = await registration?.pushManager.getSubscription();
      if (pushSubscription) {
        await unsubscribe.mutateAsync({ endpoint: pushSubscription.endpoint });
        await pushSubscription.unsubscribe();
      }
      await persistPushPreference(false);
      toast.success("Notifiche push disattivate");
    } catch {
      toast.error("Non riesco a disattivare le notifiche push");
    } finally {
      setBusy(false);
    }
  };

  const active = permission === "granted" && preferences.data?.pushEnabled;
  const supported = permission !== "unsupported" && "serviceWorker" in navigator && "PushManager" in window;

  return (
    <section className="border-y bg-card px-4 py-5 sm:rounded-lg sm:border" aria-labelledby="push-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${active ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
            {active ? <CheckCircle2 className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
          </span>
          <div>
            <h2 id="push-title" className="text-sm font-semibold">Notifiche push</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Ricevi un avviso generico per le responsabilita importanti anche quando il CRM non e aperto. I dati cliente non vengono mostrati nel push.
            </p>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {!supported
                ? "Questo browser non supporta le notifiche push."
                : !status.data?.enabled
                  ? "Il canale push non e ancora configurato per questa sede."
                  : permission === "denied"
                    ? "Permesso bloccato nelle impostazioni del browser."
                    : active
                      ? "Attive su questo dispositivo"
                      : "Non attive su questo dispositivo"}
            </p>
          </div>
        </div>
        {active ? (
          <Button variant="outline" onClick={disable} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
            Disattiva
          </Button>
        ) : (
          <Button onClick={enable} disabled={busy || !supported || !status.data?.enabled || permission === "denied"}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            Attiva push
          </Button>
        )}
      </div>
    </section>
  );
}
