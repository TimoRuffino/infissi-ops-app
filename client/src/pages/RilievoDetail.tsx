import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  AlertTriangle,
  Ruler,
  Eye,
  Camera,
  ClipboardCheck,
  Video,
  Mic,
  X,
  Image,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useParams } from "wouter";

// ── Field configs per tipologia ──────────────────────────────────────────────

type MeasureField = {
  key: string;
  label: string;
  unit: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
};

type FieldGroup = {
  title: string;
  icon: any;
  fields: MeasureField[];
};

function getMeasureGroups(tipologia: string): FieldGroup[] {
  const baseQuote: MeasureField[] = [
    { key: "larghezzaLuce", label: "Larghezza luce", unit: "mm", required: true, helpText: "Misura interna del vano murario" },
    { key: "altezzaLuce", label: "Altezza luce", unit: "mm", required: true, helpText: "Dal piano finito alla quota superiore" },
    { key: "larghezzaEsterna", label: "Larghezza esterna", unit: "mm", required: false },
    { key: "altezzaEsterna", label: "Altezza esterna", unit: "mm", required: false },
    { key: "profonditaVano", label: "Profondita vano", unit: "mm", required: true, helpText: "Profondita dello sguincio/mazzetta" },
    { key: "fuoriSquadraSx", label: "Fuori squadro SX", unit: "mm", required: false, helpText: "Differenza diagonale lato sinistro" },
    { key: "fuoriSquadraDx", label: "Fuori squadro DX", unit: "mm", required: false, helpText: "Differenza diagonale lato destro" },
    { key: "appiomboSx", label: "Appiombo SX", unit: "mm", required: false },
    { key: "appiomboDx", label: "Appiombo DX", unit: "mm", required: false },
  ];

  const spallette: MeasureField[] = [
    { key: "spallettaSx", label: "Spalletta SX", unit: "mm", required: true },
    { key: "spallettaDx", label: "Spalletta DX", unit: "mm", required: true },
    { key: "spallettaSup", label: "Spalletta superiore", unit: "mm", required: false },
    { key: "architrave", label: "Architrave", unit: "mm", required: false, helpText: "Altezza architrave dal bordo superiore" },
  ];

  const soglia: MeasureField[] = [
    { key: "sogliaEsistente", label: "Soglia esistente", unit: "mm", required: false, helpText: "Spessore soglia attuale" },
    { key: "quotaDavantiSoglia", label: "Quota davanti soglia", unit: "mm", required: false },
    { key: "quotaDietroSoglia", label: "Quota dietro soglia", unit: "mm", required: false },
  ];

  const falsotelaio: MeasureField[] = [
    { key: "falsotelaioPresente", label: "Falsotelaio presente", unit: "si/no", required: true },
    { key: "falsotelaioLarghezza", label: "Larghezza falsotelaio", unit: "mm", required: false },
    { key: "falsotelaioAltezza", label: "Altezza falsotelaio", unit: "mm", required: false },
    { key: "falsotelaioProfondita", label: "Profondita falsotelaio", unit: "mm", required: false },
    { key: "falsotelaioStato", label: "Stato falsotelaio", unit: "testo", required: false, placeholder: "Buono, da sostituire, assente..." },
  ];

  const cassonetto: MeasureField[] = [
    { key: "cassonettoPresente", label: "Cassonetto presente", unit: "si/no", required: true },
    { key: "cassonettoLarghezza", label: "Larghezza cassonetto", unit: "mm", required: false },
    { key: "cassonettoAltezza", label: "Altezza cassonetto", unit: "mm", required: false },
    { key: "cassonettoProfondita", label: "Profondita cassonetto", unit: "mm", required: false },
    { key: "cassonettoTipo", label: "Tipo cassonetto", unit: "testo", required: false, placeholder: "Incassato, esterno, coibentato..." },
  ];

  const accessori: MeasureField[] = [
    { key: "tapparellaPresente", label: "Tapparella presente", unit: "si/no", required: false },
    { key: "tapparellaTipo", label: "Tipo tapparella", unit: "testo", required: false, placeholder: "PVC, alluminio, coibentata..." },
    { key: "oscurantePresente", label: "Oscurante/persiana presente", unit: "si/no", required: false },
    { key: "oscuranteTipo", label: "Tipo oscurante", unit: "testo", required: false },
    { key: "zanzarieraRichiesta", label: "Zanzariera richiesta", unit: "si/no", required: false },
    { key: "maniglia", label: "Tipo maniglia", unit: "testo", required: false, placeholder: "Standard, DK, con chiave, antieffrazione..." },
    { key: "cerniere", label: "Cerniere", unit: "testo", required: false, placeholder: "A vista, incassate, regolabili..." },
  ];

  const groups: FieldGroup[] = [
    { title: "Quote e dimensioni vano", icon: Ruler, fields: baseQuote },
    { title: "Spallette e architrave", icon: Ruler, fields: spallette },
    { title: "Soglia", icon: Ruler, fields: soglia },
    { title: "Falsotelaio", icon: ClipboardCheck, fields: falsotelaio },
    { title: "Cassonetto e avvolgibile", icon: ClipboardCheck, fields: cassonetto },
    { title: "Accessori e complementi", icon: ClipboardCheck, fields: accessori },
  ];

  if (tipologia === "scorrevole") {
    groups[0].fields.push(
      { key: "nAnte", label: "Numero ante", unit: "n", required: true },
      { key: "larghezzaBinario", label: "Larghezza binario", unit: "mm", required: true },
      { key: "profonditaBinario", label: "Profondita binario", unit: "mm", required: false },
      { key: "spazioManovra", label: "Spazio manovra laterale", unit: "mm", required: false, helpText: "Spazio per scorrimento anta" },
    );
  }

  if (tipologia === "portafinestra" || tipologia === "porta") {
    groups[2].fields.push(
      { key: "altezzaSogliaInterno", label: "Altezza soglia lato interno", unit: "mm", required: true },
      { key: "altezzaSogliaEsterno", label: "Altezza soglia lato esterno", unit: "mm", required: true },
      { key: "dislivello", label: "Dislivello int/est", unit: "mm", required: false },
    );
  }

  return groups;
}

// ── Accessibility & site conditions ──────────────────────────────────────────

const nodiCriticiOptions = [
  "Interferenza impianto elettrico",
  "Interferenza impianto idraulico",
  "Interferenza gas/canna fumaria",
  "Muratura irregolare",
  "Umidita/infiltrazioni esistenti",
  "Cappotto termico",
  "Vincoli architettonici",
  "Presenza di controsoffitto",
  "Spazio interno limitato",
  "Altro",
];

const accessibilitaOptions = [
  "Accesso carrabile diretto",
  "Solo pedonale",
  "Scale strette",
  "Ascensore disponibile",
  "Montacarichi necessario",
  "Ponteggio necessario",
  "Quota elevata (> 3 piani)",
  "Pendenza/rampa",
  "ZTL o permesso necessario",
];

// ── Component ────────────────────────────────────────────────────────────────

export default function RilievoDetail() {
  const params = useParams<{ commessaId: string; aperturaId: string }>();
  const [, setLocation] = useLocation();
  const commessaId = parseInt(params.commessaId ?? "0");
  const aperturaId = parseInt(params.aperturaId ?? "0");

  const apertura = trpc.aperture.byId.useQuery(aperturaId);
  const commessa = trpc.commesse.byId.useQuery(commessaId);
  const utils = trpc.useUtils();

  const updateApertura = trpc.aperture.update.useMutation({
    onSuccess: () => {
      utils.aperture.byId.invalidate(aperturaId);
      utils.aperture.byCommessa.invalidate(commessaId);
    },
  });

  // Measure values stored as flat object
  const [measures, setMeasures] = useState<Record<string, string>>({});
  const [nodiCritici, setNodiCritici] = useState<string[]>([]);
  const [accessibilita, setAccessibilita] = useState<string[]>([]);
  const [noteGenerali, setNoteGenerali] = useState("");
  const [noteCritiche, setNoteCritiche] = useState("");
  const [verso, setVerso] = useState("interno");
  const [tipoRilievo, setTipoRilievo] = useState("tecnico");
  const [saved, setSaved] = useState(false);

  // Media state
  const [mediaFiles, setMediaFiles] = useState<Array<{ id: string; type: string; name: string; dataUrl: string }>>([]);
  const [isRecording, setIsRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  function addMedia(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setMediaFiles((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: file.type.startsWith("video") ? "video" : file.type.startsWith("audio") ? "audio" : "foto",
          name: file.name,
          dataUrl: reader.result as string,
        },
      ]);
      setSaved(false);
    };
    reader.readAsDataURL(file);
  }

  function removeMedia(id: string) {
    setMediaFiles((prev) => prev.filter((m) => m.id !== id));
    setSaved(false);
  }

  function handleVoiceNote() {
    if (isRecording) {
      setIsRecording(false);
      // In production, would stop MediaRecorder and save the blob
      const fakeAudio: any = {
        id: Date.now().toString(),
        type: "audio",
        name: `nota_vocale_${new Date().toLocaleTimeString()}.webm`,
        dataUrl: "",
      };
      setMediaFiles((prev) => [...prev, fakeAudio]);
      setSaved(false);
    } else {
      setIsRecording(true);
      // In production, would start navigator.mediaDevices.getUserMedia + MediaRecorder
    }
  }

  const a = apertura.data;
  const c = commessa.data;

  // Restore existing data
  useEffect(() => {
    if (a) {
      setNoteGenerali(a.noteRilievo ?? "");
      setNoteCritiche(a.criticitaAccesso ?? "");
      // Measures could be stored in noteRilievo as JSON in production
    }
  }, [a]);

  const tipologia = a?.tipologia ?? "finestra";
  const measureGroups = useMemo(() => getMeasureGroups(tipologia), [tipologia]);

  // Compute completeness
  const requiredFields = useMemo(() => {
    return measureGroups.flatMap((g) => g.fields.filter((f) => f.required).map((f) => f.key));
  }, [measureGroups]);

  const filledRequired = requiredFields.filter(
    (k) => measures[k] && measures[k].trim() !== ""
  ).length;
  const completeness = requiredFields.length > 0
    ? Math.round((filledRequired / requiredFields.length) * 100)
    : 0;

  function setMeasure(key: string, value: string) {
    setMeasures((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function toggleArrayItem(arr: string[], setArr: (v: string[]) => void, item: string) {
    setArr(arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item]);
    setSaved(false);
  }

  function handleSave() {
    if (!a) return;
    const measureJson = JSON.stringify({
      measures,
      nodiCritici,
      accessibilita,
      verso,
      tipoRilievo,
    });
    updateApertura.mutate({
      id: aperturaId,
      noteRilievo: measureJson,
      criticitaAccesso: noteCritiche || undefined,
      stato: completeness >= 80 ? "rilevata" : undefined,
    });
    setSaved(true);
  }

  if (!a || !c) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {apertura.isLoading ? "Caricamento..." : "Apertura non trovata"}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation(`/commesse/${commessaId}`)}
          className="mb-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {c.codice} — {c.cliente}
        </Button>

        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Rilievo {a.codice}
          </h1>
          <Badge variant="outline" className="uppercase text-xs">
            {a.tipologia}
          </Badge>
          {a.descrizione && (
            <span className="text-sm text-muted-foreground">
              — {a.descrizione}
            </span>
          )}
        </div>

        {/* Completeness bar */}
        <div className="flex items-center gap-3 mt-3">
          <Progress value={completeness} className="h-2 flex-1" />
          <span className="text-sm font-mono font-semibold w-12 text-right">
            {completeness}%
          </span>
          {completeness >= 80 ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {filledRequired}/{requiredFields.length} campi obbligatori compilati
          {completeness < 80 && " — completa almeno l'80% per validare il rilievo"}
        </p>
      </div>

      {/* Meta: tipo rilievo e verso apertura */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Tipo rilievo
              </Label>
              <Select value={tipoRilievo} onValueChange={setTipoRilievo}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="commerciale">Commerciale</SelectItem>
                  <SelectItem value="tecnico">Tecnico</SelectItem>
                  <SelectItem value="verifica_posa">Verifica posa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Verso apertura
              </Label>
              <Select value={verso} onValueChange={setVerso}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interno">Apertura interna</SelectItem>
                  <SelectItem value="esterno">Apertura esterna</SelectItem>
                  <SelectItem value="bilico">A bilico</SelectItem>
                  <SelectItem value="scorrevole">Scorrevole</SelectItem>
                  <SelectItem value="vasistas">Vasistas</SelectItem>
                  <SelectItem value="anta_ribalta">Anta-ribalta</SelectItem>
                  <SelectItem value="fisso">Fisso</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Piano
              </Label>
              <Input value={a.piano ?? ""} className="h-9" readOnly />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Locale
              </Label>
              <Input value={a.locale ?? ""} className="h-9" readOnly />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Measure groups */}
      <Accordion type="multiple" defaultValue={["quote-e-dimensioni-vano"]} className="space-y-3">
        {measureGroups.map((group, gi) => (
          <AccordionItem
            key={gi}
            value={group.title.toLowerCase().replace(/\s+/g, "-")}
            className="border rounded-lg px-4"
          >
            <AccordionTrigger className="py-3 hover:no-underline">
              <div className="flex items-center gap-2">
                <group.icon className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm">{group.title}</span>
                <Badge variant="secondary" className="text-[10px] ml-1">
                  {group.fields.filter((f) => measures[f.key]?.trim()).length}/
                  {group.fields.length}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                {group.fields.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      {field.label}
                      {field.required && (
                        <span className="text-destructive">*</span>
                      )}
                      {field.unit !== "si/no" && field.unit !== "testo" && (
                        <span className="text-muted-foreground font-normal">
                          ({field.unit})
                        </span>
                      )}
                    </Label>
                    {field.unit === "si/no" ? (
                      <div className="flex items-center gap-2 h-9">
                        <Switch
                          checked={measures[field.key] === "si"}
                          onCheckedChange={(v) =>
                            setMeasure(field.key, v ? "si" : "no")
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {measures[field.key] === "si" ? "Si" : "No"}
                        </span>
                      </div>
                    ) : (
                      <Input
                        type={field.unit === "testo" ? "text" : "number"}
                        placeholder={field.placeholder ?? ""}
                        value={measures[field.key] ?? ""}
                        onChange={(e) => setMeasure(field.key, e.target.value)}
                        className={`h-9 ${field.required && !measures[field.key]?.trim() ? "border-amber-300" : ""}`}
                      />
                    )}
                    {field.helpText && (
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        {field.helpText}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Nodi critici */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Nodi critici e interferenze
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {nodiCriticiOptions.map((opt) => (
              <Button
                key={opt}
                variant={nodiCritici.includes(opt) ? "default" : "outline"}
                size="sm"
                className="text-xs h-7"
                onClick={() => toggleArrayItem(nodiCritici, setNodiCritici, opt)}
              >
                {opt}
              </Button>
            ))}
          </div>
          <Textarea
            placeholder="Note aggiuntive su criticita..."
            rows={2}
            value={noteCritiche}
            onChange={(e) => {
              setNoteCritiche(e.target.value);
              setSaved(false);
            }}
          />
        </CardContent>
      </Card>

      {/* Accessibilita */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Accessibilita e condizioni cantiere
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {accessibilitaOptions.map((opt) => (
              <Button
                key={opt}
                variant={accessibilita.includes(opt) ? "default" : "outline"}
                size="sm"
                className="text-xs h-7"
                onClick={() =>
                  toggleArrayItem(accessibilita, setAccessibilita, opt)
                }
              >
                {opt}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Acquisizione multimediale */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Acquisizione multimediale
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addMedia(file);
                e.target.value = "";
              }}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addMedia(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="h-3.5 w-3.5 mr-1" />
              Scatta foto
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => videoInputRef.current?.click()}
            >
              <Video className="h-3.5 w-3.5 mr-1" />
              Registra video
            </Button>
            <Button
              variant={isRecording ? "destructive" : "outline"}
              size="sm"
              className="text-xs"
              onClick={handleVoiceNote}
            >
              <Mic className={`h-3.5 w-3.5 mr-1 ${isRecording ? "animate-pulse" : ""}`} />
              {isRecording ? "Stop registrazione" : "Nota vocale"}
            </Button>
          </div>

          {mediaFiles.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {mediaFiles.map((m) => (
                <div
                  key={m.id}
                  className="relative border rounded-lg overflow-hidden group"
                >
                  {m.type === "foto" && m.dataUrl ? (
                    <img
                      src={m.dataUrl}
                      alt={m.name}
                      className="w-full h-20 object-cover"
                    />
                  ) : (
                    <div className="w-full h-20 bg-muted flex flex-col items-center justify-center">
                      {m.type === "video" ? (
                        <Video className="h-5 w-5 text-muted-foreground" />
                      ) : m.type === "audio" ? (
                        <Mic className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Image className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="text-[9px] text-muted-foreground mt-1 px-1 truncate max-w-full">
                        {m.type}
                      </span>
                    </div>
                  )}
                  <button
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeMedia(m.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            {mediaFiles.length} file allegati — Foto e video vengono associati automaticamente all'apertura {a?.codice}
          </p>
        </CardContent>
      </Card>

      {/* Note generali */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Note generali rilievo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            placeholder="Osservazioni aggiuntive, riferimenti a planimetrie, condizioni particolari..."
            value={noteGenerali}
            onChange={(e) => {
              setNoteGenerali(e.target.value);
              setSaved(false);
            }}
          />
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-4 flex justify-end gap-3">
        <Button
          size="lg"
          onClick={handleSave}
          disabled={updateApertura.isPending}
          className="shadow-lg"
        >
          <Save className="h-4 w-4 mr-2" />
          {updateApertura.isPending
            ? "Salvataggio..."
            : saved
              ? "Salvato"
              : "Salva rilievo"}
        </Button>
      </div>
    </div>
  );
}
