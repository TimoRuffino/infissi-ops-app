// WhatsApp deep links (wa.me) — opens the operator's WhatsApp (Web/Desktop)
// with the CLIENT's number and a prefilled message; nothing is sent
// automatically. The company signature carries the office number so the
// client can call back.

export const FIRMA_WHATSAPP = "Ruffino Group — tel. 0187 872687";

// Normalize an Italian phone number to international digits for wa.me.
// The logic lives in /shared: the server needs the exact same rules to
// match an incoming WhatsApp message to the right client.
import { normalizzaTelefono } from "@shared/telefono";
export { normalizzaTelefono as waPhone };

export function waLink(
  phone: string | null | undefined,
  message: string
): string | null {
  const p = normalizzaTelefono(phone);
  if (!p) return null;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}
