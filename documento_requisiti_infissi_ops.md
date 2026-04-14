# Documento Requisiti ( Ruffino OpsPRD) 

**Autore:** Manus AI  
**Stato:** Documento dei Requisiti Aggiornato (Versione Definitiva)  
**Obiettivo:** Definire il funzionamento completo della web app **Ruffino Ops**, focalizzata sulla gestione operativa di commesse, produzione interna e post-vendita, con logica proattiva di notifica e gestione documentale semplificata.

---

## 1. Visione del Prodotto
**Ruffino Ops**  lo strumento centrale per la gestione operativa di Ruffino Immobiliare S.R.L. L'app collega l'ufficio, il laboratorio di produzione e il cantiere, garantendo che ogni cliente sia seguito in ogni fase, dal primo contatto alla garanzia post-vendita. Il sistema non  pi         solo un database, ma un assistente proattivo che notifica le scadenze in base alla priorit delle commesse.

---

## 2. Autenticazione e Sicurezza
L'accesso all'app deve essere sicuro e controllato.
- **Login tramite Email**: Sistema di autenticazione basato su email e password sicura.
- **Ruoli**: Admin (Titolare/Responsabile) e User (Tecnici/Operai).
- **Assegnazione Automatica**: Ogni Cliente e ogni Commessa vengono automaticamente assegnati all'utente che li ha creati (campo `createdBy`).
- **Permessi**: Possibilit di modificare ed eliminare elementi (Clienti, Commesse, Interventi) in base al ruolo.

---

## 3. Anagrafica Cliente (Scheda Cliente)
Il Cliente  il fulcro del sistema. Non si usa la Ragione Sociale, ma i dati personali.
- **Campi Obbligatori**: Nome, Cognome, Telefono, Email, Indirizzo.
- **Dati Fiscali/Amministrativi**:
  - **Detrazione**: Switch (S/No).
  - **Finanziamento**: Switch (S/No).
  - **Pratica Edilizia**: Menu a discesa (Nessuna pratica edilizia, CIL, CILA, SCIA).
- **Dashboard Cliente**: Una volta aperto un cliente, il sistema mostra in schede separate:
  - Commesse associate.
  - Interventi programmati.
  - Ticket aperti.
  - Garanzie attive.
- **Azione Rapida**: In ogni scheda deve esserci un tasto **"+"** per aggiungere velocemente una nuova commessa, intervento, ticket o garanzia direttamente collegata a quel cliente.

---

## 4. Gestione Commesse
La commessa rappresenta il progetto specifico.
- **Codice Automatico**: Il sistema genera il codice nel formato `COM-ANNO-NUMERO` (es. COM-2026-001).
- **Consegna Indicativa**: Non si seleziona una data specifica all'inizio, ma si sceglie tra opzioni rapide: `+30`, `+60`, `+90`.
- **Eliminazione Aperture**: Non si inseriscono pi         le singole finestre manualmente. Il modulo "Aperture" viene sostituito da **"Preventivi/Contratti"**.
- **Gestione Documentale**: Possibilit di caricare file (PDF) e foto direttamente nella commessa (es. scansione contratto, foto rilievo rapido).
- **Modifica**: Tutte le commesse devono essere modificabili in ogni campo.

---

## 5. Flusso Operativo e Board
Le commesse si muovono suLe commesse si muovnban) attraverso vari stati: *Preventivo, Rilievo, Produzione, Posa, Chiusa*.

### 5.1 Trigger Produzione
Quando una commessa viene spostata nello stato **"Produzione"**:
1. Compare un bottone obbligatorio sulla card della commessa.
2. Al click, viene chiesto di inserire la **Data di Consegna Prevista** definitiva.
3. Una volta inserita, la data compare sempre visibile sulla card: *"Data consegna prevista: gg/mm/aaaa"*.

---

## 6. Sistema di Notifiche Proattive
Il sistema monitora l'inattivit sulle commesse aperte in base alla loro priorit.
- **Priorit Bassa**: Notifica dopo 7 giorni di inattivit.
- **Priorit Media**: Notifica dopo 5 giorni di inattivit.
- **Priorit Alta**: Notifica dopo 3 giorni di inattivit.
- **Priorit Urgente**: Notifica dopo 1 giorno di inattivit.
- **Ricorsivit**: Una volta scaduto il termine, la notifica deve arrivare **ogni giorno** finch non viene effettuata un'azione sulla commessa.

---

## 7. Dashboard Principale
Oltre alle statistiche generali, la Dashboard deve includere:
- **Scheda Clienti/Priorit**: Una lista o tabella che mostra i singoli clienti con commesse attive, ordinati per priorit (Urgente in alto).
- **Scadenze Imminenti**: Vista rapida delle consegne previste per la settimana.

---

## 8. Integrazioni Esterne
- **Microsoft To Do**: Sincronizzazione dei task operativi generati dalle commesse.
- **Google Calendar**: Tutti gli interventi (Rilievo, Posa, Assistenza) devono finire sul calendario con i- **Google Calendar**: Tutti gli interventi (Rilievo, Posa, Assistenza) devono fDatabase**: Refactoring dello schema Drizzle. Tabella `clienti` con i nuovi campi. Tabella `commesse` con logica per il codice automatico `COM-YYYY-NNN`.
2. **Autenticazione**: Implementare un sistema di autenticazione sicuro basato su email.
3. **Logica Notifiche**: Implementare un controllo quotidiano della differenza tra `updatedAt` e la data attuale, confrontandola con la `priorit`.
4. **UI/UX**: Utilizzare componenti Shadcn/UI. Sostituire la gestione tabelle aperture con un componente4. **UI/UX**: Utilizzare componenti Shadcn/UI. Sostituire la gestione tabelle aperture con un componente4. **UI/UX**: Utilizzare componenti Sata.
