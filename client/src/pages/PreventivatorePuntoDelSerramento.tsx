import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Download,
  FileCheck2,
  Info,
  Plus,
  Trash2,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { trpc } from "@/lib/trpc";

import {
  applyColore,
  COLORI,
  FAMIGLIA_LABEL,
  getColore,
  getModello,
  lookupPrezzo,
  MODELLI,
  type Colore,
  type Modello,
  type PrezzoLookup,
} from "@shared/listini/punto-del-serramento";

// ── Types ────────────────────────────────────────────────────────────────────

type Posa = "cardini" | "telaio";

type PersianaInput = {
  id: string;
  larghezza: string; // mm, string (controlled input)
  altezza: string;
};

// ── Utils ────────────────────────────────────────────────────────────────────

const POSA_LABEL: Record<Posa, string> = {
  cardini: "Su Cardini",
  telaio: "Su Telaio",
};

const EUR = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MQ = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function toMm(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("FileReader error"));
    r.readAsDataURL(blob);
  });
}

// Raggruppa i modelli per tipologia (Persiane Lamelle Fisse, Orientabili,
// ecc.) in base al nome — tutto il raggruppamento è derivato dalla chiave del
// listino per evitare manutenzione separata. Fallback: "Altri".
type ModelloGroup = { label: string; modelli: Modello[] };

function groupModelli(all: Modello[]): ModelloGroup[] {
  const groups: Record<string, Modello[]> = {};
  for (const m of all) {
    const key = classify(m.key);
    (groups[key] ??= []).push(m);
  }
  const order = [
    "Persiane Lamelle Fisse",
    "Persiane Lamelle Orientabili",
    "Persiane con Sportello",
    "Porte Lamelle Fisse",
    "Porte Lamelle Orientabili",
    "Porte con Sportello",
    "Altri",
  ];
  return order
    .filter((l) => groups[l])
    .map((l) => ({ label: l, modelli: groups[l] }));
}

function classify(nome: string): string {
  const n = nome.toLowerCase();
  const isPorta = n.startsWith("porta");
  const isSport = n.includes("sportello");
  const isOrient = n.includes("orientab");
  if (isPorta && isSport) return "Porte con Sportello";
  if (isPorta && isOrient) return "Porte Lamelle Orientabili";
  if (isPorta) return "Porte Lamelle Fisse";
  if (isSport) return "Persiane con Sportello";
  if (isOrient) return "Persiane Lamelle Orientabili";
  return "Persiane Lamelle Fisse";
}

// Raggruppa i colori per famiglia rispettando l'ordine di dichiarazione.
function groupColori(all: Colore[]): {
  famiglia: Colore["famiglia"];
  label: string;
  colori: Colore[];
}[] {
  const map = new Map<Colore["famiglia"], Colore[]>();
  for (const c of all) {
    if (!map.has(c.famiglia)) map.set(c.famiglia, []);
    map.get(c.famiglia)!.push(c);
  }
  return Array.from(map.entries()).map(([famiglia, colori]) => ({
    famiglia,
    label: FAMIGLIA_LABEL[famiglia],
    colori,
  }));
}

function coloreSuffix(c: Colore): string {
  if (c.tipo === "diSerie") return "— di serie";
  if (c.tipo === "aPreventivo") return "— a preventivo";
  return `+${c.percentuale}%`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PreventivatorePuntoDelSerramento() {
  const [, setLocation] = useLocation();

  // ── Form state ────────────────────────────────────────────────────────────
  const [commessaId, setCommessaId] = useState<string>("none");
  const [riferimento, setRiferimento] = useState("");
  const [posa, setPosa] = useState<Posa>("cardini");
  const [modelloKey, setModelloKey] = useState<string>(MODELLI[0].key);
  const [coloreKey, setColoreKey] = useState<string>(
    COLORI.find((c) => c.tipo === "diSerie")?.key ?? COLORI[0].key
  );
  const [persiane, setPersiane] = useState<PersianaInput[]>([
    { id: uid(), larghezza: "", altezza: "" },
  ]);

  // ── Commesse dropdown ─────────────────────────────────────────────────────
  const commesseQuery = trpc.commesse.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const selectedCommessa = commesseQuery.data?.find(
    (c) => String(c.id) === commessaId
  );

  // ── Upload mutation ───────────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const uploadPreventivo = trpc.preventiviContratti.upload.useMutation({
    onSuccess: () => {
      utils.preventiviContratti.invalidate();
    },
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const modello = getModello(modelloKey);
  const colore = getColore(coloreKey);
  const coloriGrouped = useMemo(() => groupColori(COLORI), []);
  const modelliGrouped = useMemo(() => groupModelli(MODELLI), []);

  // ── Calc ──────────────────────────────────────────────────────────────────
  type PersianaCalc = {
    id: string;
    input: PersianaInput;
    lookup: PrezzoLookup;
    /** Prezzo con maggiorazione colore applicata (se applicabile). */
    prezzoFinale: number;
    /** Quota di maggiorazione per colore (0 se di serie / a preventivo). */
    maggiorazione: number;
    /** True se il colore richiede quotazione: il prezzo resta "base" e va confermato. */
    aPreventivo: boolean;
  };

  const calc = useMemo(() => {
    if (!modello || !colore) {
      return {
        perPersiana: [] as PersianaCalc[],
        totaleBase: 0,
        totaleMaggiorazione: 0,
        totale: 0,
        aPreventivo: false,
        anyMisuraFuoriListino: false,
      };
    }
    const perPersiana: PersianaCalc[] = persiane.map((p) => {
      const lookup = lookupPrezzo(modello, toMm(p.larghezza), toMm(p.altezza));
      if (!lookup.ok) {
        return {
          id: p.id,
          input: p,
          lookup,
          prezzoFinale: 0,
          maggiorazione: 0,
          aPreventivo: false,
        };
      }
      const applied = applyColore(lookup.prezzo, colore);
      return {
        id: p.id,
        input: p,
        lookup,
        prezzoFinale: applied.prezzo,
        maggiorazione: applied.maggiorazione,
        aPreventivo: applied.aPreventivo,
      };
    });

    const totaleBase = perPersiana.reduce(
      (acc, c) => acc + (c.lookup.ok ? c.lookup.prezzo : 0),
      0
    );
    const totaleMaggiorazione = perPersiana.reduce(
      (acc, c) => acc + c.maggiorazione,
      0
    );
    const totale = perPersiana.reduce((acc, c) => acc + c.prezzoFinale, 0);
    const aPreventivo = perPersiana.some((c) => c.aPreventivo);
    const anyMisuraFuoriListino = perPersiana.some(
      (c) => !c.lookup.ok && c.lookup.reason === "fuori_listino"
    );

    return {
      perPersiana,
      totaleBase,
      totaleMaggiorazione,
      totale,
      aPreventivo,
      anyMisuraFuoriListino,
    };
  }, [persiane, modello, colore]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function addPersiana() {
    setPersiane((ps) => [...ps, { id: uid(), larghezza: "", altezza: "" }]);
  }
  function removePersiana(id: string) {
    setPersiane((ps) => (ps.length <= 1 ? ps : ps.filter((p) => p.id !== id)));
  }
  function updatePersiana(id: string, field: "larghezza" | "altezza", v: string) {
    const cleaned = v.replace(/[^\d.,]/g, "");
    setPersiane((ps) =>
      ps.map((p) => (p.id === id ? { ...p, [field]: cleaned } : p))
    );
  }

  // ── PDF ───────────────────────────────────────────────────────────────────
  function buildPdf(): jsPDF | null {
    if (!modello || !colore) return null;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const marginX = 14;
    let y = 18;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Preventivo Punto del Serramento — Persiane", marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      `Generato il ${new Date().toLocaleDateString("it-IT")}`,
      marginX,
      y
    );
    doc.setTextColor(0);
    y += 8;

    // Dati generali
    const commessa = commesseQuery.data?.find(
      (c) => String(c.id) === commessaId
    );
    const generali: Array<[string, string]> = [
      ["Commessa", commessa ? `${commessa.codice} — ${commessa.cliente}` : "—"],
      ["Riferimento cliente", riferimento || "—"],
      ["Tipo posa", POSA_LABEL[posa]],
      ["Modello", modello.label],
      [
        "Colore",
        colore.tipo === "percento"
          ? `${colore.nome} (+${colore.percentuale}%)`
          : colore.tipo === "diSerie"
          ? `${colore.nome} (di serie)`
          : `${colore.nome} (a preventivo)`,
      ],
    ];
    autoTable(doc, {
      startY: y,
      head: [["Dato", "Valore"]],
      body: generali,
      theme: "grid",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [55, 65, 81], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Persiane
    const rows = calc.perPersiana.map((c, i) => {
      if (!c.lookup.ok) {
        return [
          String(i + 1),
          c.input.larghezza ? `${c.input.larghezza} mm` : "—",
          c.input.altezza ? `${c.input.altezza} mm` : "—",
          "—",
          "—",
          c.lookup.reason === "fuori_listino"
            ? "Fuori listino"
            : "Misure mancanti",
        ];
      }
      const l = c.lookup;
      const notes: string[] = [];
      if (l.arrotondata)
        notes.push(
          `arr. a ${l.larghezzaStandard}×${l.altezzaStandard} mm`
        );
      if (l.minimoApplicato) notes.push("min 1 m²");
      return [
        String(i + 1),
        `${l.larghezzaUtente} mm`,
        `${l.altezzaUtente} mm`,
        `${MQ.format(l.areaMq)} m²`,
        EUR.format(c.prezzoFinale),
        notes.join(", ") || "—",
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [["#", "Larghezza", "Altezza", "Area listino", "Prezzo", "Note"]],
      body: rows,
      theme: "striped",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [55, 65, 81], textColor: 255 },
      foot: [
        [
          {
            content: "Totale base (senza colore)",
            colSpan: 4,
            styles: { halign: "right" },
          },
          { content: EUR.format(calc.totaleBase), colSpan: 2 },
        ],
        ...(colore.tipo === "percento" && calc.totaleMaggiorazione > 0
          ? [
              [
                {
                  content: `Maggiorazione colore (+${colore.percentuale}%)`,
                  colSpan: 4,
                  styles: { halign: "right" as const },
                },
                {
                  content: EUR.format(calc.totaleMaggiorazione),
                  colSpan: 2,
                },
              ],
            ]
          : []),
      ],
      footStyles: {
        fillColor: [243, 244, 246],
        textColor: 0,
        fontStyle: "bold",
      },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Nota "a preventivo"
    if (calc.aPreventivo) {
      doc.setFillColor(254, 243, 199);
      doc.setDrawColor(217, 119, 6);
      doc.roundedRect(marginX, y, 210 - marginX * 2, 14, 1.5, 1.5, "FD");
      doc.setTextColor(146, 64, 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Colore a preventivo", marginX + 3, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(
        "Il colore scelto richiede conferma diretta dall'azienda. Il totale mostrato è solo il prezzo base: il sovrapprezzo colore verrà aggiunto a preventivo.",
        marginX + 3,
        y + 10,
        { maxWidth: 210 - marginX * 2 - 6 }
      );
      doc.setTextColor(0);
      y += 18;
    }

    // Totale
    autoTable(doc, {
      startY: y,
      body: [
        [
          { content: "TOTALE PREVENTIVO", styles: { fontStyle: "bold" } },
          {
            content: calc.aPreventivo
              ? `${EUR.format(calc.totale)}  (da confermare)`
              : EUR.format(calc.totale),
            styles: { fontStyle: "bold", halign: "right" },
          },
        ],
      ],
      theme: "grid",
      styles: { fontSize: 11, fillColor: [17, 24, 39], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });

    return doc;
  }

  function buildFilename(): string {
    const cliente = selectedCommessa?.cliente || riferimento || "Cliente";
    return `${sanitizeFilename(
      `Preventivo ${cliente} - Punto del Serramento`
    )}.pdf`;
  }

  async function handleExport() {
    const doc = buildPdf();
    if (!doc) return;
    const filename = buildFilename();
    doc.save(filename);

    if (!selectedCommessa) return;
    try {
      const blob = doc.output("blob") as Blob;
      const dataBase64 = await blobToBase64(blob);
      await uploadPreventivo.mutateAsync({
        commessaId: selectedCommessa.id,
        nome: filename,
        tipo: "preventivo",
        mimeType: "application/pdf",
        size: blob.size,
        dataBase64,
        keepNome: true,
      });
      toast.success(
        `Preventivo salvato nella commessa ${selectedCommessa.codice}`,
        { description: filename }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore sconosciuto";
      toast.error("Salvataggio nella commessa fallito", { description: msg });
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  const altezzaMax = modello
    ? modello.altezzeStandard[modello.altezzeStandard.length - 1]
    : 0;
  const larghezzaMax = modello
    ? modello.larghezzeStandard[modello.larghezzeStandard.length - 1]
    : 0;
  const altezzaMin = modello ? modello.altezzeStandard[0] : 0;
  const larghezzaMin = modello ? modello.larghezzeStandard[0] : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 -ml-2"
              onClick={() => setLocation("/preventivatori")}
            >
              <ArrowLeft className="h-4 w-4" />
              Preventivatori
            </Button>
          </div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" />
            Punto del Serramento — Persiane
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Il prezzo è determinato dalla tabella misure del listino. Le misure
            non standard vengono arrotondate per eccesso alla misura a listino
            più vicina; il minimo preventivabile è 1 m². Il colore applica una
            maggiorazione percentuale oppure è "di serie" / "a preventivo".
          </p>
        </div>
        <Button
          onClick={handleExport}
          className="gap-2"
          disabled={
            !modello ||
            !colore ||
            calc.perPersiana.length === 0 ||
            uploadPreventivo.isPending
          }
        >
          <Download className="h-4 w-4" />
          {uploadPreventivo.isPending ? "Salvataggio…" : "Scarica PDF"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Form ────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dati generali */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dati generali</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Commessa (opzionale)</Label>
                  <Select value={commessaId} onValueChange={setCommessaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Nessuna commessa" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nessuna commessa</SelectItem>
                      {(commesseQuery.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.codice} — {c.cliente}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Riferimento cliente</Label>
                  <Input
                    placeholder="Es. Sig. Rossi — via Garibaldi"
                    value={riferimento}
                    onChange={(e) => setRiferimento(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tipo di posa</Label>
                <RadioGroup
                  value={posa}
                  onValueChange={(v) => setPosa(v as Posa)}
                  className="grid grid-cols-2 gap-2"
                >
                  <TileOption
                    value="cardini"
                    label="Su Cardini"
                    current={posa}
                  />
                  <TileOption
                    value="telaio"
                    label="Su Telaio"
                    current={posa}
                  />
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

          {/* Configurazione */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configurazione</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Modello persiana</Label>
                <Select value={modelloKey} onValueChange={setModelloKey}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[60vh]">
                    {modelliGrouped.map((g) => (
                      <SelectGroup key={g.label}>
                        <SelectLabel>{g.label}</SelectLabel>
                        {g.modelli.map((m) => (
                          <SelectItem key={m.key} value={m.key}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {modello && (
                  <p className="text-xs text-muted-foreground">
                    Range listino: larghezza {larghezzaMin}–{larghezzaMax} mm,
                    altezza {altezzaMin}–{altezzaMax} mm.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Colore / Finitura</Label>
                <Select value={coloreKey} onValueChange={setColoreKey}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[60vh]">
                    {coloriGrouped.map((g) => (
                      <SelectGroup key={g.famiglia}>
                        <SelectLabel>{g.label}</SelectLabel>
                        {g.colori.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            <span className="mr-2">{c.nome}</span>
                            <span className="text-xs text-muted-foreground">
                              {coloreSuffix(c)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {colore && colore.tipo === "aPreventivo" && (
                  <div className="flex gap-2 items-start rounded-md border border-amber-400 bg-amber-50 text-amber-900 p-2.5 text-xs leading-snug">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Colore a preventivo</p>
                      <p>
                        Questa finitura richiede una conferma diretta di{" "}
                        <span className="font-medium">Punto del Serramento</span>.
                        Il totale mostrato è solo il prezzo base: il
                        sovrapprezzo colore verrà aggiunto in seguito.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Persiane */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Persiane ({persiane.length})
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={addPersiana}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Aggiungi persiana
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {persiane.map((p, idx) => {
                const pc = calc.perPersiana.find((c) => c.id === p.id);
                return (
                  <div
                    key={p.id}
                    className="grid grid-cols-12 gap-2 items-end p-3 rounded-md border bg-muted/20"
                  >
                    <div className="col-span-1 pb-2 text-sm font-medium text-muted-foreground">
                      #{idx + 1}
                    </div>
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">
                        Larghezza (mm)
                        {modello && (
                          <span className="text-muted-foreground">
                            {" "}· {larghezzaMin}–{larghezzaMax}
                          </span>
                        )}
                      </Label>
                      <Input
                        inputMode="numeric"
                        placeholder={modello ? String(larghezzaMin) : "—"}
                        value={p.larghezza}
                        onChange={(e) =>
                          updatePersiana(p.id, "larghezza", e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">
                        Altezza (mm)
                        {modello && (
                          <span className="text-muted-foreground">
                            {" "}· {altezzaMin}–{altezzaMax}
                          </span>
                        )}
                      </Label>
                      <Input
                        inputMode="numeric"
                        placeholder={modello ? String(altezzaMin) : "—"}
                        value={p.altezza}
                        onChange={(e) =>
                          updatePersiana(p.id, "altezza", e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-4 pb-1 text-xs">
                      <PersianaInfo calc={pc} />
                    </div>
                    <div className="col-span-1 pb-1 flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removePersiana(p.id)}
                        disabled={persiane.length <= 1}
                        title="Rimuovi persiana"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {calc.anyMisuraFuoriListino && (
                <div className="flex gap-2 items-start rounded-md border border-red-300 bg-red-50 text-red-900 p-2.5 text-xs leading-snug">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    Una o più misure superano il range massimo del listino. Il
                    prezzo verrà richiesto direttamente a Punto del Serramento.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Riepilogo ───────────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-base">Riepilogo preventivo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <RowLabel label="Posa" value={POSA_LABEL[posa]} />
              <RowLabel label="Modello" value={modello?.label ?? "—"} />
              <RowLabel
                label="Colore"
                value={
                  colore ? (
                    <Badge variant="secondary" className="gap-1">
                      {colore.nome}
                      <span className="text-[10px] opacity-70">
                        {coloreSuffix(colore)}
                      </span>
                    </Badge>
                  ) : (
                    "—"
                  )
                }
              />
              <Separator />

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Persiane
                </div>
                {calc.perPersiana.map((c, i) => (
                  <div
                    key={c.id}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-xs text-muted-foreground truncate">
                      #{i + 1} ·{" "}
                      {c.lookup.ok
                        ? `${c.lookup.larghezzaStandard}×${c.lookup.altezzaStandard}`
                        : c.lookup.reason === "fuori_listino"
                        ? "fuori listino"
                        : "misure mancanti"}
                    </span>
                    <span className="font-mono text-xs shrink-0">
                      {c.lookup.ok ? EUR.format(c.prezzoFinale) : "—"}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-1 border-t text-xs">
                  <span>Totale base</span>
                  <span className="font-mono">
                    {EUR.format(calc.totaleBase)}
                  </span>
                </div>
                {colore?.tipo === "percento" && calc.totaleMaggiorazione > 0 && (
                  <div className="flex justify-between text-xs">
                    <span>
                      Maggiorazione colore (+{colore.percentuale}%)
                    </span>
                    <span className="font-mono">
                      {EUR.format(calc.totaleMaggiorazione)}
                    </span>
                  </div>
                )}
              </div>

              <Separator />
              <div className="flex items-center justify-between pt-1">
                <span className="font-semibold">
                  Totale {calc.aPreventivo && "(da confermare)"}
                </span>
                <span className="text-lg font-bold font-mono">
                  {EUR.format(calc.totale)}
                </span>
              </div>

              {calc.aPreventivo && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-300 rounded-md p-2 leading-snug">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Il colore scelto è a preventivo: il sovrapprezzo andrà
                  confermato dall'azienda prima dell'ordine.
                </p>
              )}

              <Button
                onClick={handleExport}
                className="w-full gap-2"
                disabled={
                  !modello ||
                  !colore ||
                  calc.perPersiana.length === 0 ||
                  uploadPreventivo.isPending
                }
              >
                <Download className="h-4 w-4" />
                {uploadPreventivo.isPending
                  ? "Salvataggio…"
                  : selectedCommessa
                  ? "Scarica + salva in commessa"
                  : "Scarica PDF"}
              </Button>
              {selectedCommessa && (
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-snug">
                  <FileCheck2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Verrà salvato nella commessa{" "}
                    <span className="font-medium">
                      {selectedCommessa.codice}
                    </span>{" "}
                    come{" "}
                    <span className="font-medium">{buildFilename()}</span>.
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TileOption({
  value,
  label,
  current,
}: {
  value: string;
  label: string;
  current: string;
}) {
  const selected = current === value;
  return (
    <Label
      className={`flex items-center gap-2 rounded-md border p-2.5 cursor-pointer transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "bg-background hover:bg-accent"
      }`}
    >
      <RadioGroupItem value={value} />
      <span className="text-sm font-medium">{label}</span>
    </Label>
  );
}

function PersianaInfo({
  calc,
}: {
  calc:
    | {
        lookup: PrezzoLookup;
        prezzoFinale: number;
        aPreventivo: boolean;
      }
    | undefined;
}) {
  if (!calc) return <span className="text-muted-foreground">—</span>;
  if (!calc.lookup.ok) {
    if (calc.lookup.reason === "fuori_listino") {
      return (
        <span className="text-red-700 text-xs">
          Fuori range listino — richiedi preventivo
        </span>
      );
    }
    return <span className="text-muted-foreground text-xs">Inserisci le misure</span>;
  }
  const l = calc.lookup;
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-sm font-semibold">
        {new Intl.NumberFormat("it-IT", {
          style: "currency",
          currency: "EUR",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(calc.prezzoFinale)}
      </p>
      <p className="text-[11px] text-muted-foreground leading-tight">
        listino {l.larghezzaStandard}×{l.altezzaStandard} · {MQ.format(l.areaMq)}{" "}
        m²{l.arrotondata ? " · arrotondata" : ""}
        {l.minimoApplicato ? " · min 1 m²" : ""}
      </p>
    </div>
  );
}

function RowLabel({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

// Avoid unused-import warning on types imported only for inference
export type { Modello };
