import { cn } from "@/lib/utils";

export type StatoTarsAvatar =
  | "disponibile"
  | "in_lavoro"
  | "degradato"
  | "spento";

const coloreStato: Record<StatoTarsAvatar, string> = {
  disponibile: "text-success",
  in_lavoro: "text-primary",
  degradato: "text-warning",
  spento: "text-text-3",
};

export default function TarsAvatar({
  stato,
  size = 40,
  className,
}: {
  stato: StatoTarsAvatar;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-stato={stato}
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-surface-2",
        stato === "spento" && "opacity-55",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 48 48"
        width={Math.round(size * 0.7)}
        height={Math.round(size * 0.7)}
        fill="none"
        className={cn(
          "origin-center transition-[opacity,transform] duration-200 motion-reduce:transition-none",
          coloreStato[stato],
          stato === "in_lavoro" &&
            "motion-safe:animate-[spin_2.4s_linear_infinite]",
          stato === "degradato" && "motion-safe:animate-pulse"
        )}
        focusable="false"
      >
        <g
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.2"
        >
          <path d="M20 6H9a3 3 0 0 0-3 3v11" />
          <path d="M28 6h11a3 3 0 0 1 3 3v11" />
          <path d="M42 28v11a3 3 0 0 1-3 3H28" />
          <path d="M20 42H9a3 3 0 0 1-3-3V28" />
        </g>
        <path
          d="m24 15 9 9-9 9-9-9 9-9Z"
          fill="currentColor"
          opacity={stato === "spento" ? 0.35 : 0.86}
        />
        <path d="m24 20 4 4-4 4-4-4 4-4Z" fill="var(--color-surface)" />
      </svg>
    </span>
  );
}
