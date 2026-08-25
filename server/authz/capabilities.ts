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
    "tars.approve_low_risk",
    "tars.approve_high_risk",
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
    "tars.approve_low_risk",
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
  ],
};

export function capabilitiesForRoles(roles: readonly string[]): Set<Capability> {
  if (roles.includes("direzione")) return new Set(CAPABILITIES);

  const capabilities = new Set<Capability>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role] ?? []) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}
