# Audit accessibilità (axe-core)

`axe-core` è in devDependencies. Non è cablato nella suite Node perché serve
un browser vero: le violazioni che contano nascono dal DOM renderizzato, non
dal JSX. Questa procedura verifica una superficie dichiarata; un risultato
pulito non equivale alla conformità dell'intero prodotto.

```bash
cp node_modules/axe-core/axe.min.js client/public/_axe-temp.js
FLAG_UI_V2=on pnpm dev
```

Nella console del browser, dopo il login:

```js
await new Promise((res, rej) => {
  const s = document.createElement("script");
  s.src = "/_axe-temp.js?v=" + Date.now();
  s.onload = res;
  s.onerror = rej;
  document.head.appendChild(s);
});

if (document.documentElement.dataset.uiSystem !== "modular-control") {
  throw new Error("FLAG_UI_V2 non è ON: marker Modular Control assente");
}

async function auditPaginaCorrente() {
  const r = await axe.run(document, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    },
  });
  return {
    route: location.pathname,
    viewport: `${innerWidth}x${innerHeight}`,
    tema: document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
    violazioni: r.violations.map(v => ({
      id: v.id,
      impatto: v.impact,
      nodi: v.nodes.map(n => ({
        loc: (n.html.match(/data-loc="([^"]+)"/) || [])[1],
        html: n.html.slice(0, 120),
      })),
    })),
  };
}

console.log(JSON.stringify(await auditPaginaCorrente(), null, 1));
```

Aprire e rieseguire la funzione, una route per volta, su: `/`, `/commesse`,
`/clienti`, `/kanban`, `/planning`, `/economia`, `/tars`,
`/messaggi/email`, `/messaggi/whatsapp`, `/chat`, `/integrazioni`. Registrare
solo le route e i quadranti effettivamente provati nel verification log.

Per ogni superficie selezionata eseguire almeno questa matrice:

- 1440×900 chiaro e scuro;
- 390×844 chiaro e scuro;
- reflow equivalente a zoom 200% (viewport CSS dimezzato rispetto al desktop)
  e controllo `scrollWidth === clientWidth`;
- `prefers-reduced-motion: reduce`, verificando che non restino transizioni o
  animazioni indispensabili alla comprensione.

Checklist manuale, solo tastiera:

1. Tab raggiunge lo skip link e poi il contenuto principale.
2. Rail/dock aprono le destinazioni; il drawer intrappola il focus e Escape
   restituisce il focus al trigger.
3. Ctrl/⌘K apre la palette, le frecce cambiano opzione, Invio apre, Escape
   chiude e ripristina il focus.
4. Menu profilo, switch sede e tema sono operabili con Enter/Space; Escape
   chiude senza effetti.
5. Durante lo switch sede nessun marker del contesto precedente riappare nel
   contenuto, nella palette o nei link capability-shaped.

Il tema scuro va attivato dal menu prodotto: non basta aggiungere una classe
in console, perché va verificato anche il controllo e la persistenza della
preferenza. Le route capability-protected vanno provate anche con un principal
che non possiede la capability, senza trasformare il deny in empty state.

Alla fine: `rm client/public/_axe-temp.js`. Va in `public/` solo perché Vite
non serve `node_modules` come asset statico, e non deve finire in un build.
