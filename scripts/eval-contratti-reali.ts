// Prova dal vivo della lettura del contratto sui casi reali in
// server/contratti/eval/casi-reali/ (gitignored: PDF veri, verità scritta a
// mano in atteso.json). Chiama davvero il modello: servono
// EVAL_CONTRATTI_REALE=on, TARS_PROVIDER=openai, FLAG_TARS=on e OPENAI_API_KEY.
//   pnpm exec tsx scripts/eval-contratti-reali.ts > report.md
import { eseguiEvalContratti, reportMarkdownContratti } from "../server/contratti/eval/runEval";

const risultato = await eseguiEvalContratti();
process.stdout.write(reportMarkdownContratti(risultato));
process.stdout.write("\n\n## Dettaglio casi reali\n");
for (const c of risultato.casi.filter(x => x.nome.startsWith("reale-"))) {
  process.stdout.write(`\n### ${c.nome}\n`);
  process.stdout.write(JSON.stringify({ saltato: (c as any).saltato, esitoParser: (c as any).esitoParser, layoutWnd: (c as any).layoutWndRiconosciuto, campi: c.campi, note: c.note }, null, 1) + "\n");
}
