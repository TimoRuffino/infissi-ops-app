// WhatsApp deep links (wa.me) — opens the operator's WhatsApp (Web/Desktop)
// with the CLIENT's number and a prefilled message; nothing is sent
// automatically. The company signature carries the office number so the
// client can call back.

export const FIRMA_WHATSAPP = "Ruffino Group — tel. 0187 872687";

// Normalize an Italian phone number to international digits for wa.me.
export function waPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  // Italian numbers stored without country code (mobile 3xx…, landline 0xx…).
  if (!d.startsWith("39") || d.length <= 10) {
    if (d.startsWith("3") || d.startsWith("0")) d = "39" + d;
  }
  return d.length >= 10 ? d : null;
}

export function waLink(
  phone: string | null | undefined,
  message: string
): string | null {
  const p = waPhone(phone);
  if (!p) return null;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}
