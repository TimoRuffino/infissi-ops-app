import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, User, UserPlus, MoreHorizontal, Trash2, ArrowRight, Archive } from "lucide-react";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import SearchSelect from "@/components/SearchSelect";
import StatoChip from "@/components/StatoChip";
import DeleteCommessaDialog from "@/components/DeleteCommessaDialog";
import { PRIORITA_VARIANT, PRIORITA_LABEL, STATI_ORDER, statoLabel } from "@/lib/stato";

type DeleteTarget = { id: number; codice: string; stato: string } | null;

const emptyForm = {
  clienteId: "" as string,
  cliente: "",
  indirizzo: "",
  citta: "",
  telefono: "",
  email: "",
  priorita: "media" as "bassa" | "media" | "alta" | "urgente",
  note: "",
  consegnaIndicativa: "60" as "30" | "60" | "90",
  assegnatoA: "" as string,
};

const emptyClienteForm = {
  nome: "",
  cognome: "",
  tipo: "privato" as "privato" | "azienda" | "condominio" | "ente_pubblico",
  telefono: "",
  email: "",
  indirizzo: "",
  citta: "",
  assegnatoA: "" as string,
};

export default function CommesseList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filtroStato, setFiltroStato] = useState<string>("tutti");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const [onlyMine, setOnlyMine] = useState(false);
  const currentUser = trpc.auth.me.useQuery(undefined, { retry: false });

  const commesse = trpc.commesse.list.useQuery({
    search: search || undefined,
    stato: filtroStato !== "tutti" ? filtroStato : undefined,
    assegnatoA: onlyMine && currentUser.data ? currentUser.data.id : undefined,
  });
  const clientiList = trpc.clienti.list.useQuery({});
  const utentiList = trpc.utenti.list.useQuery(undefined);

  const utenteById = useMemo(() => {
    const map = new Map<number, any>();
    for (const u of utentiList.data ?? []) map.set(u.id, u);
    return map;
  }, [utentiList.data]);

  const utils = trpc.useUtils();
  const createMutation = trpc.commesse.create.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      utils.clienti.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
    },
  });

  // Inline cliente creation from inside the "Nuova commessa" dialog.
  const createClienteMutation = trpc.clienti.create.useMutation({
    onSuccess: (cliente) => {
      utils.clienti.invalidate();
      // Auto-select the freshly created cliente in the commessa form + inherit
      // its fields.
      const nomeCognome = `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim();
      setForm((prev) => ({
        ...prev,
        clienteId: String(cliente.id),
        cliente: nomeCognome,
        indirizzo: cliente.indirizzo ?? "",
        citta: cliente.citta ?? "",
        telefono: cliente.telefono ?? "",
        email: cliente.email ?? "",
        assegnatoA: cliente.assegnatoA ? String(cliente.assegnatoA) : prev.assegnatoA,
      }));
      setClienteDialogOpen(false);
      setClienteForm(emptyClienteForm);
    },
  });

  const deleteCommessa = trpc.commesse.delete.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setDeleteTarget(null);
    },
  });

  const archiveCommessa = trpc.commesse.archive.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      toast.success("Commessa archiviata");
    },
    onError: (e) => toast.error(e.message ?? "Archiviazione non riuscita"),
  });

  const [form, setForm] = useState(emptyForm);
  const [clienteDialogOpen, setClienteDialogOpen] = useState(false);
  const [clienteForm, setClienteForm] = useState(emptyClienteForm);

  function handleClienteSelect(clienteIdStr: string) {
    // Empty string from "Cliente non registrato" clear action.
    if (!clienteIdStr) {
      setForm({ ...form, clienteId: "", cliente: "", indirizzo: "", citta: "", telefono: "", email: "" });
      return;
    }
    const id = parseInt(clienteIdStr, 10);
    const c = clientiList.data?.find((x: any) => x.id === id);
    if (c) {
      const nomeCognome = `${c.cognome ?? ""} ${c.nome ?? ""}`.trim();
      setForm({
        ...form,
        clienteId: clienteIdStr,
        cliente: nomeCognome,
        indirizzo: c.indirizzo ?? "",
        citta: c.citta ?? "",
        telefono: c.telefono ?? "",
        email: c.email ?? "",
        // Inherit cliente owner by default so the commessa is tagged to the
        // same user that onboarded the cliente.
        assegnatoA: c.assegnatoA ? String(c.assegnatoA) : form.assegnatoA,
      });
    }
  }

  function handleCreate() {
    if (!form.cliente) return;
    createMutation.mutate({
      clienteId: form.clienteId ? parseInt(form.clienteId, 10) : undefined,
      cliente: form.cliente,
      indirizzo: form.indirizzo || undefined,
      citta: form.citta || undefined,
      telefono: form.telefono || undefined,
      email: form.email || undefined,
      priorita: form.priorita,
      note: form.note || undefined,
      consegnaIndicativa: form.consegnaIndicativa,
      assegnatoA: form.assegnatoA ? parseInt(form.assegnatoA, 10) : undefined,
    });
  }

  function handleCreateCliente() {
    if (!clienteForm.nome || !clienteForm.cognome) return;
    createClienteMutation.mutate({
      nome: clienteForm.nome,
      cognome: clienteForm.cognome,
      tipo: clienteForm.tipo,
      telefono: clienteForm.telefono || undefined,
      email: clienteForm.email || undefined,
      indirizzo: clienteForm.indirizzo || undefined,
      citta: clienteForm.citta || undefined,
      assegnatoA: clienteForm.assegnatoA ? parseInt(clienteForm.assegnatoA, 10) : undefined,
    });
  }

  // Build options for SearchSelect
  const clienteOptions = useMemo(
    () =>
      (clientiList.data ?? []).map((c: any) => ({
        value: String(c.id),
        label: `${c.cognome ?? ""} ${c.nome ?? ""}`.trim() || "(senza nome)",
        keywords: [c.email, c.telefono, c.citta].filter(Boolean).join(" "),
        hint: c.citta ?? undefined,
      })),
    [clientiList.data]
  );
  const utenteOptions = useMemo(
    () =>
      (utentiList.data ?? []).map((u: any) => ({
        value: String(u.id),
        label: `${u.cognome ?? ""} ${u.nome ?? ""}`.trim(),
        keywords: u.email,
        hint: Array.isArray(u.ruoli) ? u.ruoli[0] : undefined,
      })),
    [utentiList.data]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em]">
            Commesse
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Archivio commesse e stato avanzamento
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuova commessa
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuova commessa</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Il codice sara generato automaticamente (formato COM-ANNO-NUMERO).
              </div>
              <div className="space-y-2">
                <Label>Cliente *</Label>
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <SearchSelect
                      options={clienteOptions}
                      value={form.clienteId}
                      onChange={handleClienteSelect}
                      placeholder="Cerca cliente..."
                      searchPlaceholder="Nome, email, città..."
                      emptyText="Nessun cliente trovato"
                      allowClear
                      clearLabel="Cliente non registrato"
                      onCreate={() => {
                        setClienteForm({
                          ...emptyClienteForm,
                          assegnatoA: currentUser.data ? String(currentUser.data.id) : "",
                        });
                        setClienteDialogOpen(true);
                      }}
                      createLabel="+ Crea nuovo cliente"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Crea nuovo cliente"
                    onClick={() => {
                      setClienteForm({
                        ...emptyClienteForm,
                        assegnatoA: currentUser.data ? String(currentUser.data.id) : "",
                      });
                      setClienteDialogOpen(true);
                    }}
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>
                {form.clienteId === "" && (
                  <Input
                    placeholder="Nome cliente non registrato *"
                    value={form.cliente}
                    onChange={(e) => setForm({ ...form, cliente: e.target.value })}
                    className="mt-1.5"
                  />
                )}
                {form.clienteId !== "" && (
                  <p className="text-xs text-muted-foreground mt-1">{form.cliente}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Assegnata a</Label>
                <SearchSelect
                  options={utenteOptions}
                  value={form.assegnatoA}
                  onChange={(v) => setForm({ ...form, assegnatoA: v })}
                  placeholder="Nessuno"
                  searchPlaceholder="Cerca utente..."
                  allowClear
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Priorita</Label>
                  <Select
                    value={form.priorita}
                    onValueChange={(v: any) =>
                      setForm({ ...form, priorita: v })
                    }
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
                <div className="space-y-2">
                  <Label>Consegna indicativa</Label>
                  <Select
                    value={form.consegnaIndicativa}
                    onValueChange={(v: any) =>
                      setForm({ ...form, consegnaIndicativa: v })
                    }
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
                <div className="space-y-2">
                  <Label>Indirizzo</Label>
                  <Input
                    value={form.indirizzo}
                    onChange={(e) =>
                      setForm({ ...form, indirizzo: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Citta</Label>
                  <Input
                    value={form.citta}
                    onChange={(e) =>
                      setForm({ ...form, citta: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Telefono</Label>
                  <Input
                    value={form.telefono}
                    onChange={(e) =>
                      setForm({ ...form, telefono: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Note</Label>
                <Textarea
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  rows={2}
                />
              </div>
              <Button onClick={handleCreate} disabled={!form.cliente || createMutation.isPending}>
                {createMutation.isPending ? "Creazione..." : "Crea commessa"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Sticky toolbar: search + stato + only-mine + counter */}
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-background border-b border-border">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
            <Input
              placeholder="Cerca per codice, cliente, città…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={filtroStato} onValueChange={setFiltroStato}>
            <SelectTrigger className="w-[190px] h-9">
              <SelectValue placeholder="Stato" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tutti">Tutti gli stati</SelectItem>
              {STATI_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {statoLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {currentUser.data && (
            <Button
              variant={onlyMine ? "default" : "outline"}
              size="sm"
              onClick={() => setOnlyMine(!onlyMine)}
            >
              <User className="h-3.5 w-3.5 mr-1" />
              {onlyMine ? "Solo mie" : "Tutte"}
            </Button>
          )}
          <span className="ml-auto text-sm text-text-2 tabular-nums">
            {commesse.data?.length ?? 0} commesse
          </span>
        </div>
      </div>

      {/* Commesse — dense table */}
      <div className="rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-[52px] z-20 bg-surface-2">
            <tr className="border-b border-border text-left [&>th]:bg-surface-2 [&>th]:shadow-[inset_0_-1px_0_var(--color-border)]">
              <th className="eyebrow font-semibold px-3 sm:px-4 py-2.5">Codice</th>
              <th className="eyebrow font-semibold px-3 sm:px-4 py-2.5">Cliente</th>
              <th className="eyebrow font-semibold px-3 sm:px-4 py-2.5">Stato</th>
              <th className="eyebrow font-semibold px-4 py-2.5 hidden lg:table-cell">Assegnata</th>
              <th className="eyebrow font-semibold px-4 py-2.5 hidden md:table-cell">Città</th>
              <th className="eyebrow font-semibold px-4 py-2.5 hidden xl:table-cell">Consegna stimata</th>
              <th className="eyebrow font-semibold px-4 py-2.5 hidden sm:table-cell">Priorità</th>
              <th className="eyebrow font-semibold px-4 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {commesse.data?.map((c: any) => {
              const assignee = c.assegnatoA ? utenteById.get(c.assegnatoA) : null;
              const consegna = c.dataConsegnaConfermata
                ? new Date(c.dataConsegnaConfermata).toLocaleDateString("it-IT")
                : c.dataConsegnaIndicativa
                ? new Date(c.dataConsegnaIndicativa).toLocaleDateString("it-IT")
                : c.consegnaIndicativa
                ? `~${c.consegnaIndicativa} giorni`
                : "—";
              return (
                <tr
                  key={c.id}
                  className="border-b border-border last:border-0 h-14 hover:bg-surface-2 cursor-pointer transition-colors"
                  onClick={() => setLocation(`/commesse/${c.id}`)}
                >
                  <td className="px-3 sm:px-4">
                    <span className="codice-mono text-text-2">{c.codice}</span>
                  </td>
                  <td className="px-3 sm:px-4 font-medium text-text-1">{c.cliente || "—"}</td>
                  <td className="px-3 sm:px-4">
                    <StatoChip stato={c.stato} />
                  </td>
                  <td className="px-4 text-text-2 hidden lg:table-cell">
                    {assignee ? `${assignee.cognome} ${assignee.nome}` : "—"}
                  </td>
                  <td className="px-4 text-text-2 hidden md:table-cell">{c.citta || "—"}</td>
                  <td className="px-4 text-text-2 tabular-nums hidden xl:table-cell">{consegna}</td>
                  <td className="px-4 hidden sm:table-cell">
                    <Badge variant={PRIORITA_VARIANT[c.priorita] ?? "secondary"}>
                      {PRIORITA_LABEL[c.priorita] ?? c.priorita}
                    </Badge>
                  </td>
                  <td className="px-2" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="text-text-3">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => setLocation(`/commesse/${c.id}`)}>
                          <ArrowRight className="h-4 w-4" /> Apri scheda
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => archiveCommessa.mutate(c.id)}>
                          <Archive className="h-4 w-4" /> Archivia
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-danger focus:text-danger"
                          onClick={() =>
                            setDeleteTarget({ id: c.id, codice: c.codice, stato: c.stato })
                          }
                        >
                          <Trash2 className="h-4 w-4" /> Elimina
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {commesse.data?.length === 0 && (
          <div className="text-center py-14 text-text-2">
            <p className="text-sm">Nessuna commessa trovata</p>
          </div>
        )}
      </div>

      <DeleteCommessaDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        codice={deleteTarget?.codice ?? null}
        stato={deleteTarget?.stato ?? null}
        onConfirm={() => deleteTarget && deleteCommessa.mutate(deleteTarget.id)}
      />

      {/* Inline "Nuovo cliente" dialog — nested under Nuova commessa */}
      <Dialog open={clienteDialogOpen} onOpenChange={setClienteDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
            <div className="space-y-1.5">
              <Label>Assegnato a</Label>
              <SearchSelect
                options={utenteOptions}
                value={clienteForm.assegnatoA}
                onChange={(v) => setClienteForm({ ...clienteForm, assegnatoA: v })}
                placeholder="Nessuno"
                searchPlaceholder="Cerca utente..."
                allowClear
              />
            </div>
            <Button
              onClick={handleCreateCliente}
              disabled={
                !clienteForm.nome || !clienteForm.cognome || createClienteMutation.isPending
              }
            >
              {createClienteMutation.isPending ? "Creazione..." : "Crea e seleziona"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
