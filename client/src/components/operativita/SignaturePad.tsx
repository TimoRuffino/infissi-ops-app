import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, PenTool, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SignaturePadProps = {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
  description?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

type Point = { x: number; y: number };

/** Firma touch/mouse basata su Pointer Events, senza dipendenze applicative. */
export default function SignaturePad({
  label,
  value,
  onChange,
  description,
  disabled = false,
  required = false,
  className,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  const hasContentRef = useRef(Boolean(value));
  const [hasContent, setHasContent] = useState(Boolean(value));
  const descriptionId = useId();

  const configureContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.25;
    context.strokeStyle = getComputedStyle(canvas).color;
    return { canvas, context, rect };
  }, []);

  const restoreValue = useCallback(() => {
    const configured = configureContext();
    if (!configured) return;
    const { context, rect } = configured;
    if (!value) {
      hasContentRef.current = false;
      setHasContent(false);
      return;
    }
    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, rect.width, rect.height);
      hasContentRef.current = true;
      setHasContent(true);
    };
    image.src = value;
  }, [configureContext, value]);

  useEffect(() => {
    restoreValue();
    window.addEventListener("resize", restoreValue);
    return () => window.removeEventListener("resize", restoreValue);
  }, [restoreValue]);

  const pointFromEvent = (event: React.PointerEvent): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: rect ? event.clientX - rect.left : 0,
      y: rect ? event.clientY - rect.top : 0,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    drawingRef.current = true;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const point = pointFromEvent(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      disabled ||
      !drawingRef.current ||
      activePointerRef.current !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const point = pointFromEvent(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    hasContentRef.current = true;
    setHasContent(true);
  };

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || activePointerRef.current !== event.pointerId) {
      return;
    }
    drawingRef.current = false;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const canvas = canvasRef.current;
    if (canvas && hasContentRef.current) {
      onChange(canvas.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || disabled) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasContentRef.current = false;
    setHasContent(false);
    onChange("");
  };

  return (
    <section
      data-pattern="signature-pad"
      data-complete={hasContent || undefined}
      className={cn(
        "min-w-0 space-y-3 rounded-[var(--radius-panel)] border border-border-soft bg-surface p-4 shadow-[var(--shadow-raised)]",
        className
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-text-1">
            <PenTool
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-accent-text"
            />
            {label}
            {required ? <span className="text-danger">*</span> : null}
          </h2>
          {description ? (
            <p
              id={descriptionId}
              className="mt-1 text-xs leading-5 text-text-3"
            >
              {description}
            </p>
          ) : null}
        </div>
        {hasContent && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
            className="min-h-11 shrink-0 px-3 text-xs sm:min-h-9"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Cancella
          </Button>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-[var(--radius-control)] border-2 border-dashed border-border-strong bg-signature-paper">
        <canvas
          ref={canvasRef}
          aria-label={`${label}: area firma`}
          aria-describedby={description ? descriptionId : undefined}
          aria-disabled={disabled || undefined}
          className={cn(
            "h-36 w-full touch-none text-signature-ink",
            disabled ? "cursor-not-allowed opacity-70" : "cursor-crosshair"
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onLostPointerCapture={finishStroke}
        />
        {!hasContent && !value ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-sm text-text-3">
            {disabled ? "Firma non disponibile" : "Firma qui con dito o penna"}
          </div>
        ) : null}
      </div>

      <p
        aria-live="polite"
        className={cn(
          "flex min-h-5 items-center gap-1.5 text-xs",
          hasContent ? "text-success" : "text-text-3"
        )}
      >
        {hasContent ? (
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
        ) : null}
        {hasContent
          ? "Firma acquisita"
          : required
            ? "Firma richiesta per chiudere il verbale"
            : "Firma facoltativa"}
      </p>
    </section>
  );
}
