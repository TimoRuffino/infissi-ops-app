// «Collega questo allegato a una commessa» (08/09/2026, mandato della
// direzione: «devo poterli collegare alle commesse, sia su whatsapp che
// sulle mail»).
//
// Vale per i due canali: si sceglie la commessa e il TIPO, e il file entra
// nel fascicolo con il nome del tipo, il cliente e la data del messaggio.
// Il nome che avrà si legge PRIMA di confermare: nessuna sorpresa dopo.
//
// Se il messaggio non era collegato a nessuna commessa, il collegamento lo
// fa il server: dire di quale lavoro è un allegato lo dice anche del
// messaggio che lo portava.

import { useMemo, useState } from "react";
import { Archive, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DOC_TIPI, DOC_TIPO_LABEL, nomeDocumentoDaTipo, type DocTipo } from "@shared/docTipi";
import SearchSelect from "@/components/SearchSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

export type AllegatoDaArchiviare = {
  comunicazioneId: number;
  allegatoIndex: number;
  nome: string;
  /** La data del messaggio: entra nel nome del file. */
  quando?: string | Date | null;
  /** La commessa già collegata al messaggio, se c'è: proposta per prima. */
  commessaId?: number | null;
};

const OPZIONI_TIPO = DOC_TIPI.map(tipo => ({
  value: tipo,
  label: DOC_TIPO_LABEL[tipo],
  keywords: DOC_TIPO_LABEL[tipo],
}));

export default function ArchiviaAllegato({
  allegato,
  onClose,
}: {
  allegato: AllegatoDaArchiviare | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [commessaId, setCommessaId] = useState<string | null>(null);
  const [tipo, setTipo] = useState<DocTipo>("altro");

  const commesse = trpc.commesse.list.useQuery({}, { enabled: allegato != null });
  const opzioniCommesse = useMemo(
    () =>
      (commesse.data ?? [])
        .filter((c: any) => !c.archivedAt && c.stato !== "archiviata")
        .map((c: any) => ({
          value: String(c.id),
          label: `${c.codice ?? `#${c.id}`} — ${c.cliente ?? ""}`.trim(),
          keywords: [c.codice, c.cliente, c.citta].filter(Boolean).join(" "),
        })),
    [commesse.data]
  );

  // La commessa del messaggio è la prima proposta, ma resta cambiabile: un
  // fornitore manda in una mail sola i fogli di due lavori.
  const sceltaCorrente =
    commessaId ?? (allegato?.commessaId != null ? String(allegato.commessaId) : null);
  const clienteScelto = useMemo(() => {
    const c = (commesse.data ?? []).find((x: any) => String(x.id) === sceltaCorrente);
    return (c as any)?.cliente ?? null;
  }, [commesse.data, sceltaCorrente]);

  const nomeFinale = allegato
    ? tipo === "altro"
      ? allegato.nome
      : nomeDocumentoDaTipo(allegato.nome, tipo, clienteScelto, allegato.quando ?? null)
    : "";

  const chiudi = () => {
    setCommessaId(null);
    setTipo("altro");
    onClose();
  };

  const archivia = trpc.mail.comunicazioni.archiviaAllegato.useMutation({
    onSuccess: documento => {
      void utils.mail.invalidate();
      void utils.preventiviContratti.invalidate();
      void utils.commesse.invalidate();
      toast.success(
        `${documento.nome} nel fascicolo${
          (documento as any).messaggioCollegato ? ", e il messaggio è collegato alla commessa" : ""
        }.`
      );
      chiudi();
    },
    onError: e => toast.error(e.message ?? "Archiviazione non riuscita"),
  });

  return (
    <Dialog open={allegato != null} onOpenChange={v => (!v ? chiudi() : undefined)}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Archivia nel fascicolo</DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            {allegato?.nome}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-2" htmlFor="archivia-commessa">
              Commessa
            </label>
            <SearchSelect
              options={opzioniCommesse}
              value={sceltaCorrente}
              onChange={value => setCommessaId(value)}
              placeholder="Scegli la commessa…"
              searchPlaceholder="Cerca codice o cliente…"
              className="min-h-11"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-2" htmlFor="archivia-tipo">
              Tipo di documento
            </label>
            <SearchSelect
              options={OPZIONI_TIPO}
              value={tipo}
              onChange={value => setTipo((value as DocTipo) ?? "altro")}
              placeholder="Scegli il tipo…"
              searchPlaceholder="Cerca il tipo…"
              className="min-h-11"
            />
          </div>

          {/* Il nome che avrà, prima di dire sì. */}
          <p className="min-w-0 break-words rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-xs text-text-2 [overflow-wrap:anywhere]">
            Si chiamerà <strong className="text-text-1">{nomeFinale}</strong>
            {tipo === "altro" ? " — «Altro» non ha un tipo da cui prendere il nome." : ""}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" className="min-h-11" onClick={chiudi}>
            Annulla
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={!sceltaCorrente || archivia.isPending}
            onClick={() =>
              allegato &&
              sceltaCorrente &&
              archivia.mutate({
                id: allegato.comunicazioneId,
                allegatoIndex: allegato.allegatoIndex,
                commessaId: Number(sceltaCorrente),
                tipo,
              })
            }
          >
            {archivia.isPending ? (
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Archive className="h-4 w-4" aria-hidden="true" />
            )}
            Archivia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
