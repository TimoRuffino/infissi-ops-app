# Modular Control — performance baseline pre-migrazione

**Catturata:** 31/08/2026 · **Commit:**
cfef7c7c7da44926a1d90554717d906bba432d0f

Questa baseline precede qualsiasi modifica a token, shell, route o componenti
Modular Control. Serve al confronto della Slice 05; gli hash dei file possono
cambiare, quindi il confronto usa anche ruolo del chunk e byte.

## Gate

| Check             | Esito                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| pnpm check        | exit 0                                                                      |
| pnpm test         | 85 file passati, 1 saltato; 772 test passati, 5 saltati                     |
| pnpm build        | exit 0; 3122 moduli trasformati; Vite 7.1.9                                 |
| Build client      | 63 asset JS/CSS; 2.935.322 B raw; 833.311 B gzip ricalcolati                |
| JavaScript client | 62 asset; 2.757.843 B raw; 804.744 B gzip ricalcolati                       |
| CSS client        | 1 asset; 177.479 B raw; 28.567 B gzip                                       |
| index.html        | 969 B                                                                       |
| Bundle server     | dist/index.js 1.184.229 B                                                   |
| Warning state     | esbuild mostra 1.1mb ⚠️ per il bundle server; Vite non emette warning chunk |
| Tempo osservato   | Vite 7,79 s; esbuild 20 ms nella corsa baseline                             |

Il gzip ricalcolato usa node:zlib sul contenuto emesso. Può differire da un
server CDN in base agli header o all’algoritmo di compressione, ma rende il
confronto locale ripetibile.

## Ogni asset client emesso

Ordinamento crescente per byte raw, ottenuto con:
find dist/public/assets -maxdepth 1 -type f -exec wc -c {} + | sort -n

```text
     214 prodotti-xMhIf4uu.js
     351 StatoChip-DriYJ3l-.js
     437 separator-DuoCNioc.js
     446 progress-CeYBpKVu.js
     547 calendario-BiwgfhfK.js
     558 ConfirmDialog-CYTDpgfo.js
     829 euro-CedImm9o.js
     882 checkbox-I2CQtYC_.js
     885 card-ZLBGkddK.js
     902 switch-DohsbC8V.js
     951 radio-group-CyYsoTFd.js
    1025 paymentView-B4kgb0gu.js
    1141 DeleteCommessaDialog-B0tWY8WZ.js
    1160 textarea-B6hCWQoe.js
    1337 tabs-zgsGz0cA.js
    1413 NotFound-BHMNjNlS.js
    1543 WhatsAppButton-9SaSnEFD.js
    1881 alert-dialog-BzdFFbo_.js
    2040 TarsBriefing-Bxr9Xqsu.js
    2575 FilePreviewDialog-DTNtyvNf.js
    2644 SearchSelect-DgDMq_38.js
    3896 select-BW39Kdtl.js
    3985 SediList-D3_pd72Q.js
    5000 Conoscenza-CcNOWtKU.js
    6091 SquadreList-D0wNkSYG.js
    6465 Archivio-DpDYDhw1.js
    7681 CaselleEmailCard-CwXTBI5N.js
    7730 Notifiche-DIuNxwaN.js
    7902 VerbaleChiusura-V_yyVoHJ.js
    8950 Preventivatori-CJIMN2KT.js
    9300 Marginalita-O2luckVE.js
   10075 GaranzieList-6j48817C.js
   11052 BreakEvenPanel-fH2rjDP7.js
   11148 Tars-BI-LBhKK.js
   11570 ChatAziendale-D1Z7aRbx.js
   12586 ReclamiRifacimenti-wyepawPG.js
   12604 Pagamenti-D8_iWQ9m.js
   16170 KanbanBoard-Cv1C6Kdr.js
   16173 RilievoDetail-BB4_NO0Y.js
   17205 Magazzino-CMJLlKQP.js
   20577 Dashboard-BxY_UlG6.js
   22028 purify.es-BwoZCkIS.js
   22952 ClientiList-DmJb4pKv.js
   24364 WhatsAppPage-BFxORvsf.js
   24816 CommesseList-AHZd6uUg.js
   26587 TicketList-D-YW4K-a.js
   26839 Planning-Cpc2gEA7.js
   27854 PreventivatoreFivizzanese-IFfclHu6.js
   28826 UtentiList-DhTUt-_e.js
   34826 EmailPage--ftSvefd.js
   35263 ClienteDetail-MdqGVfrb.js
   37874 FornitoriList-BDxIwZeq.js
   59115 Integrazioni-TxT0pNwy.js
   59607 Economia-D3oIaDVo.js
   88295 CommessaDetail-uTmiKZqq.js
  107605 PreventivatorePuntoDelSerramento-2pIJGiDa.js
  159687 index.es-CcGP10V6.js
  177479 index-DwTHToJb.css
  196564 index-B8VDgi-U.js
  202363 html2canvas.esm-B0tyYwQk.js
  375675 DashboardApprofondimenti-CTKaWqGz.js
  398034 jspdf.plugin.autotable-MmoS9jPT.js
  568748 vendor-runtime-DcV-gve8.js
 2935322 total
```

## Quindici asset più grandi, raw / gzip

| Asset                                        |   Raw B |  Gzip B |
| -------------------------------------------- | ------: | ------: |
| vendor-runtime-DcV-gve8.js                   | 568.748 | 167.381 |
| jspdf.plugin.autotable-MmoS9jPT.js           | 398.034 | 129.197 |
| DashboardApprofondimenti-CTKaWqGz.js         | 375.675 | 103.791 |
| html2canvas.esm-B0tyYwQk.js                  | 202.363 |  47.699 |
| index-B8VDgi-U.js                            | 196.564 |  62.395 |
| index-DwTHToJb.css                           | 177.479 |  28.567 |
| index.es-CcGP10V6.js                         | 159.687 |  53.410 |
| PreventivatorePuntoDelSerramento-2pIJGiDa.js | 107.605 |  30.568 |
| CommessaDetail-uTmiKZqq.js                   |  88.295 |  21.586 |
| Economia-D3oIaDVo.js                         |  59.607 |  14.453 |
| Integrazioni-TxT0pNwy.js                     |  59.115 |  15.183 |
| FornitoriList-BDxIwZeq.js                    |  37.874 |   8.135 |
| ClienteDetail-MdqGVfrb.js                    |  35.263 |   7.823 |
| EmailPage--ftSvefd.js                        |  34.826 |   9.314 |
| UtentiList-DhTUt-\_e.js                      |  28.826 |   7.159 |

## Baseline visuale e viewport

Le sei immagini sono in evidence/baseline/. Tutti i dati sono fixture locali
in-memory. documentElement non presenta overflow orizzontale:

| Pagina         | Viewport | clientWidth | scrollWidth | scrollHeight |
| -------------- | -------: | ----------: | ----------: | -----------: |
| Dashboard      | 1440×900 |        1440 |        1440 |          900 |
| Commessa       | 1440×900 |        1440 |        1440 |         2172 |
| Kanban         | 1440×900 |        1440 |        1440 |          900 |
| Tars degradato | 1440×900 |        1440 |        1440 |          900 |
| Dashboard      |  390×844 |         390 |         390 |         2227 |
| Rilievo        |  390×844 |         390 |         390 |          900 |
