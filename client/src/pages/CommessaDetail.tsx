import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  ArrowLeft,
  Plus,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Hammer,
  FileText,
  Contact,
  Trash2,
  ChevronRight,
  Pencil,
  Upload,
  Download,
  File as FileIcon,
  CheckCircle2,
  Clock,
  UserPlus,
  Eye,
  Send,
  Package,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import TimelineOrdine from "@/components/TimelineOrdine";
import SearchSelect from "@/components/SearchSelect";

const tipoDocColors: Record<string, string> = {
  preventivo: "bg-blue-100 text-blue-800",
  contratto: "bg-green-100 text-green-800",
  misure: "bg-sky-100 text-sky-800",
  fattura: "bg-amber-100 text-amber-800",
  ordine: "bg-yellow-100 text-yellow-800",
  conferma_ordine: "bg-yellow-100 text-yellow-800",
  ddt_consegna: "bg-orange-100 text-orange-800",
  ddt_posa: "bg-orange-100 text-orange-800",
  ddt_finale: "bg-teal-100 text-teal-800",
  saldo: "bg-purple-100 text-purple-800",
  foto: "bg-pink-100 text-pink-800",
  altro: "bg-slate-100 text-slate-700",
};

const DOC_TIPO_LABEL: Record<string, string> = {
  preventivo: "Preventivo",
  contratto: "Contratto",
  misure: "Misure esecutive",
  fattura: "Fattura",
  ordine: "Ordine fornitore",
  conferma_ordine: "Conferma ordine",
  ddt_consegna: "DDT consegna",
  ddt_posa: "DDT posa",
  ddt_finale: "DDT finale",
  saldo: "Ricevuta saldo",
  foto: "Foto",
  altro: "Altro",
};

// Mirror of REQUIRED_DOC_TIPI_PER_STATO on the server — used to hint the
// user which doc tipo they should upload for the current state.
const SUGGESTED_TIPO_FOR_STATO: Record<string, string> = {
  preventivo: "preventivo",
  misure_esecutive: "misure",
  aggiornamento_contratto: "contratto",
  fatture_pagamento: "fattura",
  da_ordinare: "ordine",
  ordini_ultimazione: "saldo",
  attesa_posa: "ddt_consegna",
  finiture_saldo: "ddt_posa",
  interventi_regolazioni: "ddt_finale",
};

export default function CommessaDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const commessaId = parseInt(params.id ?? "0");

  const commessa = trpc.commesse.byId.useQuery(commessaId);
  const documenti = trpc.preventiviContratti.byCommessa.useQuery(commessaId);
  const statoGate = trpc.preventiviContratti.statoGate.useQuery(commessaId);
  const interventi = trpc.interventi.list.useQuery({ commessaId });
  const anomalie = trpc.anomalie.list.useQuery({ commessaId });
  const squadre = trpc.squadre.list.useQuery();
  const utenti = trpc.utenti.list.useQuery(undefined);

  const utils = trpc.useUtils();
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: number; label: string } | null>(null);
  const [interventoDialog, setInterventoDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [consegnaDialog, setConsegnaDialog] = useState(false);
  const [uploadDialog, setUploadDialog] = useState(false);

  const [interventoForm, setInterventoForm] = useState({
    tipo: "posa" as string,
    dataPianificata: "",
    squadraId: "" as string,
    indirizzo: "",
    note: "",
  });

  const [editForm, setEditForm] = useState({
    indirizzo: "",
    citta: "",
    telefono: "",
    email: "",
    priorita: "media" as "bassa" | "media" | "alta" | "urgente",
    consegnaIndicativa: "60" as "30" | "60" | "90",
    note: "",
  });

  const [consegnaDate, setConsegnaDate] = useState("");

  const [uploadForm, setUploadForm] = useState({
    file: null as File | null,
    tipo: "preventivo" as string,
    note: "",
  });

  // Nuovo cliente inline
  const [nuovoClienteDialog, setNuovoClienteDialog] = useState(false);
  const [clienteForm, setClienteForm] = useState({
    nome: "",
    cognome: "",
    tipo: "privato" as "privato" | "azienda" | "condominio" | "ente_pubblico",
    telefono: "",
    email: "",
    indirizzo: "",
    citta: "",
  });

  // Prodotti desiderati
  const [prodottoDialog, setProdottoDialog] = useState(false);
  const [editingProdottoId, setEditingProdottoId] = useState<number | null>(null);
  const [prodottoForm, setProdottoForm] = useState({
    nome: "",
    tipologia: "",
    quantita: 1,
    dimensioni: "",
    note: "",
  });

  // PDF / image preview
  const [previewDoc, setPreviewDoc] = useState<{
    id: number;
    nome: string;
    mimeType: string;
    url: string;
  } | null>(null);

  // Email preventivo (mailto)
  const [emailDoc, setEmailDoc] = useState<any | null>(null);
  const [emailForm, setEmailForm] = useState({ to: "", subject: "", body: "" });

  const deleteIntervento = trpc.interventi.delete.useMutation({
    onSuccess: () => { utils.interventi.list.invalidate(); setDeleteTarget(null); },
  });
  const deleteDocumento = trpc.preventiviContratti.delete.useMutation({
    onSuccess: () => {
      utils.preventiviContratti.invalidate();
      setDeleteTarget(null);
    },
  });
  const createIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.list.invalidate();
      setInterventoDialog(false);
      setInterventoForm({ tipo: "posa", dataPianificata: "", squadraId: "", indirizzo: "", note: "" });
    },
  });
  const updateCommessa = trpc.commesse.update.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      setEditDialog(false);
    },
  });
  const confermaDataConsegna = trpc.commesse.confermaDataConsegna.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      setConsegnaDialog(false);
      setConsegnaDate("");
    },
  });
  const uploadDocumento = trpc.preventiviContratti.upload.useMutation({
    onSuccess: () => {
      utils.preventiviContratti.invalidate();
      setUploadDialog(false);
      setUploadForm({ file: null, tipo: "preventivo", note: "" });
    },
  });
  const deleteCommessa = trpc.commesse.delete.useMutation({
    onSuccess: () => { setDeleteTarget(null); setLocation("/commesse"); },
  });

  // Nuovo cliente dalla commessa: creates cliente, then links it on commessa.
  const createCliente = trpc.clienti.create.useMutation({
    onSuccess: (cliente) => {
      updateCommessa.mutate({
        id: commessaId,
        clienteId: cliente.id,
        cliente: `${cliente.nome} ${cliente.cognome}`.trim(),
        telefono: cliente.telefono || undefined,
        email: cliente.email || undefined,
        indirizzo: cliente.indirizzo || undefined,
        citta: cliente.citta || undefined,
      });
      setNuovoClienteDialog(false);
      setClienteForm({
        nome: "", cognome: "", tipo: "privato",
        telefono: "", email: "", indirizzo: "", citta: "",
      });
    },
  });

  const addProdotto = trpc.commesse.addProdotto.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      setProdottoDialog(false);
      setEditingProdottoId(null);
      setProdottoForm({ nome: "", tipologia: "", quantita: 1, dimensioni: "", note: "" });
    },
  });
  const updateProdotto = trpc.commesse.updateProdotto.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      setProdottoDialog(false);
      setEditingProdottoId(null);
      setProdottoForm({ nome: "", tipologia: "", quantita: 1, dimensioni: "", note: "" });
    },
  });
  const removeProdotto = trpc.commesse.removeProdotto.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      setDeleteTarget(null);
    },
  });

  // Revoke object URL when preview dialog closes (avoid memory leaks).
  useEffect(() => {
    return () => {
      if (previewDoc?.url) URL.revokeObjectURL(previewDoc.url);
    };
  }, [previewDoc?.url]);

  function openEdit() {
    if (!commessa.data) return;
    const c: any = commessa.data;
    setEditForm({
      indirizzo: c.indirizzo ?? "",
      citta: c.citta ?? "",
      telefono: c.telefono ?? "",
      email: c.email ?? "",
      priorita: c.priorita ?? "media",
      consegnaIndicativa: c.consegnaIndicativa ?? "60",
      note: c.note ?? "",
    });
    setEditDialog(true);
  }

  async function handleUpload() {
    if (!uploadForm.file) return;
    const file = uploadForm.file;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      uploadDocumento.mutate({
        commessaId,
        nome: file.name,
        tipo: uploadForm.tipo as any,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataBase64: base64,
        note: uploadForm.note || undefined,
      });
    };
    reader.readAsDataURL(file);
  }

  function docToBlobUrl(doc: any): string {
    const byteChars = atob(doc.dataBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: doc.mimeType });
    return URL.createObjectURL(blob);
  }

  function downloadDocumento(docId: number) {
    utils.preventiviContratti.byId.fetch(docId).then((doc: any) => {
      if (!doc?.dataBase64) return;
      const url = docToBlobUrl(doc);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.nome;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function openPreview(docId: number) {
    utils.preventiviContratti.byId.fetch(docId).then((doc: any) => {
      if (!doc?.dataBase64) return;
      const url = docToBlobUrl(doc);
      setPreviewDoc({ id: doc.id, nome: doc.nome, mimeType: doc.mimeType, url });
    });
  }

  function openEmailDialog(doc: any) {
    // Preset subject + body. User's mail client opens with fields prefilled;
    // PDF is auto-downloaded so they can attach manually (mailto has no
    // attachment spec).
    const codice = c.codice ?? "";
    const clienteLabel = c.cliente ?? "";
    const subject = `${doc.tipo === "contratto" ? "Contratto" : "Preventivo"} ${codice}`;
    const body = [
      `Gentile ${clienteLabel},`,
      ``,
      `in allegato trovera' il ${doc.tipo} relativo alla commessa ${codice}.`,
      `Restiamo a disposizione per qualsiasi chiarimento.`,
      ``,
      `Cordiali saluti`,
    ].join("\n");
    setEmailForm({ to: c.email ?? "", subject, body });
    setEmailDoc(doc);
  }

  // Encoding helper — URLSearchParams uses + for spaces, but mailto expects
  // %20 in the body. Also encodes newlines as %0A which mail clients honor.
  function encodeForMailto(value: string): string {
    return encodeURIComponent(value).replace(/'/g, "%27");
  }

  // Primary send: mailto link. On Windows this only works if the user has a
  // default mail handler registered (Outlook desktop, Thunderbird, or Outlook
  // Web via protocol handler). We use an anchor click instead of
  // `window.location.href` because some browsers (Edge/Chrome on Win) swallow
  // the protocol navigation silently otherwise.
  function sendEmail() {
    if (!emailDoc) return;
    downloadDocumento(emailDoc.id);
    const to = encodeForMailto(emailForm.to);
    const subject = encodeForMailto(emailForm.subject);
    const body = encodeForMailto(emailForm.body);
    const href = `mailto:${to}?subject=${subject}&body=${body}`;
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    a.target = "_self";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setEmailDoc(null);
  }

  // Windows fallback #1: Outlook on the Web (works with any Microsoft 365 /
  // outlook.com account — opens compose prefilled in a new tab).
  function sendViaOutlookWeb() {
    if (!emailDoc) return;
    downloadDocumento(emailDoc.id);
    const to = encodeURIComponent(emailForm.to);
    const subject = encodeURIComponent(emailForm.subject);
    const body = encodeURIComponent(emailForm.body);
    const href = `https://outlook.office.com/mail/deeplink/compose?to=${to}&subject=${subject}&body=${body}`;
    window.open(href, "_blank", "noopener,noreferrer");
    setEmailDoc(null);
  }

  // Windows fallback #2: Gmail compose (works for any google account).
  function sendViaGmail() {
    if (!emailDoc) return;
    downloadDocumento(emailDoc.id);
    const to = encodeURIComponent(emailForm.to);
    const subject = encodeURIComponent(emailForm.subject);
    const body = encodeURIComponent(emailForm.body);
    const href = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;
    window.open(href, "_blank", "noopener,noreferrer");
    setEmailDoc(null);
  }

  // Windows/Outlook-desktop path: download an .eml (RFC 822 multipart/mixed)
  // with the doc bundled as attachment and X-Unsent:1 so Outlook opens it as a
  // new draft ready to send. Double-clicking the file launches Outlook with
  // recipient, subject, body and attachment all prefilled — no manual attach.
  function sendViaEmlDownload() {
    if (!emailDoc) return;
    utils.preventiviContratti.byId.fetch(emailDoc.id).then((doc: any) => {
      if (!doc?.dataBase64) return;
      const CRLF = "\r\n";
      const BOUNDARY = "=_bnd_" + Math.random().toString(36).slice(2, 12);
      // UTF-8 safe btoa via percent-encoding round-trip.
      const b64utf8 = (s: string) =>
        btoa(unescape(encodeURIComponent(s)));
      const chunk76 = (s: string) =>
        s.replace(/[\r\n]/g, "").match(/.{1,76}/g)?.join(CRLF) ?? "";
      const encSubject = `=?UTF-8?B?${b64utf8(emailForm.subject)}?=`;
      const bodyB64 = chunk76(b64utf8(emailForm.body));
      const attachB64 = chunk76(doc.dataBase64);
      const safeName = (doc.nome as string).replace(/"/g, "_");
      const eml = [
        "From: ",
        `To: ${emailForm.to}`,
        `Subject: ${encSubject}`,
        `Date: ${new Date().toUTCString()}`,
        "X-Unsent: 1",
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${BOUNDARY}"`,
        "",
        `--${BOUNDARY}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        bodyB64,
        "",
        `--${BOUNDARY}`,
        `Content-Type: ${doc.mimeType ?? "application/octet-stream"}; name="${safeName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${safeName}"`,
        "",
        attachB64,
        "",
        `--${BOUNDARY}--`,
        "",
      ].join(CRLF);
      const blob = new Blob([eml], { type: "message/rfc822" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${emailForm.subject || "messaggio"}.eml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setEmailDoc(null);
    });
  }

  // Last resort: copy full message to clipboard so user can paste anywhere.
  async function copyEmailToClipboard() {
    const text = [
      `A: ${emailForm.to}`,
      `Oggetto: ${emailForm.subject}`,
      ``,
      emailForm.body,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers / non-https contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    if (emailDoc) downloadDocumento(emailDoc.id);
  }

  function openProdottoEdit(p: any) {
    setEditingProdottoId(p.id);
    setProdottoForm({
      nome: p.nome ?? "",
      tipologia: p.tipologia ?? "",
      quantita: p.quantita ?? 1,
      dimensioni: p.dimensioni ?? "",
      note: p.note ?? "",
    });
    setProdottoDialog(true);
  }

  function saveProdotto() {
    if (editingProdottoId) {
      updateProdotto.mutate({
        commessaId,
        prodottoId: editingProdottoId,
        nome: prodottoForm.nome,
        tipologia: prodottoForm.tipologia || null,
        quantita: prodottoForm.quantita,
        dimensioni: prodottoForm.dimensioni || null,
        note: prodottoForm.note || null,
      });
    } else {
      addProdotto.mutate({
        commessaId,
        nome: prodottoForm.nome,
        tipologia: prodottoForm.tipologia || undefined,
        quantita: prodottoForm.quantita,
        dimensioni: prodottoForm.dimensioni || undefined,
        note: prodottoForm.note || undefined,
      });
    }
  }

  const c: any = commessa.data;
  if (!c) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {commessa.isLoading ? "Caricamento..." : "Commessa non trovata"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/commesse")}
          className="mb-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Commesse
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-muted-foreground">
                {c.codice}
              </span>
              <Badge variant="secondary" className="text-xs uppercase">
                {c.stato.replace(/_/g, " ")}
              </Badge>
              {c.priorita === "urgente" && (
                <Badge variant="destructive" className="text-xs">
                  URGENTE
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{c.cliente}</h1>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {c.clienteId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/clienti/${c.clienteId}`)}
              >
                <Contact className="h-3.5 w-3.5 mr-1" />
                Scheda cliente
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNuovoClienteDialog(true)}
              >
                <UserPlus className="h-3.5 w-3.5 mr-1" />
                Nuovo cliente
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Modifica
            </Button>
            {c.stato !== "archiviata" && (() => {
              const next: Record<string, string> = {
                preventivo: "misure_esecutive", misure_esecutive: "aggiornamento_contratto",
                aggiornamento_contratto: "fatture_pagamento", fatture_pagamento: "da_ordinare",
                da_ordinare: "produzione", produzione: "ordini_ultimazione",
                ordini_ultimazione: "attesa_posa", attesa_posa: "finiture_saldo",
                finiture_saldo: "interventi_regolazioni", interventi_regolazioni: "archiviata",
              };
              const nextStato = next[c.stato];
              const gateBlocked = statoGate.data ? !statoGate.data.canAdvance : false;
              return nextStato ? (
                <Button
                  size="sm"
                  onClick={() => updateCommessa.mutate({ id: commessaId, stato: nextStato as any })}
                  disabled={updateCommessa.isPending || gateBlocked}
                  title={
                    gateBlocked
                      ? `Carica prima un file di tipo ${(statoGate.data?.required ?? [])
                          .filter((r) => !r.satisfied)
                          .map((r) => r.label)
                          .join(" o ")}`
                      : undefined
                  }
                >
                  <ChevronRight className="h-3.5 w-3.5 mr-1" />
                  {nextStato.replace(/_/g, " ")}
                </Button>
              ) : null;
            })()}
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:bg-red-50"
              onClick={() => setDeleteTarget({ type: "commessa", id: commessaId, label: c.codice })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Info pills */}
        <div className="flex gap-4 flex-wrap mt-3 text-sm text-muted-foreground">
          {c.indirizzo && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {c.indirizzo}{c.citta ? `, ${c.citta}` : ""}
            </span>
          )}
          {c.telefono && (
            <span className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" />
              {c.telefono}
            </span>
          )}
          {c.email && (
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              {c.email}
            </span>
          )}
          {c.dataConsegnaConfermata ? (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              Data consegna prevista: {new Date(c.dataConsegnaConfermata).toLocaleDateString("it-IT")}
            </span>
          ) : c.consegnaIndicativa ? (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              Consegna indicativa: +{c.consegnaIndicativa} giorni
            </span>
          ) : null}
        </div>
        {c.note && (
          <p className="text-sm text-muted-foreground mt-2 border-l-2 pl-3">
            {c.note}
          </p>
        )}

        {/* Produzione trigger: ask for delivery date confirmation */}
        {c.stato === "produzione" && !c.dataConsegnaConfermata && (
          <Card className="mt-4 border-amber-300 bg-amber-50/50">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Commessa in produzione</p>
                  <p className="text-xs text-muted-foreground">
                    Aggiorna la data di consegna prevista per finalizzare lo stato
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={() => setConsegnaDialog(true)}>
                <Calendar className="h-3.5 w-3.5 mr-1" />
                Aggiorna data consegna
              </Button>
            </CardContent>
          </Card>
        )}

        {/* File gate banner: shows required doc tipi for current stato and
            blocks forward transitions until at least one is uploaded. */}
        {statoGate.data && statoGate.data.required.length > 0 && (
          <Card
            className={
              statoGate.data.canAdvance
                ? "mt-4 border-emerald-300 bg-emerald-50/50"
                : "mt-4 border-amber-300 bg-amber-50/50"
            }
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {statoGate.data.canAdvance ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="text-sm font-semibold">
                      {statoGate.data.canAdvance
                        ? "Documenti richiesti caricati"
                        : "Documenti richiesti per avanzare"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {statoGate.data.canAdvance
                        ? "Puoi avanzare la commessa allo stato successivo."
                        : "Carica almeno uno dei file richiesti per sbloccare l'avanzamento."}
                    </p>
                  </div>
                </div>
                {!statoGate.data.canAdvance && (
                  <Button
                    size="sm"
                    onClick={() => {
                      const missing = statoGate.data!.required.find((r) => !r.satisfied);
                      if (missing) {
                        setUploadForm((prev) => ({ ...prev, tipo: missing.tipo }));
                      }
                      setUploadDialog(true);
                    }}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1" />
                    Carica file
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pl-8">
                {statoGate.data.required.map((r) => (
                  <Badge
                    key={r.tipo}
                    variant="outline"
                    className={
                      r.satisfied
                        ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                        : "border-amber-400 bg-amber-100 text-amber-800"
                    }
                  >
                    {r.satisfied ? (
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 mr-1" />
                    )}
                    {r.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Hoisted timeline: prominent above the tabs (Feat 2). */}
      <TimelineOrdine commessaId={commessaId} />

      {/* Tabs */}
      <Tabs defaultValue="preventivi">
        <TabsList>
          <TabsTrigger value="preventivi">
            Preventivi / Contratti ({documenti.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="prodotti">
            Prodotti ({(c.prodotti?.length ?? 0)})
          </TabsTrigger>
          <TabsTrigger value="interventi">
            Interventi ({interventi.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="anomalie">
            Anomalie ({anomalie.data?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* Preventivi/Contratti Tab */}
        <TabsContent value="preventivi" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog
              open={uploadDialog}
              onOpenChange={(open) => {
                setUploadDialog(open);
                if (open) {
                  // Preset tipo to the state-required document when the user
                  // opens the upload dialog — one less click in 90% of cases.
                  const suggested = SUGGESTED_TIPO_FOR_STATO[c.stato];
                  if (suggested) {
                    setUploadForm((prev) => ({ ...prev, tipo: suggested }));
                  }
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm">
                  <Upload className="h-4 w-4 mr-1" />
                  Carica file
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Carica file</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="space-y-1.5">
                    <Label>Tipo documento</Label>
                    <Select
                      value={uploadForm.tipo}
                      onValueChange={(v: any) => setUploadForm({ ...uploadForm, tipo: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="preventivo">Preventivo</SelectItem>
                        <SelectItem value="contratto">Contratto</SelectItem>
                        <SelectItem value="misure">Misure esecutive</SelectItem>
                        <SelectItem value="fattura">Fattura</SelectItem>
                        <SelectItem value="ordine">Ordine fornitore</SelectItem>
                        <SelectItem value="conferma_ordine">Conferma ordine</SelectItem>
                        <SelectItem value="ddt_consegna">DDT consegna</SelectItem>
                        <SelectItem value="ddt_posa">DDT posa</SelectItem>
                        <SelectItem value="ddt_finale">DDT finale</SelectItem>
                        <SelectItem value="saldo">Ricevuta saldo</SelectItem>
                        <SelectItem value="foto">Foto</SelectItem>
                        <SelectItem value="altro">Altro</SelectItem>
                      </SelectContent>
                    </Select>
                    {SUGGESTED_TIPO_FOR_STATO[c.stato] && uploadForm.tipo === SUGGESTED_TIPO_FOR_STATO[c.stato] && (
                      <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                        Tipo suggerito per lo stato corrente — caricando questo file si sbloccher&agrave; l&apos;avanzamento
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>File (max 10MB)</Label>
                    <Input
                      type="file"
                      onChange={(e) =>
                        setUploadForm({
                          ...uploadForm,
                          file: e.target.files?.[0] ?? null,
                        })
                      }
                    />
                    {uploadForm.file && (
                      <p className="text-xs text-muted-foreground">
                        {uploadForm.file.name} — {(uploadForm.file.size / 1024).toFixed(1)} KB
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Note</Label>
                    <Textarea
                      rows={2}
                      value={uploadForm.note}
                      onChange={(e) => setUploadForm({ ...uploadForm, note: e.target.value })}
                    />
                  </div>
                  <Button
                    onClick={handleUpload}
                    disabled={!uploadForm.file || uploadDocumento.isPending}
                  >
                    {uploadDocumento.isPending ? "Caricamento..." : "Carica"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {documenti.data?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessun documento caricato. Carica preventivi, contratti o foto.
            </div>
          ) : (
            <div className="grid gap-2">
              {documenti.data?.map((d: any) => (
                <Card key={d.id}>
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{d.nome}</span>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${tipoDocColors[d.tipo] ?? ""}`}
                          >
                            {d.tipo}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{(d.size / 1024).toFixed(1)} KB</span>
                          <span>{new Date(d.createdAt).toLocaleDateString("it-IT")}</span>
                        </div>
                        {d.note && (
                          <p className="text-xs text-muted-foreground mt-1">{d.note}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {(d.mimeType === "application/pdf" || d.mimeType?.startsWith("image/")) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Anteprima"
                          onClick={() => openPreview(d.id)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {(d.tipo === "preventivo" || d.tipo === "contratto") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          title="Invia via email"
                          onClick={() => openEmailDialog(d)}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Scarica"
                        onClick={() => downloadDocumento(d.id)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteTarget({ type: "documento", id: d.id, label: d.nome })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Prodotti Tab */}
        <TabsContent value="prodotti" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                setEditingProdottoId(null);
                setProdottoForm({ nome: "", tipologia: "", quantita: 1, dimensioni: "", note: "" });
                setProdottoDialog(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Aggiungi prodotto
            </Button>
          </div>
          {(c.prodotti?.length ?? 0) === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessun prodotto desiderato. Aggiungi i prodotti richiesti dal cliente.
            </div>
          ) : (
            <div className="grid gap-2">
              {c.prodotti?.map((p: any) => (
                <Card key={p.id}>
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Package className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{p.nome}</span>
                          {p.tipologia && (
                            <Badge variant="secondary" className="text-[10px]">
                              {p.tipologia}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            x{p.quantita}
                          </Badge>
                        </div>
                        {p.dimensioni && (
                          <p className="text-xs text-muted-foreground mt-0.5">{p.dimensioni}</p>
                        )}
                        {p.note && (
                          <p className="text-xs text-muted-foreground mt-1">{p.note}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openProdottoEdit(p)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteTarget({ type: "prodotto", id: p.id, label: p.nome })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Interventi Tab */}
        <TabsContent value="interventi" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={interventoDialog} onOpenChange={setInterventoDialog}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Nuovo intervento
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nuovo intervento</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Tipo *</Label>
                      <Select value={interventoForm.tipo} onValueChange={(v) => setInterventoForm({ ...interventoForm, tipo: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rilievo">Rilievo</SelectItem>
                          <SelectItem value="posa">Posa</SelectItem>
                          <SelectItem value="assistenza">Assistenza</SelectItem>
                          <SelectItem value="altro">Altro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Data pianificata</Label>
                      <Input type="date" value={interventoForm.dataPianificata} onChange={(e) => setInterventoForm({ ...interventoForm, dataPianificata: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Squadra</Label>
                    <SearchSelect
                      options={(squadre.data ?? []).map((s: any) => ({
                        value: String(s.id),
                        label: s.nome,
                        keywords: [s.nome, s.caposquadra].filter(Boolean).join(" "),
                        hint: s.caposquadra ?? undefined,
                      }))}
                      value={interventoForm.squadraId}
                      onChange={(v) =>
                        setInterventoForm({ ...interventoForm, squadraId: v })
                      }
                      placeholder="Nessuna"
                      searchPlaceholder="Cerca squadra..."
                      allowClear
                      clearLabel="— Nessuna —"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Indirizzo</Label>
                    <Input value={interventoForm.indirizzo} onChange={(e) => setInterventoForm({ ...interventoForm, indirizzo: e.target.value })} placeholder={c.indirizzo ? `${c.indirizzo}, ${c.citta}` : ""} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Note</Label>
                    <Textarea rows={2} value={interventoForm.note} onChange={(e) => setInterventoForm({ ...interventoForm, note: e.target.value })} />
                  </div>
                  <Button
                    onClick={() => createIntervento.mutate({
                      commessaId,
                      tipo: interventoForm.tipo as any,
                      dataPianificata: interventoForm.dataPianificata || undefined,
                      squadraId: interventoForm.squadraId && interventoForm.squadraId !== "__none__" ? parseInt(interventoForm.squadraId) : null,
                      indirizzo: interventoForm.indirizzo || (c.indirizzo ? `${c.indirizzo}, ${c.citta}` : undefined),
                      note: interventoForm.note || undefined,
                    })}
                    disabled={createIntervento.isPending}
                  >
                    Crea intervento
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {interventi.data?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessun intervento pianificato per questa commessa.
            </div>
          ) : (
            <div className="grid gap-3">
              {interventi.data?.map((i: any) => (
                <Card key={i.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs uppercase">
                            {i.tipo}
                          </Badge>
                          <Badge
                            variant={
                              i.stato === "in_corso"
                                ? "default"
                                : i.stato === "completato"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="text-xs"
                          >
                            {i.stato.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        {i.note && (
                          <p className="text-sm font-medium">{i.note}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {i.dataPianificata && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {i.dataPianificata}
                            </span>
                          )}
                          {i.indirizzo && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {i.indirizzo}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {(i.tipo === "posa" || i.tipo === "assistenza") && (
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => setLocation(`/posa/${i.id}`)}>
                            <Hammer className="h-3.5 w-3.5 mr-1" /> Posa
                          </Button>
                        )}
                        {(i.stato === "in_corso" || i.stato === "completato") && (
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => setLocation(`/verbale/${i.id}`)}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Verbale
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                          onClick={() => setDeleteTarget({ type: "intervento", id: i.id, label: `${i.tipo} ${i.dataPianificata ?? ""}` })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Anomalie Tab */}
        <TabsContent value="anomalie" className="space-y-4 mt-4">
          {anomalie.data?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessuna anomalia segnalata per questa commessa.
            </div>
          ) : (
            <div className="grid gap-3">
              {anomalie.data?.map((a: any) => (
                <Card
                  key={a.id}
                  className={
                    a.priorita === "critica"
                      ? "border-destructive/40"
                      : ""
                  }
                >
                  <CardContent className="p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            a.priorita === "critica" || a.priorita === "alta"
                              ? "destructive"
                              : "outline"
                          }
                          className="text-[10px]"
                        >
                          {a.priorita}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {a.categoria.replace(/_/g, " ")}
                        </Badge>
                        <Badge
                          variant={
                            a.stato === "aperta"
                              ? "outline"
                              : a.stato === "risolta"
                                ? "secondary"
                                : "default"
                          }
                          className="text-[10px]"
                        >
                          {a.stato}
                        </Badge>
                      </div>
                      <p className="text-sm">{a.descrizione}</p>
                      {a.risoluzione && (
                        <p className="text-xs text-muted-foreground border-l-2 border-green-500 pl-2">
                          Risoluzione: {a.risoluzione}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit commessa dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifica commessa {c.codice}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priorita</Label>
                <Select
                  value={editForm.priorita}
                  onValueChange={(v: any) => setEditForm({ ...editForm, priorita: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bassa">Bassa</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Consegna indicativa</Label>
                <Select
                  value={editForm.consegnaIndicativa}
                  onValueChange={(v: any) => setEditForm({ ...editForm, consegnaIndicativa: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">+30 giorni</SelectItem>
                    <SelectItem value="60">+60 giorni</SelectItem>
                    <SelectItem value="90">+90 giorni</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Indirizzo</Label>
                <Input value={editForm.indirizzo} onChange={(e) => setEditForm({ ...editForm, indirizzo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Citta</Label>
                <Input value={editForm.citta} onChange={(e) => setEditForm({ ...editForm, citta: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Telefono</Label>
                <Input value={editForm.telefono} onChange={(e) => setEditForm({ ...editForm, telefono: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={3}
                value={editForm.note}
                onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
              />
            </div>
            <Button
              onClick={() => updateCommessa.mutate({
                id: commessaId,
                indirizzo: editForm.indirizzo,
                citta: editForm.citta,
                telefono: editForm.telefono,
                email: editForm.email,
                priorita: editForm.priorita,
                consegnaIndicativa: editForm.consegnaIndicativa,
                note: editForm.note,
              })}
              disabled={updateCommessa.isPending}
            >
              Salva modifiche
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Conferma data consegna dialog (produzione) */}
      <Dialog open={consegnaDialog} onOpenChange={setConsegnaDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Aggiorna data consegna</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Inserisci la data di consegna prevista confermata dal produttore.
            </p>
            <div className="space-y-1.5">
              <Label>Data consegna</Label>
              <Input
                type="date"
                value={consegnaDate}
                onChange={(e) => setConsegnaDate(e.target.value)}
              />
            </div>
            <Button
              onClick={() => confermaDataConsegna.mutate({ id: commessaId, dataConsegna: consegnaDate })}
              disabled={!consegnaDate || confermaDataConsegna.isPending}
            >
              Conferma data
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Eliminare ${deleteTarget?.type ?? ""}?`}
        description={`Stai per eliminare "${deleteTarget?.label}". Questa azione non puo essere annullata.`}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "documento") deleteDocumento.mutate(deleteTarget.id);
          else if (deleteTarget.type === "intervento") deleteIntervento.mutate(deleteTarget.id);
          else if (deleteTarget.type === "commessa") deleteCommessa.mutate(deleteTarget.id);
          else if (deleteTarget.type === "prodotto") removeProdotto.mutate({ commessaId, prodottoId: deleteTarget.id });
        }}
      />

      {/* Nuovo cliente inline dialog */}
      <Dialog open={nuovoClienteDialog} onOpenChange={setNuovoClienteDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuovo cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input
                  value={clienteForm.nome}
                  onChange={(e) => setClienteForm({ ...clienteForm, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cognome *</Label>
                <Input
                  value={clienteForm.cognome}
                  onChange={(e) => setClienteForm({ ...clienteForm, cognome: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={clienteForm.tipo}
                onValueChange={(v: any) => setClienteForm({ ...clienteForm, tipo: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="privato">Privato</SelectItem>
                  <SelectItem value="azienda">Azienda</SelectItem>
                  <SelectItem value="condominio">Condominio</SelectItem>
                  <SelectItem value="ente_pubblico">Ente pubblico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Telefono</Label>
                <Input
                  value={clienteForm.telefono}
                  onChange={(e) => setClienteForm({ ...clienteForm, telefono: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  value={clienteForm.email}
                  onChange={(e) => setClienteForm({ ...clienteForm, email: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Indirizzo</Label>
                <Input
                  value={clienteForm.indirizzo}
                  onChange={(e) => setClienteForm({ ...clienteForm, indirizzo: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Citta</Label>
                <Input
                  value={clienteForm.citta}
                  onChange={(e) => setClienteForm({ ...clienteForm, citta: e.target.value })}
                />
              </div>
            </div>
            <Button
              onClick={() => createCliente.mutate({
                nome: clienteForm.nome,
                cognome: clienteForm.cognome,
                tipo: clienteForm.tipo,
                telefono: clienteForm.telefono || undefined,
                email: clienteForm.email || undefined,
                indirizzo: clienteForm.indirizzo || undefined,
                citta: clienteForm.citta || undefined,
              })}
              disabled={!clienteForm.nome || !clienteForm.cognome || createCliente.isPending}
            >
              {createCliente.isPending ? "Creazione..." : "Crea e collega"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Prodotto desiderato dialog */}
      <Dialog open={prodottoDialog} onOpenChange={setProdottoDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProdottoId ? "Modifica prodotto" : "Aggiungi prodotto"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome prodotto *</Label>
              <Input
                placeholder="es. Finestra 2 ante PVC bianco"
                value={prodottoForm.nome}
                onChange={(e) => setProdottoForm({ ...prodottoForm, nome: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipologia</Label>
                <Input
                  placeholder="PVC / Alluminio / Legno"
                  value={prodottoForm.tipologia}
                  onChange={(e) => setProdottoForm({ ...prodottoForm, tipologia: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Quantita</Label>
                <Input
                  type="number"
                  min={1}
                  value={prodottoForm.quantita}
                  onChange={(e) => setProdottoForm({ ...prodottoForm, quantita: Math.max(1, parseInt(e.target.value) || 1) })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Dimensioni</Label>
              <Input
                placeholder="es. 120x140 cm"
                value={prodottoForm.dimensioni}
                onChange={(e) => setProdottoForm({ ...prodottoForm, dimensioni: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={2}
                value={prodottoForm.note}
                onChange={(e) => setProdottoForm({ ...prodottoForm, note: e.target.value })}
              />
            </div>
            <Button
              onClick={saveProdotto}
              disabled={!prodottoForm.nome || addProdotto.isPending || updateProdotto.isPending}
            >
              {editingProdottoId ? "Salva modifiche" : "Aggiungi prodotto"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Document preview dialog (PDF + images) */}
      <Dialog open={!!previewDoc} onOpenChange={(open) => !open && setPreviewDoc(null)}>
        <DialogContent className="max-w-4xl w-[90vw] h-[85vh] p-4 gap-3">
          <DialogHeader>
            <DialogTitle className="truncate">{previewDoc?.nome}</DialogTitle>
          </DialogHeader>
          {previewDoc?.mimeType?.startsWith("image/") ? (
            <div className="flex-1 overflow-auto flex items-center justify-center bg-muted rounded">
              <img src={previewDoc.url} alt={previewDoc.nome} className="max-w-full max-h-full" />
            </div>
          ) : (
            <iframe
              src={previewDoc?.url}
              title={previewDoc?.nome}
              className="flex-1 w-full rounded border"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => previewDoc && downloadDocumento(previewDoc.id)}>
              <Download className="h-3.5 w-3.5 mr-1" /> Scarica
            </Button>
            <Button size="sm" onClick={() => setPreviewDoc(null)}>Chiudi</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Email preventivo dialog (mailto + auto-download) */}
      <Dialog open={!!emailDoc} onOpenChange={(open) => !open && setEmailDoc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Invia {emailDoc?.tipo} via email</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Destinatario</Label>
              <Input
                type="email"
                value={emailForm.to}
                onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })}
                placeholder="cliente@esempio.it"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Oggetto</Label>
              <Input
                value={emailForm.subject}
                onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Messaggio</Label>
              <Textarea
                rows={8}
                value={emailForm.body}
                onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground border-l-2 border-emerald-400 pl-2">
              <b>Outlook desktop (.eml)</b>: scarica il file allegato già dentro, doppio click apre Outlook in bozza pronta. Le altre opzioni aprono il client scelto e scaricano l'allegato da attaccare a mano.
            </p>
            <div className="grid gap-2">
              <Button
                onClick={sendViaEmlDownload}
                disabled={!emailForm.to || !emailForm.subject}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> Scarica .eml per Outlook desktop
              </Button>
              <Button
                variant="outline"
                onClick={sendEmail}
                disabled={!emailForm.to || !emailForm.subject}
              >
                <Send className="h-3.5 w-3.5 mr-1" /> Apri client email predefinito
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={sendViaOutlookWeb}
                  disabled={!emailForm.to || !emailForm.subject}
                >
                  Outlook Web
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={sendViaGmail}
                  disabled={!emailForm.to || !emailForm.subject}
                >
                  Gmail Web
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={copyEmailToClipboard}
              >
                Copia testo negli appunti
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Su Windows con Outlook installato il pulsante <b>.eml</b> funziona senza configurazione extra. Altrimenti usa <b>Outlook Web</b> o <b>Gmail Web</b>.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
