# Tars libero — «legge tutto, capisce tutto, fa tutto»

> Mandato direzione 02/09/2026: «studia il funzionamento di Tars, rendilo
> intelligente, potente e libero di fare tutto per un agente AI, togligli
> i limiti; così è inutile». Precisazione: «deve leggere tutto, capire
> tutto e poter fare tutto; quando serve deve chiedere autorizzazione,
> quando è sicuro deve fare da solo; l'importante è che se l'ha fatto
> Tars viene segnalato. Inoltre va creata una sezione Proposte sulla
> pagina Tars.»

## 1. I lacci trovati nel codice

1. **Gate pre-modello** (`orchestratore.eseguiRun`): il resolver
   deterministico intercetta i messaggi con «commessa»/codice/nome e
   risponde senza modello («Quale intendi», «Non trovo la commessa»).
2. **Catalogo potato** (`azioni/policy.catalogoAzioniPerContesto`): con
   una superficie attiva sopravvivono solo i tool che la dichiarano.
3. **Autorità da regex**: transizione e archiviazione eseguono solo se il
   testo dell'utente matcha un classificatore «ancorato».
4. **Prompt da impiegato prudente**: regola 10 «agisci SOLO con gli
   strumenti… spiega il limite», 7 «azioni materiali = proposta»,
   etichette rigide, «una sola precisazione».
5. **Catalogo scrittura minuscolo**: 31 azioni, di cui 8 scrivono.

## 2. Nuova policy (sostituisce le invarianti «proposte-only» di CLAUDE.md)

- **Il modello decide, il dominio verifica.** Tars esegue con gli
  strumenti tutto ciò che l'utente potrebbe fare a mano; ogni strumento
  passa da un servizio di dominio che applica sede, capability
  dell'utente, state machine, gate e idempotenza. Nessuna autorità
  derivata dal testo: la chiamata dello strumento È il comando.
- **Pavimento che resta**: isolamento di sede, capability dell'utente,
  kill switch, ledger R1 e audit, niente SQL/mutation generiche, budget
  e limiti anti-loop del run.
- **Conferma umana** (proposta con anteprima) SOLO per: pagamenti e
  importi, cancellazioni definitive, invii esterni (non esistono),
  effetti su altre sedi (non esistono). Tutto il resto: azione diretta
  con Undo dove il dominio lo offre.
- **Chiedere**: solo quando l'ambiguità cambia l'esito (due commesse
  plausibili, dato mancante). Con una domanda aperta, la risposta breve
  vale («096», «la seconda», «Bertoli»).
- **Segnalazione**: ogni effetto prodotto da Tars è tracciato nel ledger
  R1 ed esposto nel «Registro» della pagina Tars e nella Situazione;
  dove il dominio ha un campo (note, motivo, descrizione) porta la firma
  «Tars per <utente>».

## 3. Tagli

- **A. Nucleo libero**: catalogo = tutto l'autorizzato (niente potatura
  per superficie/intento); gate pre-modello → hint nel contesto (il
  modello chiede o cerca); autorità di transizione/archiviazione dallo
  strumento (verifica dominio, non regex); prompt v9.
- **B. Strumenti di scrittura**: crea/aggiorna cliente, crea/aggiorna
  commessa (campi operativi), cambia stato (state machine), archivia/
  ripristina commessa, aggiorna/chiudi ticket, pianifica intervento,
  collega/classifica/gestisci comunicazione, risolvi caso, archivia
  allegato senza pre-lettura obbligatoria (rilettura interna).
- **C. Visibilità**: `tars.registroAzioni`; sezione **Proposte** sulla
  pagina Tars (smistamento + gateway + conferme pendenti nei turni) con
  Approva/Rifiuta; sezione **Registro** (cosa ha fatto Tars, quando, per
  chi, con Undo dove c'è).
- **D. Policy scritta**: CLAUDE.md «Agente AI» riscritto con questo
  mandato; spec, PRD, handoff; eval aggiornati alla nuova policy.

## 4. Stato (sera del 02/09/2026)

- A fatto e in produzione (commit `6a78cce`, deploy 16:48).
- B fatto: `strumenti/scrittura.ts` + `strumenti/comune.ts`, 13 tool R1,
  registro 1.10.0 (44 azioni), test `scrittura.test.ts`, matrice
  aggiornata. Non fatto: «cambia stato» resta `transizione_commessa`
  (già libero da A); «archivia allegato senza pre-lettura» già coperto
  dalla rilettura interna di A.
- C fatto: schede Chat / Proposte / Registro nella colonna sinistra di
  `/tars`; endpoint `tars.proposte` e `tars.registroAzioni`. Non fatto:
  conferme pendenti nei turni dentro Proposte; Undo dal Registro.
- D: CLAUDE.md, handoff §11-vicies novies, matrice; PRD in coda.
- Aggiunta dello stesso giorno (mandato «anche queste proposte sono
  inutili» + «non collegare allegati già presenti»): collegamento
  automatico sicuro dal modello e dedup per checksum nel fascicolo — vedi
  piano smistamento D7/D8.
