export const CAPABILITIES = [
  "cliente.read",
  "cliente.create",
  "cliente.update_operational",
  "cliente.assign",
  "cliente.archive",
  "cliente.delete",
  "commessa.read",
  "commessa.create",
  "commessa.update_operational",
  "commessa.assign",
  "commessa.change_state",
  "commessa.manage_documents",
  "commessa.delete",
  "ticket.create",
  "ticket.assign",
  "ticket.manage",
  "ticket.delete",
  "intervento.plan",
  "intervento.assign",
  "intervento.delete",
  "pagamento.read",
  "pagamento.record",
  "economia.read",
  // Contratto strutturato e computo limiti (03/09/2026). `contratto.read` è
  // condivisa: le misure servono a chi rileva e a chi posa. `tariffe.manage`
  // è solo direzione (via CAPABILITIES completo).
  "contratto.read",
  "contratto.manage",
  "computo.run",
  "tariffe.manage",
  // Fatturazione dal contratto (piano 2, 04/09/2026). `fattura.read` è di chi
  // vende e di chi amministra; bozza, emissione e nota di credito solo di chi
  // amministra (la direzione ha il set completo per costruzione).
  "fattura.read",
  "fattura.draft",
  "fattura.emit",
  "fattura.credit_note",
  // D7 slice 3: il doppio requisito dell'approval gateway documentale.
  // `documento.approve_proposals` approva le proposte generate dai
  // documenti; `fornitore.manage_ordini` è l'operazione finale sull'ordine
  // fornitore (oggi: aggiornare la data di consegna prevista). Approvare e
  // applicare richiedono ENTRAMBE.
  "documento.approve_proposals",
  "fornitore.manage_ordini",
  // Tenant (WS1, 06/09/2026): nominare e revocare i proprietari dell'azienda.
  // La dà SOLO il ruolo `proprietario`: né la direzione per costruzione, né
  // override, né delega (spec WS1 §4.4).
  "tenant.manage_proprietari",
  // Capability storiche dell'agente rimosso il 28/08/2026. Restano perché
  // `tars.manage_policy` governa i permessi stessi: rinominarla significa
  // migrare le regole già salvate. Le altre non compaiono più nella UI.
  "tars.use",
  "tars.approve_low_risk",
  "tars.approve_high_risk",
  "tars.manage_policy",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ALL_CAPABILITIES = new Set<Capability>(CAPABILITIES);

const SHARED_CAPABILITIES: Capability[] = [
  "cliente.read",
  "cliente.create",
  "commessa.read",
  "commessa.create",
  "ticket.create",
  "tars.use",
  "contratto.read",
];

const ROLE_CAPABILITIES: Record<string, readonly Capability[]> = {
  amministrazione: [
    ...SHARED_CAPABILITIES,
    "cliente.update_operational",
    "cliente.assign",
    "cliente.archive",
    "commessa.update_operational",
    "commessa.assign",
    "commessa.manage_documents",
    "ticket.assign",
    "ticket.manage",
    "pagamento.read",
    "pagamento.record",
    "economia.read",
    "contratto.manage",
    "computo.run",
    "tars.approve_low_risk",
    "tars.approve_high_risk",
    "fattura.read",
    "fattura.draft",
    "fattura.emit",
    "fattura.credit_note",
  ],
  commerciale: [
    ...SHARED_CAPABILITIES,
    "cliente.update_operational",
    "cliente.assign",
    "cliente.archive",
    "commessa.update_operational",
    "commessa.assign",
    "commessa.change_state",
    "commessa.manage_documents",
    "ticket.assign",
    "ticket.manage",
    "contratto.manage",
    "computo.run",
    "tars.approve_low_risk",
    "fattura.read",
  ],
  tecnico_rilievi: [
    ...SHARED_CAPABILITIES,
    "cliente.update_operational",
    "commessa.update_operational",
    "commessa.change_state",
    "commessa.manage_documents",
    "ticket.manage",
    "intervento.plan",
    "intervento.assign",
    "tars.approve_low_risk",
  ],
  squadra_posa: [
    ...SHARED_CAPABILITIES,
    "commessa.update_operational",
    "commessa.manage_documents",
    "ticket.manage",
    "intervento.plan",
    "tars.approve_low_risk",
  ],
  post_vendita: [
    ...SHARED_CAPABILITIES,
    "cliente.update_operational",
    "commessa.update_operational",
    "commessa.manage_documents",
    "ticket.assign",
    "ticket.manage",
    "intervento.plan",
    "intervento.assign",
    "tars.approve_low_risk",
  ],
  ordini: [
    ...SHARED_CAPABILITIES,
    "commessa.update_operational",
    "commessa.change_state",
    "commessa.manage_documents",
    "ticket.manage",
    "tars.approve_low_risk",
    // Chi gestisce gli ordini fornitori approva le proposte documentali e
    // può eseguirne l'operazione finale (decisione D7 slice 3). Gli altri
    // ruoli arrivano qui solo con un override individuale.
    "documento.approve_proposals",
    "fornitore.manage_ordini",
  ],
  proprietario: [...SHARED_CAPABILITIES, "tenant.manage_proprietari"],
};

export function capabilitiesForRoles(roles: readonly string[]): Set<Capability> {
  const capabilities = new Set<Capability>();
  if (roles.includes("direzione")) {
    for (const capability of CAPABILITIES) capabilities.add(capability);
    // L'unica eccezione al «direzione = tutto»: la nomina dei proprietari
    // spetta ai proprietari (spec WS1 §4.4). Chi è anche proprietario la
    // riprende dal proprio ruolo, qui sotto.
    capabilities.delete("tenant.manage_proprietari");
  }
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role] ?? []) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}
