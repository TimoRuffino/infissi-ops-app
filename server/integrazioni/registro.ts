// Le sei integrazioni, in ordine di attivazione: prima i soldi, poi i
// canali, poi il calendario, poi il backup. L'agente chiude perché non
// chiede niente. L'ordine è dato qui una volta e vale sia per la pagina
// delle impostazioni sia per il percorso guidato.
//
// Gli adattatori entrano nel registro man mano che i loro task atterrano.

import type { Adattatore, Chiave } from "./contratto";
import { agente } from "./adattatori/agente";
import { backup } from "./adattatori/backup";
import { email } from "./adattatori/email";

export const REGISTRO: Adattatore[] = [email, backup, agente];

export function adattatoreDi(chiave: Chiave): Adattatore | null {
  return REGISTRO.find(a => a.chiave === chiave) ?? null;
}
