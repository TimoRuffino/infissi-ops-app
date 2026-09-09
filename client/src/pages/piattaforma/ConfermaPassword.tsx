// Il dialogo delle azioni sensibili del pannello (spec WS6 §3.2): i campi
// dell'azione, poi la password dell'amministratore. Non è una seconda
// autenticazione — la sessione è già valida — è la prova che davanti alla
// tastiera c'è ancora la stessa persona prima di sospendere un'azienda o
// toccare un abbonamento.
//
// Il componente non sa quale azione stia confermando: riceve titolo, campi e
// un `onConferma(password)`. Lo riusa il Task 9 per tutte le azioni della
// scheda.
import { AlertCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ConfermaPasswordProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titolo: string;
  descrizione?: ReactNode;
  /** I campi dell'azione (motivo, importo, data…): stanno sopra la password. */
  children?: ReactNode;
  /** Testo del pulsante di conferma, quando «Conferma» non basta a dire cosa succede. */
  etichettaConferma?: string;
  distruttiva?: boolean;
  pending?: boolean;
  /** L'errore del server, mostrato sotto il campo così come arriva. */
  errore?: string | null;
  /** Vero quando i campi dell'azione non sono ancora validi: la password da sola non basta. */
  disabilitato?: boolean;
  onConferma: (password: string) => void;
};

export default function ConfermaPassword({
  open,
  onOpenChange,
  titolo,
  descrizione,
  children,
  etichettaConferma = "Conferma",
  distruttiva = false,
  pending = false,
  errore,
  disabilitato = false,
  onConferma,
}: ConfermaPasswordProps) {
  const [password, setPassword] = useState("");

  // La password non sopravvive alla chiusura: né a un annullamento né a una
  // conferma riuscita. Riaprire il dialogo e trovarla già scritta sarebbe un
  // invito a confermare senza leggere.
  useEffect(() => {
    if (!open) setPassword("");
  }, [open]);

  const pronto = password.length > 0 && !disabilitato && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titolo}</DialogTitle>
          {descrizione ? (
            <DialogDescription>{descrizione}</DialogDescription>
          ) : null}
        </DialogHeader>

        <form
          className="min-w-0 space-y-4"
          onSubmit={event => {
            event.preventDefault();
            if (pronto) onConferma(password);
          }}
        >
          {children ? <div className="min-w-0 space-y-4">{children}</div> : null}

          <div className="min-w-0 space-y-2">
            <Label htmlFor="piattaforma-conferma-password">
              La tua password
            </Label>
            <Input
              id="piattaforma-conferma-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="h-11"
              disabled={pending}
              aria-describedby={
                errore ? "piattaforma-conferma-errore" : undefined
              }
              aria-invalid={errore ? true : undefined}
            />
            {errore ? (
              <p
                id="piattaforma-conferma-errore"
                role="alert"
                className="flex items-start gap-1.5 text-sm text-danger"
              >
                <AlertCircle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0">{errore}</span>
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="quiet"
              className="min-h-11"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant={distruttiva ? "destructive" : "default"}
              className="min-h-11"
              disabled={!pronto}
            >
              {pending ? "Attendi…" : etichettaConferma}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
