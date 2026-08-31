# Modular Control — report contrasto Borgogna Operativa

**Data audit:** 31 agosto 2026

**Comando ripetibile:** `pnpm ui:contrast`

**Esito:** 44/44 coppie conformi

Il controllo usa luminanza relativa sRGB e rapporto WCAG. La soglia è 4,5:1
per testo normale e 3:1 per bordi di controllo, focus e testo grande. Il
programma canonico e l'inventario delle coppie sono in
`scripts/check-ui-contrast.ts`; un fallimento termina il comando con exit code
diverso da zero.

## Sintesi dei margini

| Regime | Categoria            | Coppia col margine minimo       | Rapporto | Soglia |
| ------ | -------------------- | ------------------------------- | -------: | -----: |
| Light  | Testo normale        | warning / warning-soft          |   4,81:1 |  4,5:1 |
| Light  | Controllo essenziale | border-control / canvas         |   3,73:1 |  3,0:1 |
| Light  | Gradiente focale     | on-focal / stop `#884B79`       |   6,31:1 |  4,5:1 |
| Dark   | Testo normale        | warning / warning-soft          |   6,70:1 |  4,5:1 |
| Dark   | Controllo essenziale | border-control / surface-raised |   3,09:1 |  3,0:1 |
| Dark   | Gradiente focale     | on-focal / stop `#6B4163`       |   8,20:1 |  4,5:1 |

## Inventario verificato

| Regime | Coppia                             | Rapporto | Esito |
| ------ | ---------------------------------- | -------: | :---- |
| Light  | ink / surface                      |  17,50:1 | PASS  |
| Light  | ink / canvas                       |  16,12:1 | PASS  |
| Light  | muted / surface                    |   5,57:1 | PASS  |
| Light  | on-brand / brand                   |   8,92:1 | PASS  |
| Light  | brand-soft-ink / brand-soft        |   9,47:1 | PASS  |
| Light  | on-mora / mora                     |   7,74:1 | PASS  |
| Light  | on-focal / anchor                  |  17,11:1 | PASS  |
| Light  | success / success-soft             |   5,04:1 | PASS  |
| Light  | warning / warning-soft             |   4,81:1 | PASS  |
| Light  | danger / danger-soft               |   5,32:1 | PASS  |
| Light  | info / info-soft                   |   5,26:1 | PASS  |
| Light  | on-success / success               |   5,76:1 | PASS  |
| Light  | on-warning / warning               |   5,65:1 | PASS  |
| Light  | on-danger / danger                 |   6,46:1 | PASS  |
| Light  | on-info / info                     |   6,23:1 | PASS  |
| Light  | on-focal / gradient stop `#3A1725` |  15,80:1 | PASS  |
| Light  | on-focal / gradient stop `#6C2448` |  10,59:1 | PASS  |
| Light  | on-focal / gradient stop `#884B79` |   6,31:1 | PASS  |
| Light  | border-control / surface           |   4,05:1 | PASS  |
| Light  | border-control / canvas            |   3,73:1 | PASS  |
| Light  | focus-mora / surface               |   7,74:1 | PASS  |
| Light  | focus-mora / canvas                |   7,14:1 | PASS  |
| Dark   | ink / surface                      |  16,09:1 | PASS  |
| Dark   | ink / canvas                       |  17,64:1 | PASS  |
| Dark   | muted / surface                    |   8,04:1 | PASS  |
| Dark   | on-brand / brand                   |   8,14:1 | PASS  |
| Dark   | brand-soft-ink / brand-soft        |   9,04:1 | PASS  |
| Dark   | on-mora / mora                     |   7,50:1 | PASS  |
| Dark   | on-focal / anchor                  |  16,90:1 | PASS  |
| Dark   | success / success-soft             |   6,78:1 | PASS  |
| Dark   | warning / warning-soft             |   6,70:1 | PASS  |
| Dark   | danger / danger-soft               |   7,50:1 | PASS  |
| Dark   | info / info-soft                   |   8,08:1 | PASS  |
| Dark   | on-success / success               |   8,12:1 | PASS  |
| Dark   | on-warning / warning               |   7,62:1 | PASS  |
| Dark   | on-danger / danger                 |   8,49:1 | PASS  |
| Dark   | on-info / info                     |   9,10:1 | PASS  |
| Dark   | on-focal / gradient stop `#2A1721` |  16,90:1 | PASS  |
| Dark   | on-focal / gradient stop `#522039` |  12,93:1 | PASS  |
| Dark   | on-focal / gradient stop `#6B4163` |   8,20:1 | PASS  |
| Dark   | border-control / surface           |   3,38:1 | PASS  |
| Dark   | border-control / surface-raised    |   3,09:1 | PASS  |
| Dark   | focus-mora / surface               |   7,75:1 | PASS  |
| Dark   | focus-mora / canvas                |   8,50:1 | PASS  |

## Regole consolidate

- Il gradiente è consumabile soltanto dalla variante focale.
- Il bottone predefinito usa un pieno borgogna, non un gradiente.
- `border-subtle` resta decorativo; i controlli interattivi usano
  `border-control`, verificato a 3:1.
- Focus e testo semantico usano coppie foreground/background esplicite in
  entrambi i temi.
