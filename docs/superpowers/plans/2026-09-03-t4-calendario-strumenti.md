# T4 — Il calendario dentro il CRM (strumenti): piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (D2, prima metà):** Tars legge l'agenda (interventi CRM + eventi
Google importati), pianifica con ora e squadra, sposta e segna fatto un
intervento; la commessa «segue» tramite la transizione NORMALE (gate e
Undo), mai come effetto collaterale nascosto. La migrazione degli
appuntamenti Google resta FUORI: bloccata dalla domanda aperta n. 3 della
consegna (importare lo storico sì/no).

**Architecture:** nuovo `server/tars/strumenti/agenda.ts` con
`leggi_agenda` (R0: interventi della sede nel range + eventi
`externalCalendars.events` via caller, con omissione dichiarata se il
feed non risponde), `sposta_intervento` e `segna_intervento_fatto` (R1
sulle procedure canoniche `interventi.update` / `interventi.updateStato`).
`pianifica_intervento` v1.1.0 accetta `squadraId` e `oraFine` (il router
esige già `intervento.assign` per la squadra). «La commessa segue»:
l'esito di `segna_intervento_fatto` porta `transizioneConsigliata`
deterministica (posa→`finiture_saldo`, rilievo→`misure_esecutive`) e
un'avvertenza; il MODELLO chiama `transizione_adiacente_commessa`, dove
gate e Undo vivono davvero. Fix collaterale: la fotografia leggeva
`i.data` ma il dominio scrive `dataPianificata` — la sezione interventi
era sempre vuota sui dati veri.

**Spec:** `docs/superpowers/plans/2026-09-03-tars-utile.md` §4 T4 e D2.

## Global Constraints

- Registro → **1.12.0**, 49 → **51** azioni (goldens registry.test.ts:
  conteggi, mappe rischio/scope, compensazioni R1 per i 2 nuovi R1).
- Nessuna transizione di commessa dentro gli strumenti agenda: solo
  consiglio + avvertenza.
- `getSquadreStore()` export additivo in `routers/squadre.ts` per i nomi.
- Commit verdi; suite/build/push in coda; Co-Authored-By Fable.

## Tasks

1. **Fix fotografia interventi**: `i.dataPianificata ?? i.data` (+ fixture
   test aggiornata a `dataPianificata`). Commit dedicato «fix(tars): la
   fotografia legge dataPianificata…».
2. **agenda.ts + test** (`strumenti/agenda.test.ts`): leggi_agenda
   (range default 7 giorni, filtri squadraId/commessaId, eventi esterni
   marcati `fonte: "google"`, squadra col nome); sposta_intervento
   (prima/dopo, cross-sede NOT_FOUND); segna_intervento_fatto
   (stato completato, transizioneConsigliata per tipo, avvertenza).
   pianifica_intervento esteso (squadraId+oraFine, versione 1.1.0).
3. **Registro 1.12.0** + goldens (51) + `...STRUMENTI_AGENDA`.
4. **Docs+push**: matrice (3 righe + pianifica aggiornata), tars-utile T4
   «FATTO (strumenti); migrazione in attesa della risposta n. 3», suite,
   build, push, deploy.
