// Palette comandi (⌘K / Ctrl+K) — shell UI v2.
//
// Tre garanzie non negoziabili:
// 1. La ricerca è DETERMINISTICA: clienti e commesse passano dalle stesse
//    procedure sede-scoped e capability-aware delle liste. Nessuna chiamata
//    al provider del modello mentre si digita.
// 2. Il passaggio a Tars è un atto esplicito: la voce dedicata compila la
//    pagina /tars con il testo, senza inviare nulla.
// 3. Le voci di navigazione sono le stesse della sidebar (lib/navigation),
//    quindi capability, ruoli e flag valgono anche qui: nessun link morto.
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { vociNavigazione } from "@/lib/navigation";
import { statoLabel } from "@/lib/stato";
import { trpc } from "@/lib/trpc";
import { BrainCircuit, Building2, Clock, Contact } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

const RECENTI_KEY = "rf-palette-recenti";
const MAX_RISULTATI = 6;

type Recente = { label: string; path: string };

function leggiRecenti(): Recente[] {
  try {
    const grezzo = localStorage.getItem(RECENTI_KEY);
    const lista = grezzo ? JSON.parse(grezzo) : [];
    return Array.isArray(lista) ? lista.slice(0, MAX_RISULTATI) : [];
  } catch {
    return [];
  }
}

function ricordaRecente(voce: Recente) {
  try {
    const senza = leggiRecenti().filter((r) => r.path !== voce.path);
    localStorage.setItem(
      RECENTI_KEY,
      JSON.stringify([voce, ...senza].slice(0, MAX_RISULTATI))
    );
  } catch {
    // Un localStorage indisponibile non deve rompere la navigazione.
  }
}

export default function CommandPalette({
  open,
  onOpenChange,
  user,
  capacita,
  interruttori,
}: {
  open: boolean;
  onOpenChange: (aperta: boolean) => void;
  user: unknown;
  capacita: ReadonlySet<string> | null;
  interruttori?: { tars?: boolean } | null;
}) {
  const [, setLocation] = useLocation();
  const [testo, setTesto] = useState("");
  const [recenti, setRecenti] = useState<Recente[]>([]);

  useEffect(() => {
    if (open) {
      setTesto("");
      setRecenti(leggiRecenti());
    }
  }, [open]);

  const query = testo.trim();
  const cercaEntita = open && query.length >= 2;

  // Stesse procedure delle liste: sede applicata dal server, campi già
  // filtrati per capability. Niente endpoint nuovi per la palette.
  const clientiQ = trpc.clienti.list.useQuery(
    { search: query },
    { enabled: cercaEntita, staleTime: 30_000, retry: false }
  );
  const commesseQ = trpc.commesse.list.useQuery(
    { search: query },
    { enabled: cercaEntita, staleTime: 30_000, retry: false }
  );

  const voci = useMemo(
    () => vociNavigazione(user, capacita, interruttori),
    [user, capacita, interruttori]
  );
  const vociFiltrate = useMemo(() => {
    if (!query) return voci;
    const q = query.toLowerCase();
    return voci.filter((v) => v.label.toLowerCase().includes(q));
  }, [voci, query]);

  const clienti = (clientiQ.data ?? []).slice(0, MAX_RISULTATI);
  const commesse = (commesseQ.data ?? []).slice(0, MAX_RISULTATI);
  const inCaricamento =
    cercaEntita && (clientiQ.isPending || commesseQ.isPending);
  const nessunRisultato =
    cercaEntita &&
    !inCaricamento &&
    vociFiltrate.length === 0 &&
    clienti.length === 0 &&
    commesse.length === 0;

  const vai = (path: string, label: string) => {
    // Nei recenti si ricorda la PAGINA, mai la query: un «Chiedi a Tars»
    // di ieri non deve ricompilare la domanda di ieri.
    ricordaRecente({ label, path: path.split("?")[0] });
    onOpenChange(false);
    setLocation(path);
  };

  const mac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cerca e naviga"
      description="Cerca clienti, commesse o azioni"
      shouldFilter={false}
      showCloseButton={false}
    >
      <CommandInput
        value={testo}
        onValueChange={setTesto}
        placeholder="Cerca clienti, commesse o azioni…"
      />
      <CommandList>
        {nessunRisultato && (
          <CommandEmpty>Nessun risultato per «{query}».</CommandEmpty>
        )}

        {!query && recenti.length > 0 && (
          <>
            <CommandGroup heading="Recenti">
              {recenti.map((r) => (
                <CommandItem
                  key={`rec-${r.path}`}
                  value={`rec-${r.path}`}
                  onSelect={() => vai(r.path, r.label)}
                >
                  <Clock className="text-text-3" />
                  <span>{r.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {vociFiltrate.length > 0 && (
          <CommandGroup heading="Naviga">
            {vociFiltrate.map((v) => (
              <CommandItem
                key={`nav-${v.path}`}
                value={`nav-${v.path}`}
                onSelect={() => vai(v.path, v.label)}
              >
                <v.icon className="text-text-3" />
                <span>{v.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {inCaricamento && (
          <CommandGroup heading="Ricerca">
            <CommandItem value="loading" disabled>
              Cerco «{query}» tra clienti e commesse…
            </CommandItem>
          </CommandGroup>
        )}

        {clienti.length > 0 && (
          <CommandGroup heading="Clienti">
            {clienti.map((c: any) => {
              const nome = [c.cognome, c.nome]
                .filter((parte: string) => parte && parte.trim())
                .join(" ")
                .trim();
              return (
                <CommandItem
                  key={`cli-${c.id}`}
                  value={`cli-${c.id}`}
                  onSelect={() => vai(`/clienti/${c.id}`, nome)}
                >
                  <Contact className="text-text-3" />
                  <span className="min-w-0 truncate">{nome}</span>
                  {c.citta && (
                    <span className="ml-auto text-xs text-text-3">
                      {c.citta}
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {commesse.length > 0 && (
          <CommandGroup heading="Commesse">
            {commesse.map((c: any) => (
              <CommandItem
                key={`com-${c.id}`}
                value={`com-${c.id}`}
                onSelect={() => vai(`/commesse/${c.id}`, c.codice ?? `Commessa ${c.id}`)}
              >
                <Building2 className="text-text-3" />
                <span className="codice-mono">{c.codice}</span>
                <span className="min-w-0 truncate text-text-2">{c.cliente}</span>
                {c.stato && (
                  <span className="ml-auto text-xs text-text-3">
                    {statoLabel(c.stato)}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {interruttori?.tars && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tars">
              {query && (
                <CommandItem
                  value="tars-chiedi"
                  onSelect={() =>
                    vai(`/tars?q=${encodeURIComponent(query)}`, "Tars")
                  }
                >
                  <BrainCircuit className="text-text-3" />
                  <span className="min-w-0 truncate">
                    Chiedi a Tars: «{query}»
                  </span>
                  <span className="ml-auto text-xs text-text-3">
                    compila senza inviare
                  </span>
                </CommandItem>
              )}
              <CommandItem value="tars-apri" onSelect={() => vai("/tars", "Tars")}>
                <BrainCircuit className="text-text-3" />
                <span>Apri Tars</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {!query && (
          <div className="border-t border-border-soft px-3 py-2 text-[11px] text-text-3">
            Frecce per muoverti, Invio per aprire, Esc per chiudere ·{" "}
            {mac ? "⌘K" : "Ctrl+K"}
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
