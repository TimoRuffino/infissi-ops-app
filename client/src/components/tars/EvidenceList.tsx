import { ExternalLink } from "lucide-react";
import { Link } from "wouter";

function hrefFor(item: {
  sourceType: string;
  sourceId: string;
  link?: string;
}) {
  if (item.link) return item.link;
  if (item.sourceType === "commessa") return `/commesse/${item.sourceId}`;
  if (item.sourceType === "cliente") return `/clienti/${item.sourceId}`;
  if (item.sourceType === "comunicazione") return "/messaggi/email";
  if (item.sourceType === "fattura_fic") return "/economia";
  return null;
}

export function EvidenceList({
  items,
  compact = false,
}: {
  items: Array<{
    sourceType: string;
    sourceId: string;
    label: string;
    link?: string;
  }>;
  compact?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap gap-1.5"
      aria-label="Fonti verificate"
    >
      {items.map(item => {
        const href = hrefFor(item);
        const content = (
          <>
            <span className="max-w-48 truncate">{item.label}</span>
            {href && (
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
          </>
        );
        const className = `inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground transition-colors ${compact ? "max-w-52" : "max-w-64"}`;
        return href ? (
          <Link
            key={`${item.sourceType}:${item.sourceId}`}
            href={href}
            className={`${className} hover:border-primary/35 hover:text-foreground`}
          >
            {content}
          </Link>
        ) : (
          <span
            key={`${item.sourceType}:${item.sourceId}`}
            className={className}
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}
