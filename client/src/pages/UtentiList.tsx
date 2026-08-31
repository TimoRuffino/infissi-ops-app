// /utenti — l'anagrafica degli accessi (solo direzione).
//
// Una riga per persona: chi è, cosa può fare, su quali sedi lavora e se il
// suo accesso è attivo. Le credenziali non compaiono mai: il server manda
// solo `hasPassword`, e questa pagina non ne ricava altro.
//
// Creare, modificare ed eliminare restano `adminProcedure`: `RequireDirezione`
// è la guardia UX della route, il confine vero è il server. Accessi,
// capability e deleghe vivono nel dialog dedicato, con il suo audit.

import { useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  X as XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { personName } from "@/lib/name";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ConfirmDialog";
import { UserPermissionsDialog } from "@/components/users/UserPermissionsDialog";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
const MIN_PASSWORD = 12;
const TUTTI_I_RUOLI = "tutti";

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

function ruoliDi(u: any): string[] {
  if (Array.isArray(u?.ruoli) && u.ruoli.length > 0) return u.ruoli;
  return u?.ruolo ? [u.ruolo] : [];
}

function iniziali(u: any): string {
  const cognome = String(u?.cognome ?? "").charAt(0);
  const nome = String(u?.nome ?? "").charAt(0);
  return `${cognome}${nome}`.toUpperCase() || "—";
}

export default function UtentiList() {
  const [search, setSearch] = useState("");
  const [filtroRuolo, setFiltroRuolo] = useState<string>(TUTTI_I_RUOLI);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [permissionsTarget, setPermissionsTarget] = useState<any | null>(null);

  const { user } = useAuth();
  // Specchio UX di `adminProcedure`: senza direzione i controlli di scrittura
  // non vengono montati. La guardia della route resta `RequireDirezione` e il
  // confine resta il server.
  const puoGestire = isDirezione(user);

  const utenti = trpc.utenti.list.useQuery({
    ruolo: (filtroRuolo === TUTTI_I_RUOLI ? undefined : filtroRuolo) as any,
    search: search || undefined,
  });
  const stats = trpc.utenti.stats.useQuery();
  // `sedi.listAll` è una procedura admin: non la si chiama per chi non può.
  const sediAll = trpc.sedi.listAll.useQuery(undefined, {
    enabled: puoGestire,
  });
  const utils = trpc.useUtils();

  const createUtente = trpc.utenti.create.useMutation({
    onSuccess: () => {
      utils.utenti.invalidate();
      setCreateOpen(false);
      setForm(emptyForm);
      toast.success("Utente creato");
    },
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });

  const updateUtente = trpc.utenti.update.useMutation({
    onSuccess: () => {
      utils.utenti.invalidate();
      setEditOpen(false);
    },
    onError: e => toast.error(e.message ?? "Aggiornamento non riuscito"),
  });

  const deleteUtente = trpc.utenti.delete.useMutation({
    onSuccess: () => {
      utils.utenti.invalidate();
      setDeleteTarget(null);
      toast.success("Utente eliminato");
    },
    onError: e => {
      setDeleteTarget(null);
      toast.error(e.message ?? "Eliminazione non riuscita");
    },
  });

  function openCreate() {
    setForm(emptyForm);
    setShowPassword(false);
    setCreateOpen(true);
  }

  function openEdit(u: any) {
    setEditId(u.id);
    const ruoli = ruoliDi(u);
    setForm({
      nome: u.nome,
      cognome: u.cognome,
      email: u.email,
      telefono: u.telefono ?? "",
      ruoli: (ruoli.length > 0 ? ruoli : ["commerciale"]) as RuoloValue[],
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
      if (form.sediIds.length === 1) return; // almeno una sede
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
      if (form.ruoli.length === 1) return; // almeno un ruolo
      setForm({ ...form, ruoli: form.ruoli.filter(x => x !== r) });
    } else {
      if (form.ruoli.length >= MAX_RUOLI) return; // massimo tre ruoli
      setForm({ ...form, ruoli: [...form.ruoli, r] });
    }
  }

  const sedeById = useMemo(() => {
    const m = new Map<number, any>();
    for (const s of sediAll.data ?? []) m.set(s.id, s);
    return m;
  }, [sediAll.data]);

  const righe = utenti.data ?? [];
  const perRuolo = (stats.data as any)?.perRuolo ?? {};
  const contaRuoli = !stats.isPending && !stats.isError;
  const filtriAttivi = search.trim() !== "" || filtroRuolo !== TUTTI_I_RUOLI;

  const azzeraFiltri = () => {
    setSearch("");
    setFiltroRuolo(TUTTI_I_RUOLI);
  };

  const nuovoUtenteButton = (
    <Button type="button" className="min-h-11" onClick={openCreate}>
      <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo utente
    </Button>
  );

  // Quattro stati distinti: caricamento, errore con riprova, anagrafica vuota
  // e filtro senza risultati.
  const statoLista: StatePanelProps | undefined = utenti.isPending
    ? {
        kind: "loading",
        title: "Carico gli utenti",
        description: "Recupero le persone abilitate su questa sede.",
        rows: 5,
      }
    : utenti.isError
      ? {
          kind: "error",
          title: "Elenco non caricato",
          description:
            "Non è stato possibile leggere gli utenti. Nessun profilo è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => utenti.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : righe.length === 0
        ? filtriAttivi
          ? {
              kind: "empty",
              title: "Nessun utente corrisponde ai filtri correnti",
              description:
                "Gli altri profili della sede restano leggibili: cambia ruolo o ricerca per rivederli.",
              action: (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={azzeraFiltri}
                >
                  Azzera i filtri
                </Button>
              ),
            }
          : {
              kind: "empty",
              title: "Nessun utente su questa sede",
              description: puoGestire
                ? "Crea il primo profilo: ruoli e sedi assegnate decidono cosa vedrà una volta dentro."
                : "Gli utenti abilitati su questa sede compariranno qui.",
              action: puoGestire ? nuovoUtenteButton : undefined,
            }
        : undefined;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Amministrazione"
        title="Gestione utenti"
        description={`Profili di accesso della sede attiva: massimo ${MAX_RUOLI} ruoli per persona, più le sedi su cui può lavorare.`}
        busy={utenti.isFetching}
        metadata={
          stats.isPending ? (
            <span>Conteggi in caricamento…</span>
          ) : stats.isError ? (
            <span>Conteggi non disponibili</span>
          ) : (
            <>
              <span>
                <strong className="tabular-nums text-text-1">
                  {stats.data?.total ?? 0}
                </strong>{" "}
                utenti sulla sede
              </span>
              <span>
                <strong className="tabular-nums text-text-1">
                  {stats.data?.attivi ?? 0}
                </strong>{" "}
                con accesso attivo
              </span>
            </>
          )
        }
        primaryAction={puoGestire ? nuovoUtenteButton : undefined}
      />

      {/* Una sola toolbar: ricerca e ruoli, con i conteggi della sede. */}
      <DataSurface density="compact" tone="sunken">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative min-w-0 lg:max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              aria-hidden="true"
            />
            <Input
              aria-label="Cerca fra gli utenti"
              className="h-11 pl-9 pr-10"
              placeholder="Cerca nome, cognome, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Pulisci la ricerca"
                title="Pulisci la ricerca"
                className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2"
                onClick={() => setSearch("")}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div
            role="group"
            aria-label="Filtra per ruolo"
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {[
              { value: TUTTI_I_RUOLI, label: "Tutti" },
              ...RUOLI.map(r => ({ value: r.value as string, label: r.label })),
            ].map(r => {
              const attivo = filtroRuolo === r.value;
              return (
                <Button
                  key={r.value}
                  type="button"
                  variant={attivo ? "default" : "outline"}
                  aria-pressed={attivo}
                  className="min-h-11 text-xs"
                  onClick={() => setFiltroRuolo(r.value)}
                >
                  {r.label}
                  {/* Un conteggio che non conosciamo non si mostra come zero. */}
                  {contaRuoli && (
                    <span
                      className={cn(
                        "ml-1.5 tabular-nums",
                        attivo ? "opacity-80" : "text-text-3"
                      )}
                    >
                      {r.value === TUTTI_I_RUOLI
                        ? (stats.data?.total ?? 0)
                        : (perRuolo[r.value] ?? 0)}
                    </span>
                  )}
                </Button>
              );
            })}
            {filtriAttivi && !utenti.isPending && !utenti.isError && (
              <span className="text-xs text-text-2 lg:ml-auto">
                <strong className="tabular-nums text-text-1">
                  {righe.length}
                </strong>{" "}
                in vista
              </span>
            )}
          </div>
        </div>
      </DataSurface>

      <DataSurface
        density="compact"
        tone="default"
        title="Utenti"
        description="Ruoli e sedi assegnate decidono cosa vede ciascuno. Accessi e deleghe si aprono dal pannello dedicato."
        state={statoLista}
        footer={
          puoGestire ? undefined : (
            <span>
              Elenco in sola lettura: creare, modificare e disattivare un
              profilo resta della direzione.
            </span>
          )
        }
      >
        <div className="-mx-3 -mb-3 min-w-0 border-t border-border-soft sm:-mx-4 sm:-mb-4">
          {righe.map((u: any) => {
            const nome = personName(u, u.email ?? `Utente ${u.id}`);
            const ruoli = ruoliDi(u);
            const sediIds: number[] = Array.isArray(u.sediIds) ? u.sediIds : [];
            const sediNote = sediIds
              .map(id => sedeById.get(id)?.nome)
              .filter(Boolean) as string[];

            return (
              <article
                key={u.id}
                aria-label={`Utente ${nome}`}
                className={cn(
                  "grid min-w-0 gap-3 border-b border-border-soft px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,1.1fr)_auto]",
                  !u.attivo && "bg-surface-2"
                )}
              >
                {/* Chi è e come si raggiunge. */}
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-text-2"
                  >
                    {iniziali(u)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold leading-tight text-text-1">
                      {nome}
                    </h3>
                    <p className="truncate text-xs text-text-2">{u.email}</p>
                    {u.telefono && (
                      <p className="truncate text-xs text-text-3">
                        {u.telefono}
                      </p>
                    )}
                  </div>
                </div>

                {/* Cosa può fare e dove. */}
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {ruoli.length === 0 ? (
                      <span className="text-xs text-text-3">
                        Nessun ruolo assegnato
                      </span>
                    ) : (
                      ruoli.map(ruolo => (
                        <Badge
                          key={ruolo}
                          variant="secondary"
                          className={cn("text-[11px]", RUOLO_COLORS[ruolo])}
                        >
                          <Shield className="h-2.5 w-2.5" aria-hidden="true" />
                          {RUOLI.find(r => r.value === ruolo)?.label ?? ruolo}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
                    <span className="min-w-0">
                      {sediNote.length > 0
                        ? `Sedi: ${sediNote.join(", ")}`
                        : sediIds.length > 0
                          ? `${sediIds.length} ${sediIds.length === 1 ? "sede assegnata" : "sedi assegnate"}`
                          : "Nessuna sede assegnata"}
                    </span>
                    {/* L'unico indicatore autorizzato dal server: la password
                        non esce mai dall'API, nemmeno come hash. */}
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="h-3 w-3" aria-hidden="true" />
                      {u.hasPassword
                        ? "Password impostata"
                        : "Password da impostare"}
                    </span>
                  </div>
                </div>

                {/* Stato dell'accesso e azioni. */}
                <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                  <span
                    className={cn(
                      "shrink-0 rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold",
                      u.attivo
                        ? "border-success/25 bg-success-soft text-success"
                        : "border-border-soft bg-surface-2 text-text-2"
                    )}
                  >
                    {u.attivo ? "Accesso attivo" : "Accesso disattivato"}
                  </span>

                  {puoGestire && (
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11 text-xs lg:min-h-9"
                        disabled={updateUtente.isPending}
                        onClick={() => toggleAttivo(u)}
                      >
                        {u.attivo ? "Disattiva" : "Riattiva"}
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        size="icon"
                        className="h-11 w-11 lg:h-9 lg:w-9"
                        aria-label={`Accessi e deleghe di ${nome}`}
                        title="Accessi e deleghe"
                        onClick={() => setPermissionsTarget(u)}
                      >
                        <ShieldCheck className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        size="icon"
                        className="h-11 w-11 lg:h-9 lg:w-9"
                        aria-label={`Modifica il profilo di ${nome}`}
                        title="Modifica profilo"
                        onClick={() => openEdit(u)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="dangerGhost"
                        size="icon"
                        className="h-11 w-11 lg:h-9 lg:w-9"
                        aria-label={`Elimina l'utente ${nome}`}
                        title="Elimina utente"
                        onClick={() =>
                          setDeleteTarget({ id: u.id, label: nome })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </DataSurface>

      {/* Nuovo utente */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12">
            <DialogTitle>Nuovo utente</DialogTitle>
            <DialogDescription>
              Ruoli e sedi assegnate decidono cosa vedrà. La password si
              imposta ora e non è più leggibile da nessuna schermata.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <ProfiloFields form={form} setForm={setForm} prefisso="utente-nuovo" />
            <RuoliFields form={form} onToggle={toggleRuolo} prefisso="nuovo" />
            <SediFields
              form={form}
              onToggle={toggleSede}
              sedi={sediAll.data ?? []}
              caricamento={sediAll.isPending}
              errore={sediAll.isError}
              prefisso="nuovo"
            />
            <div className="space-y-1.5">
              <Label
                htmlFor="utente-nuovo-password"
                className="flex items-center gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Password
              </Label>
              <div className="relative">
                <Input
                  id="utente-nuovo-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={`Almeno ${MIN_PASSWORD} caratteri`}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="pr-12"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2"
                  aria-label={
                    showPassword ? "Nascondi la password" : "Mostra la password"
                  }
                  title={showPassword ? "Nascondi" : "Mostra"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 border-t border-border-soft bg-surface-raised px-5 py-3">
            <Button
              type="button"
              className="min-h-12 w-full sm:min-h-11"
              onClick={() =>
                createUtente.mutate({
                  nome: form.nome,
                  cognome: form.cognome,
                  email: form.email,
                  telefono: form.telefono || undefined,
                  ruoli: form.ruoli as any,
                  sediIds: form.sediIds,
                  password: form.password,
                })
              }
              disabled={
                !form.nome.trim() ||
                !form.cognome.trim() ||
                !form.email.trim() ||
                form.password.length < MIN_PASSWORD ||
                form.ruoli.length === 0 ||
                createUtente.isPending
              }
            >
              {createUtente.isPending ? "Creazione…" : "Crea utente"}
            </Button>
            <p className="mt-2 text-xs text-text-3">
              Nome, cognome, email, almeno un ruolo e una password di almeno{" "}
              {MIN_PASSWORD} caratteri sono obbligatori.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modifica utente */}
      <Dialog
        open={editOpen}
        onOpenChange={o => {
          setEditOpen(o);
          if (!o) setEditId(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12">
            <DialogTitle>Modifica utente</DialogTitle>
            <DialogDescription>
              Accessi puntuali e deleghe temporanee restano nel pannello
              «Accessi e deleghe», con il loro storico.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <ProfiloFields
              form={form}
              setForm={setForm}
              prefisso="utente-edit"
            />
            <RuoliFields form={form} onToggle={toggleRuolo} prefisso="edit" />
            <SediFields
              form={form}
              onToggle={toggleSede}
              sedi={sediAll.data ?? []}
              caricamento={sediAll.isPending}
              errore={sediAll.isError}
              prefisso="edit"
            />
            <div className="space-y-1.5">
              <Label
                htmlFor="utente-edit-password"
                className="flex items-center gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Nuova
                password
              </Label>
              <div className="relative">
                <Input
                  id="utente-edit-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Lascia vuoto per non cambiarla"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="pr-12"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2"
                  aria-label={
                    showPassword ? "Nascondi la password" : "Mostra la password"
                  }
                  title={showPassword ? "Nascondi" : "Mostra"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-text-3">
                La password attuale non è leggibile: si può solo sostituire,
                con almeno {MIN_PASSWORD} caratteri.
              </p>
            </div>
          </div>
          <div className="sticky bottom-0 border-t border-border-soft bg-surface-raised px-5 py-3">
            <Button
              type="button"
              className="min-h-12 w-full sm:min-h-11"
              onClick={() =>
                editId &&
                updateUtente.mutate({
                  id: editId,
                  nome: form.nome || undefined,
                  cognome: form.cognome || undefined,
                  email: form.email || undefined,
                  telefono: form.telefono || undefined,
                  ruoli: form.ruoli as any,
                  sediIds: form.sediIds,
                  ...(form.password.length >= MIN_PASSWORD
                    ? { password: form.password }
                    : {}),
                })
              }
              disabled={form.ruoli.length === 0 || updateUtente.isPending}
            >
              {updateUtente.isPending ? "Salvataggio…" : "Salva modifiche"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open: boolean) => !open && setDeleteTarget(null)}
        title="Elimina utente"
        description={`Eliminare il profilo di "${deleteTarget?.label}"? L'accesso viene revocato e il profilo non è recuperabile. Per sospenderlo temporaneamente usa «Disattiva».`}
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

// ── Campi condivisi fra creazione e modifica ───────────────────────────────

type FormState = typeof emptyForm;

function ProfiloFields({
  form,
  setForm,
  prefisso,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  prefisso: string;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefisso}-nome`}>Nome *</Label>
          <Input
            id={`${prefisso}-nome`}
            value={form.nome}
            onChange={e => setForm({ ...form, nome: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefisso}-cognome`}>Cognome *</Label>
          <Input
            id={`${prefisso}-cognome`}
            value={form.cognome}
            onChange={e => setForm({ ...form, cognome: e.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefisso}-email`}>Email *</Label>
          <Input
            id={`${prefisso}-email`}
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefisso}-telefono`}>Telefono</Label>
          <Input
            id={`${prefisso}-telefono`}
            value={form.telefono}
            onChange={e => setForm({ ...form, telefono: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}

function RuoliFields({
  form,
  onToggle,
  prefisso,
}: {
  form: FormState;
  onToggle: (r: RuoloValue) => void;
  prefisso: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">
        Ruoli — {form.ruoli.length} di {MAX_RUOLI} selezionati
      </legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {RUOLI.map(r => {
          const checked = form.ruoli.includes(r.value);
          const bloccato = !checked && form.ruoli.length >= MAX_RUOLI;
          const id = `${prefisso}-ruolo-${r.value}`;
          return (
            <label
              key={r.value}
              htmlFor={id}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 text-xs transition-colors",
                checked
                  ? "border-primary bg-brand-soft text-accent-text"
                  : "border-border-soft hover:bg-surface-2",
                bloccato && "cursor-not-allowed opacity-50"
              )}
            >
              <input
                id={id}
                type="checkbox"
                checked={checked}
                disabled={bloccato}
                onChange={() => onToggle(r.value)}
              />
              {r.label}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-text-3">
        Almeno un ruolo, al massimo {MAX_RUOLI}: è il limite applicato anche dal
        server.
      </p>
    </fieldset>
  );
}

function SediFields({
  form,
  onToggle,
  sedi,
  caricamento,
  errore,
  prefisso,
}: {
  form: FormState;
  onToggle: (id: number) => void;
  sedi: any[];
  caricamento: boolean;
  errore: boolean;
  prefisso: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">
        Sedi assegnate — {form.sediIds.length} selezionate
      </legend>
      {caricamento ? (
        <p className="text-xs text-text-3">Sedi in caricamento…</p>
      ) : errore ? (
        <p className="text-xs text-danger">
          Elenco sedi non disponibile: le sedi già assegnate restano invariate.
        </p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {sedi.map((s: any) => {
            const checked = form.sediIds.includes(s.id);
            const id = `${prefisso}-sede-${s.id}`;
            return (
              <label
                key={s.id}
                htmlFor={id}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 text-xs transition-colors",
                  checked
                    ? "border-primary bg-brand-soft text-accent-text"
                    : "border-border-soft hover:bg-surface-2"
                )}
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(s.id)}
                />
                {s.nome}
              </label>
            );
          })}
        </div>
      )}
      <p className="text-xs text-text-3">
        L'utente lavora e cambia sede solo fra quelle selezionate.
      </p>
    </fieldset>
  );
}
