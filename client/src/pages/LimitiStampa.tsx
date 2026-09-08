// Stampa dei limiti di spesa (07/09/2026, «devo poter stampare i limiti»):
// una pagina senza shell, aperta in una scheda nuova dal pulsante «Stampa»
// del tab Limiti, che mette su carta l'ultimo computo come il foglio
// «CALCOLO NUOVI LIMITI»: parametri, righe del contratto, CHECK 1 e CHECK 2
// voce per voce, totali. Un computo non aggiornato alle righe correnti lo
// dice in filigrana. Stessa forma della stampa della fattura.
import { Button } from "@/components/ui/button";
import { dataItaliana } from "@/lib/contrattoView";
import { formatCent } from "@/lib/limitiView";
import { intestazioneLimiti, righeContrattoStampa, sezioniComputoStampa, totaliComputoStampa } from "@/lib/limitiStampaView";
import { permessoNegato } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";
import { Loader2, Printer, X } from "lucide-react";
import { useParams } from "wouter";

const STILE = `
.limiti-stampa { max-width: 190mm; margin: 0 auto; padding: 16px; color: #111; background: #fff; font: 12px/1.45 "Plus Jakarta Sans", system-ui, sans-serif; }
.limiti-stampa table { width: 100%; border-collapse: collapse; }
.limiti-stampa th, .limiti-stampa td { padding: 3px 6px; vertical-align: top; }
.limiti-stampa thead th { border-bottom: 1px solid #111; text-align: left; font-weight: 600; }
.limiti-stampa tbody td { border-bottom: 1px solid #ddd; }
.limiti-stampa tfoot td { border-top: 1px solid #111; font-weight: 700; }
.limiti-stampa .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.limiti-stampa .esclusa td { color: #777; }
.limiti-stampa .sezione { margin-top: 14px; page-break-inside: avoid; }
.limiti-stampa .filigrana { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 64px; font-weight: 700; color: rgba(0,0,0,0.06); transform: rotate(-30deg); text-align: center; }
@media screen { .limiti-stampa { box-shadow: 0 0 0 1px #ddd; margin: 16px auto; } }
@media print {
  @page { size: A4; margin: 15mm; }
  .no-print { display: none !important; }
  .limiti-stampa { max-width: none; padding: 0; margin: 0; box-shadow: none; }
}
`;

export default function LimitiStampa() {
  const { id } = useParams<{ id: string }>();
  const commessaId = Number(id);
  const valido = Number.isInteger(commessaId) && commessaId > 0;
  const stato = trpc.computo.ultimo.useQuery({ commessaId }, { enabled: valido, retry: false });
  const contratto = trpc.contratti.get.useQuery({ commessaId }, { enabled: valido, retry: false });
  const commessa = trpc.commesse.byId.useQuery(commessaId, { enabled: valido, retry: false });
  const sede = trpc.sedi.active.useQuery(undefined, { enabled: valido, retry: false });

  if (!valido || stato.isError) {
    const negato = stato.error ? permessoNegato(stato.error) : false;
    return (
      <div className="limiti-stampa">
        <style>{STILE}</style>
        <p>
          {negato
            ? "Non hai il permesso di vedere i limiti di questa commessa."
            : "Commessa non trovata. Se non hai fatto l'accesso, apri prima il gestionale."}
        </p>
        <a className="no-print underline" href="/">Vai al gestionale</a>
      </div>
    );
  }
  if (stato.isPending || contratto.isPending) {
    return (
      <div className="limiti-stampa">
        <style>{STILE}</style>
        <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carico i limiti…</p>
      </div>
    );
  }

  const c = stato.data.computo;
  const contr = contratto.data?.contratto ?? null;
  const righe = righeContrattoStampa(contratto.data?.righe ?? []);
  const cm = commessa.data as { codice?: string; cliente?: string; indirizzo?: string | null; citta?: string | null } | null | undefined;
  const s = sede.data ?? null;
  const oggi = dataItaliana(new Date().toISOString().slice(0, 10));
  const titoloPagina = `Limiti di spesa — ${cm?.cliente ?? cm?.codice ?? `commessa ${commessaId}`}`;

  return (
    <div className="limiti-stampa" data-testid="limiti-stampa">
      <style>{STILE}</style>
      <title>{titoloPagina}</title>
      {c && !stato.data.valido && <div className="filigrana" aria-hidden="true">COMPUTO NON AGGIORNATO</div>}

      <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => window.close()}>
          <X className="h-4 w-4" aria-hidden="true" /> Chiudi
        </Button>
        <Button type="button" className="min-h-11" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" /> Stampa
        </Button>
      </div>

      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{s?.nome || "Sede"}</div>
          {s?.indirizzo && <div>{s.indirizzo}</div>}
          {s?.citta && <div>{s.citta}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Calcolo dei limiti di spesa</div>
          <div>DM MITE 15/04/2022 · Allegato A e listino DEI</div>
          <div>Stampato il {oggi}</div>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Commessa</div>
          <div>{cm?.codice ?? `#${commessaId}`}{cm?.cliente ? ` · ${cm.cliente}` : ""}</div>
          {(cm?.indirizzo || cm?.citta) && <div>{[cm?.indirizzo, cm?.citta].filter(Boolean).join(", ")}</div>}
          {!stato.data.valido && stato.data.motivo && <div style={{ marginTop: 6, color: "#a15c00" }}>{stato.data.motivo}</div>}
        </div>
        <div>
          <table style={{ width: "auto" }}>
            <tbody>
              {intestazioneLimiti(contr, c).map(v => (
                <tr key={v.etichetta}>
                  <td style={{ color: "#555" }}>{v.etichetta}</td>
                  <td>{v.valore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!c && (
        <p>Nessun computo: compila il contratto e calcola i limiti dal gestionale.</p>
      )}

      {righe.length > 0 && (
        <section className="sezione">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Righe del contratto</div>
          <table>
            <thead>
              <tr>
                <th>N.</th>
                <th>Descrizione</th>
                <th>Categoria</th>
                <th className="num">Q.tà</th>
                <th className="num">L × H</th>
                <th className="num">mq</th>
                <th className="num">Prezzo</th>
              </tr>
            </thead>
            <tbody>
              {righe.map((r, i) => (
                <tr key={r.chiave}>
                  <td className="num">{i + 1}</td>
                  <td>{r.descrizione}</td>
                  <td>{r.categoria}</td>
                  <td className="num">{r.quantita}</td>
                  <td className="num">{r.misure}</td>
                  <td className="num">{r.mq}</td>
                  <td className="num">{r.prezzo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {c &&
        sezioniComputoStampa(c).map(sez => (
          <section key={sez.etichetta} className="sezione">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{sez.etichetta}</div>
            <table>
              <thead>
                <tr>
                  <th>Voce</th>
                  <th>DEI</th>
                  <th>Calcolo</th>
                  <th className="num">Limite</th>
                </tr>
              </thead>
              <tbody>
                {sez.righe.map(r => (
                  <tr key={r.chiave} className={r.inclusa ? undefined : "esclusa"}>
                    <td>{r.descrizione}{r.inclusa ? "" : " (non inclusa)"}</td>
                    <td>{r.codiceDei}</td>
                    <td>{r.calcolo}</td>
                    <td className="num">{r.limite}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Totale {sez.etichetta}</td>
                  <td className="num">{sez.totale}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        ))}

      {c && (
        <section className="sezione" style={{ display: "flex", justifyContent: "flex-end" }}>
          <table style={{ width: "auto", minWidth: 280 }}>
            <tbody>
              {totaliComputoStampa(c).map(v => (
                <tr key={v.etichetta}>
                  <td style={{ fontWeight: v.etichetta.startsWith("Limite") ? 700 : 400 }}>{v.etichetta}</td>
                  <td className="num" style={{ fontWeight: v.etichetta.startsWith("Limite") ? 700 : 400 }}>{v.valore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {c && c.avvertenze.length > 0 && (
        <section className="sezione">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Avvertenze del computo</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.avvertenze.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <footer style={{ marginTop: 20, borderTop: "1px solid #ddd", paddingTop: 8, fontSize: 11, color: "#555" }}>
        Limite complessivo = il minore fra CHECK 1 (massimali dell'Allegato A) e CHECK 2 (listino DEI). Le voci «non incluse» sono elencate per completezza e non entrano nei totali. Documento di lavoro, non fiscale.
        {c && <> Limite di spesa: {formatCent(c.limiteCent)}.</>}
      </footer>
    </div>
  );
}
