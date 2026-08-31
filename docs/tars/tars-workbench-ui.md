# Tars Workbench — specifica UI approvata

Data: 31 agosto 2026

## Mandato

La pagina `/tars` deve diventare una superficie operativa riconoscibile, non una chat generica. L'intervento è circoscritto a Tars e alla sezione **Agente** delle Impostazioni: non modifica shell globale, navigazione, token, font, `client/src/index.css` o componenti condivisi interessati dal redesign UI concorrente.

## Direzione visiva

- Plus Jakarta Sans e token semantici esistenti restano vincolanti.
- L'avatar di Tars è un marchio vettoriale originale ispirato ai profili di una finestra e al flusso operativo: niente robot, volto umano, emoji o orb AI generico.
- Il movimento comunica soltanto stato: quiete quando Tars è disponibile, attività mentre lavora, avviso quando è degradato. Ogni effetto non essenziale si spegne con `prefers-reduced-motion`.
- Densità da strumento operativo, gerarchia nitida, ombre e decorazioni contenute. Nessun gradiente o colore raw locale.

## Pagina `/tars`

### Desktop

La superficie ha tre zone:

1. rail conversazioni da 288–320 px con ricerca, nuova conversazione, gruppi Fissate/Recenti/Archiviate, titolo, anteprima e ultimo aggiornamento;
2. thread centrale fluido con header Tars, cronologia, azioni/evidenze e composer sticky;
3. pannello contestuale richiudibile con entità attiva e briefing operativo. Non contiene informazioni tecniche sull'agente.

### Mobile

Sotto 768 px si vede una superficie alla volta. La lista conversazioni e il contesto si aprono in `Sheet`; il thread mantiene un percorso indietro prevedibile. Composer e focus non devono essere coperti da pannelli sticky. Nessuno scroll orizzontale globale.

### Conversazioni

- Ricerca immediata per titolo e anteprima.
- Nuova conversazione esplicita.
- Rinomina, fissa/rimuovi dai fissati, archivia e ripristina.
- Nessuna cancellazione definitiva: audit e cronologia restano recuperabili.
- Ogni mutation è limitata a `sedeId + utenteId`; un id estraneo risponde `NOT_FOUND`.
- Una conversazione archiviata è sola lettura finché non viene ripristinata.
- Il blocco avviene prima di salvare turni o invocare il provider; nessun tentativo su una conversazione archiviata può consumare token o modificare `updatedAt`.

### Thread e composer

- Il turno utente appare subito in modo ottimistico e non viene duplicato al refetch.
- `role="log"`, annunci incrementali, timestamp e separatori temporali.
- Stati operativi visibili: `Fatto`, `Preparato`, `Da confermare`, `Non eseguito`, `Bloccato`.
- Evidenze e omissioni sono progressive disclosure; Undo e approvazioni restano azioni native, accessibili e idempotenti.
- Invio invia; Maiusc+Invio va a capo; Enter durante IME non invia.
- Empty state con briefing e suggerimenti operativi reali. Nessun elenco di tool, provider o modello.

## Card Impostazioni → Agente

Tutte le informazioni tecniche vengono rimosse da `/tars` e concentrate nella card **Agente**:

- stato disponibile/degradato/spento;
- provider e modello effettivi;
- ultimo run, run totali e degradati;
- strumenti/capacità attive e interruttori Tars, dentro dettaglio richiudibile;
- solo Direzione: spesa giorno/mese, residui, limiti per run/giorno/mese, chiamate, token, costo medio/massimo e stato del budget/circuito. Spesa e residui sono etichettati esplicitamente come **globali a tutte le sedi**.

La card interroga prima `platform.interruttori`; con Tars spento non avvia query `tars.*`. Non mostra chiavi, prompt, contenuti cliente o dettagli sensibili a utenti non autorizzati.

## Stati e accessibilità

- Skeleton indipendenti per rail/thread/card; un errore locale non sostituisce l'intera pagina.
- Ogni controllo solo icona ha `aria-label` e tooltip; target touch minimo 44 px.
- La conversazione attiva espone `aria-current`; menu e sheet restituiscono il focus al trigger.
- Colore non è mai l'unico segnale di stato; focus visibile, contrasto AA e dark mode coerente con i token esistenti.
- Verifica obbligatoria a 1440×900 e 390×844, tastiera, reduced motion, console pulita e assenza di overflow orizzontale.

## Fuori perimetro

- Nessun cambiamento ai cost governor, provider OpenAI, prompt, tool catalog o regole R0–R4.
- Nessun push, deploy, Railway, flag o chiamata OpenAI.
- Nessuna installazione di dipendenze UI e nessun ritocco al design system globale.
