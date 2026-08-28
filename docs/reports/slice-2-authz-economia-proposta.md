# Slice 2 — Dati economici e pagamenti dietro capability (spec approvata)

> Spec della slice autorizzata con la decisione D3 e **matrice confermata
> dalla direzione il 28/08/2026** (punti 1–5 in fondo). Chiude i rischi R4 e
> R5 del Discovery Dossier usando il capability layer esistente, senza ruoli
> hardcoded. **Non ancora implementata**: prossima slice in coda, prima della
> Document Intelligence (D7).

## Problema (VERIFICATO)

- **R4** — `commesse.byId` restituisce l'oggetto grezzo a qualunque utente
  autenticato della sede: `pagamenti[]` (registro incassi), `costi[]`
  (costi fornitore), `costoPosaStimato`. La UI nasconde la card Economia,
  l'API no: un ruolo `squadra_posa` può leggere i costi dal payload.
- **R5** — `addPagamento`, `updatePagamento`, `removePagamento` non passano
  da `authorizeCoreOperation`: qualunque utente della sede registra o
  elimina incassi manuali. Le capability `pagamento.record`/`pagamento.read`
  esistono già ma questi percorsi non le consultano. `correggiPagamento` è
  già ristretto (direzione/amministrazione) ma con check di ruolo, non di
  capability.

## Principio

Due livelli di dato economico, con la stessa policy su server e client:

- **Sintesi operativa** (resta visibile a chi lavora la commessa): pattuito
  totale, incassato totale, residuo, piano rate, `nPagamenti`. È ciò che
  alimenta chip del Board, KPI e la domanda operativa «manca del saldo?».
- **Dettaglio economico** (dietro capability): righe del registro
  `pagamenti[]` → `pagamento.read`; scritture sul registro →
  `pagamento.record`; `costi[]`, `costoPosaStimato`, margine →
  `economia.read` (margine e viste economia sono già gated, restano).

Nella matrice attuale (`authz/capabilities.ts`) `pagamento.read`,
`pagamento.record` ed `economia.read` appartengono ad amministrazione e
direzione soltanto: la slice non inventa permessi nuovi, fa rispettare quelli
scritti.

## Matrice confermata (direzione, 28/08/2026)

| Dato / azione | direzione | amministrazione | commerciale | tecnico/posa/ordini/post-vendita |
|---|---|---|---|---|
| Pattuito, incassato, residuo, piano rate nella scheda commessa (sintesi) | ✓ | ✓ | ✓ | ✓ |
| Registro `pagamenti[]` (righe) | ✓ | ✓ | ✗ | ✗ |
| Registra/modifica/elimina acconto | ✓ | ✓ | solo override per utente | solo override per utente |
| `costi[]`, `costoPosaStimato`, margine | ✓ | ✓ | ✗ | ✗ |
| Pagina `/pagamenti` («vista cassa di sede») | ✓ | ✓ | ✗ | ✗ |

**Decisioni della direzione (vincolanti per l'implementazione):**

1. **`/pagamenti` richiede `pagamento.read`**: voce di sidebar nascosta e
   query rifiutate agli altri ruoli.
2. **Chip «Da saldare» sul Board**: resta per chiunque veda il Board, ma
   soltanto come informazione operativa sintetica — **nessun importo, rata o
   dettaglio di pagamento**. Cambia il comportamento attuale («Da saldare
   € N»): il chip diventa binario, la cifra vive nelle superfici gated. Lo
   stesso principio va applicato alla voce «Da incassare» del feed Dashboard
   per chi non ha `pagamento.read`.
3. **La registrazione acconti NON va al ruolo commerciale**: chi deve
   registrarli riceve un **override per singolo utente** su
   `pagamento.record` (tabella `capability_overrides` esistente), con audit
   completo (`policy_audit_diffs`/`policy_change_events` già in piedi).
4. **Il confine di sicurezza è il server**: nascondere i campi nella UI è
   una seconda protezione, mai la prima.
5. **`byId` omette i dettagli non autorizzati** senza impedire l'accesso
   alla parte operativa della commessa: campo assente, mai `FORBIDDEN`.

## Implementazione prevista

Server (`commesse.ts` più il punto UI corrispondente):

1. `byId`: shaping del payload — senza `economia.read` si omettono `costi` e
   `costoPosaStimato`; senza `pagamento.read` si omette `pagamenti[]` e si
   espone solo la sintesi (`importoIncassato`, `nPagamenti`). Mai un errore:
   il campo assente, non il `FORBIDDEN`, così la scheda resta usabile
   (decisione 5).
2. `list`: per utenti senza `pagamento.read` omette gli importi
   (`importoTotale`, `importoIncassato`) ed espone il derivato binario che
   serve al chip (`daSaldare: boolean`); per gli autorizzati resta invariata.
3. `addPagamento`/`updatePagamento`/`removePagamento`: `authorizeCoreOperation`
   con capability `pagamento.record` e
   `legacyAllowed = direzione || amministrazione` (stesso perimetro nei due
   `policyMode`); l'abilitazione di singoli operatori passa da un override
   per utente con audit (decisione 3), non dall'allargare il ruolo.
4. `correggiPagamento`: da check di ruolo a `authorizeCoreOperation`
   (`pagamento.record`), a parità di perimetro.
5. `pagamentiRecenti` e le query della pagina `/pagamenti`: `pagamento.read`
   (decisione 1).
6. Client: chip «Da saldare» del Board **senza importo per chiunque**
   (decisione 2) e stesso principio sulla voce «Da incassare» del feed
   Dashboard per chi non ha `pagamento.read`; card Pagamenti della scheda con
   registro e comandi solo per gli autorizzati; voce di sidebar `/pagamenti`
   nascosta agli altri. La UI è la seconda protezione: il confine resta il
   server (decisione 4).

Test (positivi e negativi):

- per ruolo: direzione/amministrazione leggono registro e costi; commerciale
  e squadra_posa ricevono `byId` e `list` senza importi né registro, ma con
  la sintesi operativa;
- per capability con `policyMode=enforce` e con override per utente:
  l'override su `pagamento.record` abilita la mutation e finisce nell'audit;
- per ownership: l'assegnatario senza capability continua a NON vedere il
  registro (l'ownership non è una capability economica);
- per sede: tutte le mutation restano `NOT_FOUND` cross-sede;
- Board: il chip deriva da `daSaldare` e non contiene cifre; nessun importo
  raggiunge il payload di un utente non autorizzato.

## Impatto dichiarato

Comportamento visibile che CAMBIA: commerciale e ruoli operativi perdono la
scrittura degli acconti (salvo override individuale con audit), la lettura
del registro dettagliato, dei costi e degli importi in lista; la pagina
`/pagamenti` diventa riservata a `pagamento.read`; il chip «Da saldare» del
Board perde la cifra per tutti (l'importo vive nelle superfici gated). Prima
del rollout va censito chi oggi registra acconti senza essere
amministrazione, per assegnare gli override necessari.

## Rollback

`git revert` del commit: nessuna migrazione, nessun dato toccato. Il shaping
di `byId` è additivo-negativo (omette campi) e non riscrive nulla.
