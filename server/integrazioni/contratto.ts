// Il contratto unico del collegamento (WS5, spec §3).
//
// Non è inventato: `fattureInCloud` e `backup` espongono già `status`,
// `oauthStartUrl` e `disconnectOAuth` con gli stessi nomi. Qui l'accordo
// diventa esplicito e vale anche per le altre quattro.
//
// Solo tipi: nessuna logica, nessun import di dominio. Un adattatore importa
// questo file, mai il contrario.

import type { TrpcContext } from "../_core/context";

export type Chiave =
  | "fic"
  | "email"
  | "whatsapp"
  | "calendario"
  | "backup"
  | "agente";

/** Cosa si è rotto e cosa deve fare la persona. Mai un codice, mai uno stack. */
export type Problema = {
  causa: string;
  rimedio: string;
  azione: "ricollega" | "riprova" | "scegli" | "assistenza" | null;
};

export type Stato = {
  chiave: Chiave;
  ambito: "sede" | "azienda";
  collegato: boolean;
  /**
   * Cosa è collegato, col suo nome: «+39 0187 872687», «Ruffino Group Srl».
   * Uno stato che non nomina la cosa collegata non è uno stato.
   */
  soggetto: string | null;
  verificatoIl: Date | null;
  problema: Problema | null;
};

export type Avvio =
  | { tipo: "url"; url: string } // OAuth: FiC, Drive, calendario
  | { tipo: "popup"; configId: string } // Embedded Signup WhatsApp
  | { tipo: "modulo" }; // IMAP: il modulo vive nel client

export type Ctx = TrpcContext;

export type Adattatore = {
  chiave: Chiave;
  ambito: "sede" | "azienda";
  /** La guardia che il router sottostante applica già. Non si allarga. */
  permesso: "direzione" | "utente";

  /** Sola lettura, nessuna chiamata di rete: regge il caricamento pagina. */
  stato(ctx: Ctx): Promise<Stato>;
  /** Prova viva: una chiamata vera al fornitore. Costa, quindi non è `stato`. */
  verifica(ctx: Ctx): Promise<Problema | null>;

  avvia?(ctx: Ctx, opz?: unknown): Promise<Avvio>;
  completa?(ctx: Ctx, esito: unknown): Promise<void>;
  scollega?(ctx: Ctx): Promise<void>;
};
