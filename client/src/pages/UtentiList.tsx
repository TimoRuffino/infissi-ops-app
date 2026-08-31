import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { UserPermissionsDialog } from "@/components/users/UserPermissionsDialog";
import {
  Plus,
  Pencil,
  Trash2,
  Shield,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

const RUOLI = [
  { value: "direzione", label: "Direzione" },
  { value: "amministrazione", label: "Amministrazione" },
  { value: "commerciale", label: "Commerciale" },
  { value: "tecnico_rilievi", label: "Tecnico Rilievi" },
  { value: "squadra_posa", label: "Squadra Posa" },
  { value: "post_vendita", label: "Post-Vendita" },
  { value: "ordini", label: "Ordini" },
] as const;

type RuoloValue = (typeof RUOLI)[number]["value"];

const RUOLO_COLORS: Record<string, string> = {
  direzione: "bg-brand-soft text-accent-text",
  amministrazione: "bg-st-contratto-soft text-st-contratto",
  commerciale: "bg-info-soft text-info",
  tecnico_rilievi: "bg-st-misure-soft text-st-misure",
  squadra_posa: "bg-st-produzione-soft text-st-produzione",
  post_vendita: "bg-danger-soft text-danger",
  ordini: "bg-st-ordine-soft text-st-ordine",
};

const MAX_RUOLI = 3;

type DeleteTarget = { id: number; label: string } | null;

const emptyForm = {
  nome: "",
  cognome: "",
  email: "",
  telefono: "",
  ruoli: ["commerciale"] as RuoloValue[],
  sediIds: [1] as number[],
  password: "",
};

export default function UtentiList() {
  const [search, setSearch] = useState("");
  const [filtroRuolo, setFiltroRuolo] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [permissionsTarget, setPermissionsTarget] = useState<any | null>(null);

  const utenti = trpc.utenti.list.useQuery({
    ruolo: (filtroRuolo || undefined) as any,
    search: search || undefined,
  });
  const stats = trpc.utenti.stats.useQuery();
  const sediAll = trpc.sedi.listAll.useQuery();
  const utils = trpc.useUtils();

  const createUtente = trpc.utenti.create.useMutation({
    onSuccess: () => {
      utils.utenti.invalidate();
      setCreateOpen(false);
      setForm(emptyForm);
    },
  });

  const updateUtente = trpc.utenti.update.useMutation({
    onSuccess: () => {
      utils.utenti.invalidate();
      setEditOpen(false);
    },
  });

  const deleteUtente = trpc.utenti.delete.useMutation({
    onSuccess: () => {
      utils.utenti.invalidate();
      setDeleteTarget(null);
    },
  });

  function openEdit(u: any) {
    setEditId(u.id);
    const ruoli: RuoloValue[] =
      Array.isArray(u.ruoli) && u.ruoli.length > 0
        ? u.ruoli
        : u.ruolo
          ? [u.ruolo]
          : ["commerciale"];
    setForm({
      nome: u.nome,
      cognome: u.cognome,
      email: u.email,
      telefono: u.telefono ?? "",
      ruoli,
      sediIds:
        Array.isArray(u.sediIds) && u.sediIds.length > 0 ? u.sediIds : [1],
      password: "",
    });
    setShowPassword(false);
    setEditOpen(true);
  }

  function toggleSede(id: number) {
    const has = form.sediIds.includes(id);
    if (has) {
      if (form.sediIds.length === 1) return; // keep at least one sede
      setForm({ ...form, sediIds: form.sediIds.filter(x => x !== id) });
    } else {
      setForm({ ...form, sediIds: [...form.sediIds, id] });
    }
  }

  function toggleAttivo(u: any) {
    updateUtente.mutate({ id: u.id, attivo: !u.attivo });
  }

  function toggleRuolo(r: RuoloValue) {
    const has = form.ruoli.includes(r);
    if (has) {
      if (form.ruoli.length === 1) return; // min 1 role
      setForm({ ...form, ruoli: form.ruoli.filter(x => x !== r) });
    } else {
      if (form.ruoli.length >= MAX_RUOLI) return; // max 3 roles
      setForm({ ...form, ruoli: [...form.ruoli, r] });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gestione utenti</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Utenti e profili di accesso (max {MAX_RUOLI} ruoli per utente)
          </p>
        </div>
        <Button
          onClick={() => {
            setForm(emptyForm);
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> Nuovo utente
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {RUOLI.map(r => (
          <Card
            key={r.value}
            className="cursor-pointer hover:shadow-sm"
            onClick={() =>
              setFiltroRuolo(filtroRuolo === r.value ? "" : r.value)
            }
          >
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold">
                {(stats.data as any)?.perRuolo?.[r.value] ?? 0}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {r.label}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Cerca nome, cognome, email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={filtroRuolo}
          onValueChange={v => setFiltroRuolo(v === "tutti" ? "" : v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Tutti i ruoli" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti i ruoli</SelectItem>
            {RUOLI.map(r => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* User list */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {utenti.data?.map((u: any) => {
          const userRuoli: string[] =
            Array.isArray(u.ruoli) && u.ruoli.length > 0
              ? u.ruoli
              : u.ruolo
                ? [u.ruolo]
                : [];
          return (
            <Card
              key={u.id}
              className={`transition-all ${!u.attivo ? "opacity-50" : ""}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                      {u.cognome.charAt(0)}
                      {u.nome.charAt(0)}
                    </div>
                    <div>
                      <CardTitle className="text-sm">
                        {u.cognome} {u.nome}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Gestisci accessi di ${u.nome} ${u.cognome}`}
                      title="Gestisci accessi"
                      onClick={() => setPermissionsTarget(u)}
                    >
                      <ShieldCheck className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Modifica ${u.nome} ${u.cognome}`}
                      title="Modifica profilo"
                      onClick={() => openEdit(u)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      aria-label={`Elimina ${u.nome} ${u.cognome}`}
                      title="Elimina utente"
                      onClick={() =>
                        setDeleteTarget({
                          id: u.id,
                          label: `${u.cognome} ${u.nome}`,
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {userRuoli.map(ruolo => (
                      <Badge
                        key={ruolo}
                        className={`text-[10px] ${RUOLO_COLORS[ruolo] ?? ""}`}
                        variant="secondary"
                      >
                        <Shield className="h-2.5 w-2.5 mr-1" />
                        {RUOLI.find(r => r.value === ruolo)?.label ?? ruolo}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 text-[10px] shrink-0 ${u.attivo ? "text-success" : "text-danger"}`}
                    onClick={() => toggleAttivo(u)}
                  >
                    {u.attivo ? "Attivo" : "Disattivato"}
                  </Button>
                </div>
                {u.telefono && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    {u.telefono}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuovo utente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cognome</Label>
                <Input
                  value={form.cognome}
                  onChange={e => setForm({ ...form, cognome: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telefono</Label>
              <Input
                value={form.telefono}
                onChange={e => setForm({ ...form, telefono: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Ruoli (max {MAX_RUOLI}) — {form.ruoli.length} selezionati
              </Label>
              <div className="grid grid-cols-2 gap-1.5">
                {RUOLI.map(r => {
                  const checked = form.ruoli.includes(r.value);
                  const disabled = !checked && form.ruoli.length >= MAX_RUOLI;
                  return (
                    <label
                      key={r.value}
                      className={`flex items-center gap-2 rounded-md border p-2 text-xs cursor-pointer transition-colors ${checked ? "bg-primary/5 border-primary" : "hover:bg-muted"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleRuolo(r.value)}
                      />
                      {r.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Sedi assegnate — {form.sediIds.length} selezionate</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {(sediAll.data ?? []).map((s: any) => {
                  const checked = form.sediIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-center gap-2 rounded-md border p-2 text-xs cursor-pointer transition-colors ${checked ? "bg-primary/5 border-primary" : "hover:bg-muted"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSede(s.id)}
                      />
                      {s.nome}
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                L'utente potrà lavorare e switchare solo tra le sedi
                selezionate.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" /> Password
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Min. 12 caratteri"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <Button
              onClick={() => {
                if (
                  !form.nome ||
                  !form.cognome ||
                  !form.email ||
                  !form.password ||
                  form.password.length < 12 ||
                  form.ruoli.length === 0
                )
                  return;
                createUtente.mutate({
                  nome: form.nome,
                  cognome: form.cognome,
                  email: form.email,
                  telefono: form.telefono || undefined,
                  ruoli: form.ruoli as any,
                  sediIds: form.sediIds,
                  password: form.password,
                });
              }}
              disabled={createUtente.isPending}
            >
              Crea utente
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifica utente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cognome</Label>
                <Input
                  value={form.cognome}
                  onChange={e => setForm({ ...form, cognome: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telefono</Label>
              <Input
                value={form.telefono}
                onChange={e => setForm({ ...form, telefono: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Ruoli (max {MAX_RUOLI}) — {form.ruoli.length} selezionati
              </Label>
              <div className="grid grid-cols-2 gap-1.5">
                {RUOLI.map(r => {
                  const checked = form.ruoli.includes(r.value);
                  const disabled = !checked && form.ruoli.length >= MAX_RUOLI;
                  return (
                    <label
                      key={r.value}
                      className={`flex items-center gap-2 rounded-md border p-2 text-xs cursor-pointer transition-colors ${checked ? "bg-primary/5 border-primary" : "hover:bg-muted"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleRuolo(r.value)}
                      />
                      {r.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Sedi assegnate — {form.sediIds.length} selezionate</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {(sediAll.data ?? []).map((s: any) => {
                  const checked = form.sediIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-center gap-2 rounded-md border p-2 text-xs cursor-pointer transition-colors ${checked ? "bg-primary/5 border-primary" : "hover:bg-muted"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSede(s.id)}
                      />
                      {s.nome}
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                L'utente potrà lavorare e switchare solo tra le sedi
                selezionate.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" /> Nuova password
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Lascia vuoto per non cambiare"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Lascia vuoto per mantenere la password attuale
              </p>
            </div>
            <Button
              onClick={() => {
                if (!editId || form.ruoli.length === 0) return;
                updateUtente.mutate({
                  id: editId,
                  nome: form.nome || undefined,
                  cognome: form.cognome || undefined,
                  email: form.email || undefined,
                  telefono: form.telefono || undefined,
                  ruoli: form.ruoli as any,
                  sediIds: form.sediIds,
                  ...(form.password.length >= 12
                    ? { password: form.password }
                    : {}),
                });
              }}
              disabled={updateUtente.isPending}
            >
              Salva modifiche
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open: boolean) => !open && setDeleteTarget(null)}
        title="Elimina utente"
        description={`Confermi l'eliminazione di "${deleteTarget?.label}"?`}
        confirmLabel="Elimina utente"
        onConfirm={() => deleteTarget && deleteUtente.mutate(deleteTarget.id)}
      />
      <UserPermissionsDialog
        user={permissionsTarget}
        open={permissionsTarget != null}
        onOpenChange={open => !open && setPermissionsTarget(null)}
        onEdit={openEdit}
      />
    </div>
  );
}
