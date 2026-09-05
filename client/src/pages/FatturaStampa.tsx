// Stampa della fattura, anche in bozza: una pagina senza shell, aperta in
// una scheda nuova dal pulsante «Stampa», che mette su carta quello che la
// bozza contiene oggi. La bozza non è un documento fiscale e lo dice in
// filigrana; la fattura emessa ha comunque il PDF ufficiale di Fatture in
// Cloud nel fascicolo — questa stampa è la copia di lavoro.
import { Button } from "@/components/ui/button";
import { dataItaliana } from "@/lib/contrattoView";
import { indirizzoCliente, intestazioneStampa, righeStampa } from "@/lib/fatturaStampaView";
import { testoDicitura } from "@/lib/fatturaView";
import { formatCent } from "@/lib/limitiView";
import { permessoNegato } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";
import { Loader2, Printer, X } from "lucide-react";
import { useParams } from "wouter";

const STILE = `
.fattura-stampa { max-width: 190mm; margin: 0 auto; padding: 16px; color: #111; background: #fff; font: 12px/1.45 "Plus Jakarta Sans", system-ui, sans-serif; }
.fattura-stampa table { width: 100%; border-collapse: collapse; }
.fattura-stampa th, .fattura-stampa td { padding: 4px 6px; vertical-align: top; }
.fattura-stampa thead th { border-bottom: 1px solid #111; text-align: left; font-weight: 600; }
.fattura-stampa tbody td { border-bottom: 1px solid #ddd; }
.fattura-stampa .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fattura-stampa .testo { white-space: pre-line; }
.fattura-stampa .filigrana { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 96px; font-weight: 700; color: rgba(0,0,0,0.06); transform: rotate(-30deg); }
@media screen { .fattura-stampa { box-shadow: 0 0 0 1px #ddd; margin: 16px auto; } }
@media print {
  @page { size: A4; margin: 15mm; }
  .no-print { display: none !important; }
  .fattura-stampa { max-width: none; padding: 0; margin: 0; box-shadow: none; }
}
`;

export default function FatturaStampa() {
  const { id } = useParams<{ id: string }>();
  const fatturaId = Number(id);
  const valido = Number.isInteger(fatturaId) && fatturaId > 0;
  const q = trpc.fatture.byId.useQuery({ id: fatturaId }, { enabled: valido, retry: false });
  const config = trpc.fatturazioneConfig.get.useQuery(undefined, { enabled: valido, retry: false });
  const sede = trpc.sedi.active.useQuery(undefined, { enabled: valido, retry: false });

  if (!valido || q.isError) {
    const negato = q.error ? permessoNegato(q.error) : false;
    return (
      <div className="fattura-stampa">
        <style>{STILE}</style>
        <p>
          {negato
            ? "Non hai il permesso di vedere questa fattura."
            : "Fattura non trovata. Se non hai fatto l'accesso, apri prima il gestionale."}
        </p>
        <a className="no-print underline" href="/">Vai al gestionale</a>
      </div>
    );
  }
  if (q.isPending) {
    return (
      <div className="fattura-stampa">
        <style>{STILE}</style>
        <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carico la fattura…</p>
      </div>
    );
  }

  const f = q.data.fattura;
  const testa = intestazioneStampa(f);
  const righe = righeStampa(f.righe);
  const cliente = f.clienteSnapshot;
  const cfg = config.data?.config ?? null;
  const s = sede.data ?? null;
  const diciture = f.diciture.map(testoDicitura).filter(Boolean);
  const titoloPagina = `${testa.titolo} — ${cliente?.nome ?? "cliente"}`;

  return (
    <div className="fattura-stampa" data-testid="fattura-stampa">
      <style>{STILE}</style>
      <title>{titoloPagina}</title>
      {testa.bozza && <div className="filigrana" aria-hidden="true">BOZZA</div>}

      <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => window.close()}>
          <X className="h-4 w-4" aria-hidden="true" /> Chiudi
        </Button>
        <Button type="button" className="min-h-11" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" /> Stampa
        </Button>
      </div>

      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{cfg?.intestatario || s?.nome || "Sede"}</div>
          {s?.indirizzo && <div>{s.indirizzo}</div>}
          {s?.citta && <div>{s.citta}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{testa.titolo}</div>
          {testa.bozza && <div>Non valida ai fini fiscali · stampata il {dataItaliana(new Date().toISOString().slice(0, 10))}</div>}
          {f.inviataDryRun && !testa.bozza && <div>Emessa in prova (dry run)</div>}
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Cliente</div>
          <div>{cliente?.nome ?? "—"}</div>
          {cliente && indirizzoCliente(cliente) && <div>{indirizzoCliente(cliente)}</div>}
          {cliente?.codiceFiscale && <div>CF {cliente.codiceFiscale}</div>}
          {cliente?.partitaIva && <div>P. IVA {cliente.partitaIva}</div>}
          {cliente?.pec && <div>PEC {cliente.pec}</div>}
          {cliente && cliente.codiceDestinatario !== "0000000" && <div>Codice destinatario {cliente.codiceDestinatario}</div>}
        </div>
        <div>
          {f.intestazioneCantiere && (
            <>
              <div style={{ fontWeight: 600 }}>Cantiere</div>
              <div className="testo">{f.intestazioneCantiere}</div>
            </>
          )}
          {f.detrazioneTipo !== "nessuna" && (
            <div style={{ marginTop: 8 }}>
              Detrazione: {f.detrazioneTipo === "ecobonus" ? "Ecobonus" : "Ristrutturazione"}
            </div>
          )}
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th>Descrizione</th>
            <th className="num">Q.tà</th>
            <th className="num">Prezzo</th>
            <th className="num">IVA</th>
            <th className="num">Importo</th>
          </tr>
        </thead>
        <tbody>
          {righe.map(r =>
            r.tipo === "testo" ? (
              <tr key={r.chiave}>
                <td colSpan={5} className="testo" style={{ fontWeight: 600 }}>{r.testo}</td>
              </tr>
            ) : (
              <tr key={r.chiave}>
                <td className="testo">{r.descrizione}</td>
                <td className="num">{r.quantita}</td>
                <td className="num">{r.prezzoUnit}</td>
                <td className="num">{r.aliquota}</td>
                <td className="num">{r.importo}</td>
              </tr>
            )
          )}
        </tbody>
      </table>

      <section style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, marginTop: 16 }}>
        <div>
          {f.riepilogo.length > 0 && (
            <table style={{ width: "auto" }}>
              <thead>
                <tr><th>Aliquota</th><th className="num">Imponibile</th><th className="num">Imposta</th></tr>
              </thead>
              <tbody>
                {f.riepilogo.map(r => (
                  <tr key={r.aliquota}>
                    <td>{r.aliquota} %</td>
                    <td className="num">{formatCent(r.imponibileCent)}</td>
                    <td className="num">{formatCent(r.impostaCent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <table style={{ width: "auto", minWidth: 220 }}>
          <tbody>
            <tr><td>Imponibile</td><td className="num">{formatCent(f.imponibileCent)}</td></tr>
            <tr><td>IVA</td><td className="num">{formatCent(f.ivaCent)}</td></tr>
            <tr><td style={{ fontWeight: 700 }}>Totale</td><td className="num" style={{ fontWeight: 700 }}>{formatCent(f.totaleCent)}</td></tr>
          </tbody>
        </table>
      </section>

      {f.scadenze.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600 }}>Scadenze di pagamento</div>
          <table>
            <thead>
              <tr><th>N.</th><th>Data</th><th>Descrizione</th><th className="num">Importo</th></tr>
            </thead>
            <tbody>
              {f.scadenze.map(sc => (
                <tr key={sc.id}>
                  <td>{sc.numero}</td>
                  <td>{dataItaliana(sc.data)}</td>
                  <td>{sc.descrizione ?? ""}</td>
                  <td className="num">{formatCent(sc.importoCent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(cfg?.iban || cfg?.banca) && (
            <div style={{ marginTop: 6 }}>
              Bonifico bancario{cfg.banca ? ` · ${cfg.banca}` : ""}{cfg.intestatario ? ` · ${cfg.intestatario}` : ""}
              {cfg.iban && <div>IBAN {cfg.iban}</div>}
            </div>
          )}
        </section>
      )}

      {(diciture.length > 0 || f.note) && (
        <section style={{ marginTop: 16 }}>
          {diciture.map((d, i) => (
            <p key={i} className="testo" style={{ margin: "0 0 4px" }}>{d}</p>
          ))}
          {f.note && <p className="testo" style={{ margin: "8px 0 0" }}>{f.note}</p>}
        </section>
      )}

      {cfg?.dicituraFooter && (
        <footer className="testo" style={{ marginTop: 24, borderTop: "1px solid #ddd", paddingTop: 8, fontSize: 11 }}>
          {cfg.dicituraFooter}
        </footer>
      )}
    </div>
  );
}
