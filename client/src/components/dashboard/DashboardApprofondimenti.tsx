// Approfondimenti della Dashboard: i due grafici recharts. Vive in un
// chunk separato caricato con React.lazy: recharts non deve pesare sul
// primo paint della pagina più aperta del CRM. Ogni grafico risponde a
// una domanda operativa; niente donut decorativi.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Hammer, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function DashboardApprofondimenti({
  interventiByTipo,
  squadreWorkload,
}: {
  /** Conteggio interventi della settimana per tipo (domanda: che lavoro c'è?). */
  interventiByTipo: { name: string; valore: number }[];
  /** Carico per squadra (domanda: chi è saturo, chi ha spazio?). */
  squadreWorkload: { nome: string; attivi: number; completati: number }[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Hammer className="h-4 w-4" />
            Interventi per tipo
          </CardTitle>
          <p className="text-xs text-text-3">
            Settimana corrente · fonte: calendario interventi
          </p>
        </CardHeader>
        <CardContent>
          {interventiByTipo.length > 0 && (
            <p className="sr-only">
              {interventiByTipo
                .map(v => `${v.name}: ${v.valore} interventi`)
                .join("; ")}
              .
            </p>
          )}
          {interventiByTipo.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={interventiByTipo}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="valore" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-text-3 py-8 text-center">
              Nessun intervento pianificato questa settimana.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            Carico di lavoro per squadra
          </CardTitle>
          <p className="text-xs text-text-3">
            Settimana corrente · fonte: interventi assegnati
          </p>
        </CardHeader>
        <CardContent>
          {squadreWorkload.length > 0 && (
            <p className="sr-only">
              {squadreWorkload
                .map(s => `${s.nome}: ${s.attivi} attivi, ${s.completati} completati`)
                .join("; ")}
              .
            </p>
          )}
          {squadreWorkload.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={squadreWorkload} layout="vertical">
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="nome" tick={{ fontSize: 12 }} width={120} />
                <Tooltip />
                <Legend />
                <Bar dataKey="attivi" name="Attivi" fill="var(--chart-1)" stackId="a" />
                <Bar
                  dataKey="completati"
                  name="Completati"
                  fill="var(--chart-5)"
                  stackId="a"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-text-3 py-8 text-center">
              Nessuna squadra con interventi assegnati.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
