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
import { useState } from "react";

// ── Aziende ─────────────────────────────────────────────────────────────────
//
// Catalog of azienda preventivatori. Independent from the Fornitori anagrafica
// — adding a fornitore here or removing one elsewhere has no effect. New
// aziende are added by appending to this list; later we'll back this with a
// persisted store so the user can manage it from the UI.

type Azienda = {
  id: string;
  nome: string;
  descrizione?: string;
  accent: string; // tailwind classes for the icon tile
  prodotti: string[]; // keys into PRODOTTI_CATALOG
};

const AZIENDE: Azienda[] = [
  {
    id: "fivizzanese",
    nome: "Fivizzanese",
    descrizione: "Persiane",
    accent: "bg-indigo-100 text-indigo-700",
    prodotti: ["persiane"],
  },
  {
    id: "punto_del_serramento",
    nome: "Punto del Serramento",
    descrizione: "Persiane",
    accent: "bg-teal-100 text-teal-700",
    prodotti: ["persiane"],
  },
  {
    id: "alias",
    nome: "Alias",
    descrizione: "Portoncini blindati",
    accent: "bg-amber-100 text-amber-700",
    prodotti: ["blindati"],
  },
];

// ── Prodotti ────────────────────────────────────────────────────────────────
//
// Catalogo delle tipologie di preventivatore. Ogni azienda elenca in
// `prodotti` le chiavi che supporta — nuove tipologie si aggiungono qui e
// poi si abbinano all'azienda di competenza.

type Prodotto = { key: string; label: string };

const PRODOTTI_CATALOG: Record<string, Prodotto> = {
  persiane: { key: "persiane", label: "Persiane" },
  blindati: { key: "blindati", label: "Blindati" },
};

function getProdotto(key: string): Prodotto {
  return PRODOTTI_CATALOG[key] ?? { key, label: key };
}

// Prodotti effettivamente in uso — derivati dall'unione di quelli dichiarati
// da ciascuna azienda. Mantiene stabile l'ordine di apparizione.
const PRODOTTI_ATTIVI: Prodotto[] = (() => {
  const seen = new Set<string>();
  const out: Prodotto[] = [];
  for (const a of AZIENDE) {
    for (const key of a.prodotti) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(getProdotto(key));
    }
  }
  return out;
})();

type Target = {
  aziendaId: string;
  aziendaNome: string;
  prodotto: string;
  prodottoLabel: string;
};

// ────────────────────────────────────────────────────────────────────────────

export default function Preventivatori() {
  const [view, setView] = useState<"aziende" | "prodotti">("aziende");
  const [selected, setSelected] = useState<Target | null>(null);

  // Total = somma dei prodotti dichiarati da ciascuna azienda (no prodotto
  // cartesiano — un'azienda che fa solo persiane conta 1, non length(PRODOTTI)).
  const totalPreventivatori = AZIENDE.reduce(
    (acc, a) => acc + a.prodotti.length,
    0
  );

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
          Nuova azienda
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Aziende</p>
                <p className="text-2xl font-bold">{AZIENDE.length}</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Prodotti</p>
                <p className="text-2xl font-bold">{PRODOTTI_ATTIVI.length}</p>
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
                <p className="text-2xl font-bold">{totalPreventivatori}</p>
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

      {/* View switcher */}
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
          {AZIENDE.map((a) => (
            <AziendaCard
              key={a.id}
              azienda={a}
              onPick={(prod) =>
                setSelected({
                  aziendaId: a.id,
                  aziendaNome: a.nome,
                  prodotto: prod.key,
                  prodottoLabel: prod.label,
                })
              }
            />
          ))}
        </TabsContent>

        {/* ── Per prodotto ────────────────────────────────────────────────── */}
        <TabsContent value="prodotti" className="mt-4 space-y-4">
          {PRODOTTI_ATTIVI.map((p) => {
            const aziendeForProdotto = AZIENDE.filter((a) =>
              a.prodotti.includes(p.key)
            );
            return (
            <Card key={p.key}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{p.label}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    · {aziendeForProdotto.length}{" "}
                    {aziendeForProdotto.length === 1 ? "azienda" : "aziende"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {aziendeForProdotto.map((a) => (
                  <button
                    key={a.id}
                    onClick={() =>
                      setSelected({
                        aziendaId: a.id,
                        aziendaNome: a.nome,
                        prodotto: p.key,
                        prodottoLabel: p.label,
                      })
                    }
                    className="text-left rounded-md border bg-background hover:bg-accent hover:border-primary/40 transition-all p-3 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{a.nome}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {a.descrizione ?? "—"}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* Placeholder dialog — real calculator wired in later */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" />
              {selected?.aziendaNome} — {selected?.prodottoLabel}
            </DialogTitle>
            <DialogDescription>
              Preventivatore dedicato a {selected?.prodottoLabel?.toLowerCase()}{" "}
              di {selected?.aziendaNome}.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-dashed bg-muted/40 p-6 text-center space-y-2">
            <Sparkles className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">In sviluppo</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Il calcolatore verrà costruito qui. Definiremo i parametri
              (dimensioni, tipologia, vetro, accessori...) e la formula di
              prezzo specifica per {selected?.aziendaNome}.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function AziendaCard({
  azienda,
  onPick,
}: {
  azienda: Azienda;
  onPick: (prod: Prodotto) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div
            className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${azienda.accent}`}
          >
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{azienda.nome}</CardTitle>
            {azienda.descrizione && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {azienda.descrizione}
              </p>
            )}
          </div>
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {azienda.prodotti.length}{" "}
            {azienda.prodotti.length === 1 ? "preventivatore" : "preventivatori"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {azienda.prodotti.map((key) => {
          const p = getProdotto(key);
          return (
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
          );
        })}
      </CardContent>
    </Card>
  );
}
