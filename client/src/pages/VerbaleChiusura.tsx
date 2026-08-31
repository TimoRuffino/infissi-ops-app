import { useEffect, useState } from "react";
import { AlertTriangle, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";

import MobileFieldHeader from "@/components/operativita/MobileFieldHeader";
import SignaturePad from "@/components/operativita/SignaturePad";
import DataSurface from "@/components/patterns/DataSurface";
import StatePanel from "@/components/patterns/StatePanel";
import StickyActionBar from "@/components/patterns/StickyActionBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { trpc } from "@/lib/trpc";

export default function VerbaleChiusura() {
  const params = useParams<{ interventoId: string }>();
  const [, setLocation] = useLocation();
  const interventoId = Number.parseInt(params.interventoId ?? "0", 10);
  const { capabilities } = useOperationalContext();
  const canPlan = capabilities?.has("intervento.plan") ?? false;

  const intervento = trpc.interventi.byId.useQuery(interventoId, {
    enabled: canPlan && interventoId > 0,
    retry: false,
  });
  const commessaId = intervento.data?.commessaId ?? 0;
  const commessa = trpc.commesse.byId.useQuery(commessaId, {
    enabled: canPlan && commessaId > 0,
    retry: false,
  });
  const aperture = trpc.aperture.byCommessa.useQuery(commessaId, {
    enabled: canPlan && commessaId > 0,
    retry: false,
  });
  const anomalie = trpc.anomalie.list.useQuery(
    { commessaId },
    { enabled: canPlan && commessaId > 0, retry: false }
  );
  const existingVerbale = trpc.verbali.byIntervento.useQuery(interventoId, {
    enabled: canPlan && interventoId > 0,
    retry: false,
  });
  const utils = trpc.useUtils();

  const [noteCliente, setNoteCliente] = useState("");
  const [noteTecnico, setNoteTecnico] = useState("");
  const [firmaCliente, setFirmaCliente] = useState("");
  const [firmaTecnico, setFirmaTecnico] = useState("");
  const [saved, setSaved] = useState(false);
  const v = existingVerbale.data;

  useEffect(() => {
    if (!v) return;
    setNoteCliente(v.noteCliente ?? "");
    setNoteTecnico(v.noteTecnico ?? "");
    setFirmaCliente(v.firmaClienteData ?? "");
    setFirmaTecnico(v.firmaTecnicoData ?? "");
    setSaved(true);
  }, [v]);

  const createVerbale = trpc.verbali.create.useMutation({
    onSuccess: () => {
      setSaved(true);
      utils.verbali.byIntervento.invalidate(interventoId);
      toast.success("Verbale chiuso e salvato.");
    },
    onError: error => {
      setSaved(false);
      toast.error(error.message ?? "Chiusura del verbale non riuscita.");
    },
  });

  if (capabilities == null) {
    return (
      <StatePanel
        kind="loading"
        title="Preparo il verbale"
        description="Verifico sede e autorizzazioni."
        rows={4}
      />
    );
  }
  if (!canPlan) {
    return (
      <StatePanel
        kind="permission"
        title="Verbale non disponibile"
        description="Il profilo non dispone della capability intervento.plan."
      />
    );
  }
  if (intervento.isPending || existingVerbale.isPending) {
    return (
      <StatePanel
        kind="loading"
        title="Carico il verbale"
        description="Recupero intervento e documento."
        rows={4}
      />
    );
  }
  if (intervento.error || existingVerbale.error) {
    return (
      <StatePanel
        kind="error"
        title="Verbale non caricato"
        description="Nessun dato è stato modificato."
        action={
          <Button
            variant="outline"
            onClick={() => {
              intervento.refetch();
              existingVerbale.refetch();
            }}
          >
            Riprova
          </Button>
        }
      />
    );
  }
  const i = intervento.data;
  if (!i || commessaId <= 0) {
    return (
      <StatePanel
        kind="unavailable"
        title="Verbale non compilabile"
        description="Intervento o commessa non disponibili nella sede attiva."
      />
    );
  }
  if (commessa.isPending || aperture.isPending || anomalie.isPending) {
    return (
      <StatePanel
        kind="loading"
        title="Completo il riepilogo"
        description="Verifico aperture e anomalie prima delle firme."
        rows={4}
      />
    );
  }
  if (commessa.error || aperture.error || anomalie.error) {
    return (
      <StatePanel
        kind="error"
        title="Dati di chiusura incompleti"
        description="Il verbale non può usare conteggi parziali."
        action={
          <Button
            variant="outline"
            onClick={() => {
              commessa.refetch();
              aperture.refetch();
              anomalie.refetch();
            }}
          >
            Riprova
          </Button>
        }
      />
    );
  }
  const c = commessa.data;
  if (!c) {
    return (
      <StatePanel
        kind="unavailable"
        title="Commessa non trovata"
        description="La commessa non esiste nella sede attiva."
      />
    );
  }

  const apertureList = aperture.data ?? [];
  const anomalieList = (anomalie.data ?? []).filter(
    (item: any) => item.stato !== "risolta"
  );
  const totalAperture = apertureList.length;
  const apertureCompletate = apertureList.filter(
    (item: any) => item.stato === "posata" || item.stato === "verificata"
  ).length;
  const isComplete = Boolean(firmaCliente && firmaTecnico);
  const readOnly = Boolean(v || saved);

  const handleSave = () => {
    if (readOnly || !isComplete || createVerbale.isPending) return;
    createVerbale.mutate({
      interventoId,
      commessaId,
      tipo: "chiusura_lavori",
      noteCliente: noteCliente || undefined,
      noteTecnico: noteTecnico || undefined,
      firmaClienteData: firmaCliente || undefined,
      firmaTecnicoData: firmaTecnico || undefined,
      apertureCompletate,
      apertureTotali: totalAperture,
      anomalieRiscontrate: anomalieList.length,
    });
  };

  return (
    <div
      data-page="verbale-field"
      className="min-w-0 max-w-6xl space-y-4 pb-2 sm:space-y-5"
    >
      <MobileFieldHeader
        eyebrow="Chiusura lavori"
        title="Verbale di intervento"
        description={
          <span className="break-words">
            {c.codice} — {c.cliente}
            {i.indirizzo ? ` · ${i.indirizzo}` : ""}
          </span>
        }
        backLabel={`Torna a ${c.codice}`}
        onBack={() => setLocation(`/commesse/${commessaId}`)}
        metadata={
          <>
            <Badge variant="outline" className="uppercase">
              {i.tipo}
            </Badge>
            <span>Intervento #{interventoId}</span>
          </>
        }
        status={
          <Badge
            className={
              readOnly
                ? "bg-success-soft text-success"
                : "bg-surface-2 text-text-2"
            }
          >
            {readOnly ? "Firmato" : "Bozza"}
          </Badge>
        }
      />

      <DataSurface
        density="compact"
        tone="default"
        title="Esito operativo"
        description="Riepilogo verificato prima del consenso."
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Stato", i.stato.replace(/_/g, " ")],
            ["Aperture", `${apertureCompletate}/${totalAperture}`],
            ["Anomalie aperte", String(anomalieList.length)],
            ["Documento", readOnly ? "Bloccato" : "Da firmare"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-[var(--radius-control)] bg-surface-2 p-3"
            >
              <dt className="text-xs text-text-3">{label}</dt>
              <dd className="mt-1 text-sm font-bold capitalize text-text-1">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </DataSurface>

      {anomalieList.length > 0 ? (
        <DataSurface
          density="compact"
          tone="default"
          title={
            <span className="inline-flex items-center gap-2 text-danger">
              <AlertTriangle className="h-4 w-4" />
              {anomalieList.length} anomalie aperte
            </span>
          }
          description="Saranno registrate nel verbale: leggile prima delle firme."
        >
          <ul className="space-y-2">
            {anomalieList.slice(0, 5).map((item: any) => (
              <li
                key={item.id}
                className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                {item.descrizione} ({item.priorita})
              </li>
            ))}
          </ul>
        </DataSurface>
      ) : null}

      <DataSurface density="compact" tone="default" title="Note di chiusura">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="note-tecnico">Note del tecnico</Label>
            <Textarea
              id="note-tecnico"
              rows={4}
              value={noteTecnico}
              onChange={event => setNoteTecnico(event.target.value)}
              readOnly={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note-cliente">Note del cliente</Label>
            <Textarea
              id="note-cliente"
              rows={4}
              value={noteCliente}
              onChange={event => setNoteCliente(event.target.value)}
              readOnly={readOnly}
            />
          </div>
        </div>
      </DataSurface>

      <section aria-labelledby="verbale-firme" className="space-y-3">
        <div>
          <h2 id="verbale-firme" className="text-base font-bold">
            Firme
          </h2>
          <p className="text-sm text-text-2">
            Entrambe obbligatorie; dopo il salvataggio il verbale è di sola
            lettura.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SignaturePad
            label="Firma tecnico"
            value={firmaTecnico}
            onChange={setFirmaTecnico}
            disabled={readOnly}
            required
          />
          <SignaturePad
            label="Firma cliente"
            value={firmaCliente}
            onChange={setFirmaCliente}
            disabled={readOnly}
            required
          />
        </div>
      </section>

      <StickyActionBar
        busy={createVerbale.isPending}
        status={
          readOnly
            ? "Verbale salvato: note e firme bloccate."
            : isComplete
              ? "Entrambe le firme acquisite."
              : "Servono entrambe le firme."
        }
        secondary={
          v?.stato === "firmato" ? (
            <Button variant="outline" onClick={() => window.print()}>
              <Download className="h-4 w-4" />
              Stampa verbale
            </Button>
          ) : null
        }
        primary={
          !v ? (
            <Button
              size="lg"
              variant="brand"
              onClick={handleSave}
              disabled={!isComplete || saved || createVerbale.isPending}
              className="min-h-11 w-full sm:w-auto"
            >
              <FileText className="h-4 w-4" />
              {createVerbale.isPending
                ? "Chiusura…"
                : saved
                  ? "Verbale salvato"
                  : "Firma e chiudi verbale"}
            </Button>
          ) : null
        }
      />
    </div>
  );
}
