export type CorrelationSignal = {
  explicitEntityId?: number | null;
  codiceCommessa?: string | null;
  phone?: string | null;
  email?: string | null;
  codiceFiscale?: string | null;
  partitaIva?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  date?: string | Date | null;
  assigneeUserId?: number | null;
};

export type EntityCandidate = {
  entityType: "cliente" | "commessa";
  entityId: number;
  clienteId?: number | null;
  codiceCommessa?: string | null;
  emails?: string[];
  phones?: string[];
  codiceFiscale?: string | null;
  partitaIva?: string | null;
  invoiceNumbers?: string[];
  invoices?: Array<{ amount: number; date: string | Date }>;
  assigneeUserId?: number | null;
  updatedAt?: string | Date | null;
};

export type RankedEntityCandidate = EntityCandidate & {
  score: number;
  reasons: string[];
};

const normalizeText = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();
const normalizeCode = (value: string | null | undefined) =>
  (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeFiscal = normalizeCode;
const normalizePhone = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

function daysBetween(a: string | Date, b: string | Date): number {
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right))
    return Number.POSITIVE_INFINITY;
  return Math.abs(left - right) / 86_400_000;
}

export function rankEntityCandidates(
  signal: CorrelationSignal,
  candidates: EntityCandidate[]
): RankedEntityCandidate[] {
  return candidates
    .map(candidate => {
      let score = 0;
      const reasons: string[] = [];
      const add = (points: number, reason: string) => {
        score += points;
        reasons.push(reason);
      };

      if (
        signal.explicitEntityId != null &&
        signal.explicitEntityId === candidate.entityId
      ) {
        add(120, "id esplicito");
      }
      if (
        normalizeCode(signal.codiceCommessa) &&
        normalizeCode(signal.codiceCommessa) ===
          normalizeCode(candidate.codiceCommessa)
      ) {
        add(100, "codice commessa esatto");
      }
      if (
        normalizeFiscal(signal.codiceFiscale) &&
        normalizeFiscal(signal.codiceFiscale) ===
          normalizeFiscal(candidate.codiceFiscale)
      ) {
        add(80, "codice fiscale esatto");
      }
      if (
        normalizeFiscal(signal.partitaIva) &&
        normalizeFiscal(signal.partitaIva) ===
          normalizeFiscal(candidate.partitaIva)
      ) {
        add(80, "partita IVA esatta");
      }
      if (
        normalizeText(signal.email) &&
        (candidate.emails ?? []).some(
          email => normalizeText(email) === normalizeText(signal.email)
        )
      ) {
        add(60, "email esatta");
      }
      if (
        normalizePhone(signal.phone) &&
        (candidate.phones ?? []).some(
          phone => normalizePhone(phone) === normalizePhone(signal.phone)
        )
      ) {
        add(60, "telefono esatto");
      }
      if (
        normalizeCode(signal.invoiceNumber) &&
        (candidate.invoiceNumbers ?? []).some(
          number =>
            normalizeCode(number) === normalizeCode(signal.invoiceNumber)
        )
      ) {
        add(55, "numero fattura esatto");
      }
      if (signal.amount != null && signal.date != null) {
        const invoiceMatch = (candidate.invoices ?? []).some(
          invoice =>
            Math.abs(invoice.amount - signal.amount!) <= 0.01 &&
            daysBetween(invoice.date, signal.date!) <= 3
        );
        if (invoiceMatch) add(35, "importo e data fattura compatibili");
      }
      if (
        signal.assigneeUserId != null &&
        signal.assigneeUserId === candidate.assigneeUserId
      ) {
        add(8, "assegnatario coerente");
      }
      if (
        signal.date != null &&
        candidate.updatedAt != null &&
        daysBetween(signal.date, candidate.updatedAt) <= 7
      ) {
        add(5, "prossimita temporale");
      }
      return { ...candidate, score, reasons };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.entityId - b.entityId)
    .slice(0, 5);
}
