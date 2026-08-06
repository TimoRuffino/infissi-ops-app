// /comunicazioni — il flusso della posta letta dalle caselle aziendali.
//
// Serve a due cose: vedere che l'ingestione funziona, e smistare a mano le
// mail che il match automatico non ha saputo agganciare.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SearchSelect from "@/components/SearchSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Mail, Paperclip, Link2, Search, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

const CONFIDENZA_LABEL: Record<string, string> = {
  alta: "aggancio sicuro",
  media: "aggancio probabile",
  bassa: "aggancio incerto",
  nessuna: "non agganciata",
};

function RigaComunicazione({ c }: { c: any }) {
  const utils = trpc.useUtils();
  const [apri, setApri] = useState(false);
  const [confermaElimina, setConfermaElimina] = useState(false);
  const commesse = trpc.commesse.list.useQuery(undefined, { enabled: apri });

  const collega = trpc.mail.comunicazioni.collega.useMutation({
    onSuccess: () => {
      toast.success("Comunicazione collegata");
      utils.mail.comunicazioni.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const elimina = trpc.mail.comunicazioni.delete.useMutation({
    onSuccess: () => {
      toast.success("Eliminata dal CRM — resta nella casella di posta");
      setConfermaElimina(false);
      utils.mail.comunicazioni.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const commessa = trpc.commesse.byId.useQuery(c.commessaId ?? 0, {
    enabled: c.commessaId != null,
  });

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{c.oggetto || "(senza oggetto)"}</span>
              {c.stato === "nuova" && <Badge variant="secondary">Nuova</Badge>}
              {c.allegati?.length > 0 && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Paperclip className="h-3 w-3" />
                  {c.allegati.length}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {c.mittenteNome ? `${c.mittenteNome} · ` : ""}
              {c.mittente} · {new Date(c.receivedAt).toLocaleString("it-IT")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {c.commessaId != null ? (
              <Link
                href={`/commesse/${c.commessaId}`}
                className="text-xs text-primary hover:underline"
              >
                {commessa.data?.codice ?? `Commessa #${c.commessaId}`}
              </Link>
            ) : (
              <Badge variant="outline" className="text-xs">
                {CONFIDENZA_LABEL[c.matchConfidenza] ?? "non agganciata"}
              </Badge>
            )}
            <Button size="sm" variant="ghost" onClick={() => setApri((v) => !v)}>
              <Link2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfermaElimina(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <ConfirmDialog
          open={confermaElimina}
          onOpenChange={setConfermaElimina}
          title="Eliminare dal CRM?"
          description="La mail sparisce da qui ma resta nella casella di posta, che non viene mai toccata. Non verrà re-importata."
          confirmLabel="Elimina dal CRM"
          onConfirm={() => elimina.mutate({ id: c.id })}
        />

        {c.matchMotivo && (
          <p className="text-xs text-muted-foreground italic">{c.matchMotivo}</p>
        )}

        <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
          {c.testo}
        </p>

        {apri && (
          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1 min-w-0">
              <SearchSelect
                value={c.commessaId != null ? String(c.commessaId) : null}
                onChange={(v: string) =>
                  collega.mutate({ id: c.id, commessaId: Number(v) })
                }
                options={(commesse.data ?? []).map((cm: any) => ({
                  value: String(cm.id),
                  label: `${cm.codice} — ${cm.cliente}`,
                  keywords: cm.citta ?? "",
                }))}
                placeholder="Collega a una commessa…"
              />
            </div>
            {c.commessaId != null && (
              <Button
                size="sm"
                variant="outline"
                disabled={collega.isPending}
                onClick={() => collega.mutate({ id: c.id, commessaId: null })}
              >
                Scollega
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Comunicazioni() {
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<"tutte" | "nuove" | "da_smistare">("tutte");

  const stats = trpc.mail.comunicazioni.stats.useQuery();
  const rows = trpc.mail.comunicazioni.list.useQuery({
    search: search.trim() || undefined,
    stato: filtro === "nuove" ? "nuova" : undefined,
    soloNonCollegate: filtro === "da_smistare" ? true : undefined,
    limit: 100,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Mail className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Comunicazioni</h1>
        {stats.data && (
          <span className="text-sm text-muted-foreground">
            {stats.data.totali} totali · {stats.data.nuove} nuove ·{" "}
            {stats.data.nonCollegate} da smistare
          </span>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Tabs value={filtro} onValueChange={(v) => setFiltro(v as any)}>
          <TabsList>
            <TabsTrigger value="tutte">Tutte</TabsTrigger>
            <TabsTrigger value="nuove">Nuove</TabsTrigger>
            <TabsTrigger value="da_smistare">Da smistare</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Cerca in oggetto, mittente, testo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {rows.isLoading && (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 mx-auto animate-spin" />
        </div>
      )}

      {!rows.isLoading && (rows.data ?? []).length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Nessuna comunicazione. Configura una casella da Impostazioni →
            Caselle email, poi premi «Sincronizza».
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {(rows.data ?? []).map((c: any) => (
          <RigaComunicazione key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}
