import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ZoomIn, ZoomOut, RotateCw, X } from "lucide-react";

export type FilePreview = {
  nome: string;
  mimeType: string;
  url: string;
};

export type FilePreviewDialogProps = {
  preview: FilePreview | null;
  onClose: () => void;
  /** Optional download handler. If omitted, falls back to anchor-download of url. */
  onDownload?: () => void;
};

/**
 * Large, reusable file preview dialog. Near-fullscreen (95vw × 92vh, capped at
 * 1400px) so PDFs and images are actually readable. Handles images with zoom +
 * rotate controls, PDFs via iframe, other types via download fallback.
 */
export default function FilePreviewDialog({
  preview,
  onClose,
  onDownload,
}: FilePreviewDialogProps) {
  const [zoom, setZoom] = React.useState(1);
  const [rotate, setRotate] = React.useState(0);

  // Reset transforms whenever a new file opens.
  React.useEffect(() => {
    setZoom(1);
    setRotate(0);
  }, [preview?.url]);

  const isImage = preview?.mimeType?.startsWith("image/");
  const isPdf =
    preview?.mimeType === "application/pdf" ||
    preview?.nome?.toLowerCase().endsWith(".pdf");

  function handleDownload() {
    if (onDownload) {
      onDownload();
      return;
    }
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview.url;
    a.download = preview.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Dialog open={!!preview} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden w-[95vw] h-[92vh] max-w-[1400px] sm:max-w-[1400px] flex flex-col"
      >
        <DialogHeader className="px-4 py-3 border-b flex-row items-center gap-3 space-y-0">
          <DialogTitle className="truncate text-sm flex-1">
            {preview?.nome}
          </DialogTitle>
          <div className="flex items-center gap-1 shrink-0">
            {isImage && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                  title="Zoom out"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground w-12 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                  title="Zoom in"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setRotate((r) => (r + 90) % 360)}
                  title="Ruota"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
                <div className="w-px h-5 bg-border mx-1" />
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={handleDownload}
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Scarica
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 bg-muted/30 overflow-auto flex items-center justify-center min-h-0">
          {!preview ? null : isImage ? (
            <img
              src={preview.url}
              alt={preview.nome}
              draggable={false}
              style={{
                transform: `scale(${zoom}) rotate(${rotate}deg)`,
                transformOrigin: "center center",
                transition: "transform 0.15s ease-out",
              }}
              className="max-w-full max-h-full select-none"
            />
          ) : isPdf ? (
            <iframe
              src={preview.url}
              title={preview.nome}
              className="w-full h-full border-0"
            />
          ) : (
            <div className="text-center p-8 space-y-3">
              <p className="text-sm text-muted-foreground">
                Anteprima non disponibile per questo tipo di file.
              </p>
              <Button onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" /> Scarica per aprire
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
