# Runbook multi-azienda (WS1 — fondazione tenant)

Spec: `docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md`.
Modulo: `server/tenants/`. Interruttore: `FLAG_MULTI_AZIENDA` (fail-closed).

## Cosa fa, in una riga
Il tenant (azienda) esiste, è nel contesto di ogni richiesta, ha guardie e un
ruolo Proprietario. Ruffino Group è il tenant 1. Ogni altro tenant si ferma
alla «porta chiusa» finché il WS2 non rende tenant-aware gli archivi.

## Interruttore
- `FLAG_MULTI_AZIENDA=off` (default in produzione): il CRM di oggi. Tabelle,
  campi `tenantId` e cache esistono ma non guardano nessuno; i comandi
  restano in attesa; il ruolo `proprietario` non si aggiunge.
- `FLAG_MULTI_AZIENDA=on`: contesto con tenant, porta chiusa, sola lettura
  per i tenant sospesi, sede attiva obbligatoria, proprietario assegnabile
  dai proprietari, comandi eseguiti al boot e ogni 30 s.
- Rollback: rimetti `off` e riavvia. Nessun dato da toccare.

## Boot (log `[tenants]`)
`avviaTenants()` gira subito dopo `bootstrapAll()`: schema di `tenants`,
`tenant_eventi` (append-only con trigger), `tenant_comandi`; cache; con
l'interruttore acceso seed del tenant 1, proprietario di ripiego (la prima
direzione attiva con meno di 3 ruoli) e comandi in attesa. Righe attese:
`[tenants] tenant 1 (ruffino-group) pronto: N utenti, M sedi`.

## Comandi dell'operatore (`pnpm tenant …`)
Lo script parla solo col database e accoda comandi; il server li esegue.
Mai scritture sugli store con l'istanza viva.

    pnpm tenant elenco
    pnpm tenant crea --slug=acme --nome="Acme Infissi" --email=titolare@acme.it \
         --nome-utente=Mario --cognome=Rossi --scrivi --attendi
    pnpm tenant stato --slug=acme --sospendi --motivo="insoluto" --scrivi --attendi
    pnpm tenant stato --slug=acme --riattiva --motivo="pagato" --scrivi
    pnpm tenant proprietario --slug=acme --email=m.rossi@acme.it --assegna --scrivi

- Senza `--scrivi`: anteprima, nessuna scrittura. `--attendi`: aspetta l'esito fino a 90 s.
- Password del proprietario: `TENANT_PROPRIETARIO_PASSWORD` nell'env o prompt nascosto; hashata prima di accodare.
- Un comando fallito resta `errore` con il motivo in `esito` e un evento `comando_fallito`: correggi e riaccoda. Nessun retry automatico.
- Su Railway: `railway run pnpm tenant …`. Sospendere il tenant 1 richiede `--anche-tenant-1`.

## Verifica in sola lettura (prima e dopo l'accensione)

    SELECT id, slug, stato FROM tenants ORDER BY id;
    SELECT tipo, attore, created_at FROM tenant_eventi ORDER BY id DESC LIMIT 20;
    SELECT id, tipo, stato, richiesto_da FROM tenant_comandi WHERE stato = 'in_attesa';
    SELECT COUNT(*) FROM jsonb_array_elements((SELECT data FROM kv_store WHERE key = 'utenti')) u WHERE (u->>'tenantId') IS NULL;

L'ultima deve dare 0 dopo il primo boot col nuovo codice (backfill).

## Produzione, in ordine
1. Deploy con interruttore spento; verifica in sola lettura; nessun errore `[tenants]`.
2. Backup Drive riuscito nelle 24 ore.
3. `FLAG_MULTI_AZIENDA=on`, riavvio; log `[tenants] tenant 1 … pronto`, evento
   `proprietario_assegnato` per l'utente 1; `tenants.mio` dal client.
4. Nessun tenant 2 in produzione finché il WS2 non apre la porta.

## Errori che l'utente può vedere
- «L'azienda non è ancora attiva su questa installazione.» — porta chiusa (tenant ≠ 1).
- «Azienda sospesa: il gestionale è in sola lettura.» — mutation con tenant sospeso.
- «L'azienda non ha una sede attiva.» — tenant senza sedi attive.
- «Solo un proprietario può nominare o revocare un proprietario.»
- «Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.»
