import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Copy, Download, Plus, RotateCcw, Trash2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";

import MobileFieldHeader from "@/components/operativita/MobileFieldHeader";
import DataSurface from "@/components/patterns/DataSurface";
import StatePanel from "@/components/patterns/StatePanel";
import StickyActionBar from "@/components/patterns/StickyActionBar";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";

import { millimetriDaInput, millimetriValidi } from "@/lib/preventivatori";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

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
  // Senza questo it-IT non separa le migliaia sotto le 5 cifre: 5000 usciva
  // "5000,00 €" accanto a "10.000,00 €".
  useGrouping: true,
});

const MQ = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Stesso confine numerico dell'altro preventivatore: `@/lib/preventivatori`
// tiene la lettura tollerante storica (una misura non utilizzabile vale 0 e
// non entra nel lookup di listino). Delega, non ricalcola.
function toMm(v: string): number {
  return millimetriDaInput(v);
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
  // Smontaggio / dismissione / posa — costo aggiuntivo fisso in € inserito
  // dall'operatore. Stringa per input controllato.
  const [smontaggio, setSmontaggio] = useState<string>("");
  // Sconto commerciale in percentuale sull'imponibile (persiane + smontaggio),
  // applicato prima dell'IVA. Limite massimo 30%.
  const [sconto, setSconto] = useState<string>("");
  // Aliquota IVA: 22% ordinaria (default), 10% ristrutturazioni.
  const [iva, setIva] = useState<10 | 22>(22);

  const SCONTO_MAX = 30;

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
    const smontaggioEur =
      parseFloat(smontaggio.replace(",", ".")) || 0;
    const scontoPctRaw = parseFloat(sconto.replace(",", ".")) || 0;
    const scontoPct = Math.max(0, Math.min(scontoPctRaw, SCONTO_MAX));
    if (!modello || !colore) {
      const lordoVuoto = smontaggioEur;
      const scontoEurVuoto = lordoVuoto * (scontoPct / 100);
      const imponibileVuoto = lordoVuoto - scontoEurVuoto;
      const ivaImportoVuoto = imponibileVuoto * (iva / 100);
      return {
        perPersiana: [] as PersianaCalc[],
        totaleBase: 0,
        totaleMaggiorazione: 0,
        smontaggioEur,
        scontoPct,
        scontoEur: scontoEurVuoto,
        imponibile: imponibileVuoto,
        iva,
        ivaImporto: ivaImportoVuoto,
        totale: imponibileVuoto + ivaImportoVuoto,
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
    const totalePersiane = perPersiana.reduce(
      (acc, c) => acc + c.prezzoFinale,
      0
    );
    // Imponibile lordo = prodotti + posa. Lo sconto si applica qui. L'IVA
    // colpisce l'imponibile netto (post-sconto).
    const lordo = totalePersiane + smontaggioEur;
    const scontoEur = lordo * (scontoPct / 100);
    const imponibile = lordo - scontoEur;
    const ivaImporto = imponibile * (iva / 100);
    const totale = imponibile + ivaImporto;
    const aPreventivo = perPersiana.some((c) => c.aPreventivo);
    const anyMisuraFuoriListino = perPersiana.some(
      (c) => !c.lookup.ok && c.lookup.reason === "fuori_listino"
    );

    return {
      perPersiana,
      totaleBase,
      totaleMaggiorazione,
      smontaggioEur,
      scontoPct,
      scontoEur,
      imponibile,
      iva,
      ivaImporto,
      totale,
      aPreventivo,
      anyMisuraFuoriListino,
    };
  }, [persiane, modello, colore, smontaggio, sconto, iva]);

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
  function duplicatePersiana(id: string) {
    setPersiane((ps) => {
      const idx = ps.findIndex((p) => p.id === id);
      if (idx < 0) return ps;
      const copy: PersianaInput = { ...ps[idx], id: uid() };
      const next = [...ps];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }
  function handleReset() {
    setCommessaId("none");
    setRiferimento("");
    setPosa("cardini");
    setModelloKey(MODELLI[0].key);
    setColoreKey(
      COLORI.find((c) => c.tipo === "diSerie")?.key ?? COLORI[0].key
    );
    setPersiane([{ id: uid(), larghezza: "", altezza: "" }]);
    setSmontaggio("");
    setSconto("");
    setIva(22);
    toast.success("Preventivo resettato");
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

    // Smontaggio, dismissione e posa
    if (calc.smontaggioEur > 0) {
      autoTable(doc, {
        startY: y,
        head: [["Voce", "Totale"]],
        body: [
          ["Smontaggio, dismissione e posa", EUR.format(calc.smontaggioEur)],
        ],
        theme: "grid",
        styles: { fontSize: 9 },
        headStyles: { fillColor: [55, 65, 81], textColor: 255 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    // Sconto + Imponibile + IVA breakdown
    const breakdown: Array<[string, string]> = [];
    if (calc.scontoPct > 0) {
      breakdown.push([
        `Sconto (-${calc.scontoPct}%)`,
        `- ${EUR.format(calc.scontoEur)}`,
      ]);
    }
    breakdown.push(["Imponibile", EUR.format(calc.imponibile)]);
    breakdown.push([`IVA ${calc.iva}%`, EUR.format(calc.ivaImporto)]);
    autoTable(doc, {
      startY: y,
      head: [["Voce", "Importo"]],
      body: breakdown,
      theme: "grid",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [55, 65, 81], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Totale
    autoTable(doc, {
      startY: y,
      body: [
        [
          {
            content: "TOTALE PREVENTIVO (IVA inclusa)",
            styles: { fontStyle: "bold" },
          },
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

  const exportDisabled =
    !modello ||
    !colore ||
    calc.perPersiana.length === 0 ||
    uploadPreventivo.isPending;
  const exportLabel = uploadPreventivo.isPending
    ? "Salvataggio…"
    : "Scarica PDF";

  // Onestà del totale: una riga senza prezzo di listino vale zero nel calcolo,
  // quindi il totale mostrato è parziale finché resta lì.
  const righeSenzaPrezzo = calc.perPersiana.filter((c) => !c.lookup.ok).length;
  const righeNonIntere = persiane.filter(
    (p) =>
      (p.larghezza.trim() !== "" && millimetriValidi(p.larghezza) === null) ||
      (p.altezza.trim() !== "" && millimetriValidi(p.altezza) === null)
  ).length;
  const totaleParziale = righeSenzaPrezzo > 0 || calc.totale === 0;
  const commesse = commesseQuery.data ?? [];
  const scontoOltreMassimo = parseFloat(sconto.replace(",", ".")) > SCONTO_MAX;

  const statoAzione = uploadPreventivo.isPending
    ? `Salvataggio nella commessa ${selectedCommessa?.codice ?? ""}…`
    : righeSenzaPrezzo > 0
      ? `${righeSenzaPrezzo} ${
          righeSenzaPrezzo === 1 ? "persiana" : "persiane"
        } senza prezzo di listino: il totale non è definitivo.`
      : calc.aPreventivo
        ? "Colore a preventivo: il totale va confermato da Punto del Serramento."
        : selectedCommessa
          ? `Il PDF viene scaricato e salvato nella commessa ${selectedCommessa.codice} come ${buildFilename()}.`
          : "Il PDF viene solo scaricato: nessuna commessa collegata.";

  return (
    <div
      data-page="preventivatore-punto-del-serramento"
      className="min-w-0 max-w-6xl space-y-4 pb-2 sm:space-y-5"
    >
      <MobileFieldHeader
        eyebrow="Preventivatori"
        title="Punto del Serramento · Persiane"
        description="Il prezzo viene dalla tabella misure del listino: le misure non standard salgono alla misura a listino più vicina e il minimo preventivabile è 1 m²."
        backLabel="Torna ai preventivatori"
        onBack={() => setLocation("/preventivatori")}
        metadata={
          <>
            <span>
              {calc.perPersiana.length}{" "}
              {calc.perPersiana.length === 1 ? "persiana" : "persiane"} in
              preventivo
            </span>
            {modello ? (
              <span>
                Listino {larghezzaMin}–{larghezzaMax} × {altezzaMin}–
                {altezzaMax} mm
              </span>
            ) : null}
          </>
        }
        status={
          calc.aPreventivo ? (
            <Badge variant="warning">Colore a preventivo</Badge>
          ) : (
            <Badge variant="outline">Prezzo da listino</Badge>
          )
        }
      />

      <div className="grid min-w-0 items-start gap-4 sm:gap-5 min-[1200px]:grid-cols-12">
        <div className="min-w-0 space-y-4 sm:space-y-5 min-[1200px]:col-span-8">
          <DataSurface
            id="preventivo-destinatario"
            density="compact"
            tone="default"
            title="Commessa e destinatario"
            description="La commessa è opzionale: serve solo ad archiviare il PDF nei documenti."
          >
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="commessa" className="text-xs font-semibold">
                  Commessa
                </Label>
                <Select value={commessaId} onValueChange={setCommessaId}>
                  <SelectTrigger id="commessa" className="min-h-11 w-full">
                    <SelectValue placeholder="Nessuna commessa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nessuna commessa</SelectItem>
                    {commesse.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.codice} — {c.cliente}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="riferimento" className="text-xs font-semibold">
                  Riferimento cliente
                </Label>
                <Input
                  id="riferimento"
                  placeholder="Es. Sig. Rossi — via Garibaldi"
                  value={riferimento}
                  onChange={(e) => setRiferimento(e.target.value)}
                  className="min-h-11 min-w-0 text-base md:text-sm"
                />
              </div>
            </div>

            {commesseQuery.isPending ? (
              <p className="text-xs text-text-3">
                Carico le commesse della sede…
              </p>
            ) : commesseQuery.isError ? (
              <StatePanel
                kind="error"
                compact
                title="Elenco commesse non disponibile"
                description="Il preventivo si calcola e si scarica lo stesso: senza commessa il PDF non viene archiviato."
                action={
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => commesseQuery.refetch()}
                  >
                    Riprova
                  </Button>
                }
              />
            ) : commesse.length === 0 ? (
              <p className="text-xs text-text-3">
                Nessuna commessa nella sede attiva: il PDF verrà solo scaricato.
              </p>
            ) : null}

            <div className="min-w-0 space-y-2 border-t border-border-soft pt-4">
              <p className="text-sm font-bold text-text-1">Tipo di posa</p>
              <RadioGroup
                value={posa}
                onValueChange={(v) => setPosa(v as Posa)}
                className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <OpzioneTile
                  value="cardini"
                  label="Su cardini"
                  current={posa}
                />
                <OpzioneTile value="telaio" label="Su telaio" current={posa} />
              </RadioGroup>
            </div>
          </DataSurface>

          <DataSurface
            id="preventivo-misure"
            density="compact"
            tone="default"
            title="Misure"
            description={
              modello
                ? `Larghezza ${larghezzaMin}–${larghezzaMax} mm, altezza ${altezzaMin}–${altezzaMax} mm: fuori da questo intervallo il prezzo si chiede all'azienda.`
                : "Una scheda per persiana, larghezza e altezza in millimetri."
            }
            toolbar={
              <Button
                variant="outline"
                onClick={addPersiana}
                className="min-h-11"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Aggiungi persiana
              </Button>
            }
          >
            <div className="min-w-0 space-y-3">
              {persiane.map((p, idx) => {
                const pc = calc.perPersiana.find((c) => c.id === p.id);
                const larghezzaNonIntera =
                  p.larghezza.trim() !== "" &&
                  millimetriValidi(p.larghezza) === null;
                const altezzaNonIntera =
                  p.altezza.trim() !== "" &&
                  millimetriValidi(p.altezza) === null;
                const avvisoMisuraId = `misure-${p.id}-avviso`;
                return (
                  <div
                    key={p.id}
                    className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <p className="min-w-0 text-sm font-bold text-text-1">
                        Persiana {idx + 1}
                      </p>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Duplica la persiana ${idx + 1}`}
                          title="Duplica persiana"
                          onClick={() => duplicatePersiana(p.id)}
                          className="min-h-11 min-w-11"
                        >
                          <Copy aria-hidden="true" className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Rimuovi la persiana ${idx + 1}`}
                          title="Rimuovi persiana"
                          onClick={() => removePersiana(p.id)}
                          disabled={persiane.length <= 1}
                          className="min-h-11 min-w-11"
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                      <div className="min-w-0 space-y-1.5">
                        <Label
                          htmlFor={`larghezza-${p.id}`}
                          className="text-xs font-semibold"
                        >
                          Larghezza (mm)
                          {modello ? (
                            <span className="ml-1 font-normal text-text-3">
                              {larghezzaMin}–{larghezzaMax}
                            </span>
                          ) : null}
                        </Label>
                        <Input
                          id={`larghezza-${p.id}`}
                          inputMode="numeric"
                          placeholder={modello ? String(larghezzaMin) : "—"}
                          value={p.larghezza}
                          aria-describedby={
                            larghezzaNonIntera ? avvisoMisuraId : undefined
                          }
                          onChange={(e) =>
                            updatePersiana(p.id, "larghezza", e.target.value)
                          }
                          className="min-h-12 min-w-0 text-base md:min-h-11 md:text-sm"
                        />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <Label
                          htmlFor={`altezza-${p.id}`}
                          className="text-xs font-semibold"
                        >
                          Altezza (mm)
                          {modello ? (
                            <span className="ml-1 font-normal text-text-3">
                              {altezzaMin}–{altezzaMax}
                            </span>
                          ) : null}
                        </Label>
                        <Input
                          id={`altezza-${p.id}`}
                          inputMode="numeric"
                          placeholder={modello ? String(altezzaMin) : "—"}
                          value={p.altezza}
                          aria-describedby={
                            altezzaNonIntera ? avvisoMisuraId : undefined
                          }
                          onChange={(e) =>
                            updatePersiana(p.id, "altezza", e.target.value)
                          }
                          className="min-h-12 min-w-0 text-base md:min-h-11 md:text-sm"
                        />
                      </div>
                    </div>

                    <div className="mt-2 min-w-0">
                      <PersianaInfo calc={pc} />
                    </div>
                    {/* Avviso di campo: descrive gli input a cui è collegato via
                        `aria-describedby`, quindi non serve una live region. */}
                    {larghezzaNonIntera || altezzaNonIntera ? (
                      <p
                        id={avvisoMisuraId}
                        className="mt-1 text-xs text-warning"
                      >
                        Misura non in millimetri interi: verifica il valore
                        prima di inviare il preventivo.
                      </p>
                    ) : null}
                  </div>
                );
              })}

              {calc.anyMisuraFuoriListino ? (
                <p className="flex min-w-0 items-start gap-2 rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger">
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span>
                    Una o più misure superano il range del listino: quelle righe
                    restano senza prezzo e vanno chieste a Punto del Serramento.
                  </span>
                </p>
              ) : null}
            </div>
          </DataSurface>

          <DataSurface
            id="preventivo-configurazione"
            density="compact"
            tone="default"
            title="Configurazione"
            description="Modello e finitura determinano il prezzo di listino; sconto, posa e IVA agiscono sull'imponibile."
          >
            <BloccoCampi
              titolo="Modello e finitura"
              descrizione="I modelli restano raggruppati per tipologia, i colori per famiglia, come sul listino cartaceo."
            >
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="modello" className="text-xs font-semibold">
                  Modello persiana
                </Label>
                <Select value={modelloKey} onValueChange={setModelloKey}>
                  <SelectTrigger id="modello" className="min-h-11 w-full">
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
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="colore" className="text-xs font-semibold">
                  Colore / finitura
                </Label>
                <Select value={coloreKey} onValueChange={setColoreKey}>
                  <SelectTrigger
                    id="colore"
                    aria-describedby={
                      colore?.tipo === "aPreventivo"
                        ? "colore-a-preventivo"
                        : undefined
                    }
                    className="min-h-11 w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[60vh]">
                    {coloriGrouped.map((g) => (
                      <SelectGroup key={g.famiglia}>
                        <SelectLabel>{g.label}</SelectLabel>
                        {g.colori.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            <span className="mr-2">{c.nome}</span>
                            <span className="text-xs text-text-3">
                              {coloreSuffix(c)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {/* Descrizione del campo colore: collegata al controllo via
                    `aria-describedby`, quindi non è una live region. */}
                {colore && colore.tipo === "aPreventivo" ? (
                  <p
                    id="colore-a-preventivo"
                    className="flex min-w-0 items-start gap-2 rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning"
                  >
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>
                      Colore a preventivo: il totale mostrato è solo il prezzo
                      base, il sovrapprezzo lo conferma Punto del Serramento.
                    </span>
                  </p>
                ) : null}
              </div>
            </BloccoCampi>

            <BloccoCampi
              titolo="Smontaggio, dismissione e posa"
              descrizione="Importo fisso in euro sommato prima dello sconto. Lascia vuoto se non applicabile."
            >
              <div className="min-w-0 space-y-1.5 sm:max-w-xs">
                <Label htmlFor="smontaggio" className="text-xs font-semibold">
                  Prezzo (€)
                </Label>
                <Input
                  id="smontaggio"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={smontaggio}
                  onChange={(e) =>
                    setSmontaggio(e.target.value.replace(/[^\d.,]/g, ""))
                  }
                  className="min-h-12 min-w-0 text-base md:min-h-11 md:text-sm"
                />
              </div>
            </BloccoCampi>

            <BloccoCampi
              titolo="Sconto commerciale"
              descrizione={`Massimo ${SCONTO_MAX}%, applicato su persiane più posa prima dell'IVA.`}
            >
              <div className="min-w-0 space-y-1.5 sm:max-w-xs">
                <Label htmlFor="sconto" className="text-xs font-semibold">
                  Sconto (%)
                </Label>
                <Input
                  id="sconto"
                  inputMode="decimal"
                  placeholder="0"
                  value={sconto}
                  aria-describedby={
                    scontoOltreMassimo ? "sconto-avviso" : undefined
                  }
                  onChange={(e) =>
                    setSconto(e.target.value.replace(/[^\d.,]/g, ""))
                  }
                  className="min-h-12 min-w-0 text-base md:min-h-11 md:text-sm"
                />
                {/* Avviso di campo collegato all'input: nessuna live region. */}
                {scontoOltreMassimo ? (
                  <p id="sconto-avviso" className="text-xs text-warning">
                    Sconto limitato automaticamente a {SCONTO_MAX}%: il calcolo
                    usa {calc.scontoPct}%.
                  </p>
                ) : null}
              </div>
            </BloccoCampi>

            <BloccoCampi
              titolo="Aliquota IVA"
              descrizione="Il 10% vale solo per le ristrutturazioni agevolate; in ogni altro caso resta il 22%."
            >
              <RadioGroup
                value={String(iva)}
                onValueChange={(v) => setIva(Number(v) as 10 | 22)}
                className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <OpzioneTile
                  value="10"
                  label="IVA 10%"
                  current={String(iva)}
                  hint="ristrutturazioni"
                />
                <OpzioneTile
                  value="22"
                  label="IVA 22%"
                  current={String(iva)}
                  hint="ordinaria"
                />
              </RadioGroup>
            </BloccoCampi>
          </DataSurface>
        </div>

        <aside className="min-w-0 min-[1200px]:sticky min-[1200px]:top-4 min-[1200px]:col-span-4">
          <DataSurface
            id="preventivo-riepilogo"
            density="comfortable"
            tone="focal"
            title="Riepilogo"
            description="Un solo calcolo, quello del listino Punto del Serramento: qui non si somma nulla di nuovo."
          >
            <div className="min-w-0 space-y-3">
              <RigaRiepilogo etichetta="Posa" valore={POSA_LABEL[posa]} />
              <RigaRiepilogo
                etichetta="Modello"
                valore={modello?.label ?? "—"}
              />
              <RigaRiepilogo
                etichetta="Colore"
                valore={
                  colore ? `${colore.nome} ${coloreSuffix(colore)}` : "—"
                }
              />

              <div className="min-w-0 space-y-2 border-t border-on-focal/20 pt-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-on-focal/75">
                  Persiane
                </p>
                {calc.perPersiana.map((c, i) => (
                  <RigaRiepilogo
                    key={c.id}
                    etichetta={
                      c.lookup.ok
                        ? `#${i + 1} · listino ${c.lookup.larghezzaStandard}×${c.lookup.altezzaStandard} mm`
                        : c.lookup.reason === "fuori_listino"
                          ? `#${i + 1} · fuori listino`
                          : `#${i + 1} · misure mancanti`
                    }
                    valore={c.lookup.ok ? EUR.format(c.prezzoFinale) : "—"}
                  />
                ))}
                <RigaRiepilogo
                  etichetta="Totale base"
                  valore={EUR.format(calc.totaleBase)}
                />
                {colore?.tipo === "percento" && calc.totaleMaggiorazione > 0 ? (
                  <RigaRiepilogo
                    etichetta={`Maggiorazione colore (+${colore.percentuale}%)`}
                    valore={EUR.format(calc.totaleMaggiorazione)}
                  />
                ) : null}
              </div>

              <div className="min-w-0 space-y-2 border-t border-on-focal/20 pt-3">
                {calc.smontaggioEur > 0 ? (
                  <RigaRiepilogo
                    etichetta="Smontaggio, dismissione e posa"
                    valore={EUR.format(calc.smontaggioEur)}
                  />
                ) : null}
                {calc.scontoPct > 0 ? (
                  <RigaRiepilogo
                    etichetta={`Sconto (-${calc.scontoPct}%)`}
                    valore={`- ${EUR.format(calc.scontoEur)}`}
                  />
                ) : null}
                <RigaRiepilogo
                  etichetta="Imponibile"
                  valore={EUR.format(calc.imponibile)}
                />
                <RigaRiepilogo
                  etichetta={`IVA ${calc.iva}%`}
                  valore={EUR.format(calc.ivaImporto)}
                />
              </div>

              <div className="min-w-0 border-t border-on-focal/20 pt-3">
                <RigaRiepilogo
                  forte
                  etichetta={
                    calc.aPreventivo
                      ? "Totale (IVA inclusa) — da confermare"
                      : "Totale (IVA inclusa)"
                  }
                  valore={calc.totale === 0 ? "—" : EUR.format(calc.totale)}
                />
                {/* Il riepilogo si legge, non si annuncia: l'unico annuncio
                    resta quello della barra azioni, per non moltiplicare le
                    live region su una pagina che cambia a ogni tasto. */}
                {totaleParziale ? (
                  <p className="mt-2 rounded-[var(--radius-control)] border border-on-focal/25 bg-on-focal/10 px-3 py-2 text-xs leading-5 text-on-focal">
                    {calc.totale === 0
                      ? "Nessuna misura a listino: non c'è ancora un preventivo da mostrare."
                      : `Totale parziale: ${righeSenzaPrezzo} ${
                          righeSenzaPrezzo === 1 ? "persiana" : "persiane"
                        } senza prezzo di listino non entrano nel calcolo.`}
                  </p>
                ) : null}
                {calc.aPreventivo ? (
                  <p className="mt-2 rounded-[var(--radius-control)] border border-on-focal/25 bg-on-focal/10 px-3 py-2 text-xs leading-5 text-on-focal">
                    Il colore scelto è a preventivo: il sovrapprezzo va
                    confermato dall'azienda prima dell'ordine.
                  </p>
                ) : null}
                {righeNonIntere > 0 ? (
                  <p className="mt-2 text-xs leading-5 text-on-focal/75">
                    Alcune misure non sono millimetri interi: il calcolo le usa
                    così come sono scritte.
                  </p>
                ) : null}
              </div>
            </div>
          </DataSurface>
        </aside>
      </div>

      <StickyActionBar
        busy={uploadPreventivo.isPending}
        status={
          <>
            <span className="font-bold text-text-1">
              Totale {calc.totale === 0 ? "—" : EUR.format(calc.totale)}
              {calc.aPreventivo ? " (da confermare)" : ""}
            </span>
            <span className="block">{statoAzione}</span>
          </>
        }
        secondary={
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={uploadPreventivo.isPending}
            className="min-h-11"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Azzera
          </Button>
        }
        primary={
          <Button
            variant="brand"
            size="lg"
            onClick={handleExport}
            disabled={exportDisabled}
            className="min-h-12 w-full sm:w-auto"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            {uploadPreventivo.isPending
              ? "Salvataggio…"
              : selectedCommessa
                ? "Scarica e salva in commessa"
                : exportLabel}
          </Button>
        }
      />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function BloccoCampi({
  titolo,
  descrizione,
  children,
}: {
  titolo: string;
  descrizione?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 border-t border-border-soft pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-bold text-text-1">{titolo}</h3>
      {descrizione ? (
        <p className="mt-0.5 text-xs leading-5 text-text-3">{descrizione}</p>
      ) : null}
      <div className="mt-3 min-w-0 space-y-3">{children}</div>
    </section>
  );
}

function OpzioneTile({
  value,
  label,
  current,
  hint,
}: {
  value: string;
  label: string;
  current: string;
  hint?: string;
}) {
  const selected = current === value;
  return (
    <Label
      className={cn(
        "flex min-h-12 min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border p-3 transition-colors md:min-h-11",
        selected
          ? "border-primary bg-brand-soft text-brand-soft-ink"
          : "border-border-soft bg-surface hover:bg-surface-2"
      )}
    >
      <RadioGroupItem value={value} />
      <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
      {hint ? (
        <span className="shrink-0 text-xs text-text-3">{hint}</span>
      ) : null}
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
  if (!calc) {
    return (
      <p className="text-xs text-text-3">
        Inserisci larghezza e altezza in millimetri.
      </p>
    );
  }
  if (!calc.lookup.ok) {
    if (calc.lookup.reason === "fuori_listino") {
      return (
        <p className="text-xs font-semibold text-danger">
          Fuori dal range di listino: prezzo da richiedere all'azienda.
        </p>
      );
    }
    return (
      <p className="text-xs text-text-3">
        Senza entrambe le misure questa persiana non entra nel totale.
      </p>
    );
  }
  const l = calc.lookup;
  return (
    <p className="min-w-0 text-xs leading-5 text-text-2">
      <strong className="tabular-nums text-text-1">
        {EUR.format(calc.prezzoFinale)}
      </strong>{" "}
      · listino {l.larghezzaStandard}×{l.altezzaStandard} mm ·{" "}
      {MQ.format(l.areaMq)} m²
      {l.arrotondata ? " · misura arrotondata" : ""}
      {l.minimoApplicato ? " · minimo 1 m²" : ""}
    </p>
  );
}

function RigaRiepilogo({
  etichetta,
  valore,
  forte,
}: {
  etichetta: ReactNode;
  valore: ReactNode;
  forte?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span
        className={cn(
          "min-w-0 break-words",
          forte
            ? "text-sm font-bold text-on-focal"
            : "text-xs leading-5 text-on-focal/75"
        )}
      >
        {etichetta}
      </span>
      <span
        className={cn(
          "shrink-0 text-right tabular-nums text-on-focal",
          forte ? "text-lg font-bold" : "text-xs"
        )}
      >
        {valore}
      </span>
    </div>
  );
}

// Avoid unused-import warning on types imported only for inference
export type { Modello };
