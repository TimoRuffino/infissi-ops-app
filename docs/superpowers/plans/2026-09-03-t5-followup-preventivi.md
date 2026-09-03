# T5 — Follow-up commerciale sui preventivi: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (D3):** un preventivo senza fatti nuovi da **7 giorni** genera un
promemoria di sollecito all'assegnatario con la bozza del messaggio al
cliente; da **30 giorni** un caso deterministico del Centro Azioni propone
di chiuderlo come perso. Tutto deterministico, niente modello.

**Architecture:** modulo `server/tars/followup/preventivi.ts` con
dipendenze iniettabili. Due uscite sui binari esistenti: (1) promemoria via
`getReminderService().createApproved` — la dedupe è il `canonicalKey`
(`tars:sollecito-preventivo:<id>:<giorno ultima attività>`: un nuovo giro
di silenzio dopo nuova attività riapre il diritto al sollecito); (2)
segnali `ActionSignal` (kind nuovo `preventivo_followup`) fusi nello
scheduler del Centro Azioni accanto a `segnaliSmistamento` — MAI un
reconcile separato: auto-risolverebbe i casi degli altri detector. L'età è
l'attività reale (`ultimaAttivitaCommessa` + `ultimaComunicazionePerCommessa`),
mai `updatedAt`; le dormienti (oltre `giorniDormiente()`) restano fuori.
Worker a intervallo come quello dell'analisi, dopo le 07:00 locali,
gate `tarsProactive` + `tarsReminders` (solleciti), nessuna env nuova.

**Spec:** `docs/superpowers/plans/2026-09-03-tars-utile.md` §4 T5 e D3.

## Global Constraints

- Nessun reconcile parziale del Centro Azioni; i segnali si FONDONO nello
  scheduler.
- Promemoria solo se `assegnatoA != null` (il destinatario di default
  arriva con T6/D4); il caso dei 30 giorni porta `assigneeUserId` e, senza
  assegnatario, `targetRole: "direzione"`.
- Fingerprint del segnale a scaglioni di 15 giorni: il caso non «cambia»
  ogni notte.
- Bozza messaggio deterministica, senza importi.
- Commit verdi; suite e build al push; Co-Authored-By Fable.

## Tasks

1. **Modulo + test** (`followup/preventivi.ts`, `followup/preventivi.test.ts`):
   `preventiviFermiDiSede`, `bozzaSollecito`, `giroSollecitiPreventivi`
   (usa il service reminders VERO in test: la dedupe è sua), 
   `segnaliFollowupPreventivi`. Fixtures con date RELATIVE all'orologio
   vero (il service dei promemoria rifiuta remindAt nel passato).
2. **Kind + scheduler**: union `preventivo_followup` in
   `actionCenter/types.ts`; merge in `runActionReconcile` con catch → []
   come lo smistamento.
3. **Worker**: `startFollowupPreventiviWorker` (intervallo 30 min,
   `unref`, tick anche al boot dopo 25 s) avviato in `_core/index.ts`
   accanto agli altri.
4. **Docs+push**: tars-utile T5 FATTO; matrice (riga guardrail «followup
   deterministico»); suite, build, push, deploy SUCCESS.
