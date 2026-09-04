// La fattura dopo l'emissione: sola lettura. Numero e data li ha assegnati
// Fatture in Cloud, lo stato lo racconta lo SdI. Qui si scaricano PDF e XML,
// si richiede un aggiornamento di stato e si apre una nota di credito —
// niente altro: dall'emissione in poi il documento non si modifica.
import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, RefreshCw, Undo2 } from "lucide-react";

import { trpc } from "@/lib/trpc";
import type {
  EventoFattura,
  RigaFattura,
  StatoFattura,
} from "@shared/fatturazione/tipi";
import {
  badgeStatoFattura,
  indicatoreLimite,
  nomeFileFattura,
  riepilogoControlli,
  riepilogoView,
  testoDicitura,
  VARIANTE_BADGE,
} from "@/lib/fatturaView";
import { formatCent } from "@/lib/limitiView";
import DataSurface from "@/components/patterns/DataSurface";
import NotaCreditoDialog, {
  type SelezioneNotaCredito,
} from "@/components/fattura/NotaCreditoDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ETICHETTA_EVENTO: Record<string, string> = {
  creata: "Bozza creata",
  modificata: "Bozza modificata",
  emissione_avviata: "Emissione avviata",
  cliente_fic: "Cliente su Fatture in Cloud",
  creata_fic: "Documento creato su Fatture in Cloud",
  errore_totali: "Totali non coincidenti",
  xml_ok: "XML generato",
  xml_errore: "XML non generato",
  inviata: "Inviata allo SdI",
  stato_sdi: "Stato SdI",
  scarto: "Scarto SdI",
  annullata: "Annullata",
  nota_credito: "Nota di credito",
  pdf_archiviato: "PDF archiviato",
  xml_archiviato: "XML archiviato",
  scavalco_limiti: "Scavalco dei limiti",
};

/**
 * Gli stati in cui ha senso chiedere allo SdI come è andata: serve un
 * documento su Fatture in Cloud (`aggiornaStatoFattura` lo pretende) e una
 * fattura già uscita. Su una bozza annullata non c'è niente da sondare.
 */
const STATI_SONDABILI: ReadonlySet<StatoFattura> = new Set([
  "emessa",
  "inviata",
  "consegnata",
  "scartata",
  "rifiutata",
  "mancata_consegna",
]);

/** Gli stati da cui si storna: stesso insieme di `STATI_STORNABILI` in server/fatture/notaCredito.ts — una scartata non è mai arrivata al cliente. */
const STATI_STORNABILI: ReadonlySet<StatoFattura> = new Set([
  "emessa",
  "inviata",
  "consegnata",
  "rifiutata",
  "mancata_consegna",
]);

const STATO_SCADENZA: Record<"attesa" | "pagata" | "stornata", string> = {
  attesa: "in attesa",
  pagata: "pagata",
  stornata: "stornata",
};

/** I campi del payload che si leggono in una riga: i valori composti restano fuori. */
function riassuntoPayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .flatMap(([chiave, valore]) => {
      if (valore == null) return [];
      if (Array.isArray(valore)) return [`${chiave}: ${valore.length}`];
      if (typeof valore === "object") return [];
      return [`${chiave}: ${String(valore)}`];
    })
    .slice(0, 4)
    .join(" · ");
}

function scaricaBlob(nome: string, mimeType: string, dataBase64: string): void {
  const caratteri = atob(dataBase64);
  const byte = new Uint8Array(caratteri.length);
  for (let i = 0; i < caratteri.length; i++) byte[i] = caratteri.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([byte], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FatturaEmessaView({
  commessaId,
  fatturaId,
  puoNotaCredito,
  onApriFattura,
}: {
  commessaId: number;
  fatturaId: number;
  puoNotaCredito: boolean;
  /** La nota di credito nasce in bozza: la tab passa subito su di lei. */
  onApriFattura: (id: number) => void;
}) {
  const utils = trpc.useUtils();
  const dettaglio = trpc.fatture.byId.useQuery(
    { id: fatturaId },
    { retry: false }
  );
  const [dialogoNota, setDialogoNota] = useState(false);
  const [scaricando, setScaricando] = useState<"pdf" | "xml" | null>(null);

  const aggiornaStato = trpc.fatture.aggiornaStato.useMutation({
    onSuccess: esito => {
      void utils.fatture.byId.invalidate({ id: fatturaId });
      void utils.fatture.perCommessa.invalidate({ commessaId });
      toast.success(
        esito.cambiato
          ? `Stato aggiornato: ${esito.fattura.stato}`
          : "Nessun cambiamento dallo SdI"
      );
    },
    onError: e => toast.error(e.message),
  });

  const notaCredito = trpc.fatture.notaCredito.useMutation({
    onSuccess: esito => {
      void utils.fatture.perCommessa.invalidate({ commessaId });
      setDialogoNota(false);
      toast.success("Nota di credito creata in bozza");
      esito.avvertenze.forEach(a => toast.warning(a));
      onApriFattura(esito.fattura.id);
    },
    onError: e => toast.error(e.message),
  });

  async function scarica(tipo: "pdf" | "xml", nome: string): Promise<void> {
    setScaricando(tipo);
    try {
      const documento = await utils.fatture.documento.fetch({
        id: fatturaId,
        tipo,
      });
      // Il nome leggibile è quello del client (`nomeFileFattura`): il server
      // manda «127-2026.pdf», in cartella «Fattura 127-2026.pdf» si ritrova.
      scaricaBlob(nome, documento.mimeType, documento.dataBase64);
    } catch (errore) {
      toast.error(
        (errore as { message?: string }).message ?? "Documento non scaricabile."
      );
    } finally {
      setScaricando(null);
    }
  }

  if (dettaglio.isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-6">Caricamento fattura…</p>
    );
  }
  if (dettaglio.error) {
    return (
      <p className="text-sm text-danger py-6">{dettaglio.error.message}</p>
    );
  }
  if (!dettaglio.data) return null;

  const f = dettaglio.data.fattura;
  const eventi: EventoFattura[] = dettaglio.data.eventi;
  const stato = f.stato as StatoFattura;
  const badge = badgeStatoFattura(stato, f.inviataDryRun);
  // Il pulsante che il server rifiuterebbe non si mostra: chiedere lo stato
  // di una fattura senza documento FiC è una `PRECONDIZIONE` sicura.
  const puoSondare = f.ficDocumentId != null && STATI_SONDABILI.has(stato);
  const puoStornare =
    puoNotaCredito && f.tipo === "fattura" && STATI_STORNABILI.has(stato);
  const annullataIl =
    eventi.find(e => e.tipo === "annullata")?.createdAt ?? f.updatedAt;
  const { errori, avvisi } = riepilogoControlli(dettaglio.data.controlli);
  const titolo =
    f.tipo === "nota_credito"
      ? `Nota di credito ${f.numero ?? `#${f.id}`}`
      : `Fattura ${f.numero ?? `#${f.id}`}`;

  return (
    <div className="space-y-4 mt-4 min-w-0">
      {/* Testata */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
        <h3 className="text-sm font-semibold min-w-0">{titolo}</h3>
        {f.data && <span className="text-sm text-text-2">del {f.data}</span>}
        <Badge variant={VARIANTE_BADGE[badge.tono]}>{badge.testo}</Badge>
        {f.inviataDryRun && (
          <Badge variant="warning">prova SdI — non spedita davvero</Badge>
        )}
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {formatCent(f.totaleCent)}
        </span>
      </div>

      {f.eiErrore && (
        <p
          className="rounded-lg border border-danger-soft bg-danger-soft px-3 py-2 text-sm text-danger min-w-0"
          role="alert"
        >
          Errore dallo SdI: {f.eiErrore}
        </p>
      )}

      {stato === "annullata" ? (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-2 min-w-0">
          Bozza annullata il {new Date(annullataIl).toLocaleDateString("it-IT")}{" "}
          — nessuna azione disponibile.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {f.pdfStorageKey && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              disabled={scaricando === "pdf"}
              onClick={() => void scarica("pdf", nomeFileFattura(f, "pdf"))}
            >
              <Download className="h-4 w-4 mr-1" />
              {scaricando === "pdf" ? "Scarico…" : "Scarica PDF"}
            </Button>
          )}
          {f.xmlStorageKey && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              disabled={scaricando === "xml"}
              onClick={() => void scarica("xml", nomeFileFattura(f, "xml"))}
            >
              <Download className="h-4 w-4 mr-1" />
              {scaricando === "xml" ? "Scarico…" : "Scarica XML"}
            </Button>
          )}
          {puoSondare && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              disabled={aggiornaStato.isPending}
              onClick={() => aggiornaStato.mutate({ id: fatturaId })}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              {aggiornaStato.isPending ? "Controllo…" : "Aggiorna stato"}
            </Button>
          )}
          {puoStornare && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setDialogoNota(true)}
            >
              <Undo2 className="h-4 w-4 mr-1" /> Nota di credito
            </Button>
          )}
          {!f.pdfStorageKey &&
            !f.xmlStorageKey &&
            !puoSondare &&
            !puoStornare && (
              <span className="text-xs text-text-3">
                Nessuna azione disponibile in questo stato.
              </span>
            )}
        </div>
      )}

      <div className="grid gap-4 min-w-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4 min-w-0">
          {/* Righe del documento, nell'ordine in cui sono stampate */}
          <section aria-label="Righe della fattura" className="min-w-0">
            <div className="hidden md:block min-w-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead className="w-32 text-right">Importo</TableHead>
                    <TableHead className="w-16 text-right">IVA</TableHead>
                    <TableHead className="w-56">Limite</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {f.righe.map((r: RigaFattura) => (
                    <TableRow key={r.ordine}>
                      <TableCell className="tabular-nums text-text-3">
                        {r.ordine}
                      </TableCell>
                      <TableCell className="min-w-0 whitespace-pre-line">
                        {r.descrizione}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.tipo === "intestazione" || r.tipo === "nota"
                          ? ""
                          : formatCent(r.importoCent)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-text-2">
                        {r.aliquota == null ? "" : `${r.aliquota} %`}
                      </TableCell>
                      <TableCell className="text-xs text-text-2">
                        {indicatoreLimite(r).testo}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="space-y-2 md:hidden min-w-0">
              {f.righe.map((r: RigaFattura) => (
                <li
                  key={r.ordine}
                  className="rounded-lg border border-border p-3 text-sm min-w-0"
                >
                  <p className="whitespace-pre-line">{r.descrizione}</p>
                  <div className="mt-1 flex items-baseline gap-2 text-xs text-text-2">
                    {r.aliquota != null && <span>{r.aliquota} %</span>}
                    <span className="ml-auto text-sm font-semibold tabular-nums text-text-1">
                      {r.tipo === "intestazione" || r.tipo === "nota"
                        ? ""
                        : formatCent(r.importoCent)}
                    </span>
                  </div>
                  {indicatoreLimite(r).testo && (
                    <p className="text-xs text-text-2">
                      {indicatoreLimite(r).testo}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Scadenze */}
          <section
            aria-label="Scadenze di pagamento"
            className="space-y-1 min-w-0"
          >
            <h4 className="text-sm font-medium">Scadenze</h4>
            <ul className="divide-y divide-border text-sm">
              {f.scadenze.map(s => (
                <li
                  key={s.numero}
                  className="flex items-center gap-2 py-1.5 min-w-0"
                >
                  <span className="tabular-nums text-text-3">{s.numero}ª</span>
                  <span className="tabular-nums">{s.data}</span>
                  <span className="min-w-0 truncate text-text-2">
                    {s.descrizione ?? ""}
                  </span>
                  <Badge
                    variant={s.stato === "pagata" ? "success" : "outline"}
                    className="ml-auto shrink-0"
                  >
                    {STATO_SCADENZA[s.stato]}
                  </Badge>
                  <span className="shrink-0 tabular-nums font-medium">
                    {formatCent(s.importoCent)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Cronologia */}
          <section
            aria-label="Cronologia della fattura"
            className="space-y-1 min-w-0"
          >
            <h4 className="text-sm font-medium">Cronologia</h4>
            <ul className="divide-y divide-border text-sm">
              {eventi.map(e => (
                <li key={e.id} className="py-1.5 min-w-0">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="min-w-0 truncate font-medium">
                      {ETICHETTA_EVENTO[e.tipo] ?? e.tipo}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-text-3 tabular-nums">
                      {new Date(e.createdAt).toLocaleString("it-IT")}
                    </span>
                  </div>
                  {riassuntoPayload(e.payload) && (
                    <p className="text-xs text-text-2 break-words">
                      {riassuntoPayload(e.payload)}
                    </p>
                  )}
                </li>
              ))}
              {eventi.length === 0 && (
                <li className="py-1.5 text-muted-foreground">
                  Nessun evento registrato.
                </li>
              )}
            </ul>
          </section>
        </div>

        <aside className="space-y-3 min-w-0">
          <DataSurface density="compact" tone="sunken" title="Riepilogo">
            <dl className="space-y-1 text-sm">
              {riepilogoView(f).map(riga => (
                <div
                  key={riga.etichetta}
                  className="flex items-baseline gap-2 min-w-0"
                >
                  <dt className="min-w-0 text-text-2">{riga.etichetta}</dt>
                  <dd
                    className={`ml-auto tabular-nums font-medium ${
                      riga.tono === "errore"
                        ? "text-danger"
                        : riga.tono === "attenzione"
                          ? "text-warning"
                          : ""
                    }`}
                  >
                    {riga.valore}
                  </dd>
                </div>
              ))}
            </dl>
            {f.clienteSnapshot && (
              <p className="text-xs text-text-3">
                {f.clienteSnapshot.nome} · {f.clienteSnapshot.indirizzo},{" "}
                {f.clienteSnapshot.cap} {f.clienteSnapshot.citta} (
                {f.clienteSnapshot.provincia})
              </p>
            )}
          </DataSurface>

          {(errori.length > 0 || avvisi.length > 0) && (
            <DataSurface density="compact" tone="sunken" title="Controlli">
              {errori.length > 0 && (
                <ul
                  className="space-y-1 text-xs text-danger"
                  aria-label="Errori"
                >
                  {errori.map((m, i) => (
                    <li key={`errore-${i}`}>{m}</li>
                  ))}
                </ul>
              )}
              {avvisi.length > 0 && (
                <ul
                  className="space-y-1 text-xs text-warning"
                  aria-label="Avvisi"
                >
                  {avvisi.map((m, i) => (
                    <li key={`avviso-${i}`}>{m}</li>
                  ))}
                </ul>
              )}
            </DataSurface>
          )}

          {f.diciture.length > 0 && (
            <DataSurface density="compact" tone="sunken" title="Diciture">
              <ul className="space-y-1 text-xs text-text-2">
                {f.diciture.map(d => (
                  <li key={d} className="whitespace-pre-line">
                    {testoDicitura(d)}
                  </li>
                ))}
              </ul>
            </DataSurface>
          )}
        </aside>
      </div>

      <NotaCreditoDialog
        open={dialogoNota}
        onOpenChange={setDialogoNota}
        fattura={f}
        inCorso={notaCredito.isPending}
        onConferma={(selezione: SelezioneNotaCredito, motivo: string) =>
          notaCredito.mutate({
            fatturaId,
            selezione,
            ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
          })
        }
      />
    </div>
  );
}
