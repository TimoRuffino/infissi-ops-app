# Modular Control — route manifest

Questo manifest descrive la superficie Wouter registrata in client/src/App.tsx.
È metadata di migrazione e UX: non autorizza accessi. Il confine resta il
router server indicato, con sede, capability, ruoli e kill switch applicati
dalle procedure reali.

| Route                                              | Kind / target                           | UX guard                         | Server authority                            | Capability, role, flag                                                       | Navigation       | Mobile    | Slice / evidence destination                                              | Status   |
| -------------------------------------------------- | --------------------------------------- | -------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- | ---------------- | --------- | ------------------------------------------------------------------------- | -------- |
| /                                                  | page · Dashboard                        | authenticated shell              | protected sede-scoped routers per modulo    | procedure-specific                                                           | primary          | standard  | 02 · evidence/golden/dashboard-principal-no-economia-1440x900-light.png   | planned  |
| /clienti                                           | page · ClientiList                      | navigation capability shaping    | clientiRouter + policy engine               | cliente.read                                                                 | primary          | standard  | 03 · evidence/operational/clienti-1440x900-light.png                      | planned  |
| /clienti/:id                                       | page · ClienteDetail                    | record visibility from payload   | clientiRouter + sede scope                  | cliente.read                                                                 | hidden deep link | record    | 03 · evidence/operational/cliente-detail-1440x900-light.png               | planned  |
| /kanban                                            | page · KanbanBoard                      | navigation capability shaping    | commesseRouter + policy engine              | commessa.read                                                                | primary          | workbench | 02 · evidence/golden/kanban-gate-1440x900-light.png                       | planned  |
| /magazzino                                         | page · Magazzino                        | authenticated shell              | magazzinoRouter + parent commessa scope     | commessa.read                                                                | primary          | standard  | 03 · evidence/operational/magazzino-1440x900-light.png                    | planned  |
| /pagamenti                                         | page · Pagamenti                        | capability:pagamento.read        | commesseRouter + policy engine              | pagamento.read                                                               | primary          | standard  | 03 · evidence/operational/pagamenti-1440x900-light.png                    | planned  |
| /economia                                          | page · Economia                         | capability:economia.read         | FiC, costi and commesse policy enforcement  | effective economia.read; no role fallback                                    | primary          | workbench | 03 · evidence/operational/economia-1440x900-light.png                     | planned  |
| /marginalita                                       | guarded · Marginalita                   | RequireDirezione                 | commesse.marginalita + requireDirezione     | direzione only; economia.read does not grant access                          | primary          | standard  | 03 · evidence/operational/marginalita-1440x900-light.png                  | planned  |
| /commesse                                          | page · CommesseList                     | navigation capability shaping    | commesseRouter + policy engine              | commessa.read                                                                | primary          | standard  | 03 · evidence/operational/commesse-1440x900-light.png                     | planned  |
| /commesse/:id                                      | page · CommessaDetail                   | fields/actions capability-shaped | commesseRouter + policy engine + sede scope | commessa.read minimum                                                        | hidden deep link | record    | 02 · evidence/golden/commessa-360-1440x900-light.png                      | planned  |
| /commesse/:commessaId/aperture/:aperturaId/rilievo | page · RilievoDetail                    | parent record visibility         | apertureRouter + commesseRouter scope       | commessa.read; commessa.update_operational                                   | hidden deep link | field     | 02 · evidence/golden/rilievo-390x844-light.png                            | planned  |
| /verbale/:interventoId                             | page · VerbaleChiusura                  | parent intervention visibility   | verbaliRouter + interventiRouter scope      | intervento.plan for writes                                                   | hidden deep link | field     | 02 · evidence/golden/verbale-390x844-light.png                            | planned  |
| /planning                                          | page · Planning                         | actions capability-shaped        | interventiRouter + externalCalendarsRouter  | procedure-specific                                                           | primary          | workbench | 03 · evidence/operational/planning-1440x900-light.png                     | planned  |
| /ticket                                            | page · TicketList                       | actions capability-shaped        | ticketRouter + ticketAllegatiRouter         | ticket.create minimum                                                        | hidden           | standard  | 03 · evidence/operational/ticket-1440x900-light.png                       | planned  |
| /garanzie                                          | guarded · GaranzieList                  | RequireDirezione                 | protected sede reads; adminProcedure writes | direzione UX guard; server rechecks every write                              | hidden hub route | standard  | 04 · evidence/support-admin/garanzie-1440x900-light.png                   | planned  |
| /squadre                                           | page · SquadreList                      | read all, writes direction       | squadreRouter + adminProcedure on writes    | procedure-specific                                                           | primary          | standard  | 03 · evidence/operational/squadre-1440x900-light.png                      | planned  |
| /fornitori                                         | guarded · FornitoriList                 | RequireDirezione                 | protected reads; admin writes; DI gateway   | direzione UX; DI needs documento.approve_proposals + fornitore.manage_ordini | hidden hub route | workbench | 02 · evidence/golden/fornitori-di-1440x900-light.png                      | planned  |
| /preventivatori                                    | page · Preventivatori                   | authenticated shell              | client calculator contracts                 | none                                                                         | primary          | standard  | 03 · evidence/operational/preventivatori-1440x900-light.png               | planned  |
| /preventivatori/fivizzanese/persiane               | page · PreventivatoreFivizzanese        | authenticated shell              | client calculator contracts                 | none                                                                         | hidden deep link | field     | 04 · evidence/support-admin/preventivatore-fivizzanese-1440x900-light.png | planned  |
| /preventivatori/punto-del-serramento/persiane      | page · PreventivatorePuntoDelSerramento | authenticated shell              | client calculator contracts                 | none                                                                         | hidden deep link | field     | 04 · evidence/support-admin/preventivatore-pds-1440x900-light.png         | planned  |
| /produzione/\*?                                    | redirect · /kanban                      | produzioneRedirect               | destination uses commesseRouter             | none                                                                         | redirect-only    | redirect  | existing redirect test                                                    | redirect |
| /reclami                                           | page · ReclamiRifacimenti               | actions capability-shaped        | reclamiRifacimentiRouter + sede scope       | procedure-specific                                                           | primary          | standard  | 03 · evidence/operational/reclami-1440x900-light.png                      | planned  |
| /archivio                                          | page · Archivio                         | navigation capability shaping    | commesseRouter + sede scope                 | commessa.read                                                                | primary          | standard  | 03 · evidence/operational/archivio-1440x900-light.png                     | planned  |
| /utenti                                            | guarded · UtentiList                    | RequireDirezione                 | sede-scoped reads; adminProcedure writes    | direzione; policy panels use tars.manage_policy                              | primary          | workbench | 04 · evidence/support-admin/utenti-1440x900-light.png                     | planned  |
| /sedi                                              | guarded · SediList                      | RequireDirezione                 | sedi.listAll/create/update adminProcedure   | direzione                                                                    | primary          | standard  | 04 · evidence/support-admin/sedi-1440x900-light.png                       | planned  |
| /messaggi/email                                    | page · EmailPage                        | channel configuration and scope  | mailRouter.email + comunicazioni            | procedure-specific                                                           | primary          | inbox     | 04 · evidence/support-admin/messaggi-email-1440x900-light.png             | planned  |
| /messaggi/whatsapp                                 | page · WhatsAppPage                     | channel configuration and scope  | mailRouter.whatsapp + comunicazioni         | procedure-specific                                                           | primary          | inbox     | 04 · evidence/support-admin/messaggi-whatsapp-1440x900-light.png          | planned  |
| /chat                                              | page · ChatAziendale                    | principal and sede scope         | chatRouter                                  | authenticated                                                                | primary          | inbox     | 04 · evidence/support-admin/chat-1440x900-light.png                       | planned  |
| /notifiche                                         | page · Notifiche                        | authenticated principal          | notificheRouter                             | procedure-specific                                                           | hidden           | standard  | 04 · evidence/support-admin/notifiche-1440x900-light.png                  | planned  |
| /comunicazioni                                     | redirect · /messaggi/email              | legacyMessageRedirect            | destination uses mailRouter                 | none                                                                         | redirect-only    | redirect  | existing redirect test                                                    | redirect |
| /conoscenza                                        | guarded · Conoscenza                    | RequireDirezione                 | protected + requireDirezione + sede scope   | direzione                                                                    | hidden hub route | standard  | 04 · evidence/support-admin/conoscenza-1440x900-light.png                 | planned  |
| /integrazioni                                      | page · Integrazioni                     | panels capability/role-shaped    | integration routers + server role checks    | procedure-specific                                                           | primary          | workbench | 04 · evidence/support-admin/integrazioni-1440x900-light.png               | planned  |
| /tars                                              | page · Tars                             | tars.use + FLAG_TARS             | tarsRouter + procedureConInterruttore(tars) | effective tars.use; FLAG_TARS; tool-specific capabilities                    | primary          | workbench | 02 · evidence/golden/tars-degraded-1440x900-light.png                     | planned  |
| /404                                               | page · NotFound                         | authenticated shell              | none                                        | none                                                                         | hidden           | fallback  | 04 · evidence/support-admin/not-found-1440x900-light.png                  | planned  |
| \*                                                 | fallback · NotFound                     | authenticated shell              | none                                        | none                                                                         | fallback         | fallback  | 04 · evidence/support-admin/not-found-fallback-1440x900-light.png         | planned  |
| (nessuna) · boundary autenticazione                | esclusa · LoginPage                     | DashboardLayout senza principal  | auth.login (procedura pubblica esistente)   | none                                                                         | fuori shell      | fuori shell | 04 · esclusione motivata, nessuna prova visiva richiesta                 | esclusa  |

## Stato e aggiornamento

- planned: la route mantiene comportamento corrente e attende la propria slice.
- redirect: superficie intenzionalmente priva di pagina; helper e target sono testati.
- migrata: utilizzabile soltanto dopo implementazione e prova browser registrata.
- esclusa: superficie deliberatamente fuori dalla migrazione, con motivazione
  registrata qui sotto.

## Esclusione motivata: il confine di autenticazione

`LoginPage` non è una route Wouter: `DashboardLayout` la rende quando non c'è
un principal, prima di scegliere fra renderer Modular Control e legacy. Resta
fuori dalla migrazione per due ragioni vincolanti.

1. `platform.interruttori` è una procedura protetta: prima dell'accesso il
   client non può conoscere `FLAG_UI_V2`. Rendere pubblico il flag cambierebbe
   un contratto server per una scelta di stile.
2. Applicare comunque il marker del sistema visivo renderebbe il login
   indipendente dal flag e toglierebbe il rollback a una sola superficie: con
   il flag spento tutto il resto tornerebbe legacy tranne l'accesso.

Il login resta quindi invariato per markup, form, query ed esito. La guardia è
strutturale in `client/src/lib/navigation.test.ts` (`confine di
autenticazione`): la pagina non legge ambiente o flag protetti, usa soltanto
`auth.login` e non applica il marker del sistema visivo.

Il fallback `/404` e la route catch-all restano `planned` finché la prova
browser non è registrata: il codice è già nella grammatica Modular Control
(`PageHeader` + `DataSurface`/`StatePanel`), ma lo stato del manifest lo
promuove solo l'evidenza visiva.

Il manifest deve restare uno-a-uno con APP_ROUTE_CONTRACT e App.tsx. Cambiare
una route richiede aggiornamento nello stesso commit; migrare una pagina non
autorizza modifiche ai suoi router o ai relativi permessi.

## Confine della fondazione verificato il 31/08/2026

Shell, navigazione, context bar e command palette sono implementate su tutte
le route autenticate, ma questo non rende “migrata” la UI interna delle pagine:
per questo le righe sopra restano `planned`. Le prove trasversali sono:

- flag OFF, renderer legacy esclusivo:
  `evidence/foundations/flag-off-1440x900.png`;
- shell ON light/dark e responsive:
  `evidence/foundations/shell-1440x900-light.png`,
  `evidence/foundations/shell-1440x900-dark.png`,
  `evidence/foundations/shell-768x1024-light.png`,
  `evidence/foundations/shell-390x844-light.png`;
- principal commerciale della sede QA: link Economia assente e deep link
  `/economia` risolto in un messaggio permission, senza dati economici:
  `evidence/foundations/context-qa-economia-denied-1280x720-light.png`.
