// `/prova` — il modulo pubblico «Prova gratuita» (ciclo di vita, piano
// 10/09/2026, D7). Vive FUORI dalla shell come `/invito/:token`, e ne
// condivide l'involucro visivo: è la prima porta di Wyndoor.
//
// La pagina non promette nulla che il server non garantisca: se le
// iscrizioni sono chiuse (`iscrizione.disponibile`) mostra il messaggio di
// cortesia; a invio riuscito dice solo «controlla la casella» — il link
// d'invito viaggia SOLO per email, e la risposta è la stessa qualunque cosa
// sia successa dietro (nessuna conferma di quali email esistono).
import { AlertCircle, MailCheck, Send } from "lucide-react";
import { useState } from "react";

import { WyndoorMark } from "@/components/brand/WyndoorMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

import { TESTO_ISCRIZIONI_CHIUSE } from "./piattaforma/testi";

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
              <p className="eyebrow !text-text-2">Gestionale commesse infissi</p>
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

export default function ProvaPage() {
  const [azienda, setAzienda] = useState("");
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  // Honeypot: una persona non lo vede e non lo compila.
  const [sito, setSito] = useState("");
  const [erroreLocale, setErroreLocale] = useState("");

  const disponibile = trpc.iscrizione.disponibile.useQuery(undefined, { retry: false });
  const registra = trpc.iscrizione.registra.useMutation();

  if (disponibile.isLoading) {
    return (
      <Involucro>
        <p role="status" aria-live="polite" className="text-sm text-text-2">
          Un momento…
        </p>
      </Involucro>
    );
  }

  if (disponibile.error || !disponibile.data?.attiva) {
    return (
      <Involucro>
        <div className="min-w-0 space-y-3" role="alert">
          <h2 className="text-lg font-semibold">Iscrizioni non aperte</h2>
          <p className="text-sm leading-6 text-text-2">{TESTO_ISCRIZIONI_CHIUSE}</p>
          <p className="text-sm leading-6 text-text-3">
            Scrivi a{" "}
            <a className="font-medium text-primary underline underline-offset-2" href="mailto:info@wyndoor.com">
              info@wyndoor.com
            </a>{" "}
            e apriamo noi la prova per la tua azienda.
          </p>
        </div>
      </Involucro>
    );
  }

  if (registra.isSuccess) {
    return (
      <Involucro>
        <div className="min-w-0 space-y-3" role="status" aria-live="polite">
          <MailCheck className="h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Controlla la casella</h2>
          <p className="text-sm leading-6 text-text-2">
            Se l'indirizzo è utilizzabile riceverai entro qualche minuto l'invito per
            attivare la prova gratuita di 30 giorni: il link imposta la password e apre il
            gestionale.
          </p>
          <p className="text-sm leading-6 text-text-3">
            Niente in arrivo? Guarda nello spam, oppure scrivici a info@wyndoor.com.
          </p>
        </div>
      </Involucro>
    );
  }

  const errore = erroreLocale || registra.error?.message || "";

  function invia(event: React.FormEvent) {
    event.preventDefault();
    setErroreLocale("");
    if (azienda.trim().length < 2) {
      setErroreLocale("Scrivi il nome dell'azienda.");
      return;
    }
    if (!nome.trim() || !cognome.trim()) {
      setErroreLocale("Scrivi nome e cognome.");
      return;
    }
    registra.mutate({
      azienda: azienda.trim(),
      nome: nome.trim(),
      cognome: cognome.trim(),
      email: email.trim(),
      telefono: telefono.trim() || null,
      sito,
    });
  }

  return (
    <Involucro>
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold">Prova gratuita di 30 giorni</h2>
        <p className="text-sm leading-6 text-text-2">
          Lascia i tuoi dati: ti mandiamo per email l'invito con cui attivi l'azienda e
          scegli la password. Nessuna carta richiesta.
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
          <Label htmlFor="prova-azienda">Azienda</Label>
          <Input
            id="prova-azienda"
            value={azienda}
            onChange={event => setAzienda(event.target.value)}
            autoComplete="organization"
            autoFocus
            className="h-11"
            maxLength={120}
          />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="prova-nome">Nome</Label>
            <Input
              id="prova-nome"
              value={nome}
              onChange={event => setNome(event.target.value)}
              autoComplete="given-name"
              className="h-11"
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prova-cognome">Cognome</Label>
            <Input
              id="prova-cognome"
              value={cognome}
              onChange={event => setCognome(event.target.value)}
              autoComplete="family-name"
              className="h-11"
              maxLength={80}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="prova-email">Email di lavoro</Label>
          <Input
            id="prova-email"
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            autoComplete="email"
            required
            className="h-11"
          />
          <p className="text-xs leading-4 text-text-3">L'invito arriva qui: controlla che sia giusta.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="prova-telefono">Telefono (facoltativo)</Label>
          <Input
            id="prova-telefono"
            type="tel"
            value={telefono}
            onChange={event => setTelefono(event.target.value)}
            autoComplete="tel"
            className="h-11"
            maxLength={40}
          />
        </div>

        {/* Honeypot: nascosto alle persone, visibile ai bot. */}
        <div className="hidden" aria-hidden="true">
          <Label htmlFor="prova-sito">Sito web</Label>
          <Input
            id="prova-sito"
            value={sito}
            onChange={event => setSito(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        <Button type="submit" className="h-11 w-full" disabled={registra.isPending}>
          <Send className="h-4 w-4" aria-hidden="true" />
          {registra.isPending ? "Attendi…" : "Inizia la prova gratuita"}
        </Button>

        <p className="text-xs leading-5 text-text-3">
          Inviando accetti che usiamo questi dati solo per aprirti la prova e
          ricontattarti su Wyndoor.
        </p>
      </form>
    </Involucro>
  );
}
