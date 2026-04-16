import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  MapPin,
  Phone,
  Mail,
  Building2,
  User,
  Landmark,
  Home,
  UserCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import SearchSelect from "@/components/SearchSelect";

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
  indirizzo: "",
  citta: "",
  cap: "",
  telefono: "",
  email: "",
  detrazione: false,
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
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Contact className="h-6 w-6" />
            Clienti
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
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
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Citta</Label>
                  <Input
                    value={form.citta}
                    onChange={(e) =>
                      setForm({ ...form, citta: e.target.value })
                    }
                  />
                </div>
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
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Detrazione</div>
                    <div className="text-xs text-muted-foreground">Si / No</div>
                  </div>
                  <Switch
                    checked={form.detrazione}
                    onCheckedChange={(v) =>
                      setForm({ ...form, detrazione: v })
                    }
                  />
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
                onClick={() =>
                  createCliente.mutate({
                    nome: form.nome,
                    cognome: form.cognome,
                    tipo: form.tipo as any,
                    codiceFiscale: form.codiceFiscale || undefined,
                    partitaIva: form.partitaIva || undefined,
                    indirizzo: form.indirizzo || undefined,
                    citta: form.citta || undefined,
                    cap: form.cap || undefined,
                    telefono: form.telefono || undefined,
                    email: form.email || undefined,
                    detrazione: form.detrazione,
                    interesseFinanziamento: form.interesseFinanziamento,
                    praticaEdilizia: form.praticaEdilizia,
                    note: form.note || undefined,
                    assegnatoA: form.assegnatoA,
                  })
                }
                disabled={
                  !form.nome || !form.cognome || createCliente.isPending
                }
              >
                Crea cliente
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search + filter */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cerca per nome, citta, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
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
          <div className="w-px bg-border mx-1" />
          <Button
            variant={onlyMine ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyMine((v) => !v)}
            title="Filtra solo i clienti assegnati a me"
          >
            <UserCircle className="h-3.5 w-3.5 mr-1" />
            {onlyMine ? "Solo mie" : "Tutte"}
          </Button>
        </div>
      </div>

      {/* List */}
      {clienti.data?.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nessun cliente trovato.
        </div>
      ) : (
        <div className="grid gap-3">
          {clienti.data?.map((c: any) => {
            const TipoIcon = tipoIcons[c.tipo] ?? User;
            const displayName = `${c.nome ?? ""} ${c.cognome ?? ""}`.trim();
            return (
              <Card
                key={c.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setLocation(`/clienti/${c.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TipoIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">{displayName}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {tipoLabels[c.tipo] ?? c.tipo}
                        </Badge>
                        {c.detrazione && (
                          <Badge variant="secondary" className="text-[10px]">
                            Detrazione
                          </Badge>
                        )}
                        {c.interesseFinanziamento && (
                          <Badge variant="secondary" className="text-[10px]">
                            Finanziamento
                          </Badge>
                        )}
                        {c.praticaEdilizia && c.praticaEdilizia !== "nessuna" && (
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            {c.praticaEdilizia}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        {c.indirizzo && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {c.indirizzo}
                            {c.citta ? `, ${c.citta}` : ""}
                          </span>
                        )}
                        {c.telefono && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {c.telefono}
                          </span>
                        )}
                        {c.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {c.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="secondary" className="text-xs">
                        {c.commesseIds?.length ?? 0} commesse
                      </Badge>
                      {c.assegnatoA != null && utenteById.get(c.assegnatoA) && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <UserCircle className="h-3 w-3" />
                          {utenteById.get(c.assegnatoA)?.nome ?? "—"}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
