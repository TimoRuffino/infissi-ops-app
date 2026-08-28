import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatEuroSimbolo } from "@/lib/euro";
import { statoScostamentoIncassi } from "@/lib/economiaView";
import { trpc } from "@/lib/trpc";
import BreakEvenPanel from "./BreakEvenPanel";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  WalletCards,
} from "lucide-react";
import { useState, type ReactNode } from "react";

const MESI = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];

type Tono = "neutro" | "successo" | "attenzione" | "pericolo";

function Valore({
  label,
  value,
  meta,
  tono = "neutro",
}: {
  label: string;
  value: string;
  meta: string;
  tono?: Tono;
}) {
  return (
    <div className="min-w-0 px-3 py-3 md:px-4">
      <div className="text-xs font-medium text-text-3">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums sm:text-lg",
          tono === "successo" && "text-success",
          tono === "attenzione" && "text-warning",
          tono === "pericolo" && "text-danger"
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-4 text-text-3">{meta}</div>
    </div>
  );
}

function Banda({
  titolo,
  descrizione,
  icona,
  badge,
  children,
}: {
  titolo: string;
  descrizione: string;
  icona: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex min-w-0 flex-wrap items-start gap-2 px-3 py-3 md:px-4">
        <div className="mt-0.5 text-text-3" aria-hidden="true">
          {icona}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{titolo}</h2>
          <p className="text-xs leading-5 text-text-3">{descrizione}</p>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function GrigliaValori({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 border-t bg-background/40 sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-r">
      {children}
    </div>
  );
}

function StatoVuoto({ children }: { children: ReactNode }) {
  return (
    <div className="border-t bg-muted/25 px-4 py-5 text-sm text-text-3">
      {children}
    </div>
  );
}

function Caricamento() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Caricamento economia">
      {[0, 1, 2, 3].map(riga => (
        <div key={riga} className="overflow-hidden rounded-xl border bg-card">
          <div className="h-14 animate-pulse bg-muted/60" />
          <div className="grid grid-cols-2 border-t sm:grid-cols-3 xl:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map(colonna => (
              <div
                key={colonna}
                className="h-[78px] animate-pulse border-b border-r bg-muted/30"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EconomiaPanoramica({
  anno,
  onVaiAdAcquisti,
}: {
  anno: number;
  onVaiAdAcquisti?: () => void;
}) {
  const q = trpc.economia.overview.useQuery({ anno });
  const [vistaMensile, setVistaMensile] = useState<"competenza" | "cassa">(
    "competenza"
  );

  if (q.isLoading) return <Caricamento />;
  if (q.isError) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm">
        <div className="flex flex-wrap items-start gap-2">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-danger"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Impossibile caricare l'economia</p>
            <p className="mt-0.5 text-text-3">{q.error.message}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Riprova
          </Button>
        </div>
      </div>
    );
  }
  const d = q.data;
  if (!d) return null;

  const confronto = d.confrontoIncassi;
  const movimentiIncassoSenzaData =
    confronto.pagamentiCrmSenzaData + confronto.rateFicSenzaData;
  const mostraVendite =
    d.vendite.disponibile ||
    Math.abs(d.vendite.incassato) > 0.005 ||
    d.vendite.ratePagateSenzaData > 0;
  const mostraAcquisti =
    d.acquisti.disponibile ||
    Math.abs(d.acquisti.pagato) > 0.005 ||
    d.acquisti.ratePagateSenzaData > 0;
  const cassaIncompleta =
    !confronto.affidabile || d.acquisti.ratePagateSenzaData > 0;
  const statoConfronto = statoScostamentoIncassi(
    confronto.scostamento,
    movimentiIncassoSenzaData,
    confronto.disponibile
  );
  const badgeConfronto =
    statoConfronto === "dati_non_disponibili" ? (
      <Badge variant="info">
        <AlertTriangle aria-hidden="true" /> Dati FiC assenti
      </Badge>
    ) : statoConfronto === "allineato" ? (
      <Badge variant="success">
        <CheckCircle2 aria-hidden="true" /> Allineati
      </Badge>
    ) : statoConfronto === "dati_incompleti" ? (
      <Badge variant="warning">
        <AlertTriangle aria-hidden="true" /> Date mancanti
      </Badge>
    ) : (
      <Badge variant="warning">
        <AlertTriangle aria-hidden="true" /> Da verificare
      </Badge>
    );

  // Il risultato dell'anno in tre cifre, prima di ogni dettaglio.
  //
  // Le bande sotto rispondono a "com'è composto"; questa risponde a "com'è
  // andata", che è la domanda che si fa per prima chiunque apra la pagina.
  // Fatturato e costi sono entrambi imponibili FiC, quindi la differenza è
  // confrontabile: è l'unico accostamento onesto fra i due totali.
  const margine = d.vendite.netto - d.acquisti.netto;
  const marginePerc =
    d.vendite.netto > 0 ? Math.round((margine / d.vendite.netto) * 100) : null;
  const daIncassare = d.vendite.daIncassare;
  const daPagare = d.acquisti.daPagare;

  return (
    <div className="space-y-3">
      {/* Il minimo da fatturare apre la pagina: "come sta andando" senza la
          soglia sotto cui si perde è una classifica senza linea del traguardo.
          Vale solo per l'anno corrente — sugli anni chiusi non c'è un mese da
          coprire. */}
      {anno === new Date().getFullYear() && (
        <BreakEvenPanel onReview={() => onVaiAdAcquisti?.()} />
      )}

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 md:px-4">
          <CircleDollarSign className="h-4 w-4 text-text-3" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Come sta andando · {anno}</h2>
            <p className="text-xs text-text-3">
              Imponibili FiC al netto delle note di credito. IVA esclusa da
              entrambi i lati.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t bg-background/40 lg:grid-cols-4 [&>*]:border-b [&>*]:border-r">
          <Valore
            label="Fatturato"
            value={formatEuroSimbolo(d.vendite.netto)}
            meta={`${d.vendite.fatture} fatture emesse`}
            tono="successo"
          />
          <Valore
            label="Costi"
            value={formatEuroSimbolo(d.acquisti.netto)}
            meta={`${d.acquisti.documenti} documenti ricevuti`}
            tono="pericolo"
          />
          <Valore
            label="Differenza"
            value={formatEuroSimbolo(margine)}
            meta={
              marginePerc == null
                ? "Nessun fatturato registrato"
                : `${marginePerc}% del fatturato`
            }
            tono={margine >= 0 ? "successo" : "pericolo"}
          />
          <Valore
            label="Cassa attesa"
            value={formatEuroSimbolo(daIncassare - daPagare)}
            meta={`${formatEuroSimbolo(daIncassare)} da incassare · ${formatEuroSimbolo(daPagare)} da pagare`}
            tono={daIncassare - daPagare >= 0 ? "neutro" : "attenzione"}
          />
        </div>
        {(d.vendite.daRiconciliare > 0 || d.acquisti.dubbi > 0) && (
          <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5 text-xs md:px-4">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            <span>
              Prima di fidarti di queste cifre:{" "}
              {d.vendite.daRiconciliare > 0 && (
                <>
                  {d.vendite.daRiconciliare} fatture da riconciliare
                  {d.acquisti.dubbi > 0 ? ", " : "."}
                </>
              )}
              {d.acquisti.dubbi > 0 && (
                <>{d.acquisti.dubbi} costi ancora da classificare.</>
              )}
            </span>
          </div>
        )}
      </section>

      <Banda
        titolo={`Controllo incassi · ${anno}`}
        descrizione="Confronto per data effettiva di pagamento, su tutte le commesse e i documenti FiC della sede."
        icona={<CircleDollarSign className="h-4 w-4" />}
        badge={badgeConfronto}
      >
        <div className="grid grid-cols-1 border-t bg-background/40 sm:grid-cols-3 [&>*]:border-b [&>*]:border-r">
          <Valore
            label="Incassato CRM"
            value={formatEuroSimbolo(confronto.crm)}
            meta={`Cassa ${anno} · CRM`}
            tono="successo"
          />
          <Valore
            label="Incassato FiC"
            value={
              confronto.disponibile ? formatEuroSimbolo(confronto.fic) : "—"
            }
            meta={
              confronto.disponibile
                ? `Cassa ${anno} · FiC`
                : "Mirror FiC non disponibile"
            }
            tono={confronto.disponibile ? "successo" : "neutro"}
          />
          <Valore
            label="Scostamento CRM − FiC"
            value={
              confronto.disponibile
                ? formatEuroSimbolo(confronto.scostamento)
                : "—"
            }
            meta={
              !confronto.disponibile
                ? "Sincronizza FiC per confrontare"
                : confronto.scostamento > 0
                ? "Il CRM registra più incassi"
                : confronto.scostamento < 0
                  ? "FiC registra più incassi"
                  : "Nessuna differenza"
            }
            tono={
              statoConfronto === "allineato"
                ? "successo"
                : statoConfronto === "dati_non_disponibili"
                  ? "neutro"
                  : "attenzione"
            }
          />
        </div>
        {!confronto.disponibile && (
          <div className="flex items-start gap-2 border-t border-info/25 bg-info-soft px-3 py-2.5 text-xs md:px-4">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-info"
              aria-hidden="true"
            />
            <p>
              Nessun documento emesso è disponibile nel mirror FiC della sede.
              Collega o sincronizza Fatture in Cloud prima di usare questo
              confronto.
            </p>
          </div>
        )}
        {movimentiIncassoSenzaData > 0 && (
          <div className="flex items-start gap-2 border-t border-warning/25 bg-warning-soft px-3 py-2.5 text-xs md:px-4">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            <p>
              Il confronto è incompleto: {confronto.pagamentiCrmSenzaData}{" "}
              pagamenti CRM per {formatEuroSimbolo(confronto.crmSenzaData)} e{" "}
              {confronto.rateFicSenzaData} rate FiC per{" "}
              {formatEuroSimbolo(confronto.ficSenzaData)} non hanno una data
              utilizzabile e non sono stati assegnati all'anno.
            </p>
          </div>
        )}
      </Banda>

      <Banda
        titolo={`Vendite FiC · ${anno}`}
        descrizione={`${d.vendite.fatture} fatture, ${d.vendite.noteCredito} note di credito · competenza per data documento.`}
        icona={<ReceiptText className="h-4 w-4" />}
        badge={
          d.vendite.escluseRiconciliazione > 0 ? (
            <Badge variant="outline">
              {d.vendite.escluseRiconciliazione} escluse dalla riconciliazione
            </Badge>
          ) : (
            <Badge variant="outline">Fonte FiC</Badge>
          )
        }
      >
        {mostraVendite ? (
          <GrigliaValori>
            <Valore
              label="Fatturato netto"
              value={formatEuroSimbolo(d.vendite.netto)}
              meta={`${anno} · netto IVA · FiC`}
            />
            <Valore
              label="IVA vendite"
              value={formatEuroSimbolo(d.vendite.iva)}
              meta={`${anno} · FiC`}
            />
            <Valore
              label="Totale lordo"
              value={formatEuroSimbolo(d.vendite.lordo)}
              meta={`${anno} · FiC`}
            />
            <Valore
              label="Incassato datato"
              value={formatEuroSimbolo(d.vendite.incassato)}
              meta={`${anno} · data pagamento · FiC`}
              tono="successo"
            />
            <Valore
              label="Da incassare"
              value={formatEuroSimbolo(d.vendite.daIncassare)}
              meta={`${anno} · rate aperte · FiC`}
              tono="attenzione"
            />
            <Valore
              label="Da riconciliare"
              value={String(d.vendite.daRiconciliare)}
              meta="Fatture con riscontro CRM mancante"
              tono={d.vendite.daRiconciliare > 0 ? "attenzione" : "neutro"}
            />
          </GrigliaValori>
        ) : (
          <StatoVuoto>
            Nessuna vendita o rata incassata FiC disponibile per {anno}.
            Verifica il collegamento e avvia una sincronizzazione da
            Integrazioni.
          </StatoVuoto>
        )}
      </Banda>

      <Banda
        titolo={`Acquisti FiC · ${anno}`}
        descrizione={`${d.acquisti.documenti} documenti ricevuti · competenza per data documento.`}
        icona={<ShoppingCart className="h-4 w-4" />}
        badge={
          <Badge variant={d.acquisti.dubbi > 0 ? "warning" : "outline"}>
            {d.acquisti.dubbi} da classificare
          </Badge>
        }
      >
        {mostraAcquisti ? (
          <GrigliaValori>
            <Valore
              label="Costi netti"
              value={formatEuroSimbolo(d.acquisti.netto)}
              meta={`${anno} · netto IVA · FiC`}
              tono="pericolo"
            />
            <Valore
              label="IVA acquisti"
              value={formatEuroSimbolo(d.acquisti.iva)}
              meta={`${anno} · FiC`}
            />
            <Valore
              label="Totale lordo"
              value={formatEuroSimbolo(d.acquisti.lordo)}
              meta={`${anno} · FiC`}
            />
            <Valore
              label="Uscite datate"
              value={formatEuroSimbolo(d.acquisti.pagato)}
              meta={`${anno} · data pagamento · FiC`}
              tono="pericolo"
            />
            <Valore
              label="Da pagare"
              value={formatEuroSimbolo(d.acquisti.daPagare)}
              meta={`${anno} · rate aperte · FiC`}
              tono="attenzione"
            />
            <Valore
              label="Valore da rivedere"
              value={formatEuroSimbolo(d.acquisti.importoDubbio)}
              meta="Escluso dal calcolo del pareggio"
              tono={d.acquisti.dubbi > 0 ? "attenzione" : "neutro"}
            />
          </GrigliaValori>
        ) : (
          <StatoVuoto>
            Nessun acquisto o pagamento FiC disponibile per {anno}. Verifica i
            permessi ricevuti e sincronizza da Integrazioni.
          </StatoVuoto>
        )}
        {d.acquisti.ratePagateSenzaData > 0 && (
          <div className="flex items-start gap-2 border-t border-warning/25 bg-warning-soft px-3 py-2.5 text-xs md:px-4">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            <p>
              {d.acquisti.ratePagateSenzaData} pagamenti FiC per{" "}
              {formatEuroSimbolo(d.acquisti.pagatoSenzaData)} non hanno una
              data utilizzabile: non compaiono nelle uscite annuali né nella
              vista Cassa mensile.
            </p>
          </div>
        )}
      </Banda>

      {/* Il pattuito CRM è più largo del fatturato FiC di proposito: ci sono
          commesse concordate e non ancora fatturate. Il valore di questa
          banda è dire QUANTO più largo e perché — un totale unico accanto al
          fatturato sembrava solo uno dei due numeri sbagliato. */}
      <Banda
        titolo={`Commesse ${anno} · CRM`}
        descrizione={`${d.crm.commesse} commesse dell'anno, archiviate comprese. ${d.crm.commesseSenzaFattura} non hanno ancora una fattura FiC: il loro pattuito è il di più che solo il CRM conosce.`}
        icona={<WalletCards className="h-4 w-4" />}
        badge={
          <Badge variant="outline">
            {d.crm.commesseConFattura} fatturate · {d.crm.commesseSenzaFattura}{" "}
            no
          </Badge>
        }
      >
        <div className="grid grid-cols-2 border-t bg-background/40 sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-r">
          <Valore
            label="Pattuito totale"
            value={formatEuroSimbolo(d.crm.pattuito)}
            meta={`${d.crm.commesseConPattuito} commesse con un importo`}
          />
          <Valore
            label="Già fatturato"
            value={formatEuroSimbolo(d.crm.pattuitoDaFattura)}
            meta="Pattuito che arriva da FiC (lordo)"
          />
          <Valore
            label="Ancora da fatturare"
            value={formatEuroSimbolo(d.crm.pattuitoSoloCrm)}
            meta={`${d.crm.commesseSenzaFattura} commesse senza fattura`}
            tono={d.crm.pattuitoSoloCrm > 0 ? "attenzione" : "neutro"}
          />
          <Valore
            label="Incassato"
            value={formatEuroSimbolo(d.crm.incassato)}
            meta={`Acconti registrati sul ${anno}`}
            tono="successo"
          />
          <Valore
            label="Residuo"
            value={formatEuroSimbolo(d.crm.residuo)}
            meta="Pattuito meno incassato"
            tono="attenzione"
          />
          <Valore
            label="Senza importo"
            value={String(d.crm.commesseSenzaPattuito)}
            meta="Commesse senza pattuito né fattura"
            tono={d.crm.commesseSenzaPattuito > 0 ? "attenzione" : "neutro"}
          />
        </div>
        {/* Il confronto che la direzione fa a mente, fatto qui una volta e
            con le unità dichiarate: il pattuito CRM è lordo, il fatturato FiC
            è imponibile. Accostarli senza dirlo sembra uno scostamento. */}
        <div className="border-t bg-muted/25 px-3 py-2.5 text-xs text-text-3 md:px-4">
          Pattuito CRM {formatEuroSimbolo(d.crm.pattuito)} (lordo, IVA
          inclusa) · fatturato FiC {formatEuroSimbolo(d.vendite.lordo)} (lordo)
          ·{" "}
          <span className="font-medium text-text-2">
            {formatEuroSimbolo(d.crm.pattuito - d.vendite.lordo)}
          </span>{" "}
          di differenza. Le due cifre non coincidono mai del tutto: una
          fattura può essere di una commessa di un altro anno, e una commessa
          può essere fatturata in più esercizi.
        </div>
      </Banda>

      <section className="overflow-hidden rounded-xl border bg-card">
        <Tabs
          value={vistaMensile}
          onValueChange={value =>
            setVistaMensile(value as "competenza" | "cassa")
          }
          className="gap-0"
        >
          <div className="flex flex-wrap items-center gap-2 px-3 py-3 md:px-4">
            <WalletCards
              className="h-4 w-4 text-text-3"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">
                Andamento mensile · {anno}
              </h2>
              <p className="text-xs text-text-3">
                Competenza e cassa sono separate per non confrontare date
                diverse.
              </p>
            </div>
            {cassaIncompleta && (
              <Badge variant="warning">
                <AlertTriangle aria-hidden="true" /> Cassa incompleta
              </Badge>
            )}
            <TabsList aria-label="Vista andamento mensile">
              <TabsTrigger value="competenza">Competenza</TabsTrigger>
              <TabsTrigger value="cassa">Cassa</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="competenza" className="m-0">
            <div className="border-t md:hidden">
              {d.mesi.map(mese => (
                <div key={mese.mese} className="border-b px-3 py-3">
                  <div className="mb-2 text-sm font-semibold">
                    {MESI[mese.mese - 1]}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <dt className="text-text-3">Vendite nette</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {formatEuroSimbolo(mese.venditeNetto)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-3">Acquisti netti</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-danger">
                        {formatEuroSimbolo(mese.acquistiNetto)}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-text-3">Differenza</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums">
                        {formatEuroSimbolo(
                          mese.venditeNetto - mese.acquistiNetto
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            <div
              className="hidden overflow-x-auto border-t md:block"
              tabIndex={0}
              role="region"
              aria-label={`Competenza mensile ${anno}`}
            >
              <table className="w-full min-w-[600px] text-sm">
                <caption className="sr-only">
                  Vendite e acquisti per data documento nel {anno}
                </caption>
                <thead className="bg-surface-2 text-xs text-text-3">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Mese</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Vendite nette
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Acquisti netti
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Differenza
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.mesi.map(mese => (
                    <tr key={mese.mese} className="border-t">
                      <td className="px-4 py-2 font-medium">
                        {MESI[mese.mese - 1]}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatEuroSimbolo(mese.venditeNetto)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-danger">
                        {formatEuroSimbolo(mese.acquistiNetto)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">
                        {formatEuroSimbolo(
                          mese.venditeNetto - mese.acquistiNetto
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
          <TabsContent value="cassa" className="m-0">
            <div className="border-t md:hidden">
              {d.mesi.map(mese => (
                <div key={mese.mese} className="border-b px-3 py-3">
                  <div className="mb-2 text-sm font-semibold">
                    {MESI[mese.mese - 1]}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <dt className="text-text-3">Incassi CRM</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-success">
                        {formatEuroSimbolo(mese.incassiCrm)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-3">Incassi FiC</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-success">
                        {formatEuroSimbolo(mese.incassi)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-3">Scostamento</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums">
                        {formatEuroSimbolo(mese.incassiCrm - mese.incassi)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-3">Uscite FiC</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-danger">
                        {formatEuroSimbolo(mese.uscite)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            <div
              className="hidden overflow-x-auto border-t md:block"
              tabIndex={0}
              role="region"
              aria-label={`Cassa mensile ${anno}`}
            >
              <table className="w-full min-w-[680px] text-sm">
                <caption className="sr-only">
                  Incassi CRM, incassi FiC e uscite FiC per data pagamento nel{" "}
                  {anno}
                </caption>
                <thead className="bg-surface-2 text-xs text-text-3">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Mese</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Incassi CRM
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Incassi FiC
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Scostamento
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Uscite FiC
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.mesi.map(mese => (
                    <tr key={mese.mese} className="border-t">
                      <td className="px-4 py-2 font-medium">
                        {MESI[mese.mese - 1]}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-success">
                        {formatEuroSimbolo(mese.incassiCrm)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-success">
                        {formatEuroSimbolo(mese.incassi)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">
                        {formatEuroSimbolo(mese.incassiCrm - mese.incassi)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-danger">
                        {formatEuroSimbolo(mese.uscite)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
