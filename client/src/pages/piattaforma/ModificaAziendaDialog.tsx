// «Modifica azienda» (piano 09/09/2026, Task 4): dopo la creazione i dati
// si correggono da qui — ragione sociale, slug, note, i sei campi di
// fatturazione, la prima sede e il proprietario.
//
// Quattro pannelli e UN pulsante «Salva». I pannelli sono tab e non sezioni
// aperte una sotto l'altra perché i campi sono quindici: in un dialogo alto
// quanto lo schermo di un telefono si perderebbero tutti tranne il primo. Al
// momento di confermare, però, quello che sta per essere salvato deve essere
// di nuovo davanti agli occhi — per questo il riepilogo (`riepilogoModifiche`)
// e il segno sul pannello toccato.
//
// Si mandano DUE mutation, e solo quelle che servono (`diffModifica`):
// `modifica` per l'azienda (nome, slug, note, fatturazione, sede) e
// `modificaProprietario` per la persona. Se lo slug è cambiato, la seconda
// parte con lo slug NUOVO: il vecchio non esiste più. Il campo svuotato non
// diventa `null` qui: viaggia come stringa vuota, che il server azzera
// (`vuotoANull`), così il modulo non ha `null` da gestire.
//
// Se cambiando l'email il server riemette l'invito e la posta non è
// configurata, il link è l'unica copia esistente: il dialogo NON si chiude,
// mostra il link e il pulsante «Copia» (come «Nuova azienda»), e l'eventuale
// cambio di slug porta alla scheda nuova solo quando si chiude.
//
// Se la prima mutation passa e la seconda no, «Salva» resta lì per
// riprovare — ma la scheda che il dialogo tiene in mano non si aggiorna mai
// da sola (il paragrafo sopra), quindi un secondo tentativo non può
// rileggere «cosa manda» dal solito confronto scheda/modulo: manderebbe di
// nuovo l'azienda, con lo slug vecchio, che dopo un cambio riuscito risponde
// NOT_FOUND. `giaSalvato` + `payloadDaRipetere` (modificaAzienda.ts) tengono
// il conto di cosa è già a terra e ricalcolano da lì slug e payload di ogni
// tentativo (fix round 1, Task 4).
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, Check, Copy, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import type { AppRouter } from "../../../../server/routers";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TENANT_PIATTAFORMA_ID } from "@/lib/piattaforma";
import { trpc } from "@/lib/trpc";

import ConfermaPassword from "./ConfermaPassword";
import {
  diffModifica,
  erroriModulo,
  payloadDaRipetere,
  valoriIniziali,
  type EsitoParziale,
  type ValoriModifica,
} from "./modificaAzienda";
import {
  AVVISO_INVITO_IN_SOSPESO,
  AVVISO_SLUG,
  AVVISO_SLUG_PIATTAFORMA,
  CAMPI_FATTURAZIONE,
  TESTO_AZIENDA_SALVATA_PROPRIETARIO_NO,
  TESTO_NESSUNA_MODIFICA,
  TESTO_SOLA_LETTURA_FLAG_SPENTO,
  erroreDelComando,
  erroreFatturazione,
  riepilogoModifiche,
  testoEsitoInvito,
} from "./testi";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Scheda = RouterOutputs["piattaforma"]["azienda"];
type EsitoInvito = NonNullable<
  RouterOutputs["piattaforma"]["modificaProprietario"]["invito"]
>;

/** I quattro pannelli, nell'ordine in cui si guardano. */
type Pannello = "azienda" | "fatturazione" | "sede" | "proprietario";

const ETICHETTA_PANNELLO: Record<Pannello, string> = {
  azienda: "Azienda",
  fatturazione: "Fatturazione",
  sede: "Sede",
  proprietario: "Proprietario",
};

/** Niente salvato ancora: il punto di partenza a ogni apertura del dialogo. */
const NIENTE_SALVATO: EsitoParziale = { azienda: null, proprietario: false };

function Campo({
  id,
  etichetta,
  aiuto,
  errore,
  children,
}: {
  id: string;
  etichetta: string;
  aiuto?: string;
  errore?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{etichetta}</Label>
      {children}
      {errore ? (
        <p className="flex min-w-0 items-start gap-1.5 text-xs leading-4 text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{errore}</span>
        </p>
      ) : aiuto ? (
        <p className="text-xs leading-4 text-text-3">{aiuto}</p>
      ) : null}
    </div>
  );
}

export default function ModificaAziendaDialog({
  open,
  onOpenChange,
  scheda,
  solaLettura,
  aggiorna,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheda: Scheda;
  /** A `FLAG_MULTI_AZIENDA` spento il server rifiuta: qui si dice prima. */
  solaLettura: boolean;
  /** Rilegge scheda ed elenco dopo ogni comando (AziendaDetail#aggiorna). */
  aggiorna: () => void;
}) {
  const [, setLocation] = useLocation();
  const [pannello, setPannello] = useState<Pannello>("azienda");
  const [proprietarioId, setProprietarioId] = useState<number | null>(
    scheda.proprietari[0]?.id ?? null
  );
  const [valori, setValori] = useState<ValoriModifica>(() =>
    valoriIniziali(scheda, null)
  );
  // "modulo" = i campi; "password" = la conferma (spec WS6 §3.2); "esito" =
  // il link dell'invito riemesso, che non può sparire dentro un toast.
  const [fase, setFase] = useState<"modulo" | "password" | "esito">("modulo");
  const [errore, setErrore] = useState<string | null>(null);
  const [esitoInvito, setEsitoInvito] = useState<EsitoInvito | null>(null);
  const [copiato, setCopiato] = useState(false);
  // Lo slug è cambiato: la scheda vive a un altro indirizzo. Ci si va alla
  // chiusura, non subito, o il riepilogo dell'invito sparirebbe con la
  // pagina (`AziendaDetail` si rimonta a ogni slug).
  const [slugDaAprire, setSlugDaAprire] = useState<string | null>(null);
  // Cosa hanno già salvato i tentativi precedenti in QUESTA apertura del
  // dialogo (fix round 1, Task 4): `diff` resta calcolato sulla scheda con
  // cui si è aperto, quindi da solo non basta a un secondo tentativo dopo
  // un fallimento composto — vedi `payloadDaRipetere` in modificaAzienda.ts.
  const [giaSalvato, setGiaSalvato] = useState<EsitoParziale>(NIENTE_SALVATO);

  // La scheda si rinfresca da sola ogni minuto: il modulo NON deve
  // ricaricarsi sotto le dita di chi scrive. Riparte solo all'apertura, e
  // legge la scheda del momento attraverso il ref (stesso motivo
  // dell'`apertoRef` di «Nuova azienda»).
  const schedaRef = useRef(scheda);
  schedaRef.current = scheda;
  useEffect(() => {
    if (!open) return;
    const corrente = schedaRef.current;
    setPannello("azienda");
    setProprietarioId(corrente.proprietari[0]?.id ?? null);
    setValori(valoriIniziali(corrente, null));
    setFase("modulo");
    setErrore(null);
    setEsitoInvito(null);
    setCopiato(false);
    setSlugDaAprire(null);
    setGiaSalvato(NIENTE_SALVATO);
  }, [open]);

  const utils = trpc.useUtils();
  const modifica = trpc.piattaforma.modifica.useMutation();
  const modificaProprietario = trpc.piattaforma.modificaProprietario.useMutation();

  const diff = useMemo(() => diffModifica(scheda, valori), [scheda, valori]);
  const errori = useMemo(() => erroriModulo(scheda, valori), [scheda, valori]);
  // Cosa manca ANCORA da mandare, tolto ciò che `giaSalvato` dice già a
  // terra: è questo, non `diff`, che decide cosa parte da `salva` e cosa si
  // legge nel riepilogo sopra la password (anche sui pallini dei pannelli).
  const daRipetere = useMemo(
    () => payloadDaRipetere(diff, scheda.slug, giaSalvato),
    [diff, scheda.slug, giaSalvato]
  );
  const inAttesa = modifica.isPending || modificaProprietario.isPending;
  const tenant1 = scheda.id === TENANT_PIATTAFORMA_ID;
  const proprietario = valori.proprietario;
  const invitoInSospeso = proprietario
    ? (scheda.proprietari.find(p => p.id === proprietario.id)?.invitoInSospeso ?? false)
    : false;

  function aggiornaValori(patch: Partial<ValoriModifica>) {
    setValori(precedenti => ({ ...precedenti, ...patch }));
  }

  function aggiornaProprietario(patch: Partial<NonNullable<ValoriModifica["proprietario"]>>) {
    setValori(precedenti =>
      precedenti.proprietario
        ? { ...precedenti, proprietario: { ...precedenti.proprietario, ...patch } }
        : precedenti
    );
  }

  /** Cambiare proprietario ricarica i suoi campi: se ne salva uno per volta. */
  function scegliProprietario(id: number) {
    setProprietarioId(id);
    aggiornaValori({ proprietario: valoriIniziali(scheda, id).proprietario });
  }

  function chiudiDialogo(destinazione: string | null) {
    setFase("modulo");
    setErrore(null);
    setEsitoInvito(null);
    setCopiato(false);
    setSlugDaAprire(null);
    setGiaSalvato(NIENTE_SALVATO);
    modifica.reset();
    modificaProprietario.reset();
    onOpenChange(false);
    if (destinazione) setLocation(`/piattaforma/${destinazione}`);
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

  /**
   * Rilegge dopo un comando. L'elenco cambia sempre (nome, slug, note); la
   * SCHEDA solo se è rimasta al suo indirizzo: invalidare la query del
   * vecchio slug dopo un cambio la farebbe rispondere NOT_FOUND, e
   * `AziendaDetail` passerebbe allo stato d'errore portandosi via questo
   * dialogo — con il link dell'invito che ci fosse dentro. Dopo un cambio di
   * slug la scheda giusta la carica la navigazione, alla chiusura.
   */
  function rinfresca(slugCorrente: string) {
    if (slugCorrente === scheda.slug) aggiorna();
    else utils.piattaforma.aziende.invalidate();
  }

  /** «Salva» del modulo: senza modifiche non si chiede nemmeno la password. */
  function chiediPassword() {
    if (solaLettura || errori.length > 0) return;
    if (!daRipetere.payloadAzienda && !daRipetere.payloadProprietario) {
      toast.info(TESTO_NESSUNA_MODIFICA);
      chiudiDialogo(null);
      return;
    }
    setErrore(null);
    setFase("password");
  }

  /**
   * Le due mutation, in fila e solo quelle che servono. L'errore del dominio
   * (`comando.stato === "errore"`: slug già usato, email già in uso, tenant 1
   * intoccabile) resta nel dialogo della password, dove si sta guardando.
   * Se la prima è passata e la seconda no, i dati dell'azienda SONO salvati:
   * si dice, e «Salva» resta lì per riprovare.
   *
   * Si parte da `daRipetere`, non da `diff` (fix round 1, Task 4): `diff` è
   * calcolato sulla scheda con cui il dialogo è stato aperto, mai aggiornata
   * dopo un cambio di slug (v. `rinfresca` sotto), quindi un secondo
   * tentativo che rileggesse `diff` manderebbe di nuovo il payload
   * dell'azienda — con lo slug VECCHIO, che risponde NOT_FOUND — e il
   * proprietario non si potrebbe più salvare. `daRipetere` toglie ciò che
   * `giaSalvato` dice già a terra e sposta il bersaglio sullo slug nuovo.
   */
  async function salva(password: string) {
    const { payloadAzienda, payloadProprietario, slug: slugDiPartenza } = daRipetere;
    if (!payloadAzienda && !payloadProprietario) {
      toast.info(TESTO_NESSUNA_MODIFICA);
      chiudiDialogo(null);
      return;
    }
    // Vero sia quando l'azienda parte in QUESTO tentativo sia quando è già
    // stata salvata da uno precedente: in tutti e due i casi chi legge deve
    // sapere che quella parte è a terra, non solo quando la manda ora.
    const aziendaCoinvolta = payloadAzienda != null || giaSalvato.azienda != null;
    setErrore(null);
    let slugFinale = slugDiPartenza;
    try {
      if (payloadAzienda) {
        const esito = await modifica.mutateAsync({
          slug: slugDiPartenza,
          ...payloadAzienda,
          passwordConferma: password,
        });
        if (esito.comando.stato !== "eseguito") {
          aggiorna();
          setErrore(
            erroreDelComando(esito.comando.esito) ?? "Il comando non è andato a buon fine."
          );
          return;
        }
        slugFinale = esito.slug;
        setGiaSalvato(precedente => ({ ...precedente, azienda: { slug: slugFinale } }));
        rinfresca(slugFinale);
      }

      let invito: EsitoInvito | null = null;
      if (payloadProprietario) {
        // Lo slug nuovo, se l'azienda è già stata salvata (ora o in un
        // tentativo precedente): il vecchio non esiste più.
        const esito = await modificaProprietario.mutateAsync({
          slug: slugFinale,
          ...payloadProprietario,
          passwordConferma: password,
        });
        rinfresca(slugFinale);
        if (esito.comando.stato !== "eseguito") {
          const messaggio =
            erroreDelComando(esito.comando.esito) ?? "Il comando non è andato a buon fine.";
          setErrore(
            aziendaCoinvolta ? `${TESTO_AZIENDA_SALVATA_PROPRIETARIO_NO} ${messaggio}` : messaggio
          );
          // Lo slug è già cambiato: chiudendo si va comunque alla scheda
          // nuova, l'unica che risponde ancora.
          if (slugFinale !== scheda.slug) setSlugDaAprire(slugFinale);
          return;
        }
        setGiaSalvato(precedente => ({ ...precedente, proprietario: true }));
        invito = esito.invito;
      }

      toast.success(aziendaCoinvolta ? "Modifiche salvate" : "Dati del proprietario aggiornati");
      const destinazione = slugFinale === scheda.slug ? null : slugFinale;
      if (invito) {
        setEsitoInvito(invito);
        setCopiato(false);
        setSlugDaAprire(destinazione);
        setFase("esito");
        return;
      }
      chiudiDialogo(destinazione);
    } catch (problema) {
      setErrore(problema instanceof Error ? problema.message : "Salvataggio non riuscito.");
    }
  }

  const titoloSolaLettura = solaLettura ? TESTO_SOLA_LETTURA_FLAG_SPENTO : undefined;
  const pannelli: Pannello[] = scheda.sedePredefinita
    ? ["azienda", "fatturazione", "sede", "proprietario"]
    : ["azienda", "fatturazione", "proprietario"];

  return (
    <>
      <Dialog
        open={open && fase !== "password"}
        onOpenChange={aperto => {
          if (!aperto) chiudiDialogo(slugDaAprire);
        }}
      >
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {fase === "esito" ? "Invito rimandato" : "Modifica azienda"}
            </DialogTitle>
            <DialogDescription>
              {fase === "esito"
                ? "L'email del proprietario è cambiata: l'invito vecchio è annullato e ne è partito uno nuovo."
                : "I dati dell'azienda, la fatturazione, la prima sede e il proprietario. Si salva tutto insieme, con la tua password."}
            </DialogDescription>
          </DialogHeader>

          {fase === "esito" && esitoInvito ? (
            <div className="min-w-0 space-y-4">
              <p className="text-sm leading-5 text-text-2">
                {testoEsitoInvito({
                  inviato: esitoInvito.inviato,
                  email: esitoInvito.invito.email,
                })}
              </p>
              {esitoInvito.link && esitoInvito.baseUrl ? (
                <p className="truncate text-xs leading-4 text-text-3">
                  Link su {esitoInvito.baseUrl}
                </p>
              ) : null}
              {esitoInvito.link ? (
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
                    onClick={() => void copiaLink(esitoInvito.link!)}
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
              <DialogFooter>
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => chiudiDialogo(slugDaAprire)}
                >
                  Chiudi
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="min-w-0 space-y-4"
              onSubmit={event => {
                event.preventDefault();
                chiediPassword();
              }}
            >
              {solaLettura ? (
                <p
                  role="status"
                  className="rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft p-3 text-sm leading-5 text-text-1"
                >
                  {TESTO_SOLA_LETTURA_FLAG_SPENTO} Nessuna modifica finché non viene acceso.
                </p>
              ) : null}

              <Tabs
                value={pannello}
                onValueChange={valore => setPannello(valore as Pannello)}
                className="min-w-0"
              >
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
                  {pannelli.map(chiave => (
                    <TabsTrigger
                      key={chiave}
                      value={chiave}
                      className="min-h-11 w-full whitespace-normal"
                    >
                      {ETICHETTA_PANNELLO[chiave]}
                      {daRipetere.sezioni.includes(ETICHETTA_PANNELLO[chiave]) ? (
                        <>
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-brand"
                            aria-hidden="true"
                          />
                          <span className="sr-only">modificata</span>
                        </>
                      ) : null}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="azienda" className="min-w-0 space-y-4 pt-2">
                  <Campo id="modifica-nome" etichetta="Ragione sociale">
                    <Input
                      id="modifica-nome"
                      value={valori.nome}
                      onChange={event => aggiornaValori({ nome: event.target.value })}
                      className="h-11"
                      autoComplete="organization"
                    />
                  </Campo>
                  <Campo
                    id="modifica-slug"
                    etichetta="Slug"
                    aiuto={tenant1 ? AVVISO_SLUG_PIATTAFORMA : AVVISO_SLUG}
                  >
                    <Input
                      id="modifica-slug"
                      value={valori.slug}
                      readOnly={tenant1}
                      onChange={event => aggiornaValori({ slug: event.target.value })}
                      className="h-11 font-mono"
                      spellCheck={false}
                    />
                  </Campo>
                  <Campo
                    id="modifica-note"
                    etichetta="Note"
                    aiuto="Restano nel pannello: non le vede l'azienda."
                  >
                    <Textarea
                      id="modifica-note"
                      value={valori.note}
                      onChange={event => aggiornaValori({ note: event.target.value })}
                      className="min-h-20"
                      rows={3}
                    />
                  </Campo>
                </TabsContent>

                <TabsContent value="fatturazione" className="min-w-0 pt-2">
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    {CAMPI_FATTURAZIONE.map(({ campo, etichetta, aiuto }) => (
                      <Campo
                        key={campo}
                        id={`modifica-${campo}`}
                        etichetta={etichetta}
                        aiuto={aiuto}
                        errore={erroreFatturazione(campo, valori.fatturazione[campo])}
                      >
                        <Input
                          id={`modifica-${campo}`}
                          value={valori.fatturazione[campo]}
                          onChange={event =>
                            aggiornaValori({
                              fatturazione: {
                                ...valori.fatturazione,
                                [campo]: event.target.value,
                              },
                            })
                          }
                          className="h-11"
                          spellCheck={false}
                        />
                      </Campo>
                    ))}
                  </div>
                </TabsContent>

                {scheda.sedePredefinita ? (
                  <TabsContent value="sede" className="min-w-0 pt-2">
                    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                      <Campo
                        id="modifica-sede-nome"
                        etichetta="Nome della sede"
                        aiuto="La prima sede dell'azienda, quella su cui lavorano tutti finché non ne aprono altre."
                      >
                        <Input
                          id="modifica-sede-nome"
                          value={valori.sedeNome}
                          onChange={event => aggiornaValori({ sedeNome: event.target.value })}
                          className="h-11"
                        />
                      </Campo>
                      <Campo id="modifica-sede-citta" etichetta="Città (facoltativa)">
                        <Input
                          id="modifica-sede-citta"
                          value={valori.sedeCitta}
                          onChange={event => aggiornaValori({ sedeCitta: event.target.value })}
                          className="h-11"
                          autoComplete="address-level2"
                        />
                      </Campo>
                    </div>
                  </TabsContent>
                ) : null}

                <TabsContent value="proprietario" className="min-w-0 space-y-4 pt-2">
                  {proprietario ? (
                    <>
                      {scheda.proprietari.length > 1 ? (
                        <div className="min-w-0 space-y-1.5">
                          <Label htmlFor="modifica-proprietario">Quale proprietario</Label>
                          <Select
                            value={String(proprietarioId ?? proprietario.id)}
                            onValueChange={valore => scegliProprietario(Number(valore))}
                          >
                            <SelectTrigger
                              id="modifica-proprietario"
                              // `data-[size=default]:h-11`: il `h-9` di shadcn è una variante e
                              // vincerebbe su un `h-11` semplice, lasciando 36 px di bersaglio.
                              className="h-11 w-full min-w-0 data-[size=default]:h-11"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {scheda.proprietari.map(p => (
                                <SelectItem key={p.id} value={String(p.id)}>
                                  {p.nome} {p.cognome} · {p.email}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs leading-4 text-text-3">
                            Si salva il proprietario scelto qui: cambiandolo, i campi
                            tornano a quelli suoi.
                          </p>
                        </div>
                      ) : null}

                      {invitoInSospeso ? (
                        <p
                          role="status"
                          className="flex min-w-0 items-start gap-2 rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft p-3 text-sm leading-5 text-text-1"
                        >
                          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                          <span className="min-w-0">{AVVISO_INVITO_IN_SOSPESO}</span>
                        </p>
                      ) : null}

                      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                        <Campo id="modifica-prop-nome" etichetta="Nome">
                          <Input
                            id="modifica-prop-nome"
                            value={proprietario.nome}
                            onChange={event => aggiornaProprietario({ nome: event.target.value })}
                            className="h-11"
                            autoComplete="given-name"
                          />
                        </Campo>
                        <Campo id="modifica-prop-cognome" etichetta="Cognome">
                          <Input
                            id="modifica-prop-cognome"
                            value={proprietario.cognome}
                            onChange={event =>
                              aggiornaProprietario({ cognome: event.target.value })
                            }
                            className="h-11"
                            autoComplete="family-name"
                          />
                        </Campo>
                        <Campo
                          id="modifica-prop-email"
                          etichetta="Email"
                          aiuto="È anche il nome con cui entra: deve restare unica in tutta l'installazione."
                        >
                          <Input
                            id="modifica-prop-email"
                            type="email"
                            value={proprietario.email}
                            onChange={event => aggiornaProprietario({ email: event.target.value })}
                            className="h-11"
                            autoComplete="email"
                          />
                        </Campo>
                        <Campo id="modifica-prop-telefono" etichetta="Telefono (facoltativo)">
                          <Input
                            id="modifica-prop-telefono"
                            type="tel"
                            value={proprietario.telefono}
                            onChange={event =>
                              aggiornaProprietario({ telefono: event.target.value })
                            }
                            className="h-11"
                            autoComplete="tel"
                          />
                        </Campo>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm leading-5 text-text-2">
                      Nessun proprietario da modificare: se ne assegna uno dalla sezione
                      «Proprietari e inviti» della scheda.
                    </p>
                  )}
                </TabsContent>
              </Tabs>

              {errori.length > 0 ? (
                <ul
                  role="alert"
                  className="min-w-0 space-y-1 rounded-[var(--radius-control)] border border-danger/25 bg-danger-soft p-3 text-sm leading-5 text-danger"
                >
                  {errori.map(messaggio => (
                    <li key={messaggio} className="flex min-w-0 items-start gap-2">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">{messaggio}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="min-w-0 text-sm leading-5 text-text-2">
                  {riepilogoModifiche(daRipetere.sezioni)}
                </p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="quiet"
                  className="min-h-11"
                  disabled={inAttesa}
                  onClick={() => chiudiDialogo(null)}
                >
                  Annulla
                </Button>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={solaLettura || errori.length > 0 || inAttesa}
                  title={titoloSolaLettura}
                >
                  <Save className="size-4" aria-hidden="true" />
                  {inAttesa ? "Salvataggio…" : "Salva"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfermaPassword
        open={open && fase === "password"}
        onOpenChange={aperto => {
          // Annullare la password riporta al modulo con i campi come sono
          // stati scritti: non si ricomincia da capo per una password persa.
          if (!aperto) {
            setFase("modulo");
            setErrore(null);
          }
        }}
        titolo="Salva le modifiche"
        descrizione={riepilogoModifiche(daRipetere.sezioni)}
        etichettaConferma="Salva"
        pending={inAttesa}
        errore={errore}
        onConferma={password => void salva(password)}
      />
    </>
  );
}
