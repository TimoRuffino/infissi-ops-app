// «Proprietari e inviti» della scheda azienda (spec WS6 §8): chi possiede
// l'azienda e i link con cui ci si entra la prima volta.
//
// Due nature diverse nella stessa sezione, e si vedono:
// - assegnare o revocare il ruolo è un COMANDO (`tenant_comandi`), sensibile,
//   e passa da `ConfermaPassword`;
// - invitare e annullare un invito NON sono comandi (spec §6.4): il link è un
//   segreto a tempo, non una riga di coda, e non chiede la password.
//
// Il link dell'invito, quando la posta non è configurata, è l'unica copia che
// esiste: resta in pagina finché non lo si chiude, mai dentro un toast che
// sparisce da solo.
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, Check, Copy, Mail, UserMinus, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { AppRouter } from "../../../../server/routers";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

import ConfermaPassword from "./ConfermaPassword";
import {
  dataOraItaliana,
  erroreDelComando,
  scadenzaInvito,
  statoInvito,
  testoEsitoInvito,
} from "./testi";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Scheda = RouterOutputs["piattaforma"]["azienda"];
type Comando = NonNullable<RouterOutputs["piattaforma"]["comando"]>;
type EsitoInvito = RouterOutputs["piattaforma"]["invita"];

export default function SezioneProprietari({
  slug,
  proprietari,
  inviti,
  adesso,
  solaLettura,
  onEsito,
  aggiorna,
}: {
  slug: string;
  proprietari: Scheda["proprietari"];
  inviti: Scheda["inviti"];
  adesso: Date;
  solaLettura: boolean;
  onEsito: (comando: Comando, successo: string) => boolean;
  /** Rilegge scheda ed elenco: serve a invito e annullamento, che non sono comandi. */
  aggiorna: () => void;
}) {
  // `null` = nessun dialogo; `{ azione: "assegna" }` = email da scrivere;
  // `{ azione: "revoca", email }` = il proprietario di quella riga.
  const [dialogo, setDialogo] = useState<{ azione: "assegna" | "revoca"; email: string } | null>(
    null
  );
  const [errore, setErrore] = useState<string | null>(null);
  const [esitoInvito, setEsitoInvito] = useState<EsitoInvito | null>(null);
  const [copiato, setCopiato] = useState(false);

  const ruolo = trpc.piattaforma.proprietario.useMutation({
    onSuccess: ({ comando }) => {
      const successo = dialogo?.azione === "revoca" ? "Proprietario revocato" : "Proprietario assegnato";
      if (onEsito(comando, successo)) chiudi(false);
      else setErrore(erroreDelComando(comando.esito) ?? "Comando non riuscito.");
    },
    onError: e => setErrore(e.message),
  });

  const invita = trpc.piattaforma.invita.useMutation({
    onSuccess: esito => {
      setEsitoInvito(esito);
      setCopiato(false);
      aggiorna();
      if (esito.inviato) toast.success(testoEsitoInvito({ inviato: true, email: esito.invito.email }));
      else toast.warning("Posta non configurata: copia il link qui sotto e consegnalo a mano.");
    },
    onError: e => toast.error(e.message),
  });

  const annulla = trpc.piattaforma.annullaInvito.useMutation({
    onSuccess: invito => {
      aggiorna();
      if (invito) toast.success("Invito annullato");
      else toast.error("L'invito non esiste più o è già stato usato.");
    },
    onError: e => toast.error(e.message),
  });

  function chiudi(aperto: boolean) {
    if (!aperto) {
      setDialogo(null);
      setErrore(null);
      ruolo.reset();
    }
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

  const emailValida = /.+@.+\..+/.test(dialogo?.email.trim() ?? "");
  const titoloSolaLettura = solaLettura
    ? "Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura."
    : undefined;

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 space-y-2">
        {proprietari.length === 0 ? (
          <p className="text-sm leading-5 text-text-2">
            Nessun proprietario: l'azienda non ha nessuno che possa amministrarla
            dall'interno.
          </p>
        ) : (
          <ul className="min-w-0 divide-y divide-border-soft">
            {proprietari.map(p => (
              <li
                key={p.id}
                className="flex min-w-0 flex-col gap-2 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-semibold text-text-1">
                      {p.nome} {p.cognome}
                    </span>
                    {p.attivo ? null : <Badge variant="warning">Disattivato</Badge>}
                  </span>
                  <span className="block truncate text-xs text-text-3">{p.email}</span>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-9"
                    disabled={solaLettura || invita.isPending}
                    title={titoloSolaLettura}
                    onClick={() => invita.mutate({ slug, email: p.email })}
                  >
                    <Mail className="size-3.5" aria-hidden="true" />
                    Invia invito
                  </Button>
                  <Button
                    type="button"
                    variant="dangerGhost"
                    size="sm"
                    className="min-h-9"
                    disabled={solaLettura}
                    title={titoloSolaLettura}
                    onClick={() => {
                      setErrore(null);
                      setDialogo({ azione: "revoca", email: p.email });
                    }}
                  >
                    <UserMinus className="size-3.5" aria-hidden="true" />
                    Revoca
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-9"
          disabled={solaLettura}
          title={titoloSolaLettura}
          onClick={() => {
            setErrore(null);
            setDialogo({ azione: "assegna", email: "" });
          }}
        >
          <UserPlus className="size-3.5" aria-hidden="true" />
          Assegna proprietario
        </Button>
      </div>

      {esitoInvito ? (
        <div className="min-w-0 space-y-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p className="min-w-0 text-sm leading-5 text-text-2">
              {testoEsitoInvito({
                inviato: esitoInvito.inviato,
                email: esitoInvito.invito.email,
              })}
            </p>
            <Button
              type="button"
              variant="quiet"
              size="icon-sm"
              aria-label="Chiudi il riepilogo dell'invito"
              onClick={() => setEsitoInvito(null)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {esitoInvito.inviato ? null : (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                value={esitoInvito.link}
                aria-label="Link dell'invito"
                className="h-11 min-w-0 font-mono text-xs"
                onFocus={event => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0"
                onClick={() => void copiaLink(esitoInvito.link)}
              >
                {copiato ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                {copiato ? "Copiato" : "Copia"}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <div className="min-w-0 space-y-2 border-t border-border-soft pt-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-3">
          Inviti
        </h3>
        {inviti.length === 0 ? (
          <p className="text-sm leading-5 text-text-3">Nessun invito emesso.</p>
        ) : (
          <ul className="min-w-0 divide-y divide-border-soft">
            {inviti.map(invito => {
              const stato = statoInvito(invito, adesso);
              return (
                <li
                  key={invito.id}
                  className="flex min-w-0 flex-col gap-2 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate text-sm text-text-1">
                        {invito.email}
                      </span>
                      <Badge variant={stato.tono}>{stato.etichetta}</Badge>
                    </span>
                    <span className="block truncate text-xs text-text-3">
                      {scadenzaInvito(invito.scadeIl)} · emesso il{" "}
                      {dataOraItaliana(invito.createdAt)}
                    </span>
                  </div>
                  {stato.pendente ? (
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      className="min-h-9 w-fit shrink-0"
                      disabled={solaLettura || annulla.isPending}
                      title={titoloSolaLettura}
                      onClick={() => annulla.mutate({ id: invito.id })}
                    >
                      Annulla
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfermaPassword
        open={dialogo != null}
        onOpenChange={chiudi}
        titolo={
          dialogo?.azione === "revoca" ? "Revoca il proprietario" : "Assegna il proprietario"
        }
        descrizione={
          dialogo?.azione === "revoca"
            ? "L'utente resta nell'azienda con gli altri suoi ruoli: perde solo il ruolo di proprietario. L'ultimo proprietario non si può revocare."
            : "L'utente deve già esistere dentro l'azienda: qui riceve in più il ruolo di proprietario."
        }
        etichettaConferma={dialogo?.azione === "revoca" ? "Revoca" : "Assegna"}
        distruttiva={dialogo?.azione === "revoca"}
        pending={ruolo.isPending}
        errore={errore}
        disabilitato={!emailValida}
        onConferma={password => {
          if (!dialogo || !emailValida) return;
          setErrore(null);
          ruolo.mutate({
            slug,
            email: dialogo.email.trim(),
            azione: dialogo.azione,
            passwordConferma: password,
          });
        }}
      >
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="proprietario-email">Email</Label>
          <Input
            id="proprietario-email"
            type="email"
            value={dialogo?.email ?? ""}
            readOnly={dialogo?.azione === "revoca"}
            onChange={event =>
              setDialogo(precedente =>
                precedente ? { ...precedente, email: event.target.value } : precedente
              )
            }
            className="h-11"
            autoComplete="off"
          />
          {dialogo?.azione === "assegna" && !emailValida ? (
            <p className="flex items-start gap-1.5 text-xs leading-4 text-text-3">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                L'indirizzo di un utente che lavora già in questa azienda.
              </span>
            </p>
          ) : null}
        </div>
      </ConfermaPassword>
    </div>
  );
}
