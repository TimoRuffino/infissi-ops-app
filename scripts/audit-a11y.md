# Audit accessibilità (axe-core)

`axe-core` è in devDependencies. Non è cablato in un test perché serve un
browser vero: le violazioni che contano nascono dal DOM renderizzato, non dal
JSX. La procedura è due comandi e un incolla.

```bash
cp node_modules/axe-core/axe.min.js client/public/_axe-temp.js
npm run dev
```

Nella console del browser, dopo il login:

```js
await new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = '/_axe-temp.js?v=' + Date.now();
  s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});

const pagine = ['/', '/commesse', '/clienti', '/comunicazioni',
                '/integrazioni', '/kanban', '/economia', '/planning', '/inbox'];
const out = {};
for (const p of pagine) {
  history.pushState({}, '', p);
  dispatchEvent(new PopStateEvent('popstate'));
  await new Promise(r => setTimeout(r, 1300));
  const r = await axe.run(document, {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  });
  out[p] = r.violations.length === 0
    ? 'pulita'
    : r.violations.map(v => ({
        id: v.id,
        impatto: v.impact,
        nodi: v.nodes.map(n => ({
          loc: (n.html.match(/data-loc="([^"]+)"/) || [])[1],
          html: n.html.slice(0, 120),
        })),
      }));
}
console.log(JSON.stringify(out, null, 1));
```

Ripetilo con `document.documentElement.classList.add('dark')` — il tema scuro
ha i suoi contrasti e vanno misurati a parte, non dedotti da quelli chiari.

Alla fine: `rm client/public/_axe-temp.js`. Va in `public/` solo perché Vite
non serve `node_modules` come asset statico, e non deve finire in un build.
