import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Contact,
  Plus,
  Search,
  Building2,
  User,
  Landmark,
  Home,
  UserCircle,
  MoreHorizontal,
  ArrowRight,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import SearchSelect from "@/components/SearchSelect";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const tipoIcons: Record<string, any> = {
  privato: User,
  azienda: Building2,
  condominio: Home,
  ente_pubblico: Landmark,
};

const tipoLabels: Record<string, string> = {
  privato: "Privato",
  azienda: "Azienda",
  condominio: "Condominio",
  ente_pubblico: "Ente pubblico",
};

const praticaEdiliziaLabels: Record<string, string> = {
  nessuna: "Nessuna pratica edilizia",
  cil: "CIL",
  cila: "CILA",
  scia: "SCIA",
};

const emptyForm = {
  nome: "",
  cognome: "",
  tipo: "privato" as const,
  codiceFiscale: "",
  partitaIva: "",
  // Residenza — for fatture / admin
  indirizzo: "",
  citta: "",
  cap: "",
  // Indirizzo lavoro — what commessa uses
  indirizzoLavoro: "",
  cittaLavoro: "",
  capLavoro: "",
  lavoroStessoResidenza: true,
  telefono: "",
  email: "",
  detrazione: false,
  tipoDetrazione: "" as "" | "ecobonus" | "ristrutturazione",
  interesseFinanziamento: false,
  praticaEdilizia: "nessuna" as "nessuna" | "cil" | "cila" | "scia",
  note: "",
  assegnatoA: null as number | null,
};

export default function ClientiList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string | undefined>(undefined);
  const [onlyMine, setOnlyMine] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const currentUser = trpc.auth.me.useQuery();
  const utentiList = trpc.utenti.list.useQuery(undefined);

  const clienti = trpc.clienti.list.useQuery({
    search: search || undefined,
    tipo: tipoFilter,
    assegnatoA: onlyMine ? (currentUser.data?.id as number | undefined) : undefined,
  });
  const stats = trpc.clienti.stats.useQuery();
  const utils = trpc.useUtils();

  const createCliente = trpc.clienti.create.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
    },
  });

  const [form, setForm] = useState(emptyForm);

  const utenteById = useMemo(() => {
    const map = new Map<number, any>();
    for (const u of utentiList.data ?? []) map.set(u.id, u);
    return map;
  }, [utentiList.data]);

  const utenteOptions = useMemo(
    () =>
      (utentiList.data ?? []).map((u: any) => ({
        value: String(u.id),
        label: u.nome ?? u.email ?? `Utente ${u.id}`,
        keywords: [u.email, u.ruolo, u.ruoli?.join(" ")].filter(Boolean).join(" "),
        hint: u.ruolo ?? u.ruoli?.[0],
      })),
    [utentiList.data]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <Contact className="h-6 w-6 text-primary" />
            Clienti
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Anagrafica clienti — {stats.data?.totale ?? 0} totali
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuovo cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuovo cliente</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Nome *</Label>
                  <Input
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Cognome *</Label>
                  <Input
                    value={form.cognome}
                    onChange={(e) =>
                      setForm({ ...form, cognome: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v: any) => setForm({ ...form, tipo: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                  <Label>Codice fiscale</Label>
                  <Input
                    value={form.codiceFiscale}
                    onChange={(e) =>
                      setForm({ ...form, codiceFiscale: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Partita IVA</Label>
                  <Input
                    value={form.partitaIva}
                    onChange={(e) =>
                      setForm({ ...form, partitaIva: e.target.value })
                    }
                  />
                </div>
              </div>
              {/* Residenza — for fatture / admin */}
              <div className="rounded-md border p-3 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Indirizzo di residenza (fatturazione)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label>Indirizzo</Label>
                    <Input
                      value={form.indirizzo}
                      onChange={(e) =>
                        setForm({ ...form, indirizzo: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>CAP</Label>
                    <Input
                      value={form.cap}
                      onChange={(e) => setForm({ ...form, cap: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Citta</Label>
                  <Input
                    value={form.citta}
                    onChange={(e) =>
                      setForm({ ...form, citta: e.target.value })
                    }
                  />
                </div>
              </div>
              {/* Lavoro — what commessa uses by default */}
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Indirizzo dove va effettuato il lavoro
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={form.lavoroStessoResidenza}
                      onCheckedChange={(v) =>
                        setForm({ ...form, lavoroStessoResidenza: v })
                      }
                    />
                    <span className="text-muted-foreground">Stesso della residenza</span>
                  </label>
                </div>
                {!form.lavoroStessoResidenza && (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5 col-span-2">
                        <Label>Indirizzo lavoro</Label>
                        <Input
                          value={form.indirizzoLavoro}
                          onChange={(e) =>
                            setForm({ ...form, indirizzoLavoro: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>CAP</Label>
                        <Input
                          value={form.capLavoro}
                          onChange={(e) =>
                            setForm({ ...form, capLavoro: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Citta lavoro</Label>
                      <Input
                        value={form.cittaLavoro}
                        onChange={(e) =>
                          setForm({ ...form, cittaLavoro: e.target.value })
                        }
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Telefono</Label>
                  <Input
                    value={form.telefono}
                    onChange={(e) =>
                      setForm({ ...form, telefono: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Detrazione fiscale</div>
                    <div className="text-xs text-muted-foreground">
                      Il cliente vuole usufruirne?
                    </div>
                  </div>
                  <Switch
                    checked={form.detrazione}
                    onCheckedChange={(v) =>
                      setForm({
                        ...form,
                        detrazione: v,
                        tipoDetrazione: v ? form.tipoDetrazione : "",
                      })
                    }
                  />
                </div>
                {form.detrazione && (
                  <div className="space-y-1.5">
                    <Label>Quale detrazione</Label>
                    <Select
                      value={form.tipoDetrazione}
                      onValueChange={(v: any) =>
                        setForm({ ...form, tipoDetrazione: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona detrazione..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ecobonus">Ecobonus</SelectItem>
                        <SelectItem value="ristrutturazione">
                          Ristrutturazione
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Interesse finanziamento</div>
                  <div className="text-xs text-muted-foreground">Si / No</div>
                </div>
                <Switch
                  checked={form.interesseFinanziamento}
                  onCheckedChange={(v) =>
                    setForm({ ...form, interesseFinanziamento: v })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pratica edilizia</Label>
                <Select
                  value={form.praticaEdilizia}
                  onValueChange={(v: any) =>
                    setForm({ ...form, praticaEdilizia: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nessuna">Nessuna pratica edilizia</SelectItem>
                    <SelectItem value="cil">CIL</SelectItem>
                    <SelectItem value="cila">CILA</SelectItem>
                    <SelectItem value="scia">SCIA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Assegnato a</Label>
                <SearchSelect
                  options={utenteOptions}
                  value={form.assegnatoA != null ? String(form.assegnatoA) : ""}
                  onChange={(v) =>
                    setForm({ ...form, assegnatoA: v ? parseInt(v) : null })
                  }
                  placeholder="Seleziona utente (default: me)"
                  searchPlaceholder="Cerca utente..."
                  allowClear
                  clearLabel="— Non assegnato —"
                />
              </div>
              <Button
                onClick={() => {
                  // If "stesso della residenza" toggled, copy residenza →
                  // lavoro so commessa fallback always has a value to use.
                  const lavoroSame = form.lavoroStessoResidenza;
                  createCliente.mutate({
                    nome: form.nome,
                    cognome: form.cognome,
                    tipo: form.tipo as any,
                    codiceFiscale: form.codiceFiscale || undefined,
                    partitaIva: form.partitaIva || undefined,
                    indirizzo: form.indirizzo || undefined,
                    citta: form.citta || undefined,
                    cap: form.cap || undefined,
                    indirizzoLavoro:
                      (lavoroSame ? form.indirizzo : form.indirizzoLavoro) ||
                      undefined,
                    cittaLavoro:
                      (lavoroSame ? form.citta : form.cittaLavoro) || undefined,
                    capLavoro:
                      (lavoroSame ? form.cap : form.capLavoro) || undefined,
                    telefono: form.telefono || undefined,
                    email: form.email || undefined,
                    detrazione: form.detrazione,
                    tipoDetrazione:
                      form.detrazione && form.tipoDetrazione
                        ? (form.tipoDetrazione as "ecobonus" | "ristrutturazione")
                        : null,
                    interesseFinanziamento: form.interesseFinanziamento,
                    praticaEdilizia: form.praticaEdilizia,
                    note: form.note || undefined,
                    assegnatoA: form.assegnatoA,
                  });
                }}
                disabled={
                  !form.nome ||
                  !form.cognome ||
                  (form.detrazione && !form.tipoDetrazione) ||
                  createCliente.isPending
                }
              >
                Crea cliente
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Sticky toolbar: search + tipo chips + only-mine + counter */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-background/85 backdrop-blur border-b border-border">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
            <Input
              placeholder="Cerca per nome, città, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button
            variant={!tipoFilter ? "default" : "outline"}
            size="sm"
            onClick={() => setTipoFilter(undefined)}
          >
            Tutti
          </Button>
          {Object.entries(tipoLabels).map(([key, label]) => (
            <Button
              key={key}
              variant={tipoFilter === key ? "default" : "outline"}
              size="sm"
              onClick={() => setTipoFilter(key)}
            >
              {label}
            </Button>
          ))}
          <Button
            variant={onlyMine ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyMine((v) => !v)}
            title="Filtra solo i clienti assegnati a me"
          >
            <UserCircle className="h-3.5 w-3.5 mr-1" />
            {onlyMine ? "Solo mie" : "Tutte"}
          </Button>
          <span className="ml-auto text-sm text-text-2 tabular-nums">
            {clienti.data?.length ?? 0} clienti
          </span>
        </div>
      </div>

      {/* Clienti — dense table */}
      {clienti.data?.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface text-center py-14 text-text-2 text-sm">
          Nessun cliente trovato.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left">
                <th className="eyebrow font-semibold px-4 py-2.5">Nome</th>
                <th className="eyebrow font-semibold px-4 py-2.5">Tag fiscali</th>
                <th className="eyebrow font-semibold px-4 py-2.5">Città</th>
                <th className="eyebrow font-semibold px-4 py-2.5">Telefono</th>
                <th className="eyebrow font-semibold px-4 py-2.5 text-right">Commesse</th>
                <th className="eyebrow font-semibold px-4 py-2.5">Assegnato</th>
                <th className="eyebrow font-semibold px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {clienti.data?.map((c: any) => {
                const TipoIcon = tipoIcons[c.tipo] ?? User;
                const displayName = `${c.cognome ?? ""} ${c.nome ?? ""}`.trim();
                const assignee =
                  c.assegnatoA != null ? utenteById.get(c.assegnatoA) : null;
                return (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 h-14 hover:bg-surface-2 cursor-pointer transition-colors"
                    onClick={() => setLocation(`/clienti/${c.id}`)}
                  >
                    <td className="px-4">
                      <div className="flex items-center gap-2">
                        <TipoIcon className="h-4 w-4 text-text-3 shrink-0" />
                        <span className="font-medium text-text-1">
                          {displayName || "—"}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {tipoLabels[c.tipo] ?? c.tipo}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4">
                      <div className="flex items-center gap-1 flex-wrap">
                        {c.detrazione && (
                          <Badge variant="info" className="capitalize">
                            Detrazione{c.tipoDetrazione ? `: ${c.tipoDetrazione}` : ""}
                          </Badge>
                        )}
                        {c.interesseFinanziamento && (
                          <Badge variant="secondary">Finanziamento</Badge>
                        )}
                        {c.praticaEdilizia && c.praticaEdilizia !== "nessuna" && (
                          <Badge variant="secondary" className="uppercase">
                            {c.praticaEdilizia}
                          </Badge>
                        )}
                        {!c.detrazione &&
                          !c.interesseFinanziamento &&
                          (!c.praticaEdilizia || c.praticaEdilizia === "nessuna") && (
                            <span className="text-text-3">—</span>
                          )}
                      </div>
                    </td>
                    <td className="px-4 text-text-2">{c.citta || "—"}</td>
                    <td className="px-4 text-text-2 tabular-nums">{c.telefono || "—"}</td>
                    <td className="px-4 text-right tabular-nums font-medium text-text-1">
                      {c.commesseIds?.length ?? 0}
                    </td>
                    <td className="px-4 text-text-2">
                      {assignee ? `${assignee.cognome ?? ""} ${assignee.nome}`.trim() : "—"}
                    </td>
                    <td className="px-2" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="text-text-3">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => setLocation(`/clienti/${c.id}`)}>
                            <ArrowRight className="h-4 w-4" /> Apri scheda
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
