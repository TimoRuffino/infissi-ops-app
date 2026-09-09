// «Nuova azienda» (spec WS6 §8): un modulo solo, dall'anagrafica alla
// password di conferma. Non c'è un secondo dialogo per la password: sarebbe
// un passaggio in più su un'azione che l'amministratore sta già compilando
// campo per campo, e la conferma vale per QUESTO modulo.
//
// All'esito il dialogo non si chiude: mostra cosa è successo all'invito,
// perché se la posta non è configurata il link è l'unica copia esistente e
// chiuderlo lo perderebbe (spec §6.1: `invitaProprietario` non lancia).
import { AlertCircle, Check, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { slugSuggerito } from "@/lib/piattaforma";
import { trpc } from "@/lib/trpc";

import { erroreDelComando, testoEsitoInvito } from "./testi";

type Esito = {
  slug: string;
  nome: string;
  nota?: string;
  errore?: string;
  invito: { inviato: boolean; email?: string | null; link?: string | null } | null;
};

const VUOTO = {
  nome: "",
  slug: "",
  sedeNome: "",
  sedeCitta: "",
  propNome: "",
  propCognome: "",
  propEmail: "",
  propTelefono: "",
  omaggio: false,
  omaggioMotivo: "",
  omaggioScadenza: "",
  password: "",
};

function Campo({
  id,
  etichetta,
  children,
  aiuto,
}: {
  id: string;
  etichetta: string;
  children: React.ReactNode;
  aiuto?: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{etichetta}</Label>
      {children}
      {aiuto ? <p className="text-xs leading-4 text-text-3">{aiuto}</p> : null}
    </div>
  );
}

export default function NuovaAziendaDialog({
  open,
  onOpenChange,
  solaLettura,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A `FLAG_MULTI_AZIENDA` spento il server rifiuta: qui si dice prima. */
  solaLettura: boolean;
}) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [form, setForm] = useState(VUOTO);
  // Slug e nome della sede nascono dalla ragione sociale finché nessuno li
  // tocca: dopo, restano quello che l'amministratore ha scritto.
  const [slugToccato, setSlugToccato] = useState(false);
  const [sedeToccata, setSedeToccata] = useState(false);
  const [esito, setEsito] = useState<Esito | null>(null);
  const [copiato, setCopiato] = useState(false);

  const crea = trpc.piattaforma.crea.useMutation({
    onSuccess: risultato => {
      utils.piattaforma.aziende.invalidate();
      setEsito({
        slug: form.slug,
        nome: form.nome,
        nota: risultato.nota,
        errore: erroreDelComando(risultato.comando.esito),
        invito: risultato.invito
          ? {
              inviato: risultato.invito.inviato,
              email: risultato.invito.invito.email,
              link: risultato.invito.link,
            }
          : null,
      });
    },
  });

  function aggiorna(patch: Partial<typeof VUOTO>) {
    setForm(precedente => ({ ...precedente, ...patch }));
  }

  function cambiaNome(nome: string) {
    aggiorna({
      nome,
      ...(slugToccato ? {} : { slug: slugSuggerito(nome) }),
      ...(sedeToccata ? {} : { sedeNome: nome }),
    });
  }

  function chiudi(apri: boolean) {
    if (!apri) {
      setForm(VUOTO);
      setSlugToccato(false);
      setSedeToccata(false);
      setEsito(null);
      setCopiato(false);
      crea.reset();
    }
    onOpenChange(apri);
  }

  const completo =
    form.slug.trim().length > 0 &&
    form.nome.trim().length > 0 &&
    form.sedeNome.trim().length > 0 &&
    form.propNome.trim().length > 0 &&
    form.propCognome.trim().length > 0 &&
    form.propEmail.trim().length > 0 &&
    form.password.length > 0 &&
    (!form.omaggio || form.omaggioMotivo.trim().length > 0);

  function invia(event: React.FormEvent) {
    event.preventDefault();
    if (!completo || crea.isPending || solaLettura) return;
    crea.mutate({
      slug: form.slug.trim(),
      nome: form.nome.trim(),
      sede: {
        nome: form.sedeNome.trim(),
        citta: form.sedeCitta.trim() || null,
      },
      proprietario: {
        nome: form.propNome.trim(),
        cognome: form.propCognome.trim(),
        email: form.propEmail.trim(),
        telefono: form.propTelefono.trim() || null,
      },
      omaggio: form.omaggio
        ? {
            motivo: form.omaggioMotivo.trim(),
            scadenza: form.omaggioScadenza || null,
          }
        : undefined,
      passwordConferma: form.password,
    });
  }

  async function copiaLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiato(true);
      toast.success("Link dell'invito copiato");
    } catch {
      toast.error("Copia non riuscita: seleziona il link e copialo a mano");
    }
  }

  return (
    <Dialog open={open} onOpenChange={chiudi}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {esito ? "Azienda creata" : "Nuova azienda"}
          </DialogTitle>
          <DialogDescription>
            {esito
              ? "L'azienda esiste, la sede è aperta e il proprietario riceve l'invito con cui sceglie la password."
              : "Nascono insieme l'azienda, la sua prima sede e il proprietario. Il proprietario non riceve una password: la sceglie dall'invito."}
          </DialogDescription>
        </DialogHeader>

        {esito ? (
          <div className="min-w-0 space-y-4">
            <div className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-semibold text-text-1">
                  {esito.nome}
                </span>
                <Badge variant="secondary" className="font-mono">
                  {esito.slug}
                </Badge>
              </div>
              {esito.nota ? (
                <p className="mt-2 text-sm leading-5 text-warning">
                  {esito.nota}
                </p>
              ) : null}
              {esito.errore ? (
                <p
                  role="alert"
                  className="mt-2 flex items-start gap-1.5 text-sm leading-5 text-danger"
                >
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">{esito.errore}</span>
                </p>
              ) : null}
            </div>

            {esito.invito ? (
              <div className="min-w-0 space-y-2">
                <p className="text-sm leading-5 text-text-2">
                  {testoEsitoInvito(esito.invito)}
                </p>
                {!esito.invito.inviato && esito.invito.link ? (
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <Input
                      readOnly
                      value={esito.invito.link}
                      aria-label="Link dell'invito"
                      className="h-11 min-w-0 font-mono text-xs"
                      onFocus={event => event.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 shrink-0"
                      onClick={() => void copiaLink(esito.invito!.link!)}
                    >
                      {copiato ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                      {copiato ? "Copiato" : "Copia"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="quiet"
                className="min-h-11"
                onClick={() => chiudi(false)}
              >
                Chiudi
              </Button>
              <Button
                type="button"
                className="min-h-11"
                onClick={() => {
                  const slug = esito.slug;
                  chiudi(false);
                  setLocation(`/piattaforma/${slug}`);
                }}
              >
                Apri la scheda
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="min-w-0 space-y-5" onSubmit={invia}>
            {crea.error ? (
              <p
                role="alert"
                className="flex min-w-0 items-start gap-2 rounded-[var(--radius-control)] border border-danger/25 bg-danger-soft p-3 text-sm leading-5 text-danger"
              >
                <AlertCircle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0">{crea.error.message}</span>
              </p>
            ) : null}
            {solaLettura ? (
              <p
                role="status"
                className="rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft p-3 text-sm leading-5 text-warning"
              >
                Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura:
                nessuna azienda nuova finché non viene acceso.
              </p>
            ) : null}

            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Campo id="azienda-nome" etichetta="Ragione sociale">
                <Input
                  id="azienda-nome"
                  value={form.nome}
                  onChange={event => cambiaNome(event.target.value)}
                  className="h-11"
                  autoComplete="organization"
                  autoFocus
                />
              </Campo>
              <Campo
                id="azienda-slug"
                etichetta="Slug"
                aiuto="Minuscole, numeri e trattini: identifica l'azienda negli indirizzi e non cambia più."
              >
                <Input
                  id="azienda-slug"
                  value={form.slug}
                  onChange={event => {
                    setSlugToccato(true);
                    aggiorna({ slug: event.target.value });
                  }}
                  className="h-11 font-mono"
                  spellCheck={false}
                />
              </Campo>
            </div>

            <fieldset className="min-w-0 space-y-3">
              <legend className="text-xs font-bold uppercase tracking-[0.12em] text-text-3">
                Prima sede
              </legend>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <Campo id="sede-nome" etichetta="Nome della sede">
                  <Input
                    id="sede-nome"
                    value={form.sedeNome}
                    onChange={event => {
                      setSedeToccata(true);
                      aggiorna({ sedeNome: event.target.value });
                    }}
                    className="h-11"
                  />
                </Campo>
                <Campo id="sede-citta" etichetta="Città (facoltativa)">
                  <Input
                    id="sede-citta"
                    value={form.sedeCitta}
                    onChange={event => aggiorna({ sedeCitta: event.target.value })}
                    className="h-11"
                    autoComplete="address-level2"
                  />
                </Campo>
              </div>
            </fieldset>

            <fieldset className="min-w-0 space-y-3">
              <legend className="text-xs font-bold uppercase tracking-[0.12em] text-text-3">
                Proprietario
              </legend>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <Campo id="prop-nome" etichetta="Nome">
                  <Input
                    id="prop-nome"
                    value={form.propNome}
                    onChange={event => aggiorna({ propNome: event.target.value })}
                    className="h-11"
                    autoComplete="given-name"
                  />
                </Campo>
                <Campo id="prop-cognome" etichetta="Cognome">
                  <Input
                    id="prop-cognome"
                    value={form.propCognome}
                    onChange={event =>
                      aggiorna({ propCognome: event.target.value })
                    }
                    className="h-11"
                    autoComplete="family-name"
                  />
                </Campo>
                <Campo
                  id="prop-email"
                  etichetta="Email"
                  aiuto="A questo indirizzo arriva l'invito con cui sceglie la password."
                >
                  <Input
                    id="prop-email"
                    type="email"
                    value={form.propEmail}
                    onChange={event =>
                      aggiorna({ propEmail: event.target.value })
                    }
                    className="h-11"
                    autoComplete="email"
                  />
                </Campo>
                <Campo id="prop-telefono" etichetta="Telefono (facoltativo)">
                  <Input
                    id="prop-telefono"
                    type="tel"
                    value={form.propTelefono}
                    onChange={event =>
                      aggiorna({ propTelefono: event.target.value })
                    }
                    className="h-11"
                    autoComplete="tel"
                  />
                </Campo>
              </div>
            </fieldset>

            <div className="min-w-0 space-y-3 border-t border-border-soft pt-4">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <Label htmlFor="omaggio" className="min-w-0">
                  Omaggio subito
                  <span className="mt-0.5 block text-xs font-normal leading-4 text-text-3">
                    Al posto della prova gratuita di 30 giorni.
                  </span>
                </Label>
                <Switch
                  id="omaggio"
                  checked={form.omaggio}
                  onCheckedChange={valore => aggiorna({ omaggio: valore })}
                />
              </div>
              {form.omaggio ? (
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <Campo id="omaggio-motivo" etichetta="Motivo">
                    <Input
                      id="omaggio-motivo"
                      value={form.omaggioMotivo}
                      onChange={event =>
                        aggiorna({ omaggioMotivo: event.target.value })
                      }
                      className="h-11"
                    />
                  </Campo>
                  <Campo
                    id="omaggio-scadenza"
                    etichetta="Scadenza (facoltativa)"
                    aiuto="Senza scadenza l'omaggio non finisce da solo."
                  >
                    <Input
                      id="omaggio-scadenza"
                      type="date"
                      value={form.omaggioScadenza}
                      onChange={event =>
                        aggiorna({ omaggioScadenza: event.target.value })
                      }
                      className="h-11"
                    />
                  </Campo>
                </div>
              ) : null}
            </div>

            <div className="min-w-0 space-y-3 border-t border-border-soft pt-4">
              <Campo
                id="azienda-password"
                etichetta="La tua password"
                aiuto="Creare un'azienda è un'azione sensibile: serve a confermare che sei tu."
              >
                <Input
                  id="azienda-password"
                  type="password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={event => aggiorna({ password: event.target.value })}
                  className="h-11"
                />
              </Campo>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="quiet"
                className="min-h-11"
                disabled={crea.isPending}
                onClick={() => chiudi(false)}
              >
                Annulla
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={!completo || crea.isPending || solaLettura}
              >
                <Plus className="size-4" aria-hidden="true" />
                {crea.isPending ? "Creazione in corso…" : "Crea azienda"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
