// Pannello «Fatturazione» delle Impostazioni: la configurazione per sede che
// la fatturazione dal contratto usa per emettere — IBAN, banca e intestatario
// in calce al documento, metodo di pagamento SdI, numerazione e conto di
// Fatture in Cloud, spese di documentazione della detrazione, dicitura finale
// — più lo stato dei permessi di scrittura FiC.
//
// Nessuna regola di dominio qui: il pannello legge `fatturazioneConfig.get`,
// manda a `salva` i soli campi cambiati e mostra l'esito di `verificaScope`
// così come arriva. L'IBAN è ricontrollato lato client solo per dirlo prima
// (`ibanSembraValido`): l'autorità resta il server, che rifiuta comunque.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, ShieldCheck, Undo2 } from "lucide-react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { ibanSembraValido } from "@/lib/fatturaView";
import { formatEuro, parseEuroNonNegativo } from "@/lib/euro";
import { permessoNegato } from "@/lib/trpcErrors";
import DataSurface from "@/components/patterns/DataSurface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** Il patch accettato dal router: si legge dal contratto, non si riscrive a mano. */
type PatchConfig = inferRouterInputs<AppRouter>["fatturazioneConfig"]["salva"];
type EsitoScope =
  inferRouterOutputs<AppRouter>["fatturazioneConfig"]["verificaScope"];
type OpzioniFic = NonNullable<EsitoScope["opzioni"]>;
type Config =
  inferRouterOutputs<AppRouter>["fatturazioneConfig"]["get"]["config"];

/**
 * I metodi di pagamento SdI che il CRM propone. Un valore già salvato fuori
 * da questo elenco resta selezionabile (v. `metodiVisibili`): la tendina non
 * deve poter cancellare una configurazione che qualcun altro ha scelto.
 */
const METODI_PAGAMENTO: Array<{ codice: string; etichetta: string }> = [
  { codice: "MP05", etichetta: "MP05 · Bonifico" },
  { codice: "MP01", etichetta: "MP01 · Contanti" },
  { codice: "MP08", etichetta: "MP08 · Carta di pagamento" },
  { codice: "MP12", etichetta: "MP12 · RIBA" },
];

/** Radix non accetta il valore vuoto in una voce di tendina: serve un segnaposto. */
const NESSUNO = "__nessuno";

// Stessi tetti dello schema zod del router (server/routers/fatturazioneConfig.ts).
const MAX_IBAN = 34;
const MAX_BANCA = 80;
const MAX_INTESTATARIO = 120;
const MAX_NUMERAZIONE = 20;
const MAX_FOOTER = 500;

type Modulo = {
  iban: string;
  banca: string;
  intestatario: string;
  metodoPagamento: string;
  numerazioneFic: string;
  contoFic: string;
  speseTesto: string;
  dicituraFooter: string;
};

const MODULO_VUOTO: Modulo = {
  iban: "",
  banca: "",
  intestatario: "",
  metodoPagamento: "MP05",
  numerazioneFic: "",
  contoFic: "",
  speseTesto: "",
  dicituraFooter: "",
};

/** L'IBAN si confronta e si salva normalizzato, come fa il servizio. */
function normalizzaIban(testo: string): string {
  return testo.replace(/\s+/g, "").toUpperCase();
}

/** Campo di testo facoltativo: vuoto vuol dire «nessun valore», non stringa vuota. */
function testoONull(testo: string): string | null {
  const pulito = testo.trim();
  return pulito === "" ? null : pulito;
}

/** R17: gli importi viaggiano in centesimi interi, mai in euro decimali. */
function centDaTesto(testo: string): number | null {
  const euro = parseEuroNonNegativo(testo);
  return euro == null ? null : Math.round(euro * 100);
}

function moduloDaConfig(c: Config): Modulo {
  return {
    iban: c.iban ?? "",
    banca: c.banca ?? "",
    intestatario: c.intestatario ?? "",
    metodoPagamento: c.metodoPagamento,
    numerazioneFic: c.numerazioneFic ?? "",
    contoFic:
      c.paymentAccountIdFic == null ? "" : String(c.paymentAccountIdFic),
    speseTesto: formatEuro(c.speseDocumentazioneCent / 100),
    dicituraFooter: c.dicituraFooter ?? "",
  };
}

/**
 * Solo i campi davvero cambiati: un patch che rimanda tutto riscriverebbe
 * `updatedAt` (e la configurazione di chi ha salvato un istante prima) anche
 * quando non c'è niente da cambiare.
 */
function patchDaModulo(m: Modulo, base: Config): PatchConfig {
  const patch: PatchConfig = {};
  const iban = normalizzaIban(m.iban);
  if (iban !== (base.iban ?? "")) patch.iban = iban;
  if (testoONull(m.banca) !== base.banca) patch.banca = testoONull(m.banca);
  if (testoONull(m.intestatario) !== base.intestatario) {
    patch.intestatario = testoONull(m.intestatario);
  }
  if (m.metodoPagamento !== base.metodoPagamento) {
    patch.metodoPagamento = m.metodoPagamento;
  }
  if (testoONull(m.numerazioneFic) !== base.numerazioneFic) {
    patch.numerazioneFic = testoONull(m.numerazioneFic);
  }
  const conto = m.contoFic.trim() === "" ? null : Number(m.contoFic);
  if (conto !== base.paymentAccountIdFic) patch.paymentAccountIdFic = conto;
  if (testoONull(m.dicituraFooter) !== base.dicituraFooter) {
    patch.dicituraFooter = testoONull(m.dicituraFooter);
  }
  const cent = centDaTesto(m.speseTesto);
  if (cent != null && cent !== base.speseDocumentazioneCent) {
    patch.speseDocumentazioneCent = cent;
  }
  return patch;
}

function dataOra(valore: Date | string | null): string {
  if (valore == null) return "—";
  const d = valore instanceof Date ? valore : new Date(valore);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function FatturazioneConfigPanel() {
  const utils = trpc.useUtils();
  const q = trpc.fatturazioneConfig.get.useQuery(undefined, { retry: false });

  const [modulo, setModulo] = useState<Modulo>(MODULO_VUOTO);
  const [sporco, setSporco] = useState(false);
  // Gli elenchi arrivano solo da una verifica riuscita: finché non c'è, i
  // due campi restano liberi invece di offrire una tendina vuota.
  const [opzioni, setOpzioni] = useState<OpzioniFic | null>(null);
  const [esito, setEsito] = useState<EsitoScope | null>(null);

  // Il modulo segue il server finché l'operatore non tocca niente: dopo la
  // verifica dello scope il server riscrive la configurazione (id IVA, conto
  // scelto da solo quando è l'unico) e i campi devono mostrarlo.
  useEffect(() => {
    if (!q.data || sporco) return;
    setModulo(moduloDaConfig(q.data.config));
  }, [q.data, sporco]);

  /**
   * Le due mutation tornano la configurazione salvata: mettendola in cache
   * prima di spegnere `sporco` il modulo non passa un istante sui valori di
   * prima (l'effetto qui sopra riparte da `q.data`, che senza questo passo
   * sarebbe ancora quello vecchio finché non arriva il refetch).
   */
  function aggiornaCache(config: Config, scopeOk?: boolean): void {
    utils.fatturazioneConfig.get.setData(undefined, prev =>
      prev
        ? {
            ...prev,
            config,
            scopeScritturaOk: scopeOk ?? prev.scopeScritturaOk,
          }
        : prev
    );
    void utils.fatturazioneConfig.invalidate();
  }

  const salva = trpc.fatturazioneConfig.salva.useMutation({
    onSuccess: aggiornata => {
      aggiornaCache(aggiornata);
      setSporco(false);
      toast.success("Configurazione di fatturazione salvata");
    },
    onError: e => toast.error(e.message ?? "Salvataggio non riuscito"),
  });

  const verifica = trpc.fatturazioneConfig.verificaScope.useMutation({
    onSuccess: risposta => {
      setEsito(risposta);
      if (risposta.opzioni) setOpzioni(risposta.opzioni);
      aggiornaCache(risposta.config, risposta.config.scopeScritturaOk);
      // Con `sporco` attivo l'effetto sopra è fermo: il conto FiC assegnato
      // da solo dal server sparirebbe al prossimo «Salva» come valore nullo.
      const contoAssegnato = risposta.config.paymentAccountIdFic;
      if (typeof contoAssegnato === "number") {
        setModulo(m =>
          m.contoFic.trim() === ""
            ? { ...m, contoFic: String(contoAssegnato) }
            : m
        );
      }
      if (risposta.ok) toast.success("Permessi di scrittura confermati");
      else toast.error(risposta.motivo ?? "Verifica non riuscita");
    },
    onError: e => toast.error(e.message ?? "Verifica non riuscita"),
  });

  // Direzione-only lato server come il resto della sezione: un FORBIDDEN
  // significa che il pannello non riguarda questo utente.
  if (permessoNegato(q.error)) return null;

  if (q.isLoading || q.error || !q.data) {
    return (
      <DataSurface
        density="comfortable"
        tone="default"
        title="Fatturazione"
        description="Dati di pagamento e numerazione con cui il CRM emette le fatture della sede."
        state={
          q.error
            ? {
                kind: "error",
                title: "Configurazione di fatturazione non disponibile",
                description:
                  "Il server non ha risposto sulla configurazione della sede. Nessun dato è stato modificato.",
                action: (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void q.refetch()}
                  >
                    Riprova
                  </Button>
                ),
              }
            : {
                kind: "loading",
                title: "Lettura della configurazione",
                description:
                  "Sto chiedendo al server i dati di fatturazione della sede.",
                rows: 2,
              }
        }
      />
    );
  }

  const config = q.data.config;
  const ibanNormalizzato = normalizzaIban(modulo.iban);
  const ibanKo = ibanNormalizzato !== "" && !ibanSembraValido(ibanNormalizzato);
  const speseCent = centDaTesto(modulo.speseTesto);
  const speseKo = speseCent == null;
  const patch = patchDaModulo(modulo, config);
  const daSalvare = Object.keys(patch).length;

  const metodiVisibili = METODI_PAGAMENTO.some(
    m => m.codice === modulo.metodoPagamento
  )
    ? METODI_PAGAMENTO
    : [
        ...METODI_PAGAMENTO,
        {
          codice: modulo.metodoPagamento,
          etichetta: `${modulo.metodoPagamento} · già configurato`,
        },
      ];

  // Le tendine mostrano sempre anche il valore già salvato, pure quando FiC
  // non lo elenca più: una voce mancante lascerebbe il campo visivamente
  // vuoto e il primo salvataggio la cancellerebbe senza che nessuno l'abbia
  // chiesto. Stessa ragione di `metodiVisibili`.
  const numerazioni = opzioni?.numerations ?? [];
  const conti = opzioni?.paymentAccounts ?? [];
  const numerazioniVisibili =
    modulo.numerazioneFic.trim() === "" ||
    numerazioni.includes(modulo.numerazioneFic)
      ? numerazioni
      : [...numerazioni, modulo.numerazioneFic];
  const contiVisibili =
    modulo.contoFic.trim() === "" ||
    conti.some(c => String(c.id) === modulo.contoFic)
      ? conti
      : [
          ...conti,
          {
            id: Number(modulo.contoFic),
            name: `Conto #${modulo.contoFic} (non in elenco)`,
          },
        ];

  function cambia(patchModulo: Partial<Modulo>): void {
    setSporco(true);
    setModulo(m => ({ ...m, ...patchModulo }));
  }

  return (
    <DataSurface
      density="comfortable"
      tone="default"
      title="Fatturazione"
      description="Dati di pagamento, numerazione e diciture con cui il CRM emette le fatture di questa sede. Valgono per la sede selezionata nella barra laterale."
      toolbar={
        q.data.dryRun ? (
          <Badge variant="warning">
            Invio SdI in prova (FATTURAZIONE_SDI_DRY_RUN)
          </Badge>
        ) : (
          <Badge variant="success">Invio SdI reale</Badge>
        )
      }
    >
      <div className="min-w-0 space-y-4 border-t border-border-soft pt-4">
        {/* Permessi di scrittura: intento del collegamento e verifica vera */}
        <div className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-3">
          <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="eyebrow text-text-3">
                Permessi di scrittura richiesti
              </dt>
              <dd className="mt-1">
                {q.data.scopeScrittura ? (
                  <Badge variant="success">Richiesti nell&apos;OAuth</Badge>
                ) : (
                  <Badge variant="warning">Non richiesti</Badge>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow text-text-3">
                Verifica su Fatture in Cloud
              </dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                {q.data.scopeScritturaOk ? (
                  <Badge variant="success">Confermati</Badge>
                ) : (
                  <Badge variant="warning">Mai confermati</Badge>
                )}
                <span className="text-xs text-text-2">
                  {config.scopeVerificatoAt
                    ? `ultima verifica ${dataOra(config.scopeVerificatoAt)}`
                    : "nessuna verifica eseguita"}
                </span>
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              onClick={() => verifica.mutate()}
              disabled={verifica.isPending}
            >
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              {verifica.isPending
                ? "Verifico…"
                : "Verifica permessi e carica IVA/conti da FiC"}
            </Button>
            <span className="text-xs text-text-3">
              Una chiamata di sola lettura a Fatture in Cloud: nessun documento
              viene creato.
            </span>
          </div>

          {esito && (
            <p
              role="status"
              className={`mt-3 text-sm ${esito.ok ? "text-success" : "text-danger"}`}
            >
              {esito.ok ? (
                <>
                  Permessi confermati · IVA 22 % id{" "}
                  {esito.config.vatIdsFic[22] ?? "non trovato"}, 10 % id{" "}
                  {esito.config.vatIdsFic[10] ?? "non trovato"} · {conti.length}{" "}
                  {conti.length === 1 ? "conto" : "conti"} e{" "}
                  {numerazioni.length}{" "}
                  {numerazioni.length === 1 ? "numerazione" : "numerazioni"}{" "}
                  disponibili.
                </>
              ) : (
                <>
                  {esito.motivo ?? "Verifica non riuscita."} Ricollega Fatture
                  in Cloud con «Ri-autorizza con permessi di scrittura» nella
                  card qui sopra, poi riprova.
                </>
              )}
            </p>
          )}
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="fatturazione-iban" className="text-xs">
              IBAN di accredito
            </Label>
            <Input
              id="fatturazione-iban"
              className="h-11 font-mono text-xs"
              placeholder="IT60X0542811101000000123456"
              // +8 di margine per gli spazi di raggruppamento digitati inserendo l'IBAN.
              maxLength={MAX_IBAN + 8}
              aria-invalid={ibanKo || undefined}
              aria-describedby={ibanKo ? "fatturazione-iban-errore" : undefined}
              value={modulo.iban}
              onChange={e => cambia({ iban: e.target.value })}
            />
            {ibanKo ? (
              <p id="fatturazione-iban-errore" className="text-xs text-danger">
                Questo IBAN non supera il controllo del codice di controllo: il
                server lo rifiuterà.
              </p>
            ) : (
              <p className="text-xs text-text-3">
                Finisce in calce alla fattura come coordinate di pagamento.
              </p>
            )}
          </div>

          <div className="min-w-0 space-y-1">
            <Label htmlFor="fatturazione-banca" className="text-xs">
              Banca
            </Label>
            <Input
              id="fatturazione-banca"
              className="h-11"
              maxLength={MAX_BANCA}
              value={modulo.banca}
              onChange={e => cambia({ banca: e.target.value })}
            />
          </div>

          <div className="min-w-0 space-y-1">
            <Label htmlFor="fatturazione-intestatario" className="text-xs">
              Intestatario del conto
            </Label>
            <Input
              id="fatturazione-intestatario"
              className="h-11"
              maxLength={MAX_INTESTATARIO}
              value={modulo.intestatario}
              onChange={e => cambia({ intestatario: e.target.value })}
            />
          </div>

          <div className="min-w-0 space-y-1">
            <Label htmlFor="fatturazione-metodo" className="text-xs">
              Metodo di pagamento (SdI)
            </Label>
            <Select
              value={modulo.metodoPagamento}
              onValueChange={v => cambia({ metodoPagamento: v })}
            >
              <SelectTrigger
                id="fatturazione-metodo"
                className="min-h-11 w-full"
                aria-label="Metodo di pagamento SdI"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {metodiVisibili.map(m => (
                  <SelectItem key={m.codice} value={m.codice}>
                    {m.etichetta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1">
            <Label htmlFor="fatturazione-numerazione" className="text-xs">
              Numerazione Fatture in Cloud
            </Label>
            {numerazioni.length > 0 ? (
              <Select
                value={
                  modulo.numerazioneFic.trim() === ""
                    ? NESSUNO
                    : modulo.numerazioneFic
                }
                onValueChange={v =>
                  cambia({ numerazioneFic: v === NESSUNO ? "" : v })
                }
              >
                <SelectTrigger
                  id="fatturazione-numerazione"
                  className="min-h-11 w-full"
                  aria-label="Numerazione Fatture in Cloud"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NESSUNO}>
                    Numerazione predefinita
                  </SelectItem>
                  {numerazioniVisibili.map(n => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="fatturazione-numerazione"
                className="h-11"
                maxLength={MAX_NUMERAZIONE}
                placeholder="predefinita"
                value={modulo.numerazioneFic}
                onChange={e => cambia({ numerazioneFic: e.target.value })}
              />
            )}
            <p className="text-xs text-text-3">
              {numerazioni.length > 0
                ? "Elenco letto da Fatture in Cloud con la verifica dei permessi."
                : "Verifica i permessi per scegliere fra le numerazioni di Fatture in Cloud."}
            </p>
          </div>

          <div className="min-w-0 space-y-1">
            <Label htmlFor="fatturazione-conto" className="text-xs">
              Conto di pagamento Fatture in Cloud
            </Label>
            {conti.length > 0 ? (
              <Select
                value={
                  modulo.contoFic.trim() === "" ? NESSUNO : modulo.contoFic
                }
                onValueChange={v =>
                  cambia({ contoFic: v === NESSUNO ? "" : v })
                }
              >
                <SelectTrigger
                  id="fatturazione-conto"
                  className="min-h-11 w-full"
                  aria-label="Conto di pagamento Fatture in Cloud"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NESSUNO}>Nessun conto</SelectItem>
                  {contiVisibili.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="fatturazione-conto"
                className="h-11 tabular-nums"
                inputMode="numeric"
                placeholder="id numerico"
                value={modulo.contoFic}
                onChange={e =>
                  cambia({ contoFic: e.target.value.replace(/[^\d]/g, "") })
                }
              />
            )}
          </div>

          <div className="min-w-0 space-y-1">
            <Label htmlFor="fatturazione-spese" className="text-xs">
              Spese documentazione detrazione €
            </Label>
            <Input
              id="fatturazione-spese"
              className="h-11 tabular-nums"
              inputMode="decimal"
              aria-invalid={speseKo || undefined}
              aria-describedby={
                speseKo ? "fatturazione-spese-errore" : undefined
              }
              value={modulo.speseTesto}
              onChange={e => cambia({ speseTesto: e.target.value })}
              onBlur={() =>
                setModulo(m => {
                  const cent = centDaTesto(m.speseTesto);
                  return cent == null
                    ? m
                    : { ...m, speseTesto: formatEuro(cent / 100) };
                })
              }
            />
            {speseKo ? (
              <p id="fatturazione-spese-errore" className="text-xs text-danger">
                Importo non leggibile: usa una cifra come 150,00.
              </p>
            ) : (
              <p className="text-xs text-text-3">
                Riga «bene» al 22 % quando il contratto prevede la detrazione.
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          <Label htmlFor="fatturazione-footer" className="text-xs">
            Dicitura in calce
          </Label>
          <Textarea
            id="fatturazione-footer"
            rows={3}
            maxLength={MAX_FOOTER}
            placeholder="Testo aggiunto in fondo a ogni fattura della sede."
            value={modulo.dicituraFooter}
            onChange={e => cambia({ dicituraFooter: e.target.value })}
          />
          <p className="text-xs text-text-3">
            {modulo.dicituraFooter.length}/{MAX_FOOTER} caratteri.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="min-h-11"
            onClick={() => salva.mutate(patch)}
            disabled={salva.isPending || speseKo || daSalvare === 0}
            title={
              speseKo
                ? "Correggi le spese di documentazione prima di salvare."
                : daSalvare === 0
                  ? "Nessuna modifica da salvare."
                  : undefined
            }
          >
            <Save className="size-3.5" aria-hidden="true" />
            {salva.isPending ? "Salvo…" : "Salva"}
          </Button>
          <span className="text-xs text-text-3">
            {speseKo
              ? "Correggi le spese di documentazione prima di salvare."
              : daSalvare === 0
                ? "Nessuna modifica da salvare."
                : `${daSalvare} ${daSalvare === 1 ? "campo cambiato" : "campi cambiati"}: si salvano solo quelli.`}
          </span>
          {sporco && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setSporco(false);
                setModulo(moduloDaConfig(config));
              }}
              disabled={salva.isPending}
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              Annulla modifiche
            </Button>
          )}
        </div>
      </div>
    </DataSurface>
  );
}
