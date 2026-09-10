// `/invito/:token` — la pagina pubblica con cui il proprietario di una
// azienda nuova sceglie la sua password ed entra (spec WS6 §6.3). Vive
// FUORI dalla shell: chi la apre non ha ancora una sessione, e
// `DashboardLayout` lo manderebbe al login.
//
// Stesso involucro visivo di `LoginPage.tsx` (marchio, riquadro, riga
// borgogna in alto): è la prima cosa che il cliente vede di Wyndoor, e deve
// somigliare alla porta da cui entrerà tutti i giorni.
//
// Il token non compare mai in un titolo, in un log o in un toast: sta
// nell'indirizzo e basta.
import { AlertCircle, Check, Circle, Eye, EyeOff, LogIn } from "lucide-react";
import { useState } from "react";
import { useLocation, useParams } from "wouter";

import { WyndoorMark } from "@/components/brand/WyndoorMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

import {
  TESTO_INVITO_NON_VALIDO,
  erroreInvioPassword,
  regolePassword,
  scadenzaInvito,
} from "./piattaforma/testi";

function Involucro({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[34vw] border-r border-border bg-surface-2 lg:block"
      />

      <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <div
          className="min-w-0 max-w-[420px]"
          style={{ width: "min(420px, calc(100vw - 2rem))" }}
        >
          <div className="mb-5 space-y-3 text-center">
            <WyndoorMark size={44} className="mx-auto text-brand-mark" />
            <div className="space-y-1">
              <h1 className="font-display text-[30px] font-extrabold leading-tight">
                Wyndoor
              </h1>
              <p className="eyebrow !text-text-2">
                Gestionale commesse infissi
              </p>
            </div>
          </div>

          <div className="relative min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card p-6 shadow-lg">
            <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
            {children}
          </div>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} Ruffino Immobiliare S.R.L.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function InvitoPage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const [password, setPassword] = useState("");
  const [conferma, setConferma] = useState("");
  const [mostra, setMostra] = useState(false);
  const [erroreLocale, setErroreLocale] = useState("");

  const anteprima = trpc.inviti.anteprima.useQuery(
    { token: token ?? "" },
    { enabled: Boolean(token), retry: false }
  );

  const accetta = trpc.inviti.accetta.useMutation({
    onSuccess: () => {
      // `auth.me` ora risponde con l'utente: la shell si monta da sola.
      utils.auth.me.invalidate();
      // Il proprietario appena entrato atterra sul percorso di attivazione
      // (WS5 §5): è il momento in cui collegare le integrazioni ha un senso,
      // e ogni passo si può saltare. Dalla home non ci sarebbe arrivato.
      setLocation("/integrazioni?attivazione=1");
    },
  });

  if (anteprima.isLoading) {
    return (
      <Involucro>
        <p role="status" aria-live="polite" className="text-sm text-text-2">
          Verifica dell'invito…
        </p>
      </Involucro>
    );
  }

  if (anteprima.error || !anteprima.data) {
    // Il testo è sempre questo, mai `anteprima.error.message`: un token
    // troppo corto viene rifiutato da zod (validazione dell'input, prima
    // ancora della query) con un messaggio tecnico che qui non deve
    // comparire mai (fix-round Task 8 #3) — chi apre questo link non deve
    // leggere un dettaglio da sviluppatori.
    return (
      <Involucro>
        <div className="min-w-0 space-y-3" role="alert">
          <h2 className="text-lg font-semibold">Invito non valido</h2>
          <p className="text-sm leading-6 text-text-2">
            {TESTO_INVITO_NON_VALIDO}
          </p>
          <p className="text-sm leading-6 text-text-3">
            Chiedi un nuovo invito a chi ti ha registrato.
          </p>
        </div>
      </Involucro>
    );
  }

  const invito = anteprima.data;
  const errore = erroreLocale || accetta.error?.message || "";
  const regole = regolePassword(password, conferma);

  function invia(event: React.FormEvent) {
    event.preventDefault();
    setErroreLocale("");
    // Password corta o due password diverse si fermano qui, senza bruciare
    // un tentativo del limitatore: la regola vive in `testi.ts`, dove è
    // provata (la suite gira senza DOM e non può montare questa pagina).
    const problema = erroreInvioPassword(password, conferma);
    if (problema) {
      setErroreLocale(problema);
      return;
    }
    accetta.mutate({ token: token ?? "", password });
  }

  return (
    <Involucro>
      {/* Il saluto per nome e la scheda «Azienda / Accesso» ricalcano la
          mail da cui si arriva (server/piattaforma/testi.ts): chi ha appena
          premuto un bottone in una casella deve riconoscere subito di essere
          nel posto giusto, e vedere con quale indirizzo sta entrando — è il
          suo nome utente da qui in avanti. */}
      <div className="min-w-0 space-y-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm leading-5 text-text-2">
            Ciao {invito.nome},
          </p>
          <h2 className="text-lg font-semibold">Scegli la tua password</h2>
        </div>

        <dl className="min-w-0 space-y-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
          <div className="flex min-w-0 gap-3">
            <dt className="w-[68px] shrink-0 pt-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-text-3">
              Azienda
            </dt>
            <dd className="min-w-0 break-words text-sm font-semibold leading-5 text-text-1">
              {invito.azienda}
            </dd>
          </div>
          <div className="flex min-w-0 gap-3">
            <dt className="w-[68px] shrink-0 pt-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-text-3">
              Accesso
            </dt>
            <dd className="min-w-0 break-all text-sm font-semibold leading-5 text-text-1">
              {invito.email}
            </dd>
          </div>
        </dl>

        <p className="text-xs leading-5 text-text-3">
          {scadenzaInvito(invito.scadeIl)} · si usa una volta sola
        </p>
      </div>

      <form onSubmit={invia} className="mt-4 min-w-0 space-y-4">
        {errore ? (
          <p
            role="alert"
            className="flex min-w-0 items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm leading-5 text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{errore}</span>
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="invito-password">Scegli la password</Label>
          <div className="relative">
            <Input
              id="invito-password"
              type={mostra ? "text" : "password"}
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="new-password"
              autoFocus
              className="h-11 pr-10"
              aria-describedby="invito-regola"
            />
            <button
              type="button"
              onClick={() => setMostra(s => !s)}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={mostra ? "Nascondi password" : "Mostra password"}
            >
              {mostra ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="invito-conferma">Ripeti la password</Label>
          <Input
            id="invito-conferma"
            type={mostra ? "text" : "password"}
            value={conferma}
            onChange={event => setConferma(event.target.value)}
            autoComplete="new-password"
            className="h-11"
            aria-describedby="invito-regola"
          />
        </div>

        {/* Le due regole si accendono mentre si scrive invece di comparire
            come errore dopo l'invio. L'elenco non è `aria-live`: cambierebbe
            a ogni tasto. Per chi non lo vede resta `aria-describedby` sui
            due campi, e l'errore vero all'invio è già un `role="alert"`. */}
        <ul id="invito-regola" className="min-w-0 space-y-1.5">
          {regole.map(regola => (
            <li
              key={regola.testo}
              className="flex min-w-0 items-center gap-2 text-xs leading-4"
            >
              {regola.soddisfatta ? (
                <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
              )}
              <span className={regola.soddisfatta ? "text-text-2" : "text-text-3"}>
                {regola.testo}
              </span>
            </li>
          ))}
        </ul>

        <Button
          type="submit"
          className="h-11 w-full"
          disabled={accetta.isPending}
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {accetta.isPending ? "Attendi…" : "Imposta la password ed entra"}
        </Button>
      </form>
    </Involucro>
  );
}
