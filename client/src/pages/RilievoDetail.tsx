import { trpc } from "@/lib/trpc";
import MobileFieldHeader from "@/components/operativita/MobileFieldHeader";
import DataSurface from "@/components/patterns/DataSurface";
import StatePanel from "@/components/patterns/StatePanel";
import StickyActionBar from "@/components/patterns/StickyActionBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Save,
  AlertTriangle,
  Ruler,
  Eye,
  Camera,
  ClipboardCheck,
  Video,
  X,
  Image,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { parseRilievoDraft, serializeRilievoDraft } from "@/lib/rilievoDraft";

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
    {
      key: "larghezzaLuce",
      label: "Larghezza luce",
      unit: "mm",
      required: true,
      helpText: "Misura interna del vano murario",
    },
    {
      key: "altezzaLuce",
      label: "Altezza luce",
      unit: "mm",
      required: true,
      helpText: "Dal piano finito alla quota superiore",
    },
    {
      key: "larghezzaEsterna",
      label: "Larghezza esterna",
      unit: "mm",
      required: false,
    },
    {
      key: "altezzaEsterna",
      label: "Altezza esterna",
      unit: "mm",
      required: false,
    },
    {
      key: "profonditaVano",
      label: "Profondita vano",
      unit: "mm",
      required: true,
      helpText: "Profondita dello sguincio/mazzetta",
    },
    {
      key: "fuoriSquadraSx",
      label: "Fuori squadro SX",
      unit: "mm",
      required: false,
      helpText: "Differenza diagonale lato sinistro",
    },
    {
      key: "fuoriSquadraDx",
      label: "Fuori squadro DX",
      unit: "mm",
      required: false,
      helpText: "Differenza diagonale lato destro",
    },
    { key: "appiomboSx", label: "Appiombo SX", unit: "mm", required: false },
    { key: "appiomboDx", label: "Appiombo DX", unit: "mm", required: false },
  ];

  const spallette: MeasureField[] = [
    { key: "spallettaSx", label: "Spalletta SX", unit: "mm", required: true },
    { key: "spallettaDx", label: "Spalletta DX", unit: "mm", required: true },
    {
      key: "spallettaSup",
      label: "Spalletta superiore",
      unit: "mm",
      required: false,
    },
    {
      key: "architrave",
      label: "Architrave",
      unit: "mm",
      required: false,
      helpText: "Altezza architrave dal bordo superiore",
    },
  ];

  const soglia: MeasureField[] = [
    {
      key: "sogliaEsistente",
      label: "Soglia esistente",
      unit: "mm",
      required: false,
      helpText: "Spessore soglia attuale",
    },
    {
      key: "quotaDavantiSoglia",
      label: "Quota davanti soglia",
      unit: "mm",
      required: false,
    },
    {
      key: "quotaDietroSoglia",
      label: "Quota dietro soglia",
      unit: "mm",
      required: false,
    },
  ];

  const falsotelaio: MeasureField[] = [
    {
      key: "falsotelaioPresente",
      label: "Falsotelaio presente",
      unit: "si/no",
      required: true,
    },
    {
      key: "falsotelaioLarghezza",
      label: "Larghezza falsotelaio",
      unit: "mm",
      required: false,
    },
    {
      key: "falsotelaioAltezza",
      label: "Altezza falsotelaio",
      unit: "mm",
      required: false,
    },
    {
      key: "falsotelaioProfondita",
      label: "Profondita falsotelaio",
      unit: "mm",
      required: false,
    },
    {
      key: "falsotelaioStato",
      label: "Stato falsotelaio",
      unit: "testo",
      required: false,
      placeholder: "Buono, da sostituire, assente...",
    },
  ];

  const cassonetto: MeasureField[] = [
    {
      key: "cassonettoPresente",
      label: "Cassonetto presente",
      unit: "si/no",
      required: true,
    },
    {
      key: "cassonettoLarghezza",
      label: "Larghezza cassonetto",
      unit: "mm",
      required: false,
    },
    {
      key: "cassonettoAltezza",
      label: "Altezza cassonetto",
      unit: "mm",
      required: false,
    },
    {
      key: "cassonettoProfondita",
      label: "Profondita cassonetto",
      unit: "mm",
      required: false,
    },
    {
      key: "cassonettoTipo",
      label: "Tipo cassonetto",
      unit: "testo",
      required: false,
      placeholder: "Incassato, esterno, coibentato...",
    },
  ];

  const accessori: MeasureField[] = [
    {
      key: "tapparellaPresente",
      label: "Tapparella presente",
      unit: "si/no",
      required: false,
    },
    {
      key: "tapparellaTipo",
      label: "Tipo tapparella",
      unit: "testo",
      required: false,
      placeholder: "PVC, alluminio, coibentata...",
    },
    {
      key: "oscurantePresente",
      label: "Oscurante/persiana presente",
      unit: "si/no",
      required: false,
    },
    {
      key: "oscuranteTipo",
      label: "Tipo oscurante",
      unit: "testo",
      required: false,
    },
    {
      key: "zanzarieraRichiesta",
      label: "Zanzariera richiesta",
      unit: "si/no",
      required: false,
    },
    {
      key: "maniglia",
      label: "Tipo maniglia",
      unit: "testo",
      required: false,
      placeholder: "Standard, DK, con chiave, antieffrazione...",
    },
    {
      key: "cerniere",
      label: "Cerniere",
      unit: "testo",
      required: false,
      placeholder: "A vista, incassate, regolabili...",
    },
  ];

  const groups: FieldGroup[] = [
    { title: "Quote e dimensioni vano", icon: Ruler, fields: baseQuote },
    { title: "Spallette e architrave", icon: Ruler, fields: spallette },
    { title: "Soglia", icon: Ruler, fields: soglia },
    { title: "Falsotelaio", icon: ClipboardCheck, fields: falsotelaio },
    {
      title: "Cassonetto e avvolgibile",
      icon: ClipboardCheck,
      fields: cassonetto,
    },
    {
      title: "Accessori e complementi",
      icon: ClipboardCheck,
      fields: accessori,
    },
  ];

  if (tipologia === "scorrevole") {
    groups[0].fields.push(
      { key: "nAnte", label: "Numero ante", unit: "n", required: true },
      {
        key: "larghezzaBinario",
        label: "Larghezza binario",
        unit: "mm",
        required: true,
      },
      {
        key: "profonditaBinario",
        label: "Profondita binario",
        unit: "mm",
        required: false,
      },
      {
        key: "spazioManovra",
        label: "Spazio manovra laterale",
        unit: "mm",
        required: false,
        helpText: "Spazio per scorrimento anta",
      }
    );
  }

  if (tipologia === "portafinestra" || tipologia === "porta") {
    groups[2].fields.push(
      {
        key: "altezzaSogliaInterno",
        label: "Altezza soglia lato interno",
        unit: "mm",
        required: true,
      },
      {
        key: "altezzaSogliaEsterno",
        label: "Altezza soglia lato esterno",
        unit: "mm",
        required: true,
      },
      {
        key: "dislivello",
        label: "Dislivello int/est",
        unit: "mm",
        required: false,
      }
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
  const { capabilities } = useOperationalContext();
  const capabilitiesPending = capabilities == null;
  const canRead = capabilities?.has("commessa.read") ?? false;
  const canEdit =
    canRead && (capabilities?.has("commessa.update_operational") ?? false);

  const apertura = trpc.aperture.byId.useQuery(aperturaId, {
    enabled: canRead && aperturaId > 0,
    retry: false,
  });
  const commessa = trpc.commesse.byId.useQuery(commessaId, {
    enabled: canRead && commessaId > 0,
    retry: false,
  });
  const utils = trpc.useUtils();

  // Measure values stored as flat object
  const [measures, setMeasures] = useState<Record<string, string>>({});
  const [nodiCritici, setNodiCritici] = useState<string[]>([]);
  const [accessibilita, setAccessibilita] = useState<string[]>([]);
  const [noteGenerali, setNoteGenerali] = useState("");
  const [noteCritiche, setNoteCritiche] = useState("");
  const [verso, setVerso] = useState("interno");
  const [tipoRilievo, setTipoRilievo] = useState("tecnico");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const updateApertura = trpc.aperture.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      setDirty(false);
      utils.aperture.byId.invalidate(aperturaId);
      utils.aperture.byCommessa.invalidate(commessaId);
      toast.success("Rilievo salvato.");
    },
    onError: error => {
      setSaved(false);
      toast.error(error.message ?? "Salvataggio del rilievo non riuscito.");
    },
  });

  // Media state
  const [mediaFiles, setMediaFiles] = useState<
    Array<{ id: string; type: string; name: string; dataUrl: string }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  function addMedia(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setMediaFiles(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          type: file.type.startsWith("video")
            ? "video"
            : file.type.startsWith("audio")
              ? "audio"
              : "foto",
          name: file.name,
          dataUrl: reader.result as string,
        },
      ]);
    };
    reader.readAsDataURL(file);
  }

  function removeMedia(id: string) {
    setMediaFiles(prev => prev.filter(m => m.id !== id));
  }

  const a = apertura.data;
  const c = commessa.data;

  // Restore existing data
  useEffect(() => {
    if (a) {
      const restored = parseRilievoDraft(a.noteRilievo);
      setMeasures(restored.measures);
      setNodiCritici(restored.nodiCritici);
      setAccessibilita(restored.accessibilita);
      setVerso(restored.verso);
      setTipoRilievo(restored.tipoRilievo);
      setNoteGenerali(restored.noteGenerali);
      setNoteCritiche(a.criticitaAccesso ?? "");
      setSaved(false);
      setDirty(false);
    }
  }, [a]);

  const tipologia = a?.tipologia ?? "finestra";
  const measureGroups = useMemo(() => getMeasureGroups(tipologia), [tipologia]);

  // Compute completeness
  const requiredFields = useMemo(() => {
    return measureGroups.flatMap(group =>
      group.fields.filter(field => field.required).map(field => field.key)
    );
  }, [measureGroups]);

  const filledRequired = requiredFields.filter(
    k => measures[k] && measures[k].trim() !== ""
  ).length;
  const completeness =
    requiredFields.length > 0
      ? Math.round((filledRequired / requiredFields.length) * 100)
      : 0;

  function setMeasure(key: string, value: string) {
    setMeasures(prev => ({ ...prev, [key]: value }));
    setSaved(false);
    setDirty(true);
  }

  function toggleArrayItem(
    arr: string[],
    setArr: (value: string[]) => void,
    item: string
  ) {
    setArr(
      arr.includes(item) ? arr.filter(value => value !== item) : [...arr, item]
    );
    setSaved(false);
    setDirty(true);
  }

  function handleSave() {
    if (!a || !canEdit || a.commessaId !== commessaId) return;
    updateApertura.mutate({
      id: aperturaId,
      noteRilievo: serializeRilievoDraft({
        measures,
        nodiCritici,
        accessibilita,
        verso,
        tipoRilievo,
        noteGenerali,
      }),
      criticitaAccesso: noteCritiche || undefined,
      stato: completeness >= 80 ? "rilevata" : undefined,
    });
  }

  if (capabilitiesPending) {
    return (
      <StatePanel
        kind="loading"
        title="Preparo il rilievo"
        description="Sto verificando sede e autorizzazioni operative."
        rows={4}
      />
    );
  }

  if (!canRead) {
    return (
      <StatePanel
        kind="permission"
        title="Rilievo non disponibile"
        description="Il tuo profilo non dispone della capability commessa.read."
      />
    );
  }

  if (apertura.isPending || commessa.isPending) {
    return (
      <StatePanel
        kind="loading"
        title="Carico il rilievo"
        description="Recupero apertura e commessa dalla sede attiva."
        rows={4}
      />
    );
  }

  if (apertura.error || commessa.error) {
    return (
      <StatePanel
        kind="error"
        title="Rilievo non caricato"
        description="Non è stato possibile leggere apertura e commessa. Nessun dato è stato modificato."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              apertura.refetch();
              commessa.refetch();
            }}
          >
            Riprova
          </Button>
        }
      />
    );
  }

  if (!a || !c) {
    return (
      <StatePanel
        kind="unavailable"
        title="Rilievo non trovato"
        description="L'apertura o la commessa non esistono nella sede attiva."
      />
    );
  }

  if (a.commessaId !== commessaId) {
    return (
      <StatePanel
        kind="error"
        title="Percorso rilievo non coerente"
        description="L'apertura indicata non appartiene a questa commessa. Nessuna modifica è consentita."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => setLocation(`/commesse/${a.commessaId}`)}
          >
            Apri la commessa corretta
          </Button>
        }
      />
    );
  }

  return (
    <div
      data-page="rilievo-field"
      className="min-w-0 max-w-6xl space-y-4 pb-2 sm:space-y-5"
    >
      <MobileFieldHeader
        eyebrow="Operatività sul campo"
        title={`Rilievo ${a.codice}`}
        description={
          <span className="break-words">
            {c.codice} — {c.cliente}
          </span>
        }
        backLabel={`Torna a ${c.codice}`}
        onBack={() => setLocation(`/commesse/${commessaId}`)}
        metadata={
          <>
            <Badge variant="outline" className="uppercase">
              {a.tipologia}
            </Badge>
            {a.descrizione ? (
              <span className="min-w-0 break-words">{a.descrizione}</span>
            ) : null}
          </>
        }
        status={
          !canEdit ? (
            <Badge className="bg-warning-soft text-warning">Sola lettura</Badge>
          ) : null
        }
        progress={{
          value: completeness,
          label: "Completezza rilievo",
          detail: `${filledRequired}/${requiredFields.length} campi obbligatori compilati${
            completeness < 80 ? " · soglia di validazione 80%" : ""
          }`,
          complete: completeness >= 80,
        }}
      />

      {!canEdit ? (
        <StatePanel
          kind="permission"
          compact
          title="Compilazione non autorizzata"
          description="Puoi consultare il rilievo, ma il tuo profilo non dispone della capability commessa.update_operational."
        />
      ) : null}

      <DataSurface
        id="rilievo-context"
        density="compact"
        tone="default"
        title="Apertura e contesto"
        description="Imposta il tipo di verifica e il verso prima di inserire le quote."
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 min-[1200px]:grid-cols-4">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="tipo-rilievo" className="text-xs font-semibold">
              Tipo rilievo
            </Label>
            <Select
              value={tipoRilievo}
              disabled={!canEdit}
              onValueChange={value => {
                setTipoRilievo(value);
                setSaved(false);
                setDirty(true);
              }}
            >
              <SelectTrigger id="tipo-rilievo" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="commerciale">Commerciale</SelectItem>
                <SelectItem value="tecnico">Tecnico</SelectItem>
                <SelectItem value="verifica_posa">Verifica posa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="verso-apertura" className="text-xs font-semibold">
              Verso apertura
            </Label>
            <Select
              value={verso}
              disabled={!canEdit}
              onValueChange={value => {
                setVerso(value);
                setSaved(false);
                setDirty(true);
              }}
            >
              <SelectTrigger id="verso-apertura" className="min-h-11 w-full">
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
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="piano-apertura" className="text-xs font-semibold">
              Piano
            </Label>
            <Input
              id="piano-apertura"
              value={a.piano ?? "Non indicato"}
              className="min-h-11"
              readOnly
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="locale-apertura" className="text-xs font-semibold">
              Locale
            </Label>
            <Input
              id="locale-apertura"
              value={a.locale ?? "Non indicato"}
              className="min-h-11"
              readOnly
            />
          </div>
        </div>
      </DataSurface>

      <div className="grid min-w-0 items-start gap-4 sm:gap-5 min-[1200px]:grid-cols-12">
        <div className="min-w-0 space-y-4 sm:space-y-5 min-[1200px]:col-span-8">
          <DataSurface
            id="rilievo-measures"
            density="compact"
            tone="default"
            title="Misure tecniche"
            description="Apri un gruppo alla volta. I campi obbligatori determinano la completezza del rilievo."
          >
            <Accordion
              type="multiple"
              defaultValue={["quote-e-dimensioni-vano"]}
              className="min-w-0 space-y-2"
            >
              {measureGroups.map(group => (
                <AccordionItem
                  key={group.title}
                  value={group.title.toLowerCase().replace(/\s+/g, "-")}
                  className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 sm:px-4"
                >
                  <AccordionTrigger className="min-h-11 py-3 hover:no-underline">
                    <span className="flex min-w-0 items-center gap-2 text-left">
                      <group.icon
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-accent-text"
                      />
                      <span className="min-w-0 text-sm font-semibold">
                        {group.title}
                      </span>
                      <Badge variant="secondary" className="ml-1 shrink-0">
                        {
                          group.fields.filter(field =>
                            measures[field.key]?.trim()
                          ).length
                        }
                        /{group.fields.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 min-[900px]:grid-cols-3">
                      {group.fields.map(field => {
                        const fieldId = `rilievo-${field.key}`;
                        const helpId = field.helpText
                          ? `${fieldId}-help`
                          : undefined;
                        return (
                          <div key={field.key} className="min-w-0 space-y-1.5">
                            <Label
                              htmlFor={fieldId}
                              className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs font-semibold"
                            >
                              {field.label}
                              {field.required ? (
                                <span
                                  className="text-danger"
                                  aria-label="obbligatorio"
                                >
                                  *
                                </span>
                              ) : null}
                              {field.unit !== "si/no" &&
                              field.unit !== "testo" ? (
                                <span className="font-normal text-text-3">
                                  ({field.unit})
                                </span>
                              ) : null}
                            </Label>
                            {field.unit === "si/no" ? (
                              <Select
                                value={measures[field.key] || "non_indicato"}
                                disabled={!canEdit}
                                onValueChange={value =>
                                  setMeasure(
                                    field.key,
                                    value === "non_indicato" ? "" : value
                                  )
                                }
                              >
                                <SelectTrigger
                                  id={fieldId}
                                  className="min-h-11 w-full"
                                  aria-describedby={helpId}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="non_indicato">
                                    Da indicare
                                  </SelectItem>
                                  <SelectItem value="si">Sì</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                id={fieldId}
                                type="text"
                                inputMode={
                                  field.unit === "testo" ? undefined : "decimal"
                                }
                                aria-describedby={helpId}
                                placeholder={field.placeholder ?? ""}
                                value={measures[field.key] ?? ""}
                                readOnly={!canEdit}
                                onChange={event =>
                                  setMeasure(field.key, event.target.value)
                                }
                                className="min-h-11 min-w-0 text-base md:text-sm"
                              />
                            )}
                            {field.helpText ? (
                              <p
                                id={helpId}
                                className="text-xs leading-5 text-text-3"
                              >
                                {field.helpText}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </DataSurface>

          <DataSurface
            id="rilievo-critical"
            density="compact"
            tone="default"
            title={
              <span className="inline-flex items-center gap-2">
                <AlertTriangle
                  aria-hidden="true"
                  className="h-4 w-4 text-warning"
                />
                Nodi critici e interferenze
              </span>
            }
            description="Seleziona tutto ciò che può cambiare posa, tempi o sicurezza."
          >
            <div className="flex min-w-0 flex-wrap gap-2">
              {nodiCriticiOptions.map(option => (
                <Button
                  key={option}
                  type="button"
                  variant={nodiCritici.includes(option) ? "default" : "outline"}
                  size="sm"
                  aria-pressed={nodiCritici.includes(option)}
                  disabled={!canEdit}
                  className="min-h-11 whitespace-normal text-left text-xs md:min-h-9"
                  onClick={() =>
                    toggleArrayItem(nodiCritici, setNodiCritici, option)
                  }
                >
                  {option}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note-critiche" className="text-xs font-semibold">
                Dettagli criticità
              </Label>
              <Textarea
                id="note-critiche"
                placeholder="Descrivi vincoli, interferenze e verifiche da fare…"
                rows={3}
                value={noteCritiche}
                readOnly={!canEdit}
                onChange={event => {
                  setNoteCritiche(event.target.value);
                  setSaved(false);
                  setDirty(true);
                }}
              />
            </div>
          </DataSurface>

          <DataSurface
            id="rilievo-access"
            density="compact"
            tone="default"
            title={
              <span className="inline-flex items-center gap-2">
                <Eye aria-hidden="true" className="h-4 w-4 text-info" />
                Accessibilità e condizioni cantiere
              </span>
            }
            description="Registra i vincoli logistici che la squadra deve conoscere."
          >
            <div className="flex min-w-0 flex-wrap gap-2">
              {accessibilitaOptions.map(option => (
                <Button
                  key={option}
                  type="button"
                  variant={
                    accessibilita.includes(option) ? "default" : "outline"
                  }
                  size="sm"
                  aria-pressed={accessibilita.includes(option)}
                  disabled={!canEdit}
                  className="min-h-11 whitespace-normal text-left text-xs md:min-h-9"
                  onClick={() =>
                    toggleArrayItem(accessibilita, setAccessibilita, option)
                  }
                >
                  {option}
                </Button>
              ))}
            </div>
          </DataSurface>
        </div>

        <aside className="min-w-0 space-y-4 sm:space-y-5 min-[1200px]:sticky min-[1200px]:top-5 min-[1200px]:col-span-4">
          <DataSurface
            id="rilievo-notes"
            density="compact"
            tone="sunken"
            title="Note generali"
            description="Osservazioni, planimetrie e condizioni particolari restano nel rilievo."
          >
            <Label htmlFor="note-generali" className="sr-only">
              Note generali rilievo
            </Label>
            <Textarea
              id="note-generali"
              rows={5}
              placeholder="Aggiungi osservazioni operative…"
              value={noteGenerali}
              readOnly={!canEdit}
              onChange={event => {
                setNoteGenerali(event.target.value);
                setSaved(false);
                setDirty(true);
              }}
            />
          </DataSurface>

          <DataSurface
            id="rilievo-media"
            density="compact"
            tone="sunken"
            title={
              <span className="inline-flex items-center gap-2">
                <Camera aria-hidden="true" className="h-4 w-4" />
                Anteprima media
              </span>
            }
            description="Le anteprime restano solo su questo dispositivo e non vengono salvate nel CRM."
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={!canEdit}
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) addMedia(file);
                event.target.value = "";
              }}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              disabled={!canEdit}
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) addMedia(file);
                event.target.value = "";
              }}
            />
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit}
                className="min-h-11 text-xs md:min-h-9"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera aria-hidden="true" className="h-4 w-4" />
                Foto
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit}
                className="min-h-11 text-xs md:min-h-9"
                onClick={() => videoInputRef.current?.click()}
              >
                <Video aria-hidden="true" className="h-4 w-4" />
                Video
              </Button>
            </div>

            {mediaFiles.length > 0 ? (
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 min-[1200px]:grid-cols-2">
                {mediaFiles.map(media => (
                  <div
                    key={media.id}
                    className="group relative min-w-0 overflow-hidden rounded-[var(--radius-control)] border border-border-soft bg-surface"
                  >
                    {media.type === "foto" && media.dataUrl ? (
                      <img
                        src={media.dataUrl}
                        alt={media.name}
                        className="h-24 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-24 w-full flex-col items-center justify-center gap-1 bg-surface-2 text-text-3">
                        {media.type === "video" ? (
                          <Video aria-hidden="true" className="h-5 w-5" />
                        ) : (
                          <Image aria-hidden="true" className="h-5 w-5" />
                        )}
                        <span className="max-w-full truncate px-2 text-xs">
                          {media.type}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-full bg-focal text-on-focal shadow-[var(--shadow-raised)]"
                      aria-label={`Rimuovi ${media.name}`}
                      onClick={() => removeMedia(media.id)}
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs leading-5 text-text-3">
                Nessuna anteprima locale acquisita.
              </p>
            )}
          </DataSurface>
        </aside>
      </div>

      <StickyActionBar
        busy={updateApertura.isPending}
        dirty={dirty}
        status={
          updateApertura.isPending
            ? "Salvataggio in corso…"
            : saved
              ? "Rilievo salvato nel CRM."
              : !canEdit
                ? "Consultazione in sola lettura."
                : dirty
                  ? "Modifiche non ancora salvate."
                  : "Nessuna modifica da salvare."
        }
        primary={
          <Button
            type="button"
            size="lg"
            variant="brand"
            onClick={handleSave}
            disabled={!canEdit || !dirty || updateApertura.isPending}
            className="min-h-11 w-full sm:w-auto"
          >
            <Save aria-hidden="true" className="h-4 w-4" />
            {updateApertura.isPending ? "Salvataggio…" : "Salva rilievo"}
          </Button>
        }
      />
    </div>
  );
}
