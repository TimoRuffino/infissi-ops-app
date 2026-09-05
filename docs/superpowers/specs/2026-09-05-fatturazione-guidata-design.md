# Fatturazione guidata: una pagina, un percorso a passi

Data: 05/09/2026. Stato: approvato dalla direzione nelle risposte del 05/09
(elenco, percorso a passi, tab in sola lettura, card con importi). Piani
precedenti: limiti (piano 1), fatturazione (piano 2), lettura del contratto
(piano 3), tutti su `main` dietro flag.

## 1. Perché

Oggi contratto, limiti e fattura vivono in tre tab della pagina commessa,
ognuna densa, senza un ordine evidente e senza un posto dove vedere «cosa
manca». L'operatore non capisce da dove partire. Serve un ingresso unico:
l'elenco delle commesse da fatturare e, per ciascuna, un percorso in quattro
passi che dice cosa è fatto, cosa manca e qual è il prossimo gesto.

## 2. Decisioni (direzione, 05/09/2026)

- **Elenco**: tutte le commesse della sede negli stati `aggiornamento_contratto`
  e `fatture_pagamento` che non hanno una fattura: né una fattura FiC
  collegata (`ficFatture` con `commessaId`), né una fattura CRM in stato
  `emessa` o successivo. Una bozza CRM non conta come fattura: la commessa
  resta in elenco con il pulsante «Continua».
- **Percorso**: pagina dedicata alla commessa con quattro passi in sequenza
  — Documenti, Contratto, Limiti, Fattura — con avanzamento visibile,
  interrompibile e riprendibile.
- **Tab della pagina commessa**: Contratto (prodotti), Limiti e Fattura
  restano ma in sola lettura: riassunto dello stato e pulsante «Apri
  fatturazione». Si lavora in un posto solo.
- **Card**: cliente, codice, stato e giorni nello stato, numero di documenti,
  i quattro passi come pallini, pattuito e importo fattura previsto (solo con
  `economia.read`), pulsante «Inizia fatturazione» o «Continua».

## 3. Flusso

1. Economia → **Fatturazione** (`/fatturazione`): elenco a card, filtri per
   stato (entrambi, solo aggiornamento contratto, solo fatture pagamento),
   ricerca per cliente/codice, ordinamento per giorni nello stato (decrescente).
2. Card → «Inizia fatturazione» / «Continua» → `/fatturazione/:commessaId`.
3. Passo 1 **Documenti**: tutti i file del fascicolo della commessa (tipo,
   nome, data, chi l'ha caricato), caricamento di nuovi file, apertura; sui
   PDF di tipo `contratto` il pulsante «Leggi il contratto» (dialog del
   piano 3, se `contrattoEstrazione` è acceso). Il passo è «fatto» quando
   esiste un contratto strutturato o almeno un documento `contratto`.
4. Passo 2 **Contratto**: l'editor del contratto strutturato (righe, pattuito,
   cantiere, rate) — lo stesso di oggi, in modalità guidata (niente
   intestazioni di tab, pulsante «Avanti» che salva). «Fatto» quando il
   contratto esiste con almeno una riga.
5. Passo 3 **Limiti**: il computo (calcolo, voci, avvisi, scavalchi). «Fatto»
   quando il computo esiste, è coerente con il contratto corrente
   (`hashParametri`/`hashRighe`) ed esito `ok`.
6. Passo 4 **Fattura**: bozza, riequilibrio, scadenze, emissione, stato SdI,
   nota di credito — i componenti del piano 2. «Fatto» quando la fattura è
   `emessa` o successiva; a quel punto la commessa esce dall'elenco.
7. Ogni passo mostra in testa il riepilogo dei precedenti (una riga) e in
   coda «Indietro» / «Avanti»; «Avanti» è attivo solo se il passo è fatto,
   ma si può sempre tornare indietro. Chi non ha la capability di un passo
   lo vede in sola lettura.

## 4. Modello

### 4.1 Stato dei passi (server, deterministico)

```ts
export type PassoFatturazione = "documenti" | "contratto" | "limiti" | "fattura";
export type EsitoPasso = "da_fare" | "in_corso" | "fatto" | "non_disponibile";
export type CommessaDaFatturare = {
  commessaId: number; codice: string; cliente: string;
  stato: "aggiornamento_contratto" | "fatture_pagamento";
  statoDal: string | null;            // ISO, dalla timeline (milestone dello stato) o updatedAt
  giorniNelloStato: number | null;
  documenti: { totale: number; contratti: number };
  passi: Record<PassoFatturazione, EsitoPasso>;
  prossimoPasso: PassoFatturazione | null;
  pattuitoCent: number | null;        // solo con economia.read
  fatturaPrevistaCent: number | null; // bozza.totaleCent, altrimenti pattuito lordo; solo con economia.read
  fatturaStato: StatoFattura | null;  // bozza/in_emissione…
};
```

Regole: `documenti` = `fatto` se esiste un contratto strutturato o un
documento `contratto`, altrimenti `da_fare`; `contratto` = `fatto` con righe
≥ 1, `in_corso` se esiste senza righe, altrimenti `da_fare`; `limiti` =
`fatto` se il computo esiste, non è stantio rispetto al contratto ed esito
`ok`, `in_corso` se esiste ma stantio o incompleto, `non_disponibile` con
flag `limiti` spento; `fattura` = `fatto` da `emessa` in poi, `in_corso` con
bozza o `in_emissione`/`scartata`/`rifiutata`, `non_disponibile` con flag
`fatturazione` spento, altrimenti `da_fare`. `prossimoPasso` = il primo non
`fatto` nell'ordine.

### 4.2 Filtro «senza fattura»

`ficFatture` (store FiC) filtrato per `sedeId` e `commessaId` = id; `fatture`
CRM per commessa con stato in `emessa|inviata|consegnata|mancata_consegna`
(`scartata`/`rifiutata`/`annullata` non contano: si rifattura). Se una delle
due esiste la commessa non compare.

### 4.3 Importi

`pattuitoCent` dal contratto strutturato (`pattuitoCent`, `pattuitoTipo`) o,
in assenza, da `commessa.importoTotale`; `fatturaPrevistaCent` =
`bozza.totaleCent` se esiste una bozza, altrimenti il pattuito (lordo com'è
o imponibile × 1,10 come stima dichiarata «stima»). Entrambi `null` per chi
non ha `economia.read`; la card allora non mostra la riga degli importi.

## 5. Server

- Nuovo router `fatturazioneGuidata` (`server/routers/fatturazioneGuidata.ts`)
  dietro `procedureConInterruttore("limiti")`:
  - `daFare` (query, `contratto.read`): elenco della sede come §4.1, ordinato
    per `giorniNelloStato` decrescente; una sola lettura per store (commesse,
    documenti, contratti, computi, fatture CRM, fatture FiC), niente N+1.
  - `passi` (query `{ commessaId }`, `contratto.read`): lo stesso record per
    una commessa (usato dalla pagina a passi e dalle tab in sola lettura);
    commessa di altra sede → `NOT_FOUND`.
- Nessuna mutation nuova: i passi usano le procedure esistenti
  (`preventiviContratti.*`, `estrazioniContratto.*`, `contratti.*`,
  `computo.*`, `fatture.*`).
- Stato dei passi calcolato da una funzione pura
  `server/fatturazione/passi.ts` (`calcolaPassi(input)`), testata da sola.

## 6. Client

- Rotte: `/fatturazione` → `pages/Fatturazione.tsx`; `/fatturazione/:id` →
  `pages/FatturazioneCommessa.tsx`. Voce «Fatturazione» prima di «Contabilità»
  nel gruppo Economia (`requiredCapabilities: ["contratto.read"]`,
  `loadingFallbackRoles: ["direzione", "amministrazione"]`).
- `client/src/lib/fatturazioneView.ts`: etichette dei passi, colore dei
  pallini, `etichettaPulsante(passi)` («Inizia fatturazione» se tutto
  `da_fare`, altrimenti «Continua»), `giorniTesto`, formattazione importi con
  gli helper euro; test in `fatturazioneView.test.ts`.
- `components/fatturazione/CardCommessaDaFatturare.tsx`,
  `PassiFatturazione.tsx` (stepper: 4 passi, stato, click per saltare ai
  passi già fatti o al prossimo), `PassoDocumenti.tsx` (fascicolo: elenco,
  caricamento, apertura, «Leggi il contratto» → `LeggiContrattoDialog`).
- `ContrattoTab`, `LimitiTab`, `FatturaTab` ricevono `modalita:
  "guidata" | "lettura"` (default: comportamento attuale = `"guidata"` senza
  pulsanti Avanti; in `"lettura"` nascondono i controlli di modifica e
  mostrano un riassunto + «Apri fatturazione»). La pagina commessa usa
  `"lettura"`; la pagina a passi usa `"guidata"` con `onAvanti`.
- `ContrattoStatoBanner`: il pulsante principale diventa «Apri fatturazione»
  (link alla pagina a passi) quando il flag `limiti` è acceso.
- Mobile (390): card impilate; stepper a scorrimento orizzontale con il
  passo corrente evidenziato; i passi riusano i componenti già responsivi.
- Nessun mirror di capability: i pulsanti si disattivano in base a
  `puoModificare` dei dati del server (già presenti nei router) e agli
  errori `FORBIDDEN`.

## 7. Permessi, sede, flag

- Elenco e passi: `contratto.read` (amministrazione, commerciale, direzione).
  Modifiche: le capability dei router esistenti (`contratto.manage`,
  `fattura.draft`, `fattura.emit`, `fattura.credit_note`).
- Importi: `economia.read`.
- Sede: ogni query filtra per `sedeId`; commessa di altra sede → `NOT_FOUND`.
- Flag: pagina visibile con `limiti`; passo Fattura con `fatturazione`;
  «Leggi il contratto» con `contrattoEstrazione`. Con `limiti` spento la voce
  di menu non compare.

## 8. Test

- `server/fatturazione/passi.test.ts`: tabella di casi per ogni passo e per
  `prossimoPasso`.
- `server/routers/fatturazioneGuidata.test.ts`: filtro stati, esclusione con
  fattura FiC collegata e con fattura CRM emessa (bozza resta), sede, importi
  nascosti senza `economia.read`, `NOT_FOUND` altra sede, flag spento.
- `client/src/lib/fatturazioneView.test.ts`: etichette e pulsante.
- Browser: 1440×900 e 390×844 su elenco, pagina a passi (i quattro passi),
  tab in sola lettura; console pulita.

## 9. Fuori ambito

Transizioni di stato automatiche della commessa; nuove regole di dominio su
contratto, limiti o fattura; ridisegno dei componenti interni delle tab
(solo la cornice cambia); notifiche.
