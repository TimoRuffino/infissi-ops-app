import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  FileText,
  PenTool,
  CheckCircle2,
  Download,
  Trash2,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useParams } from "wouter";

// ── Signature Canvas ────────────────────────────────────────────────────────

function SignatureCanvas({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (data: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";

    // Restore existing signature
    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        setHasContent(true);
      };
      img.src = value;
    }
  }, []);

  const getPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      if ("touches" in e) {
        return {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      }
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    setDrawing(true);
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasContent(true);
  }

  function endDraw() {
    if (!drawing) return;
    setDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasContent(false);
    onChange("");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <PenTool className="h-4 w-4" />
          {label}
        </Label>
        {hasContent && (
          <Button variant="ghost" size="sm" onClick={clear} className="text-xs h-7">
            <Trash2 className="h-3 w-3 mr-1" />
            Cancella
          </Button>
        )}
      </div>
      <div className="border-2 border-dashed rounded-lg bg-white relative">
        <canvas
          ref={canvasRef}
          className="w-full h-32 cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasContent && !value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground text-sm">
            Firma qui
          </div>
        )}
      </div>
      {hasContent && (
        <p className="text-[10px] text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Firma acquisita
        </p>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function VerbaleChiusura() {
  const params = useParams<{ interventoId: string }>();
  const [, setLocation] = useLocation();
  const interventoId = parseInt(params.interventoId ?? "0");

  const intervento = trpc.interventi.byId.useQuery(interventoId);
  const commessaId = intervento.data?.commessaId ?? 0;
  const commessa = trpc.commesse.byId.useQuery(commessaId, { enabled: commessaId > 0 });
  const aperture = trpc.aperture.byCommessa.useQuery(commessaId, { enabled: commessaId > 0 });
  const anomalie = trpc.anomalie.list.useQuery({ commessaId }, { enabled: commessaId > 0 });
  const existingVerbale = trpc.verbali.byIntervento.useQuery(interventoId);
  const utils = trpc.useUtils();

  const createVerbale = trpc.verbali.create.useMutation({
    onSuccess: () => utils.verbali.byIntervento.invalidate(interventoId),
  });

  const [noteCliente, setNoteCliente] = useState("");
  const [noteTecnico, setNoteTecnico] = useState("");
  const [firmaCliente, setFirmaCliente] = useState("");
  const [firmaTecnico, setFirmaTecnico] = useState("");
  const [saved, setSaved] = useState(false);

  const i = intervento.data;
  const c = commessa.data;
  const v = existingVerbale.data;

  // Pre-fill from existing
  useEffect(() => {
    if (v) {
      setNoteCliente(v.noteCliente ?? "");
      setNoteTecnico(v.noteTecnico ?? "");
      if (v.firmaClienteData) setFirmaCliente(v.firmaClienteData);
      if (v.firmaTecnicoData) setFirmaTecnico(v.firmaTecnicoData);
    }
  }, [v]);

  if (!i) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {intervento.isLoading ? "Caricamento..." : "Intervento non trovato"}
      </div>
    );
  }

  const apertureList = aperture.data ?? [];
  const anomalieList = (anomalie.data ?? []).filter(
    (a: any) => a.stato !== "risolta"
  );
  const totalAperture = apertureList.length;
  const apertureCompletate = apertureList.filter(
    (a: any) => a.stato === "posata" || a.stato === "verificata"
  ).length;

  function handleSave() {
    if (v) return; // Already saved
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
    setSaved(true);
  }

  const isComplete = firmaCliente && firmaTecnico;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setLocation(commessaId ? `/commesse/${commessaId}` : "/planning")
          }
          className="mb-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Torna
        </Button>

        <div className="flex items-center gap-3 mb-1">
          <FileText className="h-6 w-6" />
          <h1 className="text-2xl font-bold tracking-tight">
            Verbale chiusura lavori
          </h1>
          {v && (
            <Badge
              variant={v.stato === "firmato" ? "default" : "secondary"}
              className="text-xs"
            >
              {v.stato === "firmato" ? "Firmato" : "Bozza"}
            </Badge>
          )}
        </div>
        {c && (
          <p className="text-sm text-muted-foreground">
            {c.codice} — {c.cliente} — {i.indirizzo}
          </p>
        )}
      </div>

      {/* Riepilogo intervento */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Riepilogo intervento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">
                Tipo
              </span>
              <Badge variant="outline" className="uppercase">
                {i.tipo}
              </Badge>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">
                Stato
              </span>
              <Badge variant={i.stato === "completato" ? "default" : "secondary"}>
                {i.stato.replace(/_/g, " ")}
              </Badge>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">
                Aperture
              </span>
              <span className="font-semibold">
                {apertureCompletate}/{totalAperture}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">
                Anomalie aperte
              </span>
              <span
                className={`font-semibold ${anomalieList.length > 0 ? "text-destructive" : ""}`}
              >
                {anomalieList.length}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Aperture completate */}
      {apertureList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Aperture ({apertureCompletate}/{totalAperture} completate)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {apertureList.map((a: any) => {
                const done =
                  a.stato === "posata" || a.stato === "verificata";
                return (
                  <div
                    key={a.id}
                    className={`text-center text-xs p-2 rounded border ${done ? "bg-green-50 border-green-200 text-green-800" : "bg-muted/30"}`}
                  >
                    <span className="font-mono font-semibold">
                      {a.codice}
                    </span>
                    <br />
                    <span className="text-[10px]">
                      {a.stato.replace(/_/g, " ")}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Note tecnico */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Note del tecnico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            placeholder="Osservazioni tecniche, condizioni particolari, lavori residui..."
            value={noteTecnico}
            onChange={(e) => setNoteTecnico(e.target.value)}
            disabled={!!v}
          />
        </CardContent>
      </Card>

      {/* Note cliente */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Note del cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            placeholder="Osservazioni del cliente, richieste aggiuntive..."
            value={noteCliente}
            onChange={(e) => setNoteCliente(e.target.value)}
            disabled={!!v}
          />
        </CardContent>
      </Card>

      <Separator />

      {/* Firme */}
      <div className="grid sm:grid-cols-2 gap-6">
        <SignatureCanvas
          label="Firma tecnico"
          value={firmaTecnico}
          onChange={(data) => {
            setFirmaTecnico(data);
            setSaved(false);
          }}
        />
        <SignatureCanvas
          label="Firma cliente"
          value={firmaCliente}
          onChange={(data) => {
            setFirmaCliente(data);
            setSaved(false);
          }}
        />
      </div>

      {/* Anomalie aperte warning */}
      {anomalieList.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-destructive">
              Attenzione: {anomalieList.length} anomalie non risolte verranno
              registrate nel verbale.
            </p>
            <ul className="mt-2 space-y-1">
              {anomalieList.slice(0, 5).map((a: any) => (
                <li key={a.id} className="text-xs text-muted-foreground">
                  — {a.descrizione} ({a.priorita})
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Save / Download */}
      <div className="sticky bottom-4 flex justify-end gap-3">
        {v?.stato === "firmato" && (
          <Button variant="outline" size="lg" onClick={() => window.print()}>
            <Download className="h-4 w-4 mr-2" />
            Stampa PDF
          </Button>
        )}
        {!v && (
          <Button
            size="lg"
            onClick={handleSave}
            disabled={!isComplete || createVerbale.isPending}
            className="shadow-lg"
          >
            <FileText className="h-4 w-4 mr-2" />
            {createVerbale.isPending
              ? "Salvataggio..."
              : saved
                ? "Salvato"
                : isComplete
                  ? "Firma e chiudi verbale"
                  : "Entrambe le firme richieste"}
          </Button>
        )}
      </div>
    </div>
  );
}
