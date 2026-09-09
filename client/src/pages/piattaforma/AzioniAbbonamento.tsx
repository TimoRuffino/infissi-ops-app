// Le sette azioni di `imposta_abbonamento` (spec WS6 §8, §9) viste dalla
// scheda dell'azienda: omaggio, proroga, disdetta, quota, tolleranze, budget
// Tars ed extra Tars. Una sola mutation (`piattaforma.abbonamento`) e una
// sola forma di dialogo (`ConfermaPassword`): cambia solo il payload.
//
// Le azioni NON stanno tutte insieme: vivono nella sezione di cui parlano —
// la quota e la sua tolleranza sotto «Spazio», il budget e l'extra sotto
// «Tars», il resto sotto «Abbonamento». Per questo il componente prende un
// `gruppo`: è lo stesso motore, montato tre volte.
//
// Le regole del dominio (il tenant 1 che non si disdice, un omaggio che non
// si può concedere) restano del servizio: qui l'errore del comando si
// mostra così com'è, non si anticipa e non si aggira.
import type { inferRouterOutputs } from "@trpc/server";
import { useState, type ReactNode } from "react";

import type { AppRouter } from "../../../../server/routers";

import { meseScritto } from "@/components/abbonamento/testi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatEuro, parseEuroNonNegativo, parseEuroPositivo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";

import ConfermaPassword from "./ConfermaPassword";
import { erroreDelComando } from "./testi";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Scheda = RouterOutputs["piattaforma"]["azienda"];
type Comando = NonNullable<RouterOutputs["piattaforma"]["comando"]>;

const GB = 1024 ** 3;

/** Quale terzina di pulsanti disegnare: la sezione che ospita il componente. */
export type GruppoAzioni = "abbonamento" | "spazio" | "tars";

type Azione =
  | "omaggio"
  | "proroga"
  | "disdetta"
  | "quota"
  | "tolleranza"
  | "budget"
  | "extra";

const AZIONI_DEL_GRUPPO: Record<GruppoAzioni, Azione[]> = {
  abbonamento: ["omaggio", "proroga", "disdetta"],
  spazio: ["quota", "tolleranza"],
  tars: ["budget", "extra", "tolleranza"],
};

const ETICHETTE_PULSANTE: Record<Azione, string> = {
  omaggio: "Omaggio",
  proroga: "Proroga",
  disdetta: "Disdetta",
  quota: "Quota",
  tolleranza: "Tolleranza",
  budget: "Budget",
  extra: "Extra",
};

function Campo({
  id,
  etichetta,
  aiuto,
  children,
}: {
  id: string;
  etichetta: string;
  aiuto?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{etichetta}</Label>
      {children}
      {aiuto ? <p className="text-xs leading-4 text-text-3">{aiuto}</p> : null}
    </div>
  );
}

/** I campi che una sola azione usa, azzerati a ogni apertura del dialogo. */
const VUOTO = {
  motivo: "",
  scadenza: "",
  giorni: "30",
  quotaGb: "",
  tolleranza: "",
  eur: "",
  senzaTetto: false,
};

export default function AzioniAbbonamento({
  slug,
  gruppo,
  abbonamento,
  quotaBytes,
  meseTars,
  solaLettura,
  onEsito,
}: {
  slug: string;
  gruppo: GruppoAzioni;
  abbonamento: Scheda["abbonamento"];
  /** La quota attuale, per precompilare il campo in GB. */
  quotaBytes?: number | null;
  /** Il mese del consumo Tars, per dire a quale mese si somma l'extra. */
  meseTars?: string;
  solaLettura: boolean;
  /** Invalida la scheda e racconta l'esito; `false` se il dominio ha rifiutato. */
  onEsito: (comando: Comando, successo: string) => boolean;
}) {
  const [aperta, setAperta] = useState<Azione | null>(null);
  const [form, setForm] = useState(VUOTO);
  const [errore, setErrore] = useState<string | null>(null);

  const azione = trpc.piattaforma.abbonamento.useMutation({
    onSuccess: ({ comando }) => {
      const ok = onEsito(comando, testoSuccesso);
      if (ok) chiudi(false);
      else setErrore(erroreDelComando(comando.esito) ?? "Comando non riuscito.");
    },
    onError: e => setErrore(e.message),
  });

  const disdice = !abbonamento?.disdettaAFinePeriodo;

  function apri(quale: Azione) {
    setErrore(null);
    setForm({
      ...VUOTO,
      giorni: "30",
      quotaGb: quotaBytes ? String(Math.max(1, Math.round(quotaBytes / GB))) : "",
      tolleranza: String(
        gruppo === "tars"
          ? (abbonamento?.tolleranzaTarsGiorni ?? 0)
          : (abbonamento?.tolleranzaStorageGiorni ?? 0)
      ),
      // Solo il budget nasce già scritto: l'extra è un importo nuovo ogni
      // volta, e trovarci dentro il budget inviterebbe a confermarlo.
      eur:
        quale === "budget" && abbonamento?.budgetTarsEur != null
          ? formatEuro(abbonamento.budgetTarsEur)
          : "",
      senzaTetto: quale === "budget" && abbonamento?.budgetTarsEur == null,
    });
    setAperta(quale);
  }

  function chiudi(apertaOra: boolean) {
    if (!apertaOra) {
      setAperta(null);
      setErrore(null);
      azione.reset();
    }
  }

  function aggiorna(patch: Partial<typeof VUOTO>) {
    setForm(precedente => ({ ...precedente, ...patch }));
  }

  const giorni = Number.parseInt(form.giorni, 10);
  const quotaGb = Number.parseInt(form.quotaGb, 10);
  const tolleranza = Number.parseInt(form.tolleranza, 10);
  const budgetEur = form.senzaTetto ? null : parseEuroNonNegativo(form.eur);
  const extraEur = parseEuroPositivo(form.eur);

  /** I campi bastano? La password da sola non manda avanti un modulo incompleto. */
  const valido = (() => {
    switch (aperta) {
      case "omaggio":
        return form.motivo.trim().length > 0;
      case "proroga":
        return form.motivo.trim().length > 0 && Number.isFinite(giorni) && giorni >= 1 && giorni <= 365;
      case "disdetta":
        return true;
      case "quota":
        return Number.isFinite(quotaGb) && quotaGb >= 1 && quotaGb <= 100_000;
      case "tolleranza":
        return Number.isFinite(tolleranza) && tolleranza >= 0 && tolleranza <= 365;
      case "budget":
        return form.senzaTetto || (budgetEur != null && budgetEur <= 100_000);
      case "extra":
        return extraEur != null && extraEur <= 100_000;
      default:
        return false;
    }
  })();

  const testoSuccesso = (() => {
    switch (aperta) {
      case "omaggio":
        return "Omaggio concesso";
      case "proroga":
        return "Prova prorogata";
      case "disdetta":
        return disdice ? "Disdetta registrata" : "Disdetta annullata";
      case "quota":
        return "Quota aggiornata";
      case "tolleranza":
        return "Tolleranza aggiornata";
      case "budget":
        return "Budget aggiornato";
      case "extra":
        return "Extra concesso";
      default:
        return "Fatto";
    }
  })();

  function conferma(password: string) {
    if (!aperta || !valido) return;
    setErrore(null);
    const base = { slug, passwordConferma: password };
    switch (aperta) {
      case "omaggio":
        azione.mutate({
          ...base,
          azione: "omaggio",
          motivo: form.motivo.trim(),
          scadenza: form.scadenza || null,
        });
        return;
      case "proroga":
        azione.mutate({ ...base, azione: "proroga", motivo: form.motivo.trim(), giorni });
        return;
      case "disdetta":
        azione.mutate({ ...base, azione: "disdetta", disdetta: disdice });
        return;
      case "quota":
        azione.mutate({ ...base, azione: "quota", quotaGb });
        return;
      case "tolleranza":
        azione.mutate({
          ...base,
          azione: "tolleranze",
          ...(gruppo === "tars" ? { tars: tolleranza } : { storage: tolleranza }),
        });
        return;
      case "budget":
        azione.mutate({ ...base, azione: "budget_tars", eur: budgetEur });
        return;
      case "extra":
        azione.mutate({ ...base, azione: "extra_tars", eur: extraEur ?? 0 });
    }
  }

  const titolo = (() => {
    switch (aperta) {
      case "omaggio":
        return "Concedi un omaggio";
      case "proroga":
        return "Proroga la prova";
      case "disdetta":
        return disdice ? "Disdici a fine periodo" : "Annulla la disdetta";
      case "quota":
        return "Cambia la quota di spazio";
      case "tolleranza":
        return gruppo === "tars" ? "Tolleranza di Tars" : "Tolleranza dello spazio";
      case "budget":
        return "Budget Tars del mese";
      case "extra":
        return "Extra Tars per questo mese";
      default:
        return "";
    }
  })();

  const descrizione = (() => {
    switch (aperta) {
      case "omaggio":
        return "L'azienda passa ad abbonamento omaggio: nessun rinnovo da pagare finché l'omaggio resta.";
      case "proroga":
        return "Sposta in avanti la fine del periodo, senza cambiare il tipo di abbonamento.";
      case "disdetta":
        return disdice
          ? "L'abbonamento resta attivo fino alla fine del periodo pagato, poi si chiude."
          : "L'abbonamento torna a rinnovarsi alla fine del periodo.";
      case "quota":
        return "Lo spazio incluso nell'abbonamento. Sotto la quota già usata i caricamenti nuovi si fermano dopo la tolleranza.";
      case "tolleranza":
        return gruppo === "tars"
          ? "I giorni di grazia dopo il 100 % del budget, prima che Tars si fermi."
          : "I giorni di grazia dopo il 100 % della quota, prima che i caricamenti nuovi si fermino.";
      case "budget":
        return "Il tetto di spesa di Tars per ogni mese. Senza tetto l'azienda non si ferma mai per budget.";
      case "extra":
        return meseTars
          ? `Si somma al budget solo per ${meseScritto(meseTars)}.`
          : "Si somma al budget solo per il mese in corso.";
      default:
        return "";
    }
  })();

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {AZIONI_DEL_GRUPPO[gruppo].map(id => (
          <Button
            key={id}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            disabled={solaLettura}
            title={solaLettura ? "Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura." : undefined}
            onClick={() => apri(id)}
          >
            {id === "disdetta" && !disdice ? "Annulla disdetta" : ETICHETTE_PULSANTE[id]}
          </Button>
        ))}
      </div>

      <ConfermaPassword
        open={aperta != null}
        onOpenChange={chiudi}
        titolo={titolo}
        descrizione={descrizione}
        etichettaConferma={aperta === "disdetta" && disdice ? "Disdici" : "Conferma"}
        distruttiva={aperta === "disdetta" && disdice}
        pending={azione.isPending}
        errore={errore}
        disabilitato={!valido}
        onConferma={conferma}
      >
        {aperta === "omaggio" || aperta === "proroga" ? (
          <Campo id="azione-motivo" etichetta="Motivo">
            <Input
              id="azione-motivo"
              value={form.motivo}
              onChange={event => aggiorna({ motivo: event.target.value })}
              className="h-11"
              autoFocus
            />
          </Campo>
        ) : null}

        {aperta === "omaggio" ? (
          <Campo
            id="azione-scadenza"
            etichetta="Scadenza (facoltativa)"
            aiuto="Senza scadenza l'omaggio non finisce da solo."
          >
            <Input
              id="azione-scadenza"
              type="date"
              value={form.scadenza}
              onChange={event => aggiorna({ scadenza: event.target.value })}
              className="h-11"
            />
          </Campo>
        ) : null}

        {aperta === "proroga" ? (
          <Campo id="azione-giorni" etichetta="Giorni" aiuto="Da 1 a 365.">
            <Input
              id="azione-giorni"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={form.giorni}
              onChange={event => aggiorna({ giorni: event.target.value })}
              className="h-11 tabular-nums"
            />
          </Campo>
        ) : null}

        {aperta === "quota" ? (
          <Campo id="azione-quota" etichetta="Quota in GB" aiuto="Da 1 a 100.000 GB.">
            <Input
              id="azione-quota"
              type="number"
              inputMode="numeric"
              min={1}
              max={100_000}
              value={form.quotaGb}
              onChange={event => aggiorna({ quotaGb: event.target.value })}
              className="h-11 tabular-nums"
              autoFocus
            />
          </Campo>
        ) : null}

        {aperta === "tolleranza" ? (
          <Campo id="azione-tolleranza" etichetta="Giorni di tolleranza" aiuto="Da 0 a 365. Zero significa: si ferma subito.">
            <Input
              id="azione-tolleranza"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              value={form.tolleranza}
              onChange={event => aggiorna({ tolleranza: event.target.value })}
              className="h-11 tabular-nums"
              autoFocus
            />
          </Campo>
        ) : null}

        {aperta === "budget" ? (
          <div className="min-w-0 space-y-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="azione-senza-tetto">Senza tetto</Label>
                <p className="mt-0.5 text-xs leading-4 text-text-3">
                  Tars non si ferma mai per budget.
                </p>
              </div>
              <Switch
                id="azione-senza-tetto"
                className="mt-0.5 shrink-0"
                checked={form.senzaTetto}
                onCheckedChange={valore => aggiorna({ senzaTetto: valore })}
              />
            </div>
            {form.senzaTetto ? null : (
              <Campo id="azione-budget" etichetta="Budget al mese in euro">
                <Input
                  id="azione-budget"
                  inputMode="decimal"
                  value={form.eur}
                  onChange={event => aggiorna({ eur: event.target.value })}
                  className="h-11 tabular-nums"
                  autoFocus
                />
              </Campo>
            )}
          </div>
        ) : null}

        {aperta === "extra" ? (
          <Campo id="azione-extra" etichetta="Extra in euro" aiuto="Maggiore di zero: un extra da zero non si concede.">
            <Input
              id="azione-extra"
              inputMode="decimal"
              value={form.eur}
              onChange={event => aggiorna({ eur: event.target.value })}
              className="h-11 tabular-nums"
              autoFocus
            />
          </Campo>
        ) : null}
      </ConfermaPassword>
    </>
  );
}
