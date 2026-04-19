import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Calculator,
  Download,
  FileCheck2,
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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { trpc } from "@/lib/trpc";

import {
  CENTINATURE,
  COLORAZIONE_LABEL,
  MODELLI,
  SUPPLEMENTI,
  getCentinatura,
  getModello,
  getSupplemento,
  type Colorazione,
  type Supplemento,
} from "@shared/listini/fivizzanese";

// ── Types ────────────────────────────────────────────────────────────────────

type Posa = "cardini" | "telaio";

type PersianaInput = {
  id: string; // client-side uid
  larghezza: string; // mm, string for controlled input
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

function areaMq(larghezzaMm: number, altezzaMm: number): number {
  return (larghezzaMm * altezzaMm) / 1_000_000;
}

// Convert a Blob to a base64 string (no data: prefix) so we can ship it
// through tRPC as JSON. FileReader.readAsDataURL yields
// "data:<mime>;base64,<payload>" — we strip everything up to the comma.
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

// Strip characters that are unsafe in filenames across OSes / Content-
// Disposition headers and collapse whitespace. Mirrors the server-side
// `renameForStato` sanitiser so client + server produce identical names.
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PreventivatoreFivizzanese() {
  const [, setLocation] = useLocation();

  // ── Form state ────────────────────────────────────────────────────────────
  const [commessaId, setCommessaId] = useState<string>("none");
  const [riferimento, setRiferimento] = useState("");
  const [posa, setPosa] = useState<Posa>("cardini");
  const [modelloKey, setModelloKey] = useState<string>(MODELLI[0].key);
  const [colorazione, setColorazione] = useState<Colorazione>("standard");
  const [persiane, setPersiane] = useState<PersianaInput[]>([
    { id: uid(), larghezza: "", altezza: "" },
  ]);
  const [supplementiSel, setSupplementiSel] = useState<Set<string>>(new Set());
  const [centinaturaAnte, setCentinaturaAnte] = useState<string>("none");

  // ── Commesse dropdown ─────────────────────────────────────────────────────
  const commesseQuery = trpc.commesse.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const selectedCommessa = commesseQuery.data?.find(
    (c) => String(c.id) === commessaId
  );

  // ── Upload mutation (save PDF into the selected commessa) ─────────────────
  const utils = trpc.useUtils();
  const uploadPreventivo = trpc.preventiviContratti.upload.useMutation({
    onSuccess: () => {
      utils.preventiviContratti.invalidate();
    },
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const modello = getModello(modelloKey);
  const prezzoMq = modello?.prezziMq[colorazione] ?? null;

  // Quando la colorazione cambia, alcuni supplementi non sono più disponibili.
  // Rimuoviamo dalla selezione quelli che perdono prezzo per questa colorazione.
  const supplementiDisponibili = useMemo(
    () =>
      SUPPLEMENTI.filter((s) => s.prezzi[colorazione] !== null),
    [colorazione]
  );

  // Purge selezioni non più disponibili ogni volta che il set cambia.
  const effettiveSelezioni = useMemo(() => {
    const disponibiliKeys = new Set(supplementiDisponibili.map((s) => s.key));
    return new Set(
      Array.from(supplementiSel).filter((k) => disponibiliKeys.has(k))
    );
  }, [supplementiSel, supplementiDisponibili]);

  // ── Calc ──────────────────────────────────────────────────────────────────
  type PersianaCalc = {
    id: string;
    larghezzaMm: number;
    altezzaMm: number;
    areaMq: number;
    prezzoBase: number; // solo questa persiana (no supplementi/centinature)
    supplementiCad: number; // totale supplementi €/cad su questa persiana
    supplementiMq: number; // totale supplementi €/m² su questa persiana
    totale: number; // base + supplementi
  };

  const calc = useMemo(() => {
    const suppAttivi = supplementiDisponibili.filter((s) =>
      effettiveSelezioni.has(s.key)
    );
    const suppCadPerPersiana = suppAttivi
      .filter((s) => s.unita === "cad")
      .reduce((acc, s) => acc + (s.prezzi[colorazione] ?? 0), 0);
    const suppMqPerPersiana = suppAttivi
      .filter((s) => s.unita === "mq")
      .reduce((acc, s) => acc + (s.prezzi[colorazione] ?? 0), 0);

    const perPersiana: PersianaCalc[] = persiane.map((p) => {
      const l = toMm(p.larghezza);
      const h = toMm(p.altezza);
      const a = areaMq(l, h);
      const base = prezzoMq ? a * prezzoMq : 0;
      const suppMq = a * suppMqPerPersiana;
      const suppCad = suppCadPerPersiana;
      return {
        id: p.id,
        larghezzaMm: l,
        altezzaMm: h,
        areaMq: a,
        prezzoBase: base,
        supplementiCad: suppCad,
        supplementiMq: suppMq,
        totale: base + suppMq + suppCad,
      };
    });

    const numPersiane = persiane.length;
    const totalePersiane = perPersiana.reduce((acc, p) => acc + p.totale, 0);
    const totaleSupplementi = perPersiana.reduce(
      (acc, p) => acc + p.supplementiMq + p.supplementiCad,
      0
    );
    const totaleBase = perPersiana.reduce((acc, p) => acc + p.prezzoBase, 0);

    const ante = centinaturaAnte === "none" ? null : Number(centinaturaAnte);
    const centinatura = ante ? getCentinatura(ante) : undefined;
    const centinaturaCostoUnitario = centinatura?.prezzo ?? 0;
    const centinaturaTotale = centinaturaCostoUnitario * numPersiane;

    const totale = totalePersiane + centinaturaTotale;

    return {
      perPersiana,
      suppAttivi,
      numPersiane,
      totaleBase,
      totaleSupplementi,
      centinaturaAnte: ante,
      centinaturaCostoUnitario,
      centinaturaTotale,
      totalePersiane,
      totale,
    };
  }, [
    persiane,
    prezzoMq,
    supplementiDisponibili,
    effettiveSelezioni,
    colorazione,
    centinaturaAnte,
  ]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function addPersiana() {
    setPersiane((ps) => [...ps, { id: uid(), larghezza: "", altezza: "" }]);
  }
  function removePersiana(id: string) {
    setPersiane((ps) => (ps.length <= 1 ? ps : ps.filter((p) => p.id !== id)));
  }
  function updatePersiana(id: string, field: "larghezza" | "altezza", v: string) {
    // Permetti solo cifre e virgola/punto, clamp al massimo 5 caratteri significativi
    const cleaned = v.replace(/[^\d.,]/g, "");
    setPersiane((ps) =>
      ps.map((p) => (p.id === id ? { ...p, [field]: cleaned } : p))
    );
  }
  function toggleSupplemento(key: string) {
    setSupplementiSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── PDF ───────────────────────────────────────────────────────────────────
  // Build the jsPDF instance for the current form state. Caller decides what
  // to do with it (save locally, upload to commessa, both).
  function buildPdf(): jsPDF | null {
    if (!modello) return null;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const marginX = 14;
    let y = 18;

    // Titolo
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Preventivo Fivizzanese — Persiane", marginX, y);
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
      ["Modello", modello.nome],
      ["Colorazione", COLORAZIONE_LABEL[colorazione]],
      ["Prezzo €/m²", prezzoMq ? EUR.format(prezzoMq) : "—"],
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
    const persianeRows = calc.perPersiana.map((p, i) => [
      String(i + 1),
      p.larghezzaMm ? `${p.larghezzaMm} mm` : "—",
      p.altezzaMm ? `${p.altezzaMm} mm` : "—",
      `${MQ.format(p.areaMq)} m²`,
      EUR.format(p.prezzoBase),
    ]);
    autoTable(doc, {
      startY: y,
      head: [["#", "Larghezza", "Altezza", "Area", "Prezzo base"]],
      body: persianeRows,
      theme: "striped",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [55, 65, 81], textColor: 255 },
      foot: [
        [
          { content: "Totale base", colSpan: 4, styles: { halign: "right" } },
          EUR.format(calc.totaleBase),
        ],
      ],
      footStyles: { fillColor: [243, 244, 246], textColor: 0, fontStyle: "bold" },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Supplementi
    if (calc.suppAttivi.length > 0) {
      const supplRows = calc.suppAttivi.map((s) => {
        const prezzo = s.prezzi[colorazione] ?? 0;
        const totale =
          s.unita === "cad"
            ? prezzo * calc.numPersiane
            : calc.perPersiana.reduce((acc, p) => acc + p.areaMq, 0) * prezzo;
        return [
          s.nome,
          s.unita === "mq" ? "€/m²" : "€/cad",
          EUR.format(prezzo),
          EUR.format(totale),
        ];
      });
      const totSupp = calc.perPersiana.reduce(
        (acc, p) => acc + p.supplementiMq + p.supplementiCad,
        0
      );
      autoTable(doc, {
        startY: y,
        head: [["Supplemento", "Unità", "Prezzo", "Totale"]],
        body: supplRows,
        theme: "striped",
        styles: { fontSize: 9 },
        headStyles: { fillColor: [55, 65, 81], textColor: 255 },
        foot: [
          [
            {
              content: "Totale supplementi",
              colSpan: 3,
              styles: { halign: "right" },
            },
            EUR.format(totSupp),
          ],
        ],
        footStyles: {
          fillColor: [243, 244, 246],
          textColor: 0,
          fontStyle: "bold",
        },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    // Centinature
    if (calc.centinaturaAnte) {
      autoTable(doc, {
        startY: y,
        head: [["Centinatura", "N° persiane", "Prezzo cad.", "Totale"]],
        body: [
          [
            `${calc.centinaturaAnte} ${
              calc.centinaturaAnte === 1 ? "anta" : "ante"
            }`,
            String(calc.numPersiane),
            EUR.format(calc.centinaturaCostoUnitario),
            EUR.format(calc.centinaturaTotale),
          ],
        ],
        theme: "grid",
        styles: { fontSize: 9 },
        headStyles: { fillColor: [55, 65, 81], textColor: 255 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    // Totale
    autoTable(doc, {
      startY: y,
      body: [
        [
          { content: "TOTALE PREVENTIVO", styles: { fontStyle: "bold" } },
          {
            content: EUR.format(calc.totale),
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

  // Filename used for both the local download and (if a commessa is picked)
  // the upload. Matches user spec: "Preventivo {cliente} - Fivizzanese.pdf".
  // Falls back to the free-text `riferimento` when no commessa is linked so
  // the download still has a meaningful name.
  function buildFilename(): string {
    const cliente = selectedCommessa?.cliente || riferimento || "Cliente";
    return `${sanitizeFilename(`Preventivo ${cliente} - Fivizzanese`)}.pdf`;
  }

  async function handleExport() {
    const doc = buildPdf();
    if (!doc) return;
    const filename = buildFilename();
    doc.save(filename);

    // If a commessa is selected also save the PDF as "preventivo" documento
    // so it lives inside the commessa's documents panel. `keepNome: true`
    // bypasses the server-side rename (which would replace our name with
    // "{stato label} {cliente}.pdf") and dedup-suffixing still applies if
    // the same name is already present.
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

  // ── Render ────────────────────────────────────────────────────────────────
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
            Fivizzanese — Persiane
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Preventivatore dedicato alle persiane Fivizzanese. Il prezzo è
            calcolato al m² in base al modello, colorazione, supplementi e
            centinature selezionati.
          </p>
        </div>
        <Button
          onClick={handleExport}
          className="gap-2"
          disabled={
            !modello || calc.numPersiane === 0 || uploadPreventivo.isPending
          }
        >
          <Download className="h-4 w-4" />
          {uploadPreventivo.isPending ? "Salvataggio…" : "Scarica PDF"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Colonna form ─────────────────────────────────────────────── */}
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
                  <PosaOption value="cardini" label="Su Cardini" current={posa} />
                  <PosaOption value="telaio" label="Su Telaio" current={posa} />
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

          {/* Configurazione prodotto */}
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
                  <SelectContent>
                    {MODELLI.map((m) => (
                      <SelectItem key={m.key} value={m.key}>
                        {m.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Colorazione</Label>
                <RadioGroup
                  value={colorazione}
                  onValueChange={(v) => setColorazione(v as Colorazione)}
                  className="grid grid-cols-3 gap-2"
                >
                  {(["standard", "speciali", "legno"] as Colorazione[]).map(
                    (c) => (
                      <PosaOption
                        key={c}
                        value={c}
                        label={COLORAZIONE_LABEL[c]}
                        current={colorazione}
                      />
                    )
                  )}
                </RadioGroup>
                {prezzoMq && (
                  <p className="text-xs text-muted-foreground">
                    Prezzo modello: {EUR.format(prezzoMq)}/m²
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Misure persiane */}
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
                const area = areaMq(toMm(p.larghezza), toMm(p.altezza));
                return (
                  <div
                    key={p.id}
                    className="grid grid-cols-12 gap-2 items-end p-3 rounded-md border bg-muted/20"
                  >
                    <div className="col-span-1 pb-2 text-sm font-medium text-muted-foreground">
                      #{idx + 1}
                    </div>
                    <div className="col-span-4 space-y-1">
                      <Label className="text-xs">Larghezza (mm)</Label>
                      <Input
                        inputMode="numeric"
                        placeholder="1200"
                        value={p.larghezza}
                        onChange={(e) =>
                          updatePersiana(p.id, "larghezza", e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-4 space-y-1">
                      <Label className="text-xs">Altezza (mm)</Label>
                      <Input
                        inputMode="numeric"
                        placeholder="1500"
                        value={p.altezza}
                        onChange={(e) =>
                          updatePersiana(p.id, "altezza", e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-2 pb-2 text-xs text-muted-foreground">
                      {area > 0 ? `${MQ.format(area)} m²` : "—"}
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
            </CardContent>
          </Card>

          {/* Supplementi */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Supplementi opzionali
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {supplementiDisponibili.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nessun supplemento a listino per questa colorazione.
                </p>
              )}
              {supplementiDisponibili.map((s) => (
                <SupplementoRow
                  key={s.key}
                  supp={s}
                  colorazione={colorazione}
                  checked={effettiveSelezioni.has(s.key)}
                  onToggle={() => toggleSupplemento(s.key)}
                />
              ))}
              {/* Supplementi non disponibili in questa colorazione (info) */}
              {SUPPLEMENTI.filter((s) => s.prezzi[colorazione] === null)
                .length > 0 && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs text-muted-foreground">
                    Non a listino per colorazione{" "}
                    <span className="font-medium">
                      {COLORAZIONE_LABEL[colorazione]}
                    </span>
                    :{" "}
                    {SUPPLEMENTI.filter(
                      (s) => s.prezzi[colorazione] === null
                    )
                      .map((s) => s.nome)
                      .join(", ")}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Centinature */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Lavorazioni speciali — Centinature
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select
                value={centinaturaAnte}
                onValueChange={setCentinaturaAnte}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuna centinatura</SelectItem>
                  {CENTINATURE.map((c) => (
                    <SelectItem key={c.ante} value={String(c.ante)}>
                      {c.ante} {c.ante === 1 ? "anta" : "ante"} —{" "}
                      {EUR.format(c.prezzo)}/cad.
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {calc.centinaturaAnte && (
                <p className="text-xs text-muted-foreground">
                  {EUR.format(calc.centinaturaCostoUnitario)} × {calc.numPersiane}{" "}
                  persiane = {EUR.format(calc.centinaturaTotale)}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Colonna riepilogo ────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-base">Riepilogo preventivo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <RowLabel label="Posa" value={POSA_LABEL[posa]} />
              <RowLabel label="Modello" value={modello?.nome ?? "—"} />
              <RowLabel
                label="Colorazione"
                value={
                  <Badge variant="secondary">
                    {COLORAZIONE_LABEL[colorazione]}
                  </Badge>
                }
              />
              <Separator />

              {/* Persiane */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Persiane
                </div>
                {calc.perPersiana.map((p, i) => (
                  <div
                    key={p.id}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-xs text-muted-foreground">
                      #{i + 1} · {p.larghezzaMm || "?"}×{p.altezzaMm || "?"} ·{" "}
                      {MQ.format(p.areaMq)} m²
                    </span>
                    <span className="font-mono text-xs">
                      {EUR.format(p.prezzoBase)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-1 border-t text-xs">
                  <span>Totale base</span>
                  <span className="font-mono">
                    {EUR.format(calc.totaleBase)}
                  </span>
                </div>
              </div>

              {/* Supplementi */}
              {calc.suppAttivi.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Supplementi
                    </div>
                    {calc.suppAttivi.map((s) => {
                      const prezzo = s.prezzi[colorazione] ?? 0;
                      const areaTot = calc.perPersiana.reduce(
                        (acc, p) => acc + p.areaMq,
                        0
                      );
                      const tot =
                        s.unita === "cad"
                          ? prezzo * calc.numPersiane
                          : areaTot * prezzo;
                      return (
                        <div
                          key={s.key}
                          className="flex items-baseline justify-between gap-2"
                        >
                          <span className="text-xs text-muted-foreground truncate">
                            {s.nome}
                          </span>
                          <span className="font-mono text-xs shrink-0">
                            {EUR.format(tot)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between pt-1 border-t text-xs">
                      <span>Totale supplementi</span>
                      <span className="font-mono">
                        {EUR.format(calc.totaleSupplementi)}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* Centinature */}
              {calc.centinaturaAnte && (
                <>
                  <Separator />
                  <RowLabel
                    label={`Centinature ${calc.centinaturaAnte} ${
                      calc.centinaturaAnte === 1 ? "anta" : "ante"
                    }`}
                    value={EUR.format(calc.centinaturaTotale)}
                    mono
                  />
                </>
              )}

              <Separator />
              <div className="flex items-center justify-between pt-1">
                <span className="font-semibold">Totale</span>
                <span className="text-lg font-bold font-mono">
                  {EUR.format(calc.totale)}
                </span>
              </div>

              <Button
                onClick={handleExport}
                className="w-full gap-2"
                disabled={
                  !modello || calc.numPersiane === 0 || uploadPreventivo.isPending
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

function PosaOption({
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

function SupplementoRow({
  supp,
  colorazione,
  checked,
  onToggle,
}: {
  supp: Supplemento;
  colorazione: Colorazione;
  checked: boolean;
  onToggle: () => void;
}) {
  const prezzo = supp.prezzi[colorazione];
  if (prezzo === null) return null;
  return (
    <label
      className={`flex items-center gap-3 rounded-md border p-2.5 cursor-pointer transition-colors ${
        checked ? "border-primary bg-primary/5" : "bg-background hover:bg-accent"
      }`}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight truncate">
          {supp.nome}
        </p>
        <p className="text-xs text-muted-foreground">
          {supp.unita === "mq" ? "€/m²" : "€/cad"}
        </p>
      </div>
      <span className="font-mono text-sm shrink-0">{EUR.format(prezzo)}</span>
    </label>
  );
}

function RowLabel({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

// Avoid unused-import warning when tree-shaken
void getSupplemento;
