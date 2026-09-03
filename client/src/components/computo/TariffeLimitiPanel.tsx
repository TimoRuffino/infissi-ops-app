// Impostazioni → Tariffe limiti: massimali, prodotti DEI, accessori, opere e
// coefficienti in vigore, con la data di validità. Sola lettura in questa fase.
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatEuro } from "@/lib/euro";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ZONE_CLIMATICHE = ["A", "B", "C", "D", "E", "F"] as const;
const GRUPPI_MASSIMALE = ["A", "B", "C"] as const;

export default function TariffeLimitiPanel() {
  const q = trpc.tariffe.limiti.useQuery(undefined, { retry: false, staleTime: 300_000 });
  const [filtroProdotti, setFiltroProdotti] = useState("");

  const prodottiFiltrati = useMemo(() => {
    const prodotti = q.data?.prodotti ?? [];
    const query = filtroProdotti.trim().toLowerCase();
    if (!query) return prodotti;
    return prodotti.filter(
      p =>
        p.codice.toLowerCase().includes(query) ||
        p.nome.toLowerCase().includes(query) ||
        p.gruppo.toLowerCase().includes(query) ||
        p.famiglia.toLowerCase().includes(query)
    );
  }, [q.data?.prodotti, filtroProdotti]);

  if (q.error) return null;
  if (!q.data) return <p className="text-sm text-muted-foreground">Caricamento tariffe…</p>;
  const t = q.data;

  return (
    <Card>
      <CardContent className="p-4 space-y-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-semibold">Tariffe limiti di spesa</p>
          <span className="text-xs text-muted-foreground">
            DM MITE 14/02/2022 · valide dal {t.validoDal} · seed {t.versione}
          </span>
        </div>
        <Tabs defaultValue="massimali">
          <TabsList className="h-auto w-full flex-wrap justify-start overflow-x-auto">
            <TabsTrigger value="massimali">Massimali</TabsTrigger>
            <TabsTrigger value="prodotti">Prodotti DEI ({t.prodotti.length})</TabsTrigger>
            <TabsTrigger value="accessori">Accessori ({t.accessori.length})</TabsTrigger>
            <TabsTrigger value="opere">Opere ({t.opere.length})</TabsTrigger>
            <TabsTrigger value="coefficienti">Coefficienti</TabsTrigger>
            <TabsTrigger value="detrazioni">Detrazioni</TabsTrigger>
          </TabsList>

          <TabsContent value="massimali">
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th>Gruppo</th>
                    {ZONE_CLIMATICHE.map(z => (
                      <th key={z} className="text-right">
                        Zona {z}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GRUPPI_MASSIMALE.map(g => (
                    <tr key={g} className="border-t border-border">
                      <td>{g}</td>
                      {ZONE_CLIMATICHE.map(z => (
                        <td key={z} className="text-right">
                          {formatEuro(t.massimali.find(m => m.gruppo === g && m.zona === z)?.euroMq ?? 0)} €/mq
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="prodotti" className="space-y-2">
            <Input
              value={filtroProdotti}
              onChange={e => setFiltroProdotti(e.target.value)}
              placeholder="Filtra per codice, gruppo, famiglia o nome…"
              aria-label="Filtra prodotti DEI"
              className="max-w-sm"
            />
            <div className="max-h-96 overflow-y-auto overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pr-2">Codice</th>
                    <th className="pr-2">Gruppo/famiglia</th>
                    <th>Nome</th>
                    <th className="text-right">Prezzo/unità</th>
                  </tr>
                </thead>
                <tbody>
                  {prodottiFiltrati.map(p => (
                    <tr key={p.codice} className="border-t border-border">
                      <td className="whitespace-nowrap pr-2 text-xs text-muted-foreground">{p.codice}</td>
                      <td className="whitespace-nowrap pr-2 text-xs text-muted-foreground">
                        {p.gruppo}/{p.famiglia}
                      </td>
                      <td className="min-w-0">{p.nome}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {formatEuro(p.prezzo)} /{p.unita}
                      </td>
                    </tr>
                  ))}
                  {prodottiFiltrati.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                        Nessun prodotto trovato.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="accessori">
            <div className="max-h-96 overflow-y-auto overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pr-2">Codice</th>
                    <th>Nome</th>
                    <th className="pr-2 text-right">Regola</th>
                    <th className="text-right">Valore</th>
                  </tr>
                </thead>
                <tbody>
                  {t.accessori.map(a => (
                    <tr key={a.codice} className="border-t border-border">
                      <td className="whitespace-nowrap pr-2 text-xs text-muted-foreground">{a.codice}</td>
                      <td className="min-w-0">{a.nome}</td>
                      <td className="whitespace-nowrap pr-2 text-right text-xs text-muted-foreground">{a.regola}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {a.regola.startsWith("pct_") ? `${a.valore}%` : `${formatEuro(a.valore)} €`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="opere">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {t.opere.map(o => (
                    <tr key={o.codice} className="border-t border-border">
                      <td className="whitespace-nowrap pr-2 text-xs text-muted-foreground">{o.codiceDei ?? "—"}</td>
                      <td className="min-w-0">{o.descrizione}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {formatEuro(o.prezzo)} /{o.unita}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="coefficienti">
            <dl className="grid gap-x-4 text-sm md:grid-cols-3">
              {Object.entries(t.coefficienti)
                .flatMap(([k, v]) =>
                  typeof v === "object"
                    ? Object.entries(v as Record<string, number>).map(([k2, v2]) => [`${k}.${k2}`, v2] as const)
                    : [[k, v as number] as const]
                )
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between border-t border-border py-1">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="tabular-nums">{Number(v).toLocaleString("it-IT", { maximumFractionDigits: 4 })}</dd>
                  </div>
                ))}
            </dl>
          </TabsContent>

          <TabsContent value="detrazioni">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {t.detrazioni.map(d => (
                    <tr key={`${d.tipo}-${d.immobile}-${d.anno}`} className="border-t border-border">
                      <td>{d.tipo}</td>
                      <td>{d.immobile}</td>
                      <td className="tabular-nums">{d.anno}</td>
                      <td className="text-right tabular-nums">{d.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
