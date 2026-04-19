import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Calculator,
  Building2,
  Package,
  ArrowRight,
  Sparkles,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";

// ── Labels (shared with Fornitori page) ──────────────────────────────────────

const categoriaLabels: Record<string, string> = {
  pvc: "PVC",
  alluminio: "Alluminio",
  vetro: "Vetro",
  ferramenta: "Ferramenta",
  persiane: "Persiane",
  blindati: "Blindati",
  accessori: "Accessori",
  guarnizioni: "Guarnizioni",
  altro: "Altro",
};

const categoriaColors: Record<string, string> = {
  pvc: "bg-blue-100 text-blue-800 border-blue-200",
  alluminio: "bg-sky-100 text-sky-800 border-sky-200",
  vetro: "bg-cyan-100 text-cyan-800 border-cyan-200",
  ferramenta: "bg-amber-100 text-amber-800 border-amber-200",
  persiane: "bg-lime-100 text-lime-800 border-lime-200",
  blindati: "bg-stone-100 text-stone-800 border-stone-200",
  accessori: "bg-purple-100 text-purple-800 border-purple-200",
  guarnizioni: "bg-green-100 text-green-800 border-green-200",
  altro: "bg-gray-100 text-gray-700 border-gray-200",
};

// Product types each azienda typically offers a preventivatore for. Keeps the
// UI consistent even when a fornitore record has a single `categoria`. Later
// we will bind each (azienda × prodotto) pair to a real calculator.
const PRODOTTI_BASE = [
  { key: "finestre", label: "Finestre" },
  { key: "porte_finestre", label: "Porte-finestre" },
  { key: "scorrevoli", label: "Scorrevoli" },
  { key: "persiane", label: "Persiane" },
  { key: "portoncini", label: "Portoncini" },
  { key: "zanzariere", label: "Zanzariere" },
] as const;

type PreventivatoreTarget = {
  azienda: string;
  aziendaId?: number;
  prodotto: string;
  prodottoLabel: string;
};

export default function Preventivatori() {
  const fornitori = trpc.fornitori.list.useQuery({ attivo: true });
  const [view, setView] = useState<"aziende" | "prodotti">("aziende");
  const [selected, setSelected] = useState<PreventivatoreTarget | null>(null);

  // Group fornitori by categoria for the "Per Prodotto" view. Each categoria
  // becomes a bucket showing every azienda that produces that product type.
  const perCategoria = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const f of fornitori.data ?? []) {
      const cat = (f as any).categoria ?? "altro";
      (map[cat] ??= []).push(f);
    }
    return map;
  }, [fornitori.data]);

  const totalAziende = fornitori.data?.length ?? 0;
  const totalProdotti = Object.keys(perCategoria).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" />
            Preventivatori
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Calcolatori di preventivo divisi per azienda e prodotto. Seleziona
            un'azienda per vedere i preventivatori disponibili, oppure filtra
            per tipo di prodotto.
          </p>
        </div>
        <Button disabled className="gap-2" title="In arrivo">
          <Plus className="h-4 w-4" />
          Nuovo preventivatore
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Aziende</p>
                <p className="text-2xl font-bold">{totalAziende}</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Categorie</p>
                <p className="text-2xl font-bold">{totalProdotti}</p>
              </div>
              <Package className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Preventivatori</p>
                <p className="text-2xl font-bold">
                  {totalAziende * PRODOTTI_BASE.length}
                </p>
              </div>
              <Calculator className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Stato</p>
                <Badge variant="secondary" className="mt-1 gap-1">
                  <Sparkles className="h-3 w-3" />
                  In sviluppo
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: view switcher */}
      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <TabsList>
          <TabsTrigger value="aziende" className="gap-2">
            <Building2 className="h-4 w-4" />
            Per azienda
          </TabsTrigger>
          <TabsTrigger value="prodotti" className="gap-2">
            <Package className="h-4 w-4" />
            Per prodotto
          </TabsTrigger>
        </TabsList>

        {/* ── Per azienda ─────────────────────────────────────────────────── */}
        <TabsContent value="aziende" className="mt-4 space-y-4">
          {fornitori.isLoading ? (
            <SkeletonGrid />
          ) : (fornitori.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="Nessuna azienda configurata"
              body="Aggiungi fornitori nella sezione Fornitori per sbloccare i preventivatori associati."
              cta="Vai a Fornitori"
              href="/fornitori"
            />
          ) : (
            <div className="space-y-4">
              {(fornitori.data ?? []).map((f: any) => (
                <AziendaBlock
                  key={f.id}
                  fornitore={f}
                  onPick={(prod) =>
                    setSelected({
                      azienda: f.ragioneSociale,
                      aziendaId: f.id,
                      prodotto: prod.key,
                      prodottoLabel: prod.label,
                    })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Per prodotto ────────────────────────────────────────────────── */}
        <TabsContent value="prodotti" className="mt-4 space-y-4">
          {fornitori.isLoading ? (
            <SkeletonGrid />
          ) : Object.keys(perCategoria).length === 0 ? (
            <EmptyState
              title="Nessun prodotto disponibile"
              body="I prodotti sono derivati dalle categorie dei fornitori attivi."
              cta="Vai a Fornitori"
              href="/fornitori"
            />
          ) : (
            <div className="space-y-4">
              {Object.entries(perCategoria).map(([cat, aziendeForCat]) => (
                <Card key={cat}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={categoriaColors[cat] ?? categoriaColors.altro}
                      >
                        {categoriaLabels[cat] ?? cat}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {aziendeForCat.length}{" "}
                        {aziendeForCat.length === 1 ? "azienda" : "aziende"}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {aziendeForCat.map((f: any) => (
                      <button
                        key={f.id}
                        onClick={() =>
                          setSelected({
                            azienda: f.ragioneSociale,
                            aziendaId: f.id,
                            prodotto: cat,
                            prodottoLabel: categoriaLabels[cat] ?? cat,
                          })
                        }
                        className="text-left rounded-md border bg-background hover:bg-accent transition-colors p-3 group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {f.ragioneSociale}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {f.citta ?? "—"}
                            </p>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Placeholder dialog: real calculator wired in later */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" />
              {selected?.azienda} — {selected?.prodottoLabel}
            </DialogTitle>
            <DialogDescription>
              Preventivatore dedicato a {selected?.prodottoLabel?.toLowerCase()}{" "}
              di {selected?.azienda}.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-dashed bg-muted/40 p-6 text-center space-y-2">
            <Sparkles className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">In sviluppo</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Il calcolatore verrà costruito qui. Definiremo i parametri
              (dimensioni, tipologia, vetro, accessori...) e la formula di
              prezzo specifica per {selected?.azienda}.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function AziendaBlock({
  fornitore,
  onPick,
}: {
  fornitore: any;
  onPick: (prod: (typeof PRODOTTI_BASE)[number]) => void;
}) {
  const cat = fornitore.categoria ?? "altro";
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">
              {fornitore.ragioneSociale}
            </CardTitle>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {fornitore.citta ?? "—"}
              {fornitore.referenteCommerciale
                ? ` · ${fornitore.referenteCommerciale}`
                : ""}
            </p>
          </div>
          <Badge
            variant="outline"
            className={categoriaColors[cat] ?? categoriaColors.altro}
          >
            {categoriaLabels[cat] ?? cat}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {PRODOTTI_BASE.map((p) => (
          <button
            key={p.key}
            onClick={() => onPick(p)}
            className="rounded-md border bg-background hover:bg-accent hover:border-primary/40 transition-all p-2.5 text-left group"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-medium truncate">{p.label}</span>
              <Calculator className="h-3 w-3 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:text-primary transition shrink-0" />
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  title,
  body,
  cta,
  href,
}: {
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-3">
        <Calculator className="h-10 w-10 text-muted-foreground/40 mx-auto" />
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {body}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={href}>{cta}</a>
        </Button>
      </CardContent>
    </Card>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="py-8">
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="grid grid-cols-6 gap-2">
                {[0, 1, 2, 3, 4, 5].map((j) => (
                  <div key={j} className="h-8 bg-muted rounded" />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
