# Computo limiti: analisi dei fogli reali e modello verificato

Data: 03/09/2026. Integra la spec `2026-09-03-limiti-e-fatturazione-design.md`
(§5 motore, §4.3 tariffe) e **prevale su di essa dove divergono**. È la
specifica del motore `server/computo/motore.ts` e del seed
`shared/limiti/tariffe-seed.json` (generato da `scripts/estrai-tariffe-limiti.py`).

Fonti (fuori dal repository, dati aziendali): tre commesse chiuse nel 2026
con contratto (preventivo Konfortline/Etrum), foglio «CALCOLO NUOVI LIMITI»
compilato (due `.xlsm`, un PDF) e fattura FiC — numeri 127, 129 e 130/2026.
Qui e nel codice compaiono solo misure, prezzi di listino e totali: mai
nomi, indirizzi o codici fiscali.

## 1. Cosa succede davvero, in tre casi

| | 127/2026 | 129/2026 | 130/2026 |
|---|---|---|---|
| Righe contratto | 3 PF 2 ante 1900×2400, 2 fin 2 ante 1660×1540, 1 fin 2 ante 1150×1540 (PVC pellicolato «Real Wood») + coprifili + posa 1.100 + 6 maniglie | 8 finestre PVC bianche (1 anta) + 7 persiane alluminio abbinate + posa/trasporto 2.800 + coprifili | 6 finestre PVC bianche + coprifili + posa 1.000 |
| Contratto | 14.086,11 + IVA 10 % = **15.494,72** | 11.910,86 + IVA mista = **14.092,71** | 5.712,78 + IVA (22 % beni, 10 % posa) = **6.849,59** |
| Foglio limiti | zona D, 2 installatori, km non indicati | zona «E» nel foglio (La Spezia è D: massimali uguali), 12 km | zona «E», km non indicati |
| CHECK1 / CHECK2 | 19.519,84 / **19.307,29** | **16.975,66** / 19.735,99 | 13.999,91 / **10.965,57** |
| Fattura | beni 8.847,46 @22, servizi 4.798,59 @10, storno/riaddebito 4.798,59; imponibile 13.646,05; totale **15.496,52** | tutto @10 (servizi > beni significativi): imponibile 12.810,91; totale **14.092,00** | beni 3.262,28 @22, servizi 2.449 @10; imponibile 5.711,28; totale **6.380,00** |

Osservazioni che cambiano il piano:

1. **Il limite vincolante cambia caso per caso** (CHECK2 in 127 e 130,
   CHECK1 in 129): servono entrambi, per riga, con i prezzi giusti.
2. **I prezzi DEI di CHECK2 stanno nei fogli «Calcolo Automatici A…F»**
   (colonna PREZZO UNITARIO, es. PVC finestra 2 ante 589,57 €/mq), non nel
   foglio «DEI» (574,72: listino più vecchio). Il seed deve leggere quelli.
3. **Gli accessori pesano**: nel 127 il 22 % del CHECK2 prodotti è
   pellicolatura (15 % sul totale a mq), incollaggio strutturale (120 €/anta)
   e ribalta (70 €/pezzo). Le righe del contratto devono portare gli
   accessori con codice di catalogo.
4. **L'oscurante abbinato è un prodotto DEI a sé** (persiana alluminio
   525,58–575,99 €/mq × mq del serramento, + accessori in percentuale per
   pezzo) e sposta il serramento nel blocco B (900 €/mq).
5. **Totali del foglio**: `H46 = H9 + Σ T22:T34 + Σ T39:T43 + G35 + H15 + H19`
   dove `Tn = IF(Gn>0, Hn, 0)`: un servizio entra nel totale **solo se è
   fatturato**; le spese professionali entrano per l'importo fatturato
   (G35), non per il limite. `T46` (CHECK2) **esclude** sviluppo ordine (T25),
   trasporto (T30) e posa (T33): sono già nel prezzo DEI «opere compiute».
   Prima della fattura il CRM usa un insieme di voci «incluse» (§4).
6. **La fattura ricalca il contratto a modo suo**: se il contratto è lordo
   con IVA 10 % piatta, la fattura tiene il **lordo** (15.494,72 →
   15.496,52) e l'imponibile scende; se il contratto era a IVA 22 %, tiene
   l'**imponibile** (5.712,78 → 5.711,28) e il lordo scende. È materia del
   piano 2, ma il contratto deve registrare `pattuitoTipo` e la struttura
   IVA del preventivo (beni al 22 o al 10).
7. **«Da fattura» delle opere** (G22:G34) è una scelta dell'operatore sotto
   il limite: nel 129 ha preso il limite arrotondato per difetto (220, 119,
   110, 146, 523, 323, 528 = 84 + 444, 317, 2.500, 272); nel 127 e 130 valori
   più bassi. Il piano 2 propone il limite intero come default modificabile.

## 2. Formule verificate (foglio → motore)

Ogni formula è stata ricalcolata a mano sui tre casi. Notazione: `n.x` =
pezzi, `mq.x` = metri quadri del gruppo `x` (chiavi di `aggregati.ts`:
serramenti, cassonetti, porteBlindate, portoncini, serrTapp, serrPers,
serrScuri, portoncinoPers, tapparelle, persiane, scuri, veneziane, tende,
pergole, zanzariere, legno, legnoTapp, legnoPers, legnoScuri).

### 2.1 Aggregati e tempi (Calcolo Automatici L7…BD11, Tempi)

- `mq` di riga = `L × H × quantità / 10⁶` **senza arrotondamento** (H7 = 4,75;
  5,1128; 1,2728). Nel DB: `NUMERIC(12,6)`; niente `round` a 3 decimali
  (16.039,76 ≠ 16.039,92).
- `larghezzaM` (Q13) = Σ L × quantità dei soli serramenti (blocchi A, B, E,
  F) — 127: 10,17; 129: 7,19; 130: 7,24.
- Ore tiro (Tempi F14) = 0,5 × serramenti + 0,25 × (serrTapp + cassonetti +
  tapparelle + legnoTapp) + 0,25 × (serrPers + persiane + legnoPers +
  portoncinoPers) + 0,25 × (serrScuri + scuri + legnoScuri) + ⅓ + 0,5 ×
  porteBlindate + 0,5 × (portoncini + portoncinoPers) + 0,25 × (veneziane +
  zanzariere) + 1 × tende + 2 × pergole. 129: 8 × 0,5 + 7 × 0,25 + ⅓ = 6,0833.
- Ore posa (Tempi O12) = 3 × serramenti + 1 × cassonetti + 1,5 × oscuranti
  (soli e abbinati) + 1,5 × (veneziane + zanzariere) + 4 × tende + 16 ×
  pergole + 3 × porteBlindate + 3 × portoncini. 129: 24 + 10,5 = 34,5.
- Giornate = `ROUNDUP(orePosa / 8)`.

### 2.2 CHECK1, prodotti e opere (CHECK1 H6:H43)

| Cella | Voce | Formula | Verifica |
|---|---|---|---|
| H6 | massimale A | `E6 × (mq blocco A + mq legno)` | 129: 780 × 0,73 = 569,40 |
| H7 | massimale B | `E7 × (mq blocco B + mq legno+oscuranti)` | 129: 900 × 12,5854 = 11.326,86 |
| H8 | massimale C | `E8 × (mq oscuranti soli + schermature)` | — |
| H11/H13/H14/H17/H18 | controtelai | `prezzo × misura`, acciaio/misto: `min 1,2 mq` | — |
| H22 | rilievo al pezzo | `60,17 × (nA/8 + nLegno/8 + serrTapp/4 + legnoTapp/4 + serrPers/4 + legnoPers/4 + cassonettiB/8 + legnoScuri/4 + serrScuri/8 + nC/8 + cassonettiLegno/8 + nD/8 + portoncinoPers/8 + 1)` | 129: (1/8 + 7/4 + 1) × 60,17 = 172,99 |
| H23 | rilievo a foro | `60,17 × (serramentiTutti/3 + 1)` | 129: (8/3 + 1) × 60,17 = 220,62 |
| H24 | progettazione | `29,84 × nTotale/2` | 129: 4 × 29,84 = 119,36 |
| H25 | sviluppo ordine | `60,17 × (nTotale/6 + ½)` | 129: 110,31 |
| H26 | protezione | `36,5 × ½ × (serramenti + legno + serrTapp + serrPers + serrScuri + porteBlindate + portoncini + tapparelle + persiane + scuri + legnoTapp + legnoPers + legnoScuri + portoncinoPers)` | 129: 4 × 36,5 = 146 |
| H27 | rimozione serramenti | `20,22 × (mq.serramenti + mq.legno + 2·mq.serrPers + mq.serrTapp + mq.serrScuri + mq.persiane + mq.scuri + mq.tapparelle + mq.porteBlindate + mq.portoncini + 2·mq.legnoPers + mq.legnoTapp + mq.legnoScuri + 2·mq.portoncinoPers)` | 129: 20,22 × 25,9008 = 523,71 |
| H28 | rimozione tapparelle | `26,97 × (mq.serrTapp + mq.cassonettiB + mq.tapparelle + mq.cassonetti + mq.legnoTapp + mq.cassonettiLegno)` | — |
| H29 | smaltimento | **`150 + 104,69 × 0,1 × mqSerr + 0,35 × mqCass + 0,05 × mqOsc + 100 × 0,025 × mqSerrOneri + 0,015 × mqCass + 0,0125 × mqOscOneri`** — la precedenza del foglio moltiplica 104,69 e 100 SOLO per il primo addendo. Si riproduce così. `mqSerr` = serramenti + legno + serrTapp + serrPers + serrScuri + legnoTapp + legnoPers + legnoScuri + porteBlindate + portoncini + portoncinoPers; `mqOsc` = serrTapp + serrPers + serrScuri + tapparelle + persiane + scuri; `mqSerrOneri` = mqSerr − legnoTapp − legnoPers − legnoScuri; `mqOscOneri` = mqOsc + legnoTapp + legnoPers + legnoScuri | 129: 150 + 139,40 + 0,63 + 33,29 + 0,16 = 323,47; 130: 330,72; 127: 416,69 |
| H30 | trasporto | `2 × km × 0,7 × giornate` | 129: 2 × 12 × 0,7 × 5 = 84 |
| H31 | tiro al piano | `2 × 36,5 × oreTiro × (piano > 4 ? 1,3 : 1)` | 129: 444,08 |
| H32 | assistenza muraria | `44,13 × larghezzaM` | 129: 317,29 |
| H33 | posa | `orePosa × 2 × 36,5` | 129: 2.518,50 |
| H34 | pulizia | `50 + oreTiro × 36,5` | 129: 272,04 |
| H35 | spese professionali | `max(600; 4 % di quanto fatturato)`; prima della fattura: `max(600; 4 % del pattuito imponibile stimato)` | 600 nei tre casi |
| H39 | altri servizi | `2 % dei prodotti fatturati`; prima della fattura: 2 % della somma dei `prezzoTotCent` delle righe | — |
| H40 | assistenze murarie | `32,18 × 2 × nTotale` | 129: 514,88 |
| H41 | dime | `92,85 × mqTotale` | 129: 1.236,33 |
| H42 | piattaforma | `517,92` (64,74 × 8) | |
| H43 | permessi suolo | `300` | |

`E22:E43` (prezzi) sono dati del seed (`opere[]`), non costanti del motore.

### 2.3 CHECK2 per riga (T6 = Σ blocchi «Calcolo Automatici»)

Per ogni riga di SERRAMENTI il foglio ha un blocco di 65 righe che ricalcola
il prodotto scelto (`Prodotti` = nome, `CODICE` DEI, `PREZZO UNITARIO`) e
gli accessori marcati «Sì». Regole per sotto-blocco (formula del `Total`):

| Sotto-blocco | Base | Accessori |
|---|---|---|
| Serramenti PVC/alluminio (A, B) | `prezzo × mq_riga`, con **minimo 1 mq sul totale della riga** (`I = IF(0<mq<1, 1, mq)`), non per pezzo | pellicolatura `15 % × prezzo × mq`; incollaggio `120 × nAnte × q`; soglia ribassata PF `100 × q` (solo portefinestre); coprifili 80/100 `1,65 / 3,45 €/m × perimetro × q` con perimetro = `L + 2H` per portefinestre, `2(L + H)` per finestre; ribalta `70 × q` (per pezzo, non per anta); alluminio: percentuali `× prezzo × mq`, ribalta alluminio `70 × q` |
| Serramenti legno / legno-alluminio (E, F) | `prezzo × mq` **senza minimo** | percentuali `× prezzo × q` (per pezzo), ribalta `70 × q` |
| Cassonetti (A, B) | prezzo **a pezzo** scelto dalla classe di mq per pezzo: `<0,51 → 100×40; <0,71 → 150×40; <0,91 → 200×40; <1,11 → 250×40; altrimenti 300×40` (famiglie fino/oltre 110 mm; monoblocco per fascia mq) | pellicolatura `19 % × prezzo × q`; traverso `45 × q` |
| Avvolgibili (B, C, F) | `prezzo × max(1,8; mqAvv)`, `mqAvv = mq_riga + 0,05 × (L + 0,25) + 0,25 × (H + 0,05)` (L, H in metri; la maggiorazione è per riga, non per pezzo) | motori `176/198/225,5/247,5 × q` |
| Persiane (B, C, F) | `prezzo × mq_riga` (mq del serramento, **senza minimo**) | PVC: pellicolatura `19 % × prezzo × q`, serratura `163 × q`, cardini cappotto `6 × q × 2`; legno: percentuali `× prezzo × q`, laccature a pezzo; alluminio: anodizzazione naturale 3 %, elettrocolore 4 %, colori speciali 4 %, effetto legno 8 %, cardini 180 mm 3 % (1 anta) / 4 % (2 ante) — tutte `× prezzo × q` |
| Scuri legno | `prezzo × mq` | douglas 28 %, rovere 33 % `× prezzo × q`; bianco 46, RAL 50 `× q` |
| Portoncini | `prezzo × mq` | pellicolatura `15 % × prezzo × mq`; soglia `120` **una volta per riga** |
| Porte blindate | `prezzo × q` (a pezzo) | — |
| Schermature (D) | `prezzo × mq` con voce scelta per intervallo L/H (il foglio la sceglie da tabelle di intervalli) | — (v1: l'operatore sceglie il codice; il motore non applica gli intervalli) |

Verifiche: 127 → 13.366,49 × 1,15 + 1.440 + 420 = **17.231,46**; 130 →
**9.239,054236**; 129 → 791,07 (blocco A) + 16.578,325892 (blocco B) =
**17.369,395892**. Riproduzione in `scratchpad/valida_casi.py` → «TUTTO OK».

### 2.4 Totali

- `check1` = massimali (H9) + controtelai (H15 + H19) + Σ opere **incluse** +
  Σ eventuali **inclusi** + (spese professionali se incluse).
- `check2` = Σ DEI per riga (T6) + controtelai + Σ opere incluse **tranne**
  sviluppo ordine, trasporto e posa + Σ eventuali inclusi + (spese
  professionali se incluse).
- `limite` = min(check1, check2); se una riga non ha voce DEI, `check2`
  è `null`, `limite = check1`, esito «incompleto».
- Riproduzione: 130 → 13.999,912 / 10.965,567; 129 → 16.975,663 /
  19.735,987; 127 → 19.519,84 / 19.307,28 (il PDF mostra 19.307,29 per
  arrotondamenti a video).

## 3. Modello nel CRM (prevale sul piano 1 dove diverge)

### 3.1 Riga di contratto

- `categoria` come nel piano (serramento_pvc, serramento_alluminio,
  serramento_legno, serramento_legno_alluminio, cassonetto, tapparella,
  persiana, scuro, schermatura, zanzariera, tenda, pergola, porta_blindata,
  portoncino, porta_interna, controtelaio, accessorio, altro).
- `tipologia` = **codice del prodotto DEI nel seed** (`prodotti[].codice`,
  es. `C25077-c` «PVC finestra a 2 ante»), non più l'enum
  `TIPOLOGIE_SERRAMENTO`. Per i controtelai resta il codice della variante.
- `oscuranteIntegrato` (tapparella | persiana | scuro | null) come nel piano,
  più **`oscuranteTipologia`**: codice del prodotto DEI dell'oscurante
  abbinato (es. `C15078-a`).
- `accessori`: `Array<{ codice: string; quantita: number }>` con `codice` =
  `accessori[].codice` del seed (es. `serramento.C25088-a`). Gli accessori
  dell'oscurante usano i codici del gruppo dell'oscurante
  (`persiana.C15154-b`). La `quantita` conta i pezzi interessati (default =
  quantità della riga); per le regole in percentuale sui mq è ignorata.
- `mq` = `L × H × q / 10⁶` esatto (6 decimali).

### 3.2 Contratto

Aggiunge `opzioniComputo` (parte di `hashParametri`):

```ts
type OpzioniComputo = {
  rilievo: "foro" | "pezzo";            // H23 oppure H22, mai entrambi
  speseProfessionali: boolean;         // H35 nel totale
  eventuali: CodiceOpera[];            // H39..H43 richiesti in cantiere
};
// default: { rilievo: "foro", speseProfessionali: false, eventuali: [] }
```

### 3.3 Voci del computo

`VoceComputo` aggiunge `inclusa: boolean` e `inCheck2: boolean`. Le voci
prodotto sono due per riga: `massimale_*` (CHECK1, aggregata per gruppo)
e `dei_riga_n` (CHECK2, per riga, con `dettaglio` che elenca base e
accessori). Le opere hanno `inclusa` dalle opzioni (default: tutte le
ordinarie tranne rilievo al pezzo; spese professionali ed eventuali
solo se richiesti) e `inCheck2 = !opere[].esclusaDaCheck2`.

### 3.4 Seed (`shared/limiti/tariffe-seed.json`)

```
massimali[18] { gruppo A|B|C, zona, euroMq }
prodotti[342] { codice, gruppo: serramento|cassonetto|avvolgibile|persiana|scuro|portoncino|porta_blindata|schermatura,
                famiglia, nome, prezzo, unita: mq|cad|m, foglio, zone?, nAnte?, portafinestra?, minimoMq?,
                mqPezzoMin?, mqPezzoMax?, intervalloL?, intervalloH? }
accessori[~75] { codice: "<gruppo>.<codiceDei>", codiceDei, nome, gruppo, famiglie[],
                 regola: pct_mq|pct_pezzo|cad_pezzo|cad_anta|cad_fisso|m_perimetro, valore, moltiplicatore, soloPortafinestra }
controtelai[22], opere[19] { …, esclusaDaCheck2, inclusaDefault }, coefficienti, detrazioni, beneSignificativoDefault
```

## 4. Casi d'oro per i test del motore

Fixture `server/computo/__fixtures__/casi-reali.json` (righe, parametri e
attesi in euro con 4 decimali dove il foglio li dà; tolleranza 1 centesimo
sui valori letti da un PDF).

**Caso 130** (zona E, km null, piano null): PF 2 ante `C25077-e` 1×1900×2500
[`serramento.C25088-c`, `serramento.C25088-h`, `serramento.C25126`];
`C25077-c` 2×1200×1720 e 2×1100×1720 [C25088-h, C25126]; `C25077-b`
1×740×1720 [C25088-h, C25126]. Attesi: massimale_A 10.869,144; rilievo_pezzo
105,2975; rilievo_foro 180,51; progettazione 89,52; sviluppo_ordine 90,255;
protezione 109,5; rimozione_serramenti 281,761656; rimozione_tapparelle 0;
smaltimento 330,7204212; trasporto 0; tiro_piano 243,3333; assistenza_muraria
319,5012; posa 1.314; pulizia 171,6667; spese_professionali 600;
assistenze_murarie_eventuali 386,16; dime 1.293,84618; piattaforma 517,92;
permessi_suolo 300; DEI totale 9.239,054236; check1 13.999,912; check2
10.965,567.

**Caso 129** (zona E, km 12, piano null): `C25077-b` 1×500×1460 [C25088-b,
C25126]; con persiana: `C25077-b` 1×510×1340 + `C15079-a` [persiana
C15154-b, C15155-a]; 1×1000×2540 + `C15078-a`; 2×1000×1660 + `C15078-a`;
3×1060×1900 + `C15078-a` (tutte con [C25088-b, C25126] sul serramento e
[C15154-b, C15155-a] sulla persiana). Attesi: massimale_A 569,4; massimale_B
11.326,86; rilievo_pezzo 172,98875; rilievo_foro 220,62333; progettazione
119,36; sviluppo_ordine 110,31167; protezione 146; rimozione_serramenti
523,714176; smaltimento 323,4740101; trasporto 84; tiro_piano 444,08333;
assistenza_muraria 317,2947; posa 2.518,5; pulizia 272,04167;
assistenze_murarie_eventuali 514,88; dime 1.236,33489; DEI totale
17.369,395892; check1 16.975,663; check2 19.735,987.

**Caso 127** (zona D, km null, piano ≤ 4): `C25077-e` 3×1900×2400,
`C25077-c` 2×1660×1540 e 1×1150×1540, tutte [C25088-a, C25088-b, C25126].
Attesi: massimale_A 16.039,764; rilievo_foro 180,51; progettazione 89,52;
sviluppo_ordine 90,255; protezione 109,5; rimozione_serramenti 415,80;
smaltimento 416,69; tiro_piano 243,33; assistenza_muraria 448,80; posa
1.314; pulizia 171,67; DEI totale 17.231,46; check1 19.519,84; check2
19.307,28 (±0,02).

## 5. Scelte deliberate (stranezze del foglio che si riproducono)

- H29: precedenza degli operatori come nel foglio (§2.2).
- Minimo 1 mq sul totale della riga, non sul pezzo, e solo per PVC/alluminio.
- Ribalta 70 € per pezzo (il foglio non moltiplica per le ante); incollaggio
  120 € per anta (`nAnte` della tipologia).
- Maggiorazione avvolgibile sommata una volta per riga; soglia portoncino
  una volta per riga; cardini cappotto × 2.
- Zona climatica: il foglio la digita a mano (`INIZIO!H11`); il CRM la
  deriva dal comune con override registrato. D ed E hanno gli stessi
  massimali, quindi i due `.xlsm` con «E» per La Spezia non cambiano i numeri.
- Le percentuali di CHECK2 usano il prezzo unitario **del prodotto scelto**
  (alluminio per zona), mai un prezzo medio.

Queste scelte sono fatti contabili già accettati dal commercialista nei
tre casi; cambiarle è una decisione di direzione, non un fix.
