// «Backup e ripristino» della scheda azienda (spec WS6 §8): gli ultimi cinque
// backup dell'azienda e il ripristino dei suoi archivi dal Drive.
//
// Il ripristino non passa da `ConfermaPassword`: la PROVA non è un'azione
// sensibile (spec §3.2 — il server legge il Drive e confronta, senza toccare
// nulla) e chiedere una password per non scrivere niente insegnerebbe a
// digitarla senza leggere. Il dialogo è quindi uno solo, con l'interruttore
// «Scrivi davvero» che fa comparire password e, per il tenant 1, la conferma
// in più. È la stessa distinzione del server, resa visibile.
//
// Prova e ripristino restano `in_attesa`: li esegue il giro dei comandi,
// perché è il server a parlare col Drive dell'azienda. La sezione mostra
// «In corso…» e la pagina interroga il comando finché non si chiude.
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, DatabaseBackup } from "lucide-react";
import { useState } from "react";

import type { AppRouter } from "../../../../server/routers";

import { byteScritti } from "@/components/abbonamento/testi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { trpc } from "@/lib/trpc";

import { dataOraItaliana, erroreDelComando } from "./testi";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Scheda = RouterOutputs["piattaforma"]["azienda"];
type Comando = NonNullable<RouterOutputs["piattaforma"]["comando"]>;

/** «AAAA-MM-GG» locale: è il nome con cui il backup vive su Drive («Backup CRM …»). */
function giornoIso(istante: Date): string {
  const mese = String(istante.getMonth() + 1).padStart(2, "0");
  const giorno = String(istante.getDate()).padStart(2, "0");
  return `${istante.getFullYear()}-${mese}-${giorno}`;
}

/** L'esito di `ripristina_archivi` (server/tenants/ripristino.ts) letto senza fidarsi. */
type EsitoRipristino = {
  dryRun: boolean;
  backup: { nome: string } | null;
  store: Array<{ nome: string; prima: number; dopo: number; sostituito: boolean }>;
  anomalie: string[];
  avvertenze: string[];
};

function leggiEsito(esito: Record<string, unknown> | null | undefined): EsitoRipristino | null {
  if (!esito || !Array.isArray(esito.store)) return null;
  const backup = esito.backup as { nome?: unknown } | null | undefined;
  return {
    dryRun: esito.dryRun === true,
    backup: backup && typeof backup.nome === "string" ? { nome: backup.nome } : null,
    store: (esito.store as EsitoRipristino["store"]).filter(
      s => s && typeof s.nome === "string"
    ),
    anomalie: Array.isArray(esito.anomalie) ? (esito.anomalie as string[]) : [],
    avvertenze: Array.isArray(esito.avvertenze) ? (esito.avvertenze as string[]) : [],
  };
}

const VUOTO = { backup: "", solo: "", scrivi: false, ancheTenant1: false, password: "" };

export default function SezioneRipristino({
  slug,
  backup,
  tenant1,
  solaLettura,
  comandoSeguito,
  onEsito,
}: {
  slug: string;
  backup: Scheda["backup"];
  /** Ruffino Group: ripristinarla tocca la piattaforma, e va detto due volte. */
  tenant1: boolean;
  solaLettura: boolean;
  /** Il comando lungo che la pagina sta seguendo, se è questo. */
  comandoSeguito: Comando | null;
  onEsito: (comando: Comando, successo: string) => boolean;
}) {
  const [aperto, setAperto] = useState(false);
  const [form, setForm] = useState(VUOTO);
  const [errore, setErrore] = useState<string | null>(null);

  const ripristina = trpc.piattaforma.ripristina.useMutation({
    onSuccess: ({ comando }) => {
      const ok = onEsito(
        comando,
        form.scrivi ? "Ripristino accodato" : "Prova di ripristino accodata"
      );
      if (ok) chiudi(false);
      else setErrore(erroreDelComando(comando.esito) ?? "Comando non riuscito.");
    },
    onError: e => setErrore(e.message),
  });

  function chiudi(apertoOra: boolean) {
    setAperto(apertoOra);
    if (!apertoOra) {
      setForm(VUOTO);
      setErrore(null);
      ripristina.reset();
    }
  }

  function apri(riferimento: string) {
    setForm({ ...VUOTO, backup: riferimento });
    setErrore(null);
    setAperto(true);
  }

  const pronto =
    form.backup.trim().length > 0 && (!form.scrivi || form.password.length > 0);

  const inCorso = comandoSeguito?.tipo === "ripristina_archivi" && comandoSeguito.stato === "in_attesa";
  const esito =
    comandoSeguito?.tipo === "ripristina_archivi" && comandoSeguito.stato === "eseguito"
      ? leggiEsito(comandoSeguito.esito)
      : null;
  const erroreSeguito =
    comandoSeguito?.tipo === "ripristina_archivi" && comandoSeguito.stato === "errore"
      ? erroreDelComando(comandoSeguito.esito)
      : undefined;

  const titoloSolaLettura = solaLettura
    ? "Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura."
    : undefined;

  return (
    <div className="min-w-0 space-y-4">
      {backup.length === 0 ? (
        <p className="text-sm leading-5 text-text-2">
          Nessun backup registrato per questa azienda.
        </p>
      ) : (
        // `relative`: la colonna delle azioni ha un'intestazione `sr-only`,
        // che è in posizione assoluta. Senza un antenato posizionato il suo
        // blocco contenitore diventa la pagina, e quel pixel fuori schermo
        // allarga `documentElement.scrollWidth` — scroll orizzontale globale,
        // misurato a 390 px prima di questa riga.
        <div
          className="relative min-w-0 overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Ultimi backup dell'azienda"
        >
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-xs text-text-3">
              <tr>
                <th scope="col" className="px-2 py-2 text-left font-semibold">Quando</th>
                <th scope="col" className="px-2 py-2 text-left font-semibold">Esito</th>
                <th scope="col" className="px-2 py-2 text-left font-semibold">Dove</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">File</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Peso</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {backup.map(riga => (
                <tr key={riga.id} className="border-t border-border-soft align-top">
                  <td className="min-w-0 px-2 py-2 tabular-nums">
                    {dataOraItaliana(riga.startedAt)}
                    <span className="block truncate text-xs text-text-3">
                      {riga.trigger === "manuale" ? "a mano" : "schedulato"}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <Badge
                      variant={riga.ok == null ? "warning" : riga.ok ? "success" : "danger"}
                      title={riga.error ?? undefined}
                    >
                      {riga.ok == null ? "In corso" : riga.ok ? "Riuscito" : "Fallito"}
                    </Badge>
                  </td>
                  <td className="min-w-0 px-2 py-2 text-text-2">
                    {riga.target === "drive" ? "Drive" : riga.target === "locale" ? "Locale" : "—"}
                    <span className="block truncate text-xs text-text-3">{riga.rootName}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{riga.files}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{byteScritti(riga.bytes)}</td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-9"
                      disabled={solaLettura}
                      title={titoloSolaLettura}
                      onClick={() => apri(giornoIso(riga.startedAt))}
                    >
                      Ripristina
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-9"
        disabled={solaLettura}
        title={titoloSolaLettura}
        onClick={() => apri("")}
      >
        <DatabaseBackup className="size-3.5" aria-hidden="true" />
        Ripristina da un altro backup
      </Button>

      {inCorso ? (
        <p role="status" className="text-sm leading-5 text-text-2">
          Ripristino in corso… Il server lo esegue al prossimo giro dei comandi;
          questa pagina si aggiorna da sola.
        </p>
      ) : null}

      {erroreSeguito ? (
        <p
          role="alert"
          className="flex min-w-0 items-start gap-2 rounded-[var(--radius-control)] border border-danger/25 bg-danger-soft p-3 text-sm leading-5 text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{erroreSeguito}</span>
        </p>
      ) : null}

      {esito ? (
        <div className="min-w-0 space-y-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
          <p className="min-w-0 text-sm font-semibold text-text-1">
            {esito.dryRun ? "Prova di ripristino" : "Ripristino eseguito"}
            {esito.backup ? ` · ${esito.backup.nome}` : null}
          </p>
          {esito.store.length === 0 ? (
            <p className="text-sm leading-5 text-text-2">Nessuno store nel backup.</p>
          ) : (
            <ul className="min-w-0 space-y-1 text-sm">
              {esito.store.map(s => (
                <li key={s.nome} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 truncate font-mono text-xs text-text-1">{s.nome}</span>
                  <span className="tabular-nums text-text-2">
                    {s.prima} → {s.dopo}
                  </span>
                  {s.sostituito ? null : (
                    <span className="text-xs text-text-3">(non sostituito)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {esito.anomalie.map(a => (
            <p key={a} className="text-sm leading-5 text-danger">
              {a}
            </p>
          ))}
          {esito.avvertenze.map(a => (
            <p key={a} className="text-sm leading-5 text-warning">
              {a}
            </p>
          ))}
        </div>
      ) : null}

      <Dialog open={aperto} onOpenChange={chiudi}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form.scrivi ? "Ripristina gli archivi" : "Prova il ripristino"}
            </DialogTitle>
            <DialogDescription>
              La prova legge il backup dal Drive dell'azienda e dice cosa
              cambierebbe, senza toccare niente. Solo con «Scrivi davvero» gli
              archivi vengono sostituiti.
            </DialogDescription>
          </DialogHeader>

          <form
            className="min-w-0 space-y-4"
            onSubmit={event => {
              event.preventDefault();
              if (!pronto || ripristina.isPending) return;
              setErrore(null);
              const solo = form.solo
                .split(",")
                .map(s => s.trim())
                .filter(Boolean);
              ripristina.mutate({
                slug,
                backup: form.backup.trim(),
                solo: solo.length > 0 ? solo : null,
                scrivi: form.scrivi,
                ...(tenant1 && form.scrivi ? { ancheTenant1: form.ancheTenant1 } : {}),
                ...(form.scrivi ? { passwordConferma: form.password } : {}),
              });
            }}
          >
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="ripristino-backup">Backup</Label>
              <Input
                id="ripristino-backup"
                value={form.backup}
                onChange={event => setForm(p => ({ ...p, backup: event.target.value }))}
                className="h-11 font-mono text-sm"
                placeholder="AAAA-MM-GG"
                spellCheck={false}
                autoFocus
              />
              <p className="text-xs leading-4 text-text-3">
                La data del backup, oppure l'id della cartella su Drive.
              </p>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="ripristino-solo">Solo questi archivi (facoltativo)</Label>
              <Input
                id="ripristino-solo"
                value={form.solo}
                onChange={event => setForm(p => ({ ...p, solo: event.target.value }))}
                className="h-11 font-mono text-sm"
                placeholder="clienti, commesse"
                spellCheck={false}
              />
              <p className="text-xs leading-4 text-text-3">
                Separati da virgola. Vuoto significa: tutti quelli del backup.
              </p>
            </div>

            <div className="flex min-w-0 items-start justify-between gap-3 border-t border-border-soft pt-4">
              <div className="min-w-0">
                <Label htmlFor="ripristino-scrivi">Scrivi davvero</Label>
                <p className="mt-0.5 text-xs leading-4 text-text-3">
                  Sostituisce gli archivi con quelli del backup.
                </p>
              </div>
              <Switch
                id="ripristino-scrivi"
                className="mt-0.5 shrink-0"
                checked={form.scrivi}
                onCheckedChange={valore => setForm(p => ({ ...p, scrivi: valore }))}
              />
            </div>

            {form.scrivi && tenant1 ? (
              <div className="flex min-w-0 items-start gap-2">
                <Checkbox
                  id="ripristino-tenant1"
                  checked={form.ancheTenant1}
                  onCheckedChange={valore =>
                    setForm(p => ({ ...p, ancheTenant1: valore === true }))
                  }
                  className="mt-0.5"
                />
                <Label htmlFor="ripristino-tenant1" className="min-w-0 text-sm font-normal leading-5">
                  Anche Ruffino Group (riscrive gli archivi della piattaforma)
                </Label>
              </div>
            ) : null}

            {form.scrivi ? (
              <div className="min-w-0 space-y-2">
                <Label htmlFor="ripristino-password">La tua password</Label>
                <Input
                  id="ripristino-password"
                  type="password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={event => setForm(p => ({ ...p, password: event.target.value }))}
                  className="h-11"
                  disabled={ripristina.isPending}
                />
              </div>
            ) : null}

            {errore ? (
              <p
                role="alert"
                className="flex min-w-0 items-start gap-1.5 text-sm leading-5 text-danger"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">{errore}</span>
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="quiet"
                className="min-h-11"
                disabled={ripristina.isPending}
                onClick={() => chiudi(false)}
              >
                Annulla
              </Button>
              <Button
                type="submit"
                variant={form.scrivi ? "destructive" : "default"}
                className="min-h-11"
                disabled={!pronto || ripristina.isPending}
              >
                {ripristina.isPending
                  ? "Attendi…"
                  : form.scrivi
                    ? "Ripristina davvero"
                    : "Prova senza scrivere"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
