import { waLink } from "@/lib/whatsapp";

// Small green WhatsApp action — renders nothing when the number is unusable.
// Opens wa.me in a new tab: WhatsApp shows the prefilled message, the
// operator presses send there (nothing is sent automatically from the CRM).
export default function WhatsAppButton({
  phone,
  message,
  label,
  className = "",
}: {
  phone: string | null | undefined;
  message: string;
  label?: string;
  className?: string;
}) {
  const href = waLink(phone, message);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Scrivi su WhatsApp"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 rounded-md bg-[#25D366] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#1fb457] transition-colors ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
        <path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.1L2.1 22l5.05-1.5A9.9 9.9 0 1 0 12.04 2Zm0 1.7a8.2 8.2 0 1 1-4.2 15.2l-.3-.18-3 .89.9-2.93-.2-.3a8.2 8.2 0 0 1 6.8-12.68Zm-3.1 4.1c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.6.12.17 1.74 2.8 4.3 3.8 2.13.84 2.56.67 3.02.63.46-.04 1.5-.61 1.7-1.2.22-.6.22-1.1.16-1.2-.06-.1-.23-.17-.48-.3-.25-.12-1.5-.74-1.73-.82-.23-.08-.4-.13-.57.12-.17.25-.65.82-.8.99-.15.17-.3.19-.55.06-.25-.12-1.07-.4-2.03-1.26a7.6 7.6 0 0 1-1.4-1.75c-.15-.25-.02-.39.11-.51.11-.11.25-.3.37-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.12-.55-1.36-.77-1.86-.2-.48-.4-.42-.55-.43l-.49-.01Z" />
      </svg>
      {label ?? "WhatsApp"}
    </a>
  );
}
