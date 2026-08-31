import { cn } from "@/lib/utils";

export const SKELETON_SHAPES = [
  "block",
  "text",
  "control",
  "avatar",
  "panel",
  "row",
] as const;

export type SkeletonShape = (typeof SKELETON_SHAPES)[number];

const shapeClasses: Record<SkeletonShape, string> = {
  block: "rounded-[var(--radius-control)]",
  text: "h-4 rounded-[var(--radius-pill)]",
  control: "h-10 rounded-[var(--radius-control)]",
  avatar: "size-10 rounded-full",
  panel: "min-h-32 rounded-[var(--radius-panel)]",
  row: "h-12 rounded-[var(--radius-control)]",
};

function Skeleton({
  className,
  shape = "block",
  ...props
}: React.ComponentProps<"div"> & { shape?: SkeletonShape }) {
  return (
    <div
      data-slot="skeleton"
      data-shape={shape}
      className={cn(
        "bg-border-soft motion-safe:animate-pulse",
        shapeClasses[shape],
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
