import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Banknote,
  CalendarClock,
  TrendingUp,
  ChevronDown,
  HardHat,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatEuro, parseEuroNonNegativo, parseEuroPositivo } from "@/lib/euro";
import { presentPagamento } from "@/lib/paymentView";
import { TIPOLOGIE_PRODOTTO } from "@/lib/prodotti";
import { hasRuolo, isDirezione } from "@/lib/roles";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import WhatsAppButton from "@/components/WhatsAppButton";
import { FIRMA_WHATSAPP } from "@/lib/whatsapp";
import DeleteCommessaDialog from "@/components/DeleteCommessaDialog";
import TimelineOrdine from "@/components/TimelineOrdine";
import SearchSelect from "@/components/SearchSelect";
import FilePreviewDialog from "@/components/FilePreviewDialog";
import StatoChip from "@/components/StatoChip";
import { statoLabel, PRIORITA_VARIANT, PRIORITA_LABEL } from "@/lib/stato";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  documento_identita: "bg-indigo-100 text-indigo-800",
  visura: "bg-cyan-100 text-cyan-800",
  planimetria: "bg-violet-100 text-violet-800",
  certificazione: "bg-lime-100 text-lime-800",
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
  documento_identita: "Documento d'identità",
  visura: "Visura",
  planimetria: "Planimetria",
  certificazione: "Certificazione",
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
  // Full cliente record — loaded when the commessa has a clienteId so we can
  // edit anagrafica (nome, cognome, codice fiscale, ...). Skipped for legacy
  // commesse without a clienteId; in that case we fall back to editing only
  // the commessa-level display string + contact fields.
  const clienteIdOfCommessa = (commessa.data as any)?.clienteId ?? null;
  const cliente = trpc.clienti.byId.useQuery(clienteIdOfCommessa ?? 0, {
    enabled: clienteIdOfCommessa != null,
  });
  const documenti = trpc.preventiviContratti.byCommessa.useQuery(commessaId);
  const statoGate = trpc.preventiviContratti.statoGate.useQuery(commessaId);
  const interventi = trpc.interventi.list.useQuery({ commessaId });
  const anomalie = trpc.anomalie.list.useQuery({ commessaId });
  const squadre = trpc.squadre.list.useQuery();
  const utenti = trpc.utenti.list.useQuery(undefined);

  const utils = trpc.useUtils();
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: number; label: string } | null>(null);
  // Confirm dialog for "procedi senza file" — surfaces when the user tries to
  // advance to the next stato while the current stato still has required
  // documents uploaded. The operator can confirm to bypass the gate (server
  // accepts when `force: true`) or cancel and upload the file first.
  const [forceAdvanceTarget, setForceAdvanceTarget] = useState<{
    stato: string;
    message: string;
  } | null>(null);
  // §3.6 hard-delete dialog (separate so it can require typing the code).
  const [confirmDeleteCommessa, setConfirmDeleteCommessa] = useState(false);
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
    // Cliente anagrafica — only pushed back to the cliente record when a
    // clienteId is linked. Editing nome/cognome triggers a cascade on the
    // server that refreshes the denormalized display string on every
    // commessa linked to this cliente.
    nome: "",
    cognome: "",
    codiceFiscale: "",
    partitaIva: "",
    cap: "",
    // Contact + address — currently duplicated across cliente and commessa.
    // The edit dialog writes both on save so the user doesn't have to care.
    indirizzo: "",
    citta: "",
    telefono: "",
    email: "",
    // Commessa-only fields
    priorita: "media" as "bassa" | "media" | "alta" | "urgente",
    // Utente associato alla commessa (assegnatoA). "" = non assegnata.
    assegnatoA: "" as string,
    // Either preset offset days OR free calendar date
    consegnaMode: "preset" as "preset" | "data",
    consegnaIndicativa: "60" as "30" | "60" | "90",
    dataConsegnaIndicativa: "",
    note: "",
  });

  const [consegnaDate, setConsegnaDate] = useState("");

  const [uploadForm, setUploadForm] = useState({
    file: null as File | null,
    tipo: "preventivo" as string,
    note: "",
  });

  // Rinomina e riclassifica un documento gia caricato. Il tipo conta per il
  // doc gate: un contratto caricato come "altro" blocca un avanzamento
  // legittimo, e finora si poteva correggere solo ricaricando il file.
  const [rinominaDoc, setRinominaDoc] = useState<any>(null);
  const [rinominaForm, setRinominaForm] = useState({ nome: "", tipo: "altro" });

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
    cap: "",
    indirizzoLavoro: "",
    cittaLavoro: "",
    capLavoro: "",
    lavoroStessoResidenza: true,
    detrazione: false,
    tipoDetrazione: "" as "" | "ecobonus" | "ristrutturazione",
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
  const rinominaDocumento = trpc.preventiviContratti.update.useMutation({
    onSuccess: () => {
      utils.preventiviContratti.invalidate();
      setRinominaDoc(null);
      toast.success("Documento aggiornato");
    },
    onError: (e) => toast.error(e.message ?? "Modifica non riuscita"),
  });
  const createIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.list.invalidate();
      setInterventoDialog(false);
      setInterventoForm({
        tipo: "posa",
        dataPianificata: "",
        // Riparti dalla squadra della commessa: è quella che va in cantiere.
        squadraId: commessa.data?.squadraId ? String(commessa.data.squadraId) : "",
        indirizzo: "",
        note: "",
      });
    },
  });
  const updateCommessa = trpc.commesse.update.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      utils.commesse.list.invalidate();
      utils.preventiviContratti.statoGate.invalidate(commessaId);
      setEditDialog(false);
      setForceAdvanceTarget(null);
    },
  });
  const updateCliente = trpc.clienti.update.useMutation({
    onSuccess: () => {
      utils.clienti.byId.invalidate(clienteIdOfCommessa ?? 0);
      utils.clienti.list.invalidate();
      // Commessa view also shows the denormalized name → refresh it so the
      // server-side cascade shows through immediately.
      utils.commesse.byId.invalidate(commessaId);
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
  // Soft-archive / restore. No data loss: stato, prodotti, documenti, aperture
  // and interventi are preserved. On archive we redirect back to /commesse so
  // the archived record stops appearing in the default list.
  const archiveCommessa = trpc.commesse.archive.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setLocation("/commesse");
    },
    onError: (e) => toast.error(e.message ?? "Archiviazione non riuscita"),
  });
  const restoreCommessa = trpc.commesse.restore.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
    },
    onError: (e) => toast.error(e.message ?? "Ripristino non riuscito"),
  });

  // Nuovo cliente dalla commessa: creates cliente, then links it on commessa.
  const createCliente = trpc.clienti.create.useMutation({
    onSuccess: (cliente: any) => {
      updateCommessa.mutate({
        id: commessaId,
        clienteId: cliente.id,
        cliente: `${cliente.cognome} ${cliente.nome}`.trim(),
        telefono: cliente.telefono || undefined,
        email: cliente.email || undefined,
        // Commessa indirizzo = indirizzo LAVORO (falls back to residenza).
        indirizzo: cliente.indirizzoLavoro || cliente.indirizzo || undefined,
        citta: cliente.cittaLavoro || cliente.citta || undefined,
      });
      setNuovoClienteDialog(false);
      setClienteForm({
        nome: "", cognome: "", tipo: "privato",
        telefono: "", email: "", indirizzo: "", citta: "", cap: "",
        indirizzoLavoro: "", cittaLavoro: "", capLavoro: "",
        lavoroStessoResidenza: true,
        detrazione: false, tipoDetrazione: "",
      });
    },
  });

  // Nota: invalidare anche commesse.list — da quando la lista mostra la
  // colonna Prodotti, senza questo restava indietro dopo una modifica.
  const addProdotto = trpc.commesse.addProdotto.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      utils.commesse.list.invalidate();
      setProdottoDialog(false);
      setEditingProdottoId(null);
      setProdottoForm({ nome: "", tipologia: "", quantita: 1, dimensioni: "", note: "" });
    },
  });
  const updateProdotto = trpc.commesse.updateProdotto.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      utils.commesse.list.invalidate();
      setProdottoDialog(false);
      setEditingProdottoId(null);
      setProdottoForm({ nome: "", tipologia: "", quantita: 1, dimensioni: "", note: "" });
    },
  });
  const removeProdotto = trpc.commesse.removeProdotto.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      utils.commesse.list.invalidate();
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
    const cl: any = cliente.data;
    // Prefer cliente record for anagrafica when available; fall back to the
    // commessa display string split into nome/cognome on the first space so
    // legacy commesse without a clienteId still get a sensible seed.
    // Display string is "Cognome Nome": first token = cognome, rest = nome.
    const fallbackParts = (c.cliente ?? "").trim().split(/\s+/);
    const fallbackCognome = fallbackParts[0] ?? "";
    const fallbackNome = fallbackParts.slice(1).join(" ");
    setEditForm({
      nome: cl?.nome ?? fallbackNome,
      cognome: cl?.cognome ?? fallbackCognome,
      codiceFiscale: cl?.codiceFiscale ?? "",
      partitaIva: cl?.partitaIva ?? "",
      cap: cl?.cap ?? "",
      indirizzo: c.indirizzo ?? cl?.indirizzo ?? "",
      citta: c.citta ?? cl?.citta ?? "",
      telefono: c.telefono ?? cl?.telefono ?? "",
      email: c.email ?? cl?.email ?? "",
      priorita: c.priorita ?? "media",
      assegnatoA: c.assegnatoA != null ? String(c.assegnatoA) : "",
      consegnaMode: c.dataConsegnaIndicativa ? "data" : "preset",
      consegnaIndicativa: c.consegnaIndicativa ?? "60",
      dataConsegnaIndicativa: c.dataConsegnaIndicativa ?? "",
      note: c.note ?? "",
    });
    setEditDialog(true);
  }

  // Single "Save" handler for the edit dialog. Fires cliente.update (when a
  // clienteId is linked) then commesse.update. Server-side cascade in
  // clienti.update keeps the denormalized display string on every linked
  // commessa in sync, so callers never have to patch that by hand.
  async function handleSaveEdit() {
    try {
      if (clienteIdOfCommessa != null) {
        await updateCliente.mutateAsync({
          id: clienteIdOfCommessa,
          nome: editForm.nome,
          cognome: editForm.cognome,
          codiceFiscale: editForm.codiceFiscale || undefined,
          partitaIva: editForm.partitaIva || undefined,
          cap: editForm.cap || undefined,
          telefono: editForm.telefono || undefined,
          email: editForm.email || undefined,
          indirizzo: editForm.indirizzo || undefined,
          citta: editForm.citta || undefined,
        });
      }
      await updateCommessa.mutateAsync({
        id: commessaId,
        // Refresh the denormalized display string even when no clienteId is
        // linked, so users can still correct it.
        cliente: `${editForm.cognome} ${editForm.nome}`.trim(),
        indirizzo: editForm.indirizzo,
        citta: editForm.citta,
        telefono: editForm.telefono,
        email: editForm.email,
        priorita: editForm.priorita,
        // Utente associato — null quando "Non assegnata".
        assegnatoA: editForm.assegnatoA ? parseInt(editForm.assegnatoA) : null,
        // Mutually exclusive — only one of the two persists.
        consegnaIndicativa:
          editForm.consegnaMode === "preset" ? editForm.consegnaIndicativa : null,
        dataConsegnaIndicativa:
          editForm.consegnaMode === "data"
            ? editForm.dataConsegnaIndicativa || null
            : null,
        note: editForm.note,
      });
    } catch (e) {
      console.error("[commessa] save edit failed", e);
    }
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
      {/* Archived banner — surfaces the archived state front-and-center so
          users don't mistake an archived job for an active one. No buttons
          inside: restore is in the header to match the archive entry point. */}
      {c.archivedAt && (
        <div className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3 flex items-start gap-3">
          <Archive className="h-5 w-5 text-zinc-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-zinc-900">Commessa archiviata</p>
            <p className="text-sm text-zinc-700">
              Archiviata il{" "}
              {new Date(c.archivedAt).toLocaleDateString("it-IT", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              . Non compare nelle liste, nel board o nel planning. Dati, file e
              stato di avanzamento sono preservati — usa <em>Ripristina</em>{" "}
              per riattivarla.
            </p>
          </div>
        </div>
      )}

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="codice-mono text-text-2">{c.codice}</span>
              <StatoChip stato={c.stato} />
              {(c.priorita === "urgente" || c.priorita === "alta") && (
                <Badge variant={PRIORITA_VARIANT[c.priorita] ?? "secondary"}>
                  {PRIORITA_LABEL[c.priorita] ?? c.priorita}
                </Badge>
              )}
              {c.archivedAt && (
                <Badge variant="secondary" className="gap-1">
                  <Archive className="h-3 w-3" />
                  Archiviata
                </Badge>
              )}
            </div>
            <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em]">
              {c.cliente}
            </h1>
          </div>
          <div className="flex gap-1.5 items-center flex-wrap">
            {/* Single primary action: Avanza a: <stato successivo> (§4.3) */}
            {!c.archivedAt && c.stato !== "archiviata" && (() => {
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
                  onClick={() => {
                    if (gateBlocked && statoGate.data) {
                      const missing = statoGate.data.required
                        .filter((r) => !r.satisfied)
                        .map((r) => r.label)
                        .join(" o ");
                      setForceAdvanceTarget({
                        stato: nextStato,
                        message: `Non è stato caricato il file "${missing}" per lo stato "${statoLabel(c.stato)}". Procedere comunque?`,
                      });
                    } else {
                      updateCommessa.mutate({ id: commessaId, stato: nextStato as any });
                    }
                  }}
                  disabled={updateCommessa.isPending}
                  title={
                    gateBlocked
                      ? `Manca il file ${(statoGate.data?.required ?? [])
                          .filter((r) => !r.satisfied)
                          .map((r) => r.label)
                          .join(" o ")} — chiederà conferma`
                      : undefined
                  }
                >
                  Avanza a: {statoLabel(nextStato)}
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              ) : null;
            })()}
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Modifica
            </Button>
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
            {c.archivedAt ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreCommessa.mutate(commessaId)}
                disabled={restoreCommessa.isPending}
                title="Ripristina commessa — torna attiva con stato e dati invariati"
              >
                <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
                Ripristina
              </Button>
            ) : (
              /* Archivia + Elimina live in the ••• menu (§3.6) */
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-text-3">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() =>
                      setDeleteTarget({
                        type: "archive-commessa",
                        id: commessaId,
                        label: c.codice,
                      })
                    }
                  >
                    <Archive className="h-4 w-4" /> Archivia
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    onClick={() => setConfirmDeleteCommessa(true)}
                  >
                    <Trash2 className="h-4 w-4" /> Elimina
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
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
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              {c.telefono}
              <WhatsAppButton
                phone={c.telefono}
                message={`Buongiorno ${c.cliente ?? ""}, la contattiamo da Ruffino Group in merito alla sua commessa ${c.codice ?? ""}.\n${FIRMA_WHATSAPP}`}
              />
            </span>
          )}
          {c.email && (
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              {c.email}
            </span>
          )}
          {/* Data di apertura: quando la commessa è entrata in casa. Utile
              a colpo d'occhio quanto è vecchia una pratica. */}
          {(c.dataApertura || c.createdAt) && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              Creata il{" "}
              <span className="font-medium text-foreground">
                {new Date(
                  c.dataApertura
                    ? `${c.dataApertura}T12:00:00`
                    : c.createdAt
                ).toLocaleDateString("it-IT")}
              </span>
            </span>
          )}
          {(() => {
            const assignee = (utenti.data ?? []).find(
              (u: any) => u.id === c.assegnatoA
            ) as any;
            return (
              <span className="flex items-center gap-1">
                <Contact className="h-3.5 w-3.5" />
                Assegnata a:{" "}
                <span className="font-medium text-foreground">
                  {assignee
                    ? `${assignee.cognome ?? ""} ${assignee.nome ?? ""}`.trim() ||
                      assignee.email
                    : "Non assegnata"}
                </span>
              </span>
            );
          })()}
          {c.dataConsegnaConfermata ? (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              Consegna prevista · {new Date(c.dataConsegnaConfermata).toLocaleDateString("it-IT")}
            </span>
          ) : c.dataConsegnaIndicativa ? (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              Consegna stimata · {new Date(c.dataConsegnaIndicativa).toLocaleDateString("it-IT")}
            </span>
          ) : c.consegnaIndicativa ? (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              Consegna stimata · ~{c.consegnaIndicativa} giorni
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
        {statoGate.data && statoGate.data.required.length > 0 && (() => {
          const missingCount = statoGate.data.required.filter((r) => !r.satisfied).length;
          const missingNames = statoGate.data.required
            .filter((r) => !r.satisfied)
            .map((r) => r.label)
            .join(" e ");
          return (
          <Card
            className={
              statoGate.data.canAdvance
                ? "mt-4 border-success/40 bg-success-soft"
                : "mt-4 border-warning/40 bg-warning-soft"
            }
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {statoGate.data.canAdvance ? (
                    <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="text-sm font-semibold">
                      {statoGate.data.canAdvance
                        ? "Documenti richiesti caricati"
                        : `Manca${missingCount === 1 ? "" : "no"} ${missingCount} document${missingCount === 1 ? "o" : "i"}`}
                    </p>
                    <p className="text-xs text-text-2">
                      {statoGate.data.canAdvance
                        ? "Puoi avanzare la commessa allo stato successivo."
                        : `Serv${missingCount === 1 ? "e" : "ono"} ${missingNames}. Puoi procedere lo stesso — ti chiederemo conferma.`}
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
          );
        })()}
      </div>

      {/* Pagamenti — totale, incassato, residuo. Inline editing: blur saves. */}
      <PagamentiCard
        commessa={commessa.data}
        commessaId={commessaId}
        onSave={(patch) =>
          updateCommessa.mutate({ id: commessaId, ...patch })
        }
      />

      {/* Economia — margine lordo (P0.2). Direzione/amministrazione only:
          the query itself is role-gated server-side, the client just hides
          the card for everyone else. */}
      <EconomiaCard commessaId={commessaId} />

      {/* Squadra di posa — chi va in cantiere su questa commessa. */}
      <SquadraPosaCard
        commessa={c}
        squadre={squadre.data ?? []}
        onAssegna={(squadraId) =>
          updateCommessa.mutate({ id: commessaId, squadraId })
        }
        salvataggioInCorso={updateCommessa.isPending}
      />


      {/* Hoisted timeline: prominent above the tabs (Feat 2). */}
      <TimelineOrdine commessaId={commessaId} />

      {/* Tabs */}
      <Tabs defaultValue="preventivi">
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="preventivi">
            File e documenti ({documenti.data?.length ?? 0})
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

        {/* File e documenti Tab */}
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
                      {/* Una lista sola: DOC_TIPO_LABEL rispecchia DOC_TIPI
                          del server, quindi un tipo nuovo compare qui senza
                          che nessuno debba ricordarsene. */}
                      <SelectContent>
                        {Object.entries(DOC_TIPO_LABEL).map(([tipo, label]) => (
                          <SelectItem key={tipo} value={tipo}>
                            {label}
                          </SelectItem>
                        ))}
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
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <FileText className="h-9 w-9 text-text-3" />
              <p className="text-[15px] font-semibold">Nessun documento</p>
              <p className="text-sm text-text-2 max-w-xs">
                Qui compariranno preventivi, contratti, fatture e foto. Usa il
                pulsante per caricare un file.
              </p>
              <Button size="sm" variant="outline" onClick={() => setUploadDialog(true)}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Carica file
              </Button>
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
                            {DOC_TIPO_LABEL[d.tipo] ?? d.tipo}
                          </Badge>
                          {d.source === "fic" && (
                            <Badge variant="outline" className="text-[10px]">
                              Fatture in Cloud
                            </Badge>
                          )}
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
                        className="h-7 w-7"
                        title="Rinomina o cambia tipo"
                        aria-label={`Rinomina ${d.nome}`}
                        onClick={() => {
                          setRinominaDoc(d);
                          setRinominaForm({ nome: d.nome, tipo: d.tipo });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
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
            <Dialog
              open={interventoDialog}
              onOpenChange={(o) => {
                // All'apertura parti dalla squadra assegnata alla commessa:
                // è quella che va in cantiere, riscriverla ogni volta era
                // solo lavoro doppio.
                if (o) {
                  setInterventoForm((f) => ({
                    ...f,
                    squadraId: c.squadraId ? String(c.squadraId) : f.squadraId,
                  }));
                }
                setInterventoDialog(o);
              }}
            >
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifica commessa {c.codice}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* Anagrafica cliente */}
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Anagrafica cliente
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Cognome</Label>
                  <Input
                    value={editForm.cognome}
                    onChange={(e) => setEditForm({ ...editForm, cognome: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input
                    value={editForm.nome}
                    onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Codice fiscale</Label>
                  <Input
                    value={editForm.codiceFiscale}
                    onChange={(e) =>
                      setEditForm({ ...editForm, codiceFiscale: e.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Partita IVA</Label>
                  <Input
                    value={editForm.partitaIva}
                    onChange={(e) => setEditForm({ ...editForm, partitaIva: e.target.value })}
                  />
                </div>
              </div>
              {clienteIdOfCommessa == null && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Questa commessa non è collegata a un cliente in anagrafica —
                  le modifiche all'anagrafica vengono salvate solo come nome
                  visualizzato sulla commessa.
                </p>
              )}
            </div>

            {/* Contatti e indirizzo */}
            <div className="space-y-3 border-t pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Contatti e indirizzo
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Telefono</Label>
                  <Input
                    value={editForm.telefono}
                    onChange={(e) => setEditForm({ ...editForm, telefono: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Indirizzo</Label>
                <Input
                  value={editForm.indirizzo}
                  onChange={(e) => setEditForm({ ...editForm, indirizzo: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div className="space-y-1.5">
                  <Label>Città</Label>
                  <Input
                    value={editForm.citta}
                    onChange={(e) => setEditForm({ ...editForm, citta: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>CAP</Label>
                  <Input
                    value={editForm.cap}
                    onChange={(e) => setEditForm({ ...editForm, cap: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Dati commessa */}
            <div className="space-y-3 border-t pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Dati commessa
              </div>
              <div className="space-y-1.5">
                <Label>Assegnata a</Label>
                <SearchSelect
                  options={(utenti.data ?? []).map((u: any) => ({
                    value: String(u.id),
                    label:
                      u.nome && u.cognome
                        ? `${u.cognome} ${u.nome}`
                        : u.nome ?? u.email ?? `Utente ${u.id}`,
                    keywords: [u.nome, u.cognome, u.email, (u.ruoli ?? []).join(" ")]
                      .filter(Boolean)
                      .join(" "),
                    hint: (u.ruoli ?? [])[0],
                  }))}
                  value={editForm.assegnatoA}
                  onChange={(v) => setEditForm({ ...editForm, assegnatoA: v })}
                  placeholder="Non assegnata"
                  searchPlaceholder="Cerca utente..."
                  allowClear
                  clearLabel="— Non assegnata —"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Priorità</Label>
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
                    value={
                      editForm.consegnaMode === "data"
                        ? "data"
                        : editForm.consegnaIndicativa
                    }
                    onValueChange={(v: any) => {
                      if (v === "data") {
                        setEditForm({ ...editForm, consegnaMode: "data" });
                      } else {
                        setEditForm({
                          ...editForm,
                          consegnaMode: "preset",
                          consegnaIndicativa: v,
                        });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">+30 giorni</SelectItem>
                      <SelectItem value="60">+60 giorni</SelectItem>
                      <SelectItem value="90">+90 giorni</SelectItem>
                      <SelectItem value="data">Data da calendario…</SelectItem>
                    </SelectContent>
                  </Select>
                  {editForm.consegnaMode === "data" && (
                    <Input
                      type="date"
                      value={editForm.dataConsegnaIndicativa}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          dataConsegnaIndicativa: e.target.value,
                        })
                      }
                    />
                  )}
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
            </div>

            <Button
              onClick={handleSaveEdit}
              disabled={updateCommessa.isPending || updateCliente.isPending}
            >
              {updateCommessa.isPending || updateCliente.isPending
                ? "Salvataggio..."
                : "Salva modifiche"}
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

      {/* Delete / archive confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.type === "archive-commessa"
            ? "Archiviare la commessa?"
            : `Eliminare ${deleteTarget?.type ?? ""}?`
        }
        description={
          deleteTarget?.type === "archive-commessa"
            ? `La commessa "${deleteTarget?.label}" verrà spostata in Archivio. Nessun dato, file o stato di avanzamento viene perso — potrai ripristinarla in qualsiasi momento.`
            : `Stai per eliminare "${deleteTarget?.label}". Questa azione non puo essere annullata.`
        }
        destructive={deleteTarget?.type !== "archive-commessa"}
        confirmLabel={
          deleteTarget?.type === "archive-commessa" ? "Archivia" : "Elimina"
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "documento") deleteDocumento.mutate(deleteTarget.id);
          else if (deleteTarget.type === "intervento") deleteIntervento.mutate(deleteTarget.id);
          else if (deleteTarget.type === "commessa") deleteCommessa.mutate(deleteTarget.id);
          else if (deleteTarget.type === "archive-commessa") archiveCommessa.mutate(deleteTarget.id);
          else if (deleteTarget.type === "prodotto") removeProdotto.mutate({ commessaId, prodottoId: deleteTarget.id });
        }}
      />

      {/* Hard-delete of the commessa (§3.6) — requires typing the code when
          the commessa is past produzione. */}
      <DeleteCommessaDialog
        open={confirmDeleteCommessa}
        onOpenChange={setConfirmDeleteCommessa}
        codice={c.codice}
        stato={c.stato}
        onConfirm={() => deleteCommessa.mutate(commessaId)}
      />

      {/* Force advance confirmation — fires when the operator tries to move
          to the next stato without uploading the required document. The
          server accepts the override via the `force: true` flag. */}
      <ConfirmDialog
        open={!!forceAdvanceTarget}
        onOpenChange={(open) => !open && setForceAdvanceTarget(null)}
        title="File richiesto non caricato"
        description={forceAdvanceTarget?.message ?? ""}
        destructive={false}
        confirmLabel="Procedi comunque"
        onConfirm={() => {
          if (!forceAdvanceTarget) return;
          updateCommessa.mutate({
            id: commessaId,
            stato: forceAdvanceTarget.stato as any,
            force: true,
          });
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
                <Label>Cognome *</Label>
                <Input
                  value={clienteForm.cognome}
                  onChange={(e) => setClienteForm({ ...clienteForm, cognome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input
                  value={clienteForm.nome}
                  onChange={(e) => setClienteForm({ ...clienteForm, nome: e.target.value })}
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
            {/* Residenza */}
            <div className="rounded-md border p-3 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Indirizzo di residenza (fatturazione)
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label>Indirizzo</Label>
                  <Input
                    value={clienteForm.indirizzo}
                    onChange={(e) => setClienteForm({ ...clienteForm, indirizzo: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>CAP</Label>
                  <Input
                    value={clienteForm.cap}
                    onChange={(e) => setClienteForm({ ...clienteForm, cap: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Citta</Label>
                <Input
                  value={clienteForm.citta}
                  onChange={(e) => setClienteForm({ ...clienteForm, citta: e.target.value })}
                />
              </div>
            </div>
            {/* Lavoro */}
            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Indirizzo lavoro
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={clienteForm.lavoroStessoResidenza}
                    onChange={(e) => setClienteForm({ ...clienteForm, lavoroStessoResidenza: e.target.checked })}
                  />
                  <span className="text-muted-foreground">Stesso della residenza</span>
                </label>
              </div>
              {!clienteForm.lavoroStessoResidenza && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5 col-span-2">
                      <Label>Indirizzo lavoro</Label>
                      <Input
                        value={clienteForm.indirizzoLavoro}
                        onChange={(e) => setClienteForm({ ...clienteForm, indirizzoLavoro: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>CAP</Label>
                      <Input
                        value={clienteForm.capLavoro}
                        onChange={(e) => setClienteForm({ ...clienteForm, capLavoro: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Citta lavoro</Label>
                    <Input
                      value={clienteForm.cittaLavoro}
                      onChange={(e) => setClienteForm({ ...clienteForm, cittaLavoro: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
            {/* Detrazione */}
            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Detrazione fiscale</div>
                  <div className="text-xs text-muted-foreground">Il cliente vuole usufruirne?</div>
                </div>
                <input
                  type="checkbox"
                  checked={clienteForm.detrazione}
                  onChange={(e) => setClienteForm({ ...clienteForm, detrazione: e.target.checked, tipoDetrazione: e.target.checked ? clienteForm.tipoDetrazione : "" })}
                />
              </div>
              {clienteForm.detrazione && (
                <div className="space-y-1.5">
                  <Label>Quale detrazione</Label>
                  <Select
                    value={clienteForm.tipoDetrazione}
                    onValueChange={(v: any) => setClienteForm({ ...clienteForm, tipoDetrazione: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Seleziona detrazione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ecobonus">Ecobonus</SelectItem>
                      <SelectItem value="ristrutturazione">Ristrutturazione</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <Button
              onClick={() => {
                const lavoroSame = clienteForm.lavoroStessoResidenza;
                createCliente.mutate({
                  nome: clienteForm.nome,
                  cognome: clienteForm.cognome,
                  tipo: clienteForm.tipo,
                  telefono: clienteForm.telefono || undefined,
                  email: clienteForm.email || undefined,
                  indirizzo: clienteForm.indirizzo || undefined,
                  citta: clienteForm.citta || undefined,
                  cap: clienteForm.cap || undefined,
                  indirizzoLavoro: (lavoroSame ? clienteForm.indirizzo : clienteForm.indirizzoLavoro) || undefined,
                  cittaLavoro: (lavoroSame ? clienteForm.citta : clienteForm.cittaLavoro) || undefined,
                  capLavoro: (lavoroSame ? clienteForm.cap : clienteForm.capLavoro) || undefined,
                  detrazione: clienteForm.detrazione,
                  tipoDetrazione:
                    clienteForm.detrazione && clienteForm.tipoDetrazione
                      ? (clienteForm.tipoDetrazione as "ecobonus" | "ristrutturazione")
                      : null,
                });
              }}
              disabled={
                !clienteForm.nome ||
                !clienteForm.cognome ||
                (clienteForm.detrazione && !clienteForm.tipoDetrazione) ||
                createCliente.isPending
              }
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
            {/* Stesso elenco proposto alla creazione della commessa, così la
                colonna Prodotti in lista resta omogenea. I nomi liberi dei
                prodotti già inseriti restano selezionabili e non si perdono. */}
            <div className="space-y-1.5">
              <Label>Prodotto *</Label>
              <Select
                value={prodottoForm.nome}
                onValueChange={(v) => setProdottoForm({ ...prodottoForm, nome: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona il prodotto" />
                </SelectTrigger>
                <SelectContent>
                  {prodottoForm.nome &&
                    !TIPOLOGIE_PRODOTTO.includes(prodottoForm.nome) && (
                      <SelectItem value={prodottoForm.nome}>
                        {prodottoForm.nome}
                      </SelectItem>
                    )}
                  {TIPOLOGIE_PRODOTTO.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Materiale</Label>
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

      {/* Document preview — reusable large dialog */}
      <FilePreviewDialog
        preview={previewDoc}
        onClose={() => setPreviewDoc(null)}
        onDownload={() => previewDoc && downloadDocumento(previewDoc.id)}
      />

      {/* Email preventivo dialog (mailto + auto-download) */}
      <Dialog
        open={!!rinominaDoc}
        onOpenChange={(open) => !open && setRinominaDoc(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rinomina documento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome file</Label>
              <Input
                value={rinominaForm.nome}
                onChange={(e) =>
                  setRinominaForm({ ...rinominaForm, nome: e.target.value })
                }
                placeholder="Documento d'identita Rossi Mario.pdf"
              />
              <p className="text-[11px] text-muted-foreground">
                Il nome e libero: tienici l&apos;estensione del file.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo documento</Label>
              <Select
                value={rinominaForm.tipo}
                onValueChange={(v) =>
                  setRinominaForm({ ...rinominaForm, tipo: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TIPO_LABEL).map(([tipo, label]) => (
                    <SelectItem key={tipo} value={tipo}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRinominaDoc(null)}>
              Annulla
            </Button>
            <Button
              disabled={
                !rinominaForm.nome.trim() || rinominaDocumento.isPending
              }
              onClick={() =>
                rinominaDocumento.mutate({
                  id: rinominaDoc.id,
                  nome: rinominaForm.nome.trim(),
                  tipo: rinominaForm.tipo as any,
                })
              }
            >
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

// ── Pagamenti (registro acconti) ─────────────────────────────────────────────
// Totale pattuito + registro acconti datati (importo, data, metodo, nota).
// importoIncassato è la somma del registro, ricalcolata dal server: board,
// dashboard e notifiche restano coerenti. Chips 50/40/10% riflettono il
// piano di pagamento tipico (acconto — secondo acconto — saldo).
const METODO_LABEL: Record<string, string> = {
  bonifico: "Bonifico",
  contanti: "Contanti",
  assegno: "Assegno",
  pos: "POS",
  finanziamento: "Finanziamento",
  altro: "Altro",
};

// Che rata è: 1°–5° acconto o saldo finale.
export const TIPO_PAGAMENTO_LABEL: Record<string, string> = {
  acconto_1: "1° acconto",
  acconto_2: "2° acconto",
  acconto_3: "3° acconto",
  acconto_4: "4° acconto",
  acconto_5: "5° acconto",
  saldo: "Saldo",
};

// Suggerisce la rata successiva in base a quante sono già registrate.
// Prende il CONTEGGIO, non l'array: commesse.list non restituisce i pagamenti
// e passandole un array vuoto proponeva sempre "1° acconto".
export function tipoPagamentoSuggerito(nGiaRegistrati: number): string {
  const n = nGiaRegistrati ?? 0;
  return n >= 5 ? "saldo" : `acconto_${n + 1}`;
}

// Piano rate della commessa: le scadenze concordate, non gli incassi.
//
// Con una fattura FiC collegata il piano è di sola lettura — arriva dalle
// scadenze del documento. Senza fattura è l'operatore a scriverlo, ed è
// l'unico caso in cui questa sezione ha comandi.
function PianoRateSezione({
  commessaId,
  totalePattuito,
}: {
  commessaId: number;
  totalePattuito: number | null;
}) {
  const utils = trpc.useUtils();
  const q = trpc.commesse.pattuito.useQuery(commessaId);
  const [aggiungi, setAggiungi] = useState(false);
  const [form, setForm] = useState({ importo: "", scadenza: "", descrizione: "" });
  const fmt = formatEuro;
  const parse = parseEuroPositivo;
  const fmtScadenza = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });

  const invalida = () => {
    utils.commesse.pattuito.invalidate(commessaId);
    utils.commesse.invalidate();
  };
  const addRata = trpc.commesse.addRata.useMutation({
    onSuccess: () => {
      invalida();
      setForm({ importo: "", scadenza: "", descrizione: "" });
      setAggiungi(false);
      toast.success("Rata aggiunta");
    },
    onError: e => toast.error(e.message),
  });
  const removeRata = trpc.commesse.removeRata.useMutation({
    onSuccess: () => {
      invalida();
      toast.success("Rata eliminata");
    },
    onError: e => toast.error(e.message),
  });

  const rate = q.data?.rate ?? [];
  const modificabile = q.data?.modificabile ?? false;
  const sommaRate = rate
    .filter((r: any) => r.stato !== "stornata")
    .reduce((s: number, r: any) => s + (r.importo ?? 0), 0);
  const scostamento =
    totalePattuito != null && rate.length > 0
      ? Math.round((sommaRate - totalePattuito) * 100) / 100
      : null;

  if (q.isLoading) return null;
  if (rate.length === 0 && !modificabile) return null;

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 flex-wrap">
        <CalendarClock className="h-4 w-4 text-text-3" />
        <span className="text-sm font-medium">Piano rate</span>
        {!modificabile && (
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            da FiC
          </Badge>
        )}
        <span className="text-xs text-text-3 ml-auto tabular-nums">
          {rate.length} rate · € {fmt(sommaRate)}
        </span>
        {modificabile && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setAggiungi(v => !v)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Rata
          </Button>
        )}
      </div>

      {rate.length > 0 && (
        <div className="divide-y divide-border/60">
          {rate.map((r: any) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="text-xs text-text-3 w-6 tabular-nums shrink-0">
                {r.numero}
              </span>
              <span className="font-medium tabular-nums w-24 shrink-0">
                € {fmt(r.importo)}
              </span>
              <span className="text-xs text-text-3 w-24 shrink-0">
                {r.scadenza ? fmtScadenza(r.scadenza) : "senza scadenza"}
              </span>
              <span className="text-xs text-text-3 truncate min-w-0 flex-1">
                {r.descrizione ?? ""}
              </span>
              <Badge
                variant={r.stato === "pagata" ? "default" : "outline"}
                className="h-5 text-[10px] shrink-0"
              >
                {r.stato === "pagata"
                  ? "Pagata"
                  : r.stato === "stornata"
                    ? "Stornata"
                    : "In attesa"}
              </Badge>
              {modificabile && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  aria-label={`Elimina rata ${r.numero}`}
                  onClick={() =>
                    removeRata.mutate({ commessaId, rataId: r.id })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {scostamento != null && Math.abs(scostamento) >= 0.5 && (
        <p className="px-3 py-2 text-xs text-warning border-t border-border/60">
          Le rate {scostamento > 0 ? "superano" : "non coprono"} il pattuito di €{" "}
          {fmt(Math.abs(scostamento))}.
        </p>
      )}

      {aggiungi && modificabile && (
        <div className="flex items-end gap-2 px-3 py-2.5 flex-wrap border-t border-border/60 bg-surface-2/60">
          <div className="space-y-0.5">
            <Label className="text-[10px]">Importo €</Label>
            <Input
              inputMode="decimal"
              value={form.importo}
              onChange={e => setForm({ ...form, importo: e.target.value })}
              className="h-8 w-28 text-xs tabular-nums"
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px]">Scadenza</Label>
            <Input
              type="date"
              value={form.scadenza}
              onChange={e => setForm({ ...form, scadenza: e.target.value })}
              className="h-8 w-[135px] text-xs"
            />
          </div>
          <div className="space-y-0.5 flex-1 min-w-[140px]">
            <Label className="text-[10px]">Nota</Label>
            <Input
              value={form.descrizione}
              onChange={e => setForm({ ...form, descrizione: e.target.value })}
              placeholder="1° acconto, saldo…"
              className="h-8 text-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!form.importo.trim() || addRata.isPending}
            onClick={() => {
              const importo = parse(form.importo);
              if (importo == null) {
                toast.error("Importo della rata non valido");
                return;
              }
              addRata.mutate({
                commessaId,
                importo,
                scadenza: form.scadenza || null,
                descrizione: form.descrizione.trim() || undefined,
              });
            }}
          >
            Aggiungi
          </Button>
        </div>
      )}
    </div>
  );
}

function PagamentiCard({
  commessa,
  commessaId,
  onSave,
}: {
  commessa: any;
  commessaId: number;
  onSave: (patch: { importoTotale?: number | null }) => void;
}) {
  const utils = trpc.useUtils();
  const [tot, setTot] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pForm, setPForm] = useState({
    importo: "",
    data: new Date().toISOString().split("T")[0],
    metodo: "bonifico",
    tipo: "",
    note: "",
  });
  // Fonte del pattuito. Finché non risponde il server assumiamo modificabile:
  // il blocco è comunque riaffermato lato server, e un campo inerte a ogni
  // apertura di scheda sarebbe peggio dell'attesa di un istante.
  const pattuitoQ = trpc.commesse.pattuito.useQuery(commessaId);
  const pattuitoDaFic = pattuitoQ.data?.fonte === "fic";
  const motivoBlocco = pattuitoQ.data?.motivoBlocco ?? null;

  const addPagamento = trpc.commesse.addPagamento.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setPForm((f) => ({ ...f, importo: "", tipo: "", note: "" }));
      setAddOpen(false);
      toast.success("Acconto registrato");
    },
    onError: (e) => toast.error(e.message ?? "Registrazione non riuscita"),
  });
  const removePagamento = trpc.commesse.removePagamento.useMutation({
    onSuccess: () => utils.commesse.invalidate(),
    onError: (e) => toast.error(e.message ?? "Rimozione non riuscita"),
  });
  const updatePagamento = trpc.commesse.updatePagamento.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setEditPag(null);
      toast.success("Acconto aggiornato");
    },
    onError: (e) => toast.error(e.message ?? "Salvataggio non riuscito"),
  });
  // Row being edited + its draft.
  const [editPag, setEditPag] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ importo: "", data: "", metodo: "bonifico", tipo: "", note: "" });

  if (!commessa) return null;
  const totale: number | null = commessa.importoTotale ?? null;
  const pagamenti: any[] = Array.isArray(commessa.pagamenti) ? commessa.pagamenti : [];
  const incassato = Number(commessa.importoIncassato ?? 0);
  const residuo = (totale ?? 0) - incassato;
  const pct = totale ? Math.min(100, Math.round((incassato / totale) * 100)) : 0;

  const parse = parseEuroNonNegativo;
  const fmt = formatEuro;
  const fmtData = (iso: string | null) =>
    iso ? new Date(iso + "T12:00:00").toLocaleDateString("it-IT") : "—";

  // Quick chips: percentage of the agreed total, capped at what's left.
  const chip = (p: number) => {
    if (!totale) return;
    const val = Math.min(Math.round(totale * p) / 1, Math.max(0, residuo));
    setPForm((f) => ({ ...f, importo: String(val), tipo: tipoPagamentoSuggerito(pagamenti.length) }));
    setAddOpen(true);
  };

  const ordered = [...pagamenti].sort((a, b) =>
    (a.data ?? "0000").localeCompare(b.data ?? "0000")
  );
  const orderedWithView = ordered.map(p => ({
    pagamento: p,
    view: presentPagamento(p),
  }));

  return (
    <Card className={residuo > 0 && totale ? "border-l-[3px] border-l-warning" : ""}>
      <CardContent className="py-4 space-y-3">
        {/* Header row: totale + progress + residuo */}
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-success-soft text-success">
              <Banknote className="h-5 w-5" />
            </span>
            <span className="font-semibold text-sm">Pagamenti</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-text-3">Totale pattuito €</Label>
              {pattuitoDaFic && (
                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                  da FiC
                </Badge>
              )}
            </div>
            {/* Il pattuito di una commessa fatturata è FiC: mostrarlo come
                campo editabile prometterebbe una modifica che il server
                rifiuta. Qui diventa una cifra con la sua fonte. */}
            {pattuitoDaFic ? (
              <p
                className="h-9 w-32 flex items-center text-sm font-semibold tabular-nums"
                title={motivoBlocco ?? undefined}
              >
                {totale != null ? `€ ${fmt(totale)}` : "—"}
              </p>
            ) : (
              <Input
                inputMode="decimal"
                placeholder="—"
                value={tot ?? (totale != null ? String(totale) : "")}
                onChange={(e) => setTot(e.target.value)}
                onBlur={() => {
                  if (tot == null) return;
                  onSave({ importoTotale: tot.trim() === "" ? null : parse(tot) });
                  setTot(null);
                }}
                className="h-9 w-32 tabular-nums"
              />
            )}
          </div>
          {totale != null && totale > 0 && (
            <>
              <div className="flex-1 min-w-[140px] max-w-xs">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-3">
                    {pct}% incassato · € {fmt(incassato)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className={`h-full ${residuo > 0 ? "bg-warning" : "bg-success"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="eyebrow !text-text-3">Residuo</p>
                <p
                  className={`text-xl font-bold tabular-nums ${
                    residuo > 0 ? "text-warning" : "text-success"
                  }`}
                >
                  € {fmt(Math.max(0, residuo))}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Scadenze concordate — distinte dagli incassi qui sotto */}
        <PianoRateSezione commessaId={commessaId} totalePattuito={totale} />

        {/* Acconti registrati */}
        {ordered.length > 0 && (
          <div className="rounded-md border border-border divide-y divide-border/60">
            {orderedWithView.map(({ pagamento: p, view }) =>
              editPag === p.id && view.canEdit ? (
                <div key={p.id} className="flex items-end gap-2 px-3 py-2 flex-wrap bg-surface-2/60">
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Data</Label>
                    <Input
                      type="date"
                      value={editDraft.data}
                      onChange={(e) => setEditDraft({ ...editDraft, data: e.target.value })}
                      className="h-8 w-[135px] text-xs"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Importo €</Label>
                    <Input
                      inputMode="decimal"
                      value={editDraft.importo}
                      onChange={(e) => setEditDraft({ ...editDraft, importo: e.target.value })}
                      className="h-8 w-24 tabular-nums"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Metodo</Label>
                    <Select
                      value={editDraft.metodo}
                      onValueChange={(v) => setEditDraft({ ...editDraft, metodo: v })}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(METODO_LABEL).map(([k, l]) => (
                          <SelectItem key={k} value={k}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Tipo</Label>
                    <Select
                      value={editDraft.tipo || "__none"}
                      onValueChange={(v) => setEditDraft({ ...editDraft, tipo: v === "__none" ? "" : v })}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">—</SelectItem>
                        {Object.entries(TIPO_PAGAMENTO_LABEL).map(([k, l]) => (
                          <SelectItem key={k} value={k}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-0.5 flex-1 min-w-[120px]">
                    <Label className="text-[10px]">Nota</Label>
                    <Input
                      value={editDraft.note}
                      onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={!parse(editDraft.importo) || updatePagamento.isPending}
                    onClick={() =>
                      updatePagamento.mutate({
                        commessaId,
                        pagamentoId: p.id,
                        importo: parse(editDraft.importo)!,
                        data: editDraft.data || null,
                        metodo: editDraft.metodo as any,
                        tipo: (editDraft.tipo || null) as any,
                        note: editDraft.note.trim() || null,
                      })
                    }
                  >
                    Salva
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditPag(null)}>
                    Annulla
                  </Button>
                </div>
              ) : (
                <div
                  key={p.id}
                  className={`flex min-w-0 flex-wrap items-center gap-2 px-3 py-2 text-sm sm:flex-nowrap sm:gap-3 ${
                    p.stato === "stornato" ? "bg-surface-2/50 text-text-3" : ""
                  }`}
                >
                  <span className="tabular-nums text-text-2 w-20 shrink-0">
                    {fmtData(p.data)}
                  </span>
                  <span className="font-bold tabular-nums shrink-0">
                    € {fmt(p.importo)}
                  </span>
                  {p.tipo && (
                    <Badge className="text-[10px] shrink-0 bg-info-soft text-info border-transparent">
                      {TIPO_PAGAMENTO_LABEL[p.tipo] ?? p.tipo}
                    </Badge>
                  )}
                  {p.metodo && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {METODO_LABEL[p.metodo] ?? p.metodo}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {view.origineLabel}
                  </Badge>
                  {p.stato === "stornato" && (
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {view.statoLabel}
                    </Badge>
                  )}
                  {view.fatturaLabel && (
                    <span className="text-xs text-text-3 sm:shrink-0">
                      {view.fatturaLabel}
                    </span>
                  )}
                  {p.note && (
                    <span
                      className="order-last w-full truncate text-xs text-text-3 sm:order-none sm:min-w-0 sm:w-auto sm:flex-1"
                      title={p.note}
                    >
                      {p.note}
                    </span>
                  )}
                  <span className="hidden flex-1 sm:block" />
                  {view.canEdit && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0"
                      title="Modifica acconto"
                      aria-label="Modifica acconto"
                      onClick={() => {
                        setEditPag(p.id);
                        setEditDraft({
                          importo: String(p.importo ?? ""),
                          data: p.data ?? "",
                          metodo: p.metodo ?? "bonifico",
                          tipo: p.tipo ?? "",
                          note: p.note ?? "",
                        });
                      }}
                    >
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {view.canRemove && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-danger shrink-0"
                      title="Rimuovi acconto"
                      aria-label="Rimuovi acconto"
                      disabled={removePagamento.isPending}
                      onClick={() =>
                        removePagamento.mutate({ commessaId, pagamentoId: p.id })
                      }
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )
            )}
          </div>
        )}

        {/* Quick add */}
        {addOpen ? (
          <div className="flex gap-2 items-end flex-wrap rounded-md border border-border bg-surface-2 p-3">
            <div className="space-y-1 w-28">
              <Label className="text-xs">Importo € *</Label>
              <Input
                autoFocus
                inputMode="decimal"
                value={pForm.importo}
                onChange={(e) => setPForm({ ...pForm, importo: e.target.value })}
                className="h-9 tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data</Label>
              <Input
                type="date"
                value={pForm.data}
                onChange={(e) => setPForm({ ...pForm, data: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1 w-36">
              <Label className="text-xs">Metodo</Label>
              <Select
                value={pForm.metodo}
                onValueChange={(v) => setPForm({ ...pForm, metodo: v })}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(METODO_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-36">
              <Label className="text-xs">Tipo</Label>
              <Select
                value={pForm.tipo || "__none"}
                onValueChange={(v) => setPForm({ ...pForm, tipo: v === "__none" ? "" : v })}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {Object.entries(TIPO_PAGAMENTO_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[140px]">
              <Label className="text-xs">Nota</Label>
              <Input
                placeholder="Facoltativa"
                value={pForm.note}
                onChange={(e) => setPForm({ ...pForm, note: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="flex gap-1.5">
              <Button
                disabled={!parse(pForm.importo) || addPagamento.isPending}
                onClick={() =>
                  addPagamento.mutate({
                    commessaId,
                    importo: parse(pForm.importo)!,
                    data: pForm.data || null,
                    metodo: pForm.metodo as any,
                    tipo: (pForm.tipo || null) as any,
                    note: pForm.note.trim() || undefined,
                  })
                }
              >
                Registra
              </Button>
              <Button variant="ghost" onClick={() => setAddOpen(false)}>
                Annulla
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPForm((f) => ({ ...f, tipo: tipoPagamentoSuggerito(pagamenti.length) }));
                setAddOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Registra acconto
            </Button>
            {totale != null && totale > 0 && residuo > 0 && (
              <>
                <span className="text-xs text-text-3">rapido:</span>
                {[0.5, 0.4, 0.1].map((p) => (
                  <Button
                    key={p}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-primary"
                    onClick={() => chip(p)}
                  >
                    {Math.round(p * 100)}% (€ {fmt(Math.min(Math.round(totale * p), Math.max(0, residuo)))})
                  </Button>
                ))}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ── Economia commessa (P0.2) ────────────────────────────────────────────────
// Margine lordo = pattuito − costi fornitore − costo posa stimato.
// I costi si registrano QUI, riga per riga, come gli acconti della card
// Pagamenti: un solo posto dove scrivere un costo. Visibile solo a
// direzione/amministrazione (la query stessa è gated lato server).
const FORNITORI_COSTO = [
  "Wnd", "Oknoplast", "Alias", "Pail", "Primed", "HenryGlass", "Palmieri",
  "Errecci", "Fivizzanese", "Oskura", "Korus", "Punto del Serramento",
  "Kopern", "Citea", "Cerrato", "Brianzatende", "Seraplastic", "St Scale",
  "Sharknet",
];

function EconomiaCard({ commessaId }: { commessaId: number }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const canSee = isDirezione(user) || hasRuolo(user, "amministrazione");
  const margine = trpc.commesse.margine.useQuery(commessaId, {
    enabled: canSee,
    retry: false,
  });

  const [posa, setPosa] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const emptyCosto = {
    importo: "",
    fornitore: "",
    descrizione: "",
    data: "",
    numeroOrdine: "",
  };
  const [form, setForm] = useState(emptyCosto);

  // Ogni scrittura economica deve invalidare ANCHE commesse.margine: è una
  // query a sé, e senza questo la card rileggeva il valore vecchio dalla
  // cache facendo sembrare che il salvataggio non fosse andato a buon fine.
  const refresh = () => {
    utils.commesse.margine.invalidate(commessaId);
    utils.commesse.marginalita.invalidate();
    utils.commesse.byId.invalidate(commessaId);
    utils.commesse.list.invalidate();
  };
  const saveCostoPosa = trpc.commesse.update.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Costo posa aggiornato");
    },
    onError: (e) => toast.error(e.message ?? "Salvataggio non riuscito"),
  });
  const addCosto = trpc.commesse.addCosto.useMutation({
    onSuccess: () => {
      refresh();
      setForm(emptyCosto);
      setAddOpen(false);
      toast.success("Costo registrato");
    },
    onError: (e) => toast.error(e.message ?? "Registrazione non riuscita"),
  });
  const updateCosto = trpc.commesse.updateCosto.useMutation({
    onSuccess: () => {
      refresh();
      setEditId(null);
      toast.success("Costo aggiornato");
    },
    onError: (e) => toast.error(e.message ?? "Salvataggio non riuscito"),
  });
  const removeCosto = trpc.commesse.removeCosto.useMutation({
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e.message ?? "Rimozione non riuscita"),
  });
  const importaCosti = trpc.commesse.importaCostiDaOrdini.useMutation({
    onSuccess: (r: any) => {
      refresh();
      toast.success(`${r.importati} costi importati dagli ordini fornitore`);
    },
    onError: (e) => toast.error(e.message ?? "Import non riuscito"),
  });

  if (!canSee || !margine.data) return null;
  const m: any = margine.data;
  const costi: any[] = m.costi ?? [];

  const fmt = formatEuro;
  const parse = parseEuroPositivo;
  const fmtData = (iso: string | null) =>
    iso ? new Date(iso + "T12:00:00").toLocaleDateString("it-IT") : null;

  // Fascia di margine: ≥30% verde, 15–30% ambra, <15% rosso, grigio se i
  // dati non bastano per un numero onesto.
  const perc = m.marginePerc;
  const tone = m.datiIncompleti
    ? { text: "text-text-3", border: "" }
    : perc != null && perc >= 0.3
      ? { text: "text-success", border: "border-l-[3px] border-l-success" }
      : perc != null && perc >= 0.15
        ? { text: "text-warning", border: "border-l-[3px] border-l-warning" }
        : { text: "text-danger", border: "border-l-[3px] border-l-danger" };

  const submitAdd = () => {
    const imp = parse(form.importo);
    if (!imp) return toast.error("Importo non valido");
    addCosto.mutate({
      commessaId,
      importo: imp,
      fornitore: form.fornitore || null,
      descrizione: form.descrizione || null,
      data: form.data || null,
      numeroOrdine: form.numeroOrdine || null,
    });
  };
  const submitEdit = () => {
    const imp = parse(form.importo);
    if (!imp) return toast.error("Importo non valido");
    updateCosto.mutate({
      commessaId,
      costoId: editId!,
      importo: imp,
      fornitore: form.fornitore || null,
      descrizione: form.descrizione || null,
      data: form.data || null,
      numeroOrdine: form.numeroOrdine || null,
    });
  };

  const campiCosto = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label>Importo € *</Label>
        <Input
          inputMode="decimal"
          autoFocus
          placeholder="0"
          value={form.importo}
          onChange={(e) => setForm((f) => ({ ...f, importo: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label>Fornitore</Label>
        <Select
          value={form.fornitore || "__none"}
          onValueChange={(v) =>
            setForm((f) => ({ ...f, fornitore: v === "__none" ? "" : v }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleziona..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {form.fornitore && !FORNITORI_COSTO.includes(form.fornitore) && (
              <SelectItem value={form.fornitore}>{form.fornitore}</SelectItem>
            )}
            {FORNITORI_COSTO.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Descrizione</Label>
        <Input
          placeholder="es. Finestre PVC, persiane..."
          value={form.descrizione}
          onChange={(e) => setForm((f) => ({ ...f, descrizione: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label>N° ordine</Label>
        <Input
          placeholder="es. 2026/4471"
          value={form.numeroOrdine}
          onChange={(e) => setForm((f) => ({ ...f, numeroOrdine: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label>Data</Label>
        <Input
          type="date"
          value={form.data}
          onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
        />
      </div>
    </div>
  );

  return (
    <Card className={tone.border}>
      <CardContent className="py-4 space-y-3">
        {/* Riga sintesi: pattuito · costi · posa · margine */}
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-info-soft text-info">
              <TrendingUp className="h-5 w-5" />
            </span>
            <span className="font-semibold text-sm">Stima economia CRM</span>
          </div>

          <div className="space-y-0.5">
            <div className="eyebrow">Pattuito</div>
            <div className="tabular-nums font-medium">
              {m.ricavi != null ? `€ ${fmt(m.ricavi)}` : "—"}
            </div>
          </div>

          <div className="space-y-0.5">
            <div className="eyebrow">Costi manuali stimati</div>
            <div className="tabular-nums font-medium">
              € {fmt(m.costiFornitore)}
              <span className="text-text-3 text-xs ml-1">({costi.length})</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-text-3">Costo posa stimato €</Label>
            <Input
              inputMode="decimal"
              placeholder="—"
              className="h-8 w-32"
              value={posa ?? (m.costoPosa != null ? String(m.costoPosa) : "")}
              onChange={(e) => setPosa(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={() => {
                if (posa == null) return;
                const raw = posa.trim();
                // Vuoto = "non impostato". Zero è un valore legittimo (posa
                // fatta in casa), quindi qui accetto anche 0 — a differenza
                // degli importi dei costi, dove 0 non ha senso.
                const n = parseEuroNonNegativo(raw);
                if (raw !== "" && n == null) {
                  toast.error("Costo posa non valido");
                  setPosa(null);
                  return;
                }
                const v = raw === "" ? null : n;
                if (v !== (m.costoPosa ?? null)) {
                  saveCostoPosa.mutate({ id: commessaId, costoPosaStimato: v });
                }
                setPosa(null);
              }}
            />
          </div>

          <div className="ml-auto text-right space-y-0.5">
            <div className="eyebrow">Margine stimato</div>
            {m.datiIncompleti ? (
              <div className="text-sm text-text-3">
                Dati incompleti
                <div className="text-[11px]">
                  {m.ricavi == null
                    ? "manca il totale pattuito"
                    : "nessun costo registrato"}
                </div>
              </div>
            ) : (
              <div className={`tabular-nums font-bold text-lg ${tone.text}`}>
                € {fmt(m.margineLordo ?? 0)}
                {perc != null && (
                  <span className="text-sm font-semibold ml-1.5">
                    ({Math.round(perc * 100)}%)
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Registro costi */}
        {costi.length > 0 && (
          <div className="space-y-1.5">
            {costi.map((c: any) =>
              editId === c.id ? (
                <div
                  key={c.id}
                  className="rounded-lg border border-primary/40 bg-surface-2 px-3 py-3 space-y-3"
                >
                  {campiCosto}
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setEditId(null)}>
                      Annulla
                    </Button>
                    <Button size="sm" onClick={submitEdit} disabled={updateCosto.isPending}>
                      Salva
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 flex-wrap"
                >
                  <span className="tabular-nums font-bold">€ {fmt(c.importo)}</span>
                  {c.fornitore && (
                    <Badge variant="secondary" className="text-[10px]">
                      {c.fornitore}
                    </Badge>
                  )}
                  {c.descrizione && (
                    <span className="text-sm text-text-2">{c.descrizione}</span>
                  )}
                  {c.numeroOrdine && (
                    <span className="codice-mono text-xs text-text-3">
                      {c.numeroOrdine}
                    </span>
                  )}
                  {fmtData(c.data) && (
                    <span className="text-xs text-text-3 tabular-nums">
                      {fmtData(c.data)}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditId(c.id);
                        setAddOpen(false);
                        setForm({
                          importo: String(c.importo ?? ""),
                          fornitore: c.fornitore ?? "",
                          descrizione: c.descrizione ?? "",
                          data: c.data ?? "",
                          numeroOrdine: c.numeroOrdine ?? "",
                        });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-danger"
                      onClick={() =>
                        removeCosto.mutate({ commessaId, costoId: c.id })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* Nuovo costo + import una tantum dagli ordini fornitore */}
        {addOpen ? (
          <div className="rounded-lg border border-primary/40 bg-surface-2 px-3 py-3 space-y-3">
            {campiCosto}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>
                Annulla
              </Button>
              <Button size="sm" onClick={submitAdd} disabled={addCosto.isPending}>
                Registra costo
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setForm(emptyCosto);
                setEditId(null);
                setAddOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Aggiungi costo fornitore
            </Button>
            {(m.ordiniImportabili?.length ?? 0) > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-primary"
                onClick={() => importaCosti.mutate(commessaId)}
                disabled={importaCosti.isPending}
              >
                Importa {m.ordiniImportabili.length} ordini già a sistema
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Squadra di posa ─────────────────────────────────────────────────────────
// Chi va in cantiere su questa commessa. Il campo squadraId esisteva già sul
// modello ma non era esposto da nessuna parte: le squadre si assegnavano solo
// al singolo intervento, quindi guardando una commessa non si sapeva chi la
// stesse posando.
//
// La card diventa richiesta esplicita (bordo ambra, "da assegnare") quando la
// commessa entra nelle fasi di posa e nessuno è stato assegnato.
const FASI_POSA = ["attesa_posa", "finiture_saldo", "interventi_regolazioni"];

function SquadraPosaCard({
  commessa,
  squadre,
  onAssegna,
  salvataggioInCorso,
}: {
  commessa: any;
  squadre: any[];
  onAssegna: (squadraId: number | null) => void;
  salvataggioInCorso: boolean;
}) {
  if (!commessa) return null;

  const inPosa = FASI_POSA.includes(commessa.stato);
  const squadra = squadre.find((s) => s.id === commessa.squadraId) ?? null;
  const daAssegnare = inPosa && !squadra;

  return (
    <Card
      className={
        daAssegnare
          ? "border-l-[3px] border-l-warning"
          : squadra
            ? "border-l-[3px] border-l-info"
            : ""
      }
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`grid h-9 w-9 place-items-center rounded-lg ${
                daAssegnare ? "bg-warning-soft text-warning" : "bg-info-soft text-info"
              }`}
            >
              <HardHat className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <div className="font-semibold text-sm">Squadra di posa</div>
              {daAssegnare ? (
                <div className="text-xs text-warning">
                  Da assegnare — la commessa è in fase di posa
                </div>
              ) : squadra ? (
                <div className="text-xs text-text-2">
                  {squadra.caposquadra
                    ? `Caposquadra ${squadra.caposquadra}`
                    : "Assegnata"}
                  {squadra.telefono ? ` · ${squadra.telefono}` : ""}
                </div>
              ) : (
                <div className="text-xs text-text-3">Nessuna squadra assegnata</div>
              )}
            </div>
          </div>

          <div className="min-w-[220px] flex-1 max-w-sm">
            <SearchSelect
              options={squadre.map((s: any) => ({
                value: String(s.id),
                label: s.nome,
                keywords: [s.nome, s.caposquadra, s.telefono]
                  .filter(Boolean)
                  .join(" "),
                hint: s.caposquadra ?? undefined,
              }))}
              value={commessa.squadraId ? String(commessa.squadraId) : ""}
              onChange={(v) =>
                onAssegna(v && v !== "__none__" ? parseInt(v) : null)
              }
              placeholder={daAssegnare ? "Assegna una squadra" : "Nessuna squadra"}
              searchPlaceholder="Cerca squadra..."
              allowClear
              clearLabel="— Nessuna —"
            />
          </div>

          {salvataggioInCorso && (
            <span className="text-xs text-text-3">Salvataggio…</span>
          )}

          {squadre.length === 0 && (
            <span className="text-xs text-text-3">
              Nessuna squadra registrata — creale in «Squadre di posa».
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
