import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Copy, Download, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

import {
  areaMetriQuadri,
  millimetriDaInput,
  millimetriValidi,
} from "@/lib/preventivatori";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

import {
  CENTINATURE,
  COLORAZIONE_LABEL,
  MODELLI,
  SUPPLEMENTI,
  getCentinatura,
  getModello,
  getPromoColore,
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

// I confini numerici vivono in `@/lib/preventivatori`, condivisi con l'altro
// preventivatore: `toMm` è la lettura tollerante storica (una misura non
// utilizzabile vale 0 e quindi non produce prezzo), `areaMq` la conversione in
// metri quadri. Delegano, non ricalcolano: i prezzi restano identici.
function toMm(v: string): number {
  return millimetriDaInput(v);
}

function areaMq(larghezzaMm: number, altezzaMm: number): number {
  return areaMetriQuadri(larghezzaMm, altezzaMm);
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
  // In modalità standard vale Colorazione ("standard"|"speciali"|"legno"),
  // in modalità promo vale una chiave di `modello.promo.colori`.
  const [colorazioneKey, setColorazioneKey] = useState<string>("standard");
  const [persiane, setPersiane] = useState<PersianaInput[]>([
    { id: uid(), larghezza: "", altezza: "" },
  ]);
  const [supplementiSel, setSupplementiSel] = useState<Set<string>>(new Set());
  const [centinaturaAnte, setCentinaturaAnte] = useState<string>("none");
  // Smontaggio / dismissione / posa — costo aggiuntivo fisso in € inserito
  // dall'operatore. Stringa per input controllato.
  const [smontaggio, setSmontaggio] = useState<string>("");
  // Aliquota IVA applicata sull'imponibile. 22% = nuova costruzione (default),
  // 10% = ristrutturazioni agevolate.
  const [iva, setIva] = useState<10 | 22>(22);

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
  const isPromo = !!modello?.promo;
  const promoColore = isPromo && modello
    ? getPromoColore(modello, colorazioneKey)
    : undefined;
  // Quando è attiva una promo i supplementi/colorazioni standard non si
  // applicano: trattiamo l'indexing legacy come "standard" per evitare
  // errori ma i valori vengono ignorati nel calc (supplementiDisponibili = []).
  const colorazione: Colorazione = isPromo
    ? "standard"
    : ((colorazioneKey as Colorazione) ?? "standard");
  const prezzoMq = isPromo
    ? promoColore?.prezzoMq ?? null
    : modello?.prezziMq[colorazione] ?? null;

  // Quando cambio modello: resetto la colorazione al primo valore valido del
  // nuovo modello (promo → primo colore promo, standard → "standard") e se il
  // modello promo ha `posaFissa` la forzo.
  useEffect(() => {
    if (!modello) return;
    if (modello.promo) {
      setColorazioneKey(modello.promo.colori[0]?.key ?? "standard");
      if (modello.promo.posaFissa) setPosa(modello.promo.posaFissa);
    } else {
      setColorazioneKey("standard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelloKey]);

  // Quando la colorazione cambia, alcuni supplementi non sono più disponibili.
  // In promo non ci sono supplementi applicabili.
  const supplementiDisponibili = useMemo(
    () =>
      isPromo
        ? []
        : SUPPLEMENTI.filter((s) => s.prezzi[colorazione] !== null),
    [colorazione, isPromo]
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

    const smontaggioEur =
      parseFloat(smontaggio.replace(",", ".")) || 0;

    // Ricarico promo: applicato sul prezzo base persiane (che in promo = area ×
    // prezzoMq colore promo). Non moltiplica supplementi/centinature/smontaggio.
    const ricaricoPct = isPromo
      ? modello?.promo?.ricaricoPercento ?? 0
      : 0;
    const ricaricoPromo = totaleBase * (ricaricoPct / 100);

    const imponibile =
      totaleBase +
      totaleSupplementi +
      centinaturaTotale +
      ricaricoPromo +
      smontaggioEur;
    const ivaImporto = imponibile * (iva / 100);
    const totale = imponibile + ivaImporto;

    return {
      perPersiana,
      suppAttivi,
      numPersiane,
      totaleBase,
      totaleSupplementi,
      centinaturaAnte: ante,
      centinaturaCostoUnitario,
      centinaturaTotale,
      smontaggioEur,
      totalePersiane,
      ricaricoPct,
      ricaricoPromo,
      imponibile,
      iva,
      ivaImporto,
      totale,
    };
  }, [
    persiane,
    prezzoMq,
    supplementiDisponibili,
    effettiveSelezioni,
    colorazione,
    centinaturaAnte,
    smontaggio,
    isPromo,
    modello,
    iva,
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
    setColorazioneKey("standard");
    setPersiane([{ id: uid(), larghezza: "", altezza: "" }]);
    setSupplementiSel(new Set());
    setCentinaturaAnte("none");
    setSmontaggio("");
    setIva(22);
    toast.success("Preventivo resettato");
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
      [
        "Colorazione",
        isPromo
          ? `${promoColore?.nome ?? "—"} (promo)`
          : COLORAZIONE_LABEL[colorazione],
      ],
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

    // Ricarico promo (se attivo) + Imponibile + IVA
    const breakdown: Array<[string, string]> = [];
    if (isPromo && calc.ricaricoPct > 0) {
      breakdown.push([
        `Ricarico promo (+${calc.ricaricoPct}%)`,
        EUR.format(calc.ricaricoPromo),
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
  const exportDisabled =
    !modello || calc.numPersiane === 0 || uploadPreventivo.isPending;
  const exportLabel = uploadPreventivo.isPending
    ? "Salvataggio…"
    : "Scarica PDF";

  // Onestà del totale: una riga senza misura utilizzabile vale zero dentro il
  // calcolo, quindi il totale che si vede è parziale. Va detto, non nascosto.
  const righeSenzaMisura = calc.perPersiana.filter((p) => p.areaMq <= 0).length;
  const righeNonIntere = persiane.filter(
    (p) =>
      (p.larghezza.trim() !== "" && millimetriValidi(p.larghezza) === null) ||
      (p.altezza.trim() !== "" && millimetriValidi(p.altezza) === null)
  ).length;
  const totaleParziale = righeSenzaMisura > 0 || calc.totale === 0;
  const commesse = commesseQuery.data ?? [];

  const statoAzione = uploadPreventivo.isPending
    ? `Salvataggio nella commessa ${selectedCommessa?.codice ?? ""}…`
    : righeSenzaMisura > 0
      ? `${righeSenzaMisura} ${
          righeSenzaMisura === 1 ? "persiana" : "persiane"
        } senza misure: il totale non è definitivo.`
      : selectedCommessa
        ? `Il PDF viene scaricato e salvato nella commessa ${selectedCommessa.codice} come ${buildFilename()}.`
        : "Il PDF viene solo scaricato: nessuna commessa collegata.";

  return (
    <div
      data-page="preventivatore-fivizzanese"
      className="min-w-0 max-w-6xl space-y-4 pb-2 sm:space-y-5"
    >
      <MobileFieldHeader
        eyebrow="Preventivatori"
        title="Fivizzanese · Persiane"
        description="Prezzo al m² per modello e colorazione, con supplementi, centinature e posa. Le misure si inseriscono in millimetri."
        backLabel="Torna ai preventivatori"
        onBack={() => setLocation("/preventivatori")}
        metadata={
          <>
            <span>
              {calc.numPersiane}{" "}
              {calc.numPersiane === 1 ? "persiana" : "persiane"} in preventivo
            </span>
            <span>
              {prezzoMq ? `${EUR.format(prezzoMq)}/m²` : "Prezzo non a listino"}
            </span>
          </>
        }
        status={
          isPromo ? (
            <Badge variant="warning">Promo attiva</Badge>
          ) : (
            <Badge variant="outline">Listino standard</Badge>
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
                  disabled={
                    !!modello?.promo?.posaFissa &&
                    modello.promo.posaFissa !== "cardini"
                  }
                  hint={
                    modello?.promo?.posaFissa === "cardini" ? "promo" : undefined
                  }
                />
                <OpzioneTile
                  value="telaio"
                  label="Su telaio"
                  current={posa}
                  disabled={
                    !!modello?.promo?.posaFissa &&
                    modello.promo.posaFissa !== "telaio"
                  }
                  hint={
                    modello?.promo?.posaFissa === "telaio" ? "promo" : undefined
                  }
                />
              </RadioGroup>
              {modello?.promo?.posaFissa ? (
                <p className="text-xs text-text-3">
                  Il modello in promozione forza la posa{" "}
                  {POSA_LABEL[modello.promo.posaFissa].toLowerCase()}.
                </p>
              ) : null}
            </div>
          </DataSurface>

          <DataSurface
            id="preventivo-misure"
            density="compact"
            tone="default"
            title="Misure"
            description="Una scheda per persiana, larghezza e altezza in millimetri. L'area si aggiorna mentre scrivi."
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
                const area = areaMq(toMm(p.larghezza), toMm(p.altezza));
                const larghezzaNonIntera =
                  p.larghezza.trim() !== "" &&
                  millimetriValidi(p.larghezza) === null;
                const altezzaNonIntera =
                  p.altezza.trim() !== "" && millimetriValidi(p.altezza) === null;
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
                        </Label>
                        <Input
                          id={`larghezza-${p.id}`}
                          inputMode="numeric"
                          placeholder="1200"
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
                        </Label>
                        <Input
                          id={`altezza-${p.id}`}
                          inputMode="numeric"
                          placeholder="1500"
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

                    <p className="mt-2 text-xs text-text-3">
                      {area > 0 ? (
                        <span className="text-text-2">
                          Area{" "}
                          <strong className="tabular-nums text-text-1">
                            {MQ.format(area)} m²
                          </strong>
                        </span>
                      ) : (
                        "Senza entrambe le misure questa persiana non entra nel totale."
                      )}
                    </p>
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
            </div>
          </DataSurface>

          <DataSurface
            id="preventivo-configurazione"
            density="compact"
            tone="default"
            title="Configurazione"
            description="Modello, colorazione e voci accessorie del listino Fivizzanese."
          >
            <BloccoCampi
              titolo="Modello e colorazione"
              descrizione={
                prezzoMq
                  ? `Prezzo applicato: ${EUR.format(prezzoMq)}/m².`
                  : "Nessun prezzo a listino per questa combinazione."
              }
            >
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="modello" className="text-xs font-semibold">
                  Modello persiana
                </Label>
                <Select value={modelloKey} onValueChange={setModelloKey}>
                  <SelectTrigger id="modello" className="min-h-11 w-full">
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

              {isPromo && modello?.promo ? (
                <div className="min-w-0 space-y-2">
                  <p className="text-xs font-semibold text-text-1">
                    Colore in promozione
                  </p>
                  <RadioGroup
                    value={colorazioneKey}
                    onValueChange={setColorazioneKey}
                    className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
                  >
                    {modello.promo.colori.map((c) => (
                      <OpzioneTile
                        key={c.key}
                        value={c.key}
                        label={c.nome}
                        current={colorazioneKey}
                        hint={`${EUR.format(c.prezzoMq)}/m²`}
                      />
                    ))}
                  </RadioGroup>
                  {/* Copy stabile della promozione: non è uno stato che cambia
                      sotto le dita, quindi resta un paragrafo normale. */}
                  <p className="rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
                    {modello.promo.note ??
                      "Promozione temporanea sul modello selezionato."}
                  </p>
                </div>
              ) : (
                <div className="min-w-0 space-y-2">
                  <p className="text-xs font-semibold text-text-1">
                    Colorazione
                  </p>
                  <RadioGroup
                    value={colorazioneKey}
                    onValueChange={setColorazioneKey}
                    className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3"
                  >
                    {(["standard", "speciali", "legno"] as Colorazione[]).map(
                      (c) => (
                        <OpzioneTile
                          key={c}
                          value={c}
                          label={COLORAZIONE_LABEL[c]}
                          current={colorazioneKey}
                        />
                      )
                    )}
                  </RadioGroup>
                </div>
              )}
            </BloccoCampi>

            {isPromo ? (
              <BloccoCampi
                titolo="Supplementi e centinature"
                descrizione="Non applicabili al modello in promozione: il prezzo al m² del colore li comprende già."
              >
                <p className="text-xs text-text-3">
                  Cambia modello per tornare al listino standard con supplementi
                  e centinature.
                </p>
              </BloccoCampi>
            ) : (
              <>
                <BloccoCampi
                  titolo="Supplementi opzionali"
                  descrizione="Si applicano a ogni persiana del preventivo."
                >
                  {supplementiDisponibili.length === 0 ? (
                    <p className="text-xs text-text-3">
                      Nessun supplemento a listino per questa colorazione.
                    </p>
                  ) : (
                    <div className="min-w-0 space-y-2">
                      {supplementiDisponibili.map((s) => (
                        <SupplementoRow
                          key={s.key}
                          supp={s}
                          colorazione={colorazione}
                          checked={effettiveSelezioni.has(s.key)}
                          onToggle={() => toggleSupplemento(s.key)}
                        />
                      ))}
                    </div>
                  )}
                  {SUPPLEMENTI.filter((s) => s.prezzi[colorazione] === null)
                    .length > 0 ? (
                    <p className="text-xs text-text-3">
                      Non a listino per la colorazione{" "}
                      <span className="font-semibold text-text-2">
                        {COLORAZIONE_LABEL[colorazione]}
                      </span>
                      :{" "}
                      {SUPPLEMENTI.filter(
                        (s) => s.prezzi[colorazione] === null
                      )
                        .map((s) => s.nome)
                        .join(", ")}
                      .
                    </p>
                  ) : null}
                </BloccoCampi>

                <BloccoCampi
                  titolo="Centinature"
                  descrizione="Lavorazione speciale applicata a tutte le persiane del preventivo."
                >
                  <div className="min-w-0 space-y-1.5">
                    <Label
                      htmlFor="centinatura"
                      className="text-xs font-semibold"
                    >
                      Ante centinate
                    </Label>
                    <Select
                      value={centinaturaAnte}
                      onValueChange={setCentinaturaAnte}
                    >
                      <SelectTrigger
                        id="centinatura"
                        className="min-h-11 w-full"
                      >
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
                    {calc.centinaturaAnte ? (
                      <p className="text-xs text-text-3">
                        {EUR.format(calc.centinaturaCostoUnitario)} ×{" "}
                        {calc.numPersiane}{" "}
                        {calc.numPersiane === 1 ? "persiana" : "persiane"} ={" "}
                        {EUR.format(calc.centinaturaTotale)}
                      </p>
                    ) : null}
                  </div>
                </BloccoCampi>
              </>
            )}

            <BloccoCampi
              titolo="Smontaggio, dismissione e posa"
              descrizione="Importo fisso in euro sommato all'imponibile. Lascia vuoto se non applicabile."
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
            description="Un solo calcolo, quello del listino Fivizzanese: qui non si somma nulla di nuovo."
          >
            <div className="min-w-0 space-y-3">
              <RigaRiepilogo etichetta="Posa" valore={POSA_LABEL[posa]} />
              <RigaRiepilogo etichetta="Modello" valore={modello?.nome ?? "—"} />
              <RigaRiepilogo
                etichetta="Colorazione"
                valore={
                  isPromo
                    ? `${promoColore?.nome ?? "—"} (promo)`
                    : COLORAZIONE_LABEL[colorazione]
                }
              />

              <div className="min-w-0 space-y-2 border-t border-on-focal/20 pt-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-on-focal/75">
                  Persiane
                </p>
                {calc.perPersiana.map((p, i) => (
                  <RigaRiepilogo
                    key={p.id}
                    etichetta={
                      p.areaMq > 0
                        ? `#${i + 1} · ${p.larghezzaMm}×${p.altezzaMm} mm · ${MQ.format(p.areaMq)} m²`
                        : `#${i + 1} · misure mancanti`
                    }
                    valore={p.areaMq > 0 ? EUR.format(p.prezzoBase) : "—"}
                  />
                ))}
                <RigaRiepilogo
                  etichetta="Totale base"
                  valore={EUR.format(calc.totaleBase)}
                />
              </div>

              {calc.suppAttivi.length > 0 ? (
                <div className="min-w-0 space-y-2 border-t border-on-focal/20 pt-3">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-on-focal/75">
                    Supplementi
                  </p>
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
                      <RigaRiepilogo
                        key={s.key}
                        etichetta={s.nome}
                        valore={EUR.format(tot)}
                      />
                    );
                  })}
                  <RigaRiepilogo
                    etichetta="Totale supplementi"
                    valore={EUR.format(calc.totaleSupplementi)}
                  />
                </div>
              ) : null}

              <div className="min-w-0 space-y-2 border-t border-on-focal/20 pt-3">
                {calc.centinaturaAnte ? (
                  <RigaRiepilogo
                    etichetta={`Centinature ${calc.centinaturaAnte} ${
                      calc.centinaturaAnte === 1 ? "anta" : "ante"
                    }`}
                    valore={EUR.format(calc.centinaturaTotale)}
                  />
                ) : null}
                {calc.smontaggioEur > 0 ? (
                  <RigaRiepilogo
                    etichetta="Smontaggio, dismissione e posa"
                    valore={EUR.format(calc.smontaggioEur)}
                  />
                ) : null}
                {isPromo && calc.ricaricoPct > 0 ? (
                  <RigaRiepilogo
                    etichetta={`Ricarico promo (+${calc.ricaricoPct}%)`}
                    valore={EUR.format(calc.ricaricoPromo)}
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
                  etichetta="Totale (IVA inclusa)"
                  valore={calc.totale === 0 ? "—" : EUR.format(calc.totale)}
                />
                {/* Il riepilogo si legge, non si annuncia: l'unico annuncio
                    resta quello della barra azioni, per non moltiplicare le
                    live region su una pagina che cambia a ogni tasto. */}
                {totaleParziale ? (
                  <p className="mt-2 rounded-[var(--radius-control)] border border-on-focal/25 bg-on-focal/10 px-3 py-2 text-xs leading-5 text-on-focal">
                    {calc.totale === 0
                      ? "Nessuna misura valida: non c'è ancora un preventivo da mostrare."
                      : `Totale parziale: ${righeSenzaMisura} ${
                          righeSenzaMisura === 1 ? "persiana" : "persiane"
                        } senza misure non entrano nel calcolo.`}
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
  disabled,
  hint,
}: {
  value: string;
  label: string;
  current: string;
  disabled?: boolean;
  hint?: string;
}) {
  const selected = current === value;
  return (
    <Label
      className={cn(
        "flex min-h-12 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border p-3 transition-colors md:min-h-11",
        disabled
          ? "cursor-not-allowed border-border-soft bg-surface-2 opacity-60"
          : selected
            ? "cursor-pointer border-primary bg-brand-soft text-brand-soft-ink"
            : "cursor-pointer border-border-soft bg-surface hover:bg-surface-2"
      )}
    >
      <RadioGroupItem value={value} disabled={disabled} />
      <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
      {hint ? (
        <span className="shrink-0 text-xs text-text-3">{hint}</span>
      ) : null}
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
      className={cn(
        "flex min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border p-3 transition-colors md:min-h-11",
        checked
          ? "border-primary bg-brand-soft text-brand-soft-ink"
          : "border-border-soft bg-surface hover:bg-surface-2"
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight">
          {supp.nome}
        </span>
        <span className="block text-xs text-text-3">
          {supp.unita === "mq" ? "€/m²" : "€/cad"}
        </span>
      </span>
      <span className="shrink-0 text-sm tabular-nums">
        {EUR.format(prezzo)}
      </span>
    </label>
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
