import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requiresCodeToDelete } from "@/lib/stato";

// Destructive-delete confirmation for a commessa (redesign §3.6).
// - Title names the code: "Eliminare la commessa COM-2026-041?"
// - Body: definitiva e non annullabile.
// - For commesse beyond produzione, the operator must type the exact code to
//   enable the Elimina button.
export default function DeleteCommessaDialog({
  open,
  onOpenChange,
  codice,
  stato,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codice: string | null;
  stato: string | null;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open, codice]);

  const needCode = !!stato && requiresCodeToDelete(stato);
  const canDelete = !needCode || typed.trim() === (codice ?? "");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Eliminare la commessa {codice ?? ""}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            L'operazione è definitiva e non può essere annullata.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needCode && (
          <div className="space-y-1.5">
            <Label className="text-xs">
              Per confermare, digita il codice commessa{" "}
              <span className="font-mono font-semibold">{codice}</span>
            </Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={codice ?? ""}
              autoFocus
              className="font-mono"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Annulla</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canDelete}
            onClick={onConfirm}
            className="bg-danger text-on-danger hover:bg-danger/90 disabled:opacity-50 disabled:pointer-events-none"
          >
            Elimina
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
