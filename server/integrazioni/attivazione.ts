// Lo stato del percorso guidato, per azienda (WS5, spec §5).
//
// Vive in un `persistedStore` per tenant e NON in `server/tenants/**`, che è
// zona vietata al WS5: il confine con WS3 regge anche qui.
//
// Il percorso non tiene una seconda verità accanto al dominio: «collegata»
// lo decide sempre `stato()` dell'adattatore. Qui si registra solo ciò che
// il dominio non sa — che qualcuno ha scelto di saltare un passo.

import { persistedStore } from "../_core/persistence";
import type { Chiave, Ctx } from "./contratto";
import { REGISTRO } from "./registro";

type RigaAttivazione = {
  id: number;
  chiave: Chiave;
  saltataIl: Date | null;
};

const _store = persistedStore<RigaAttivazione>(
  "onboarding_integrazioni",
  items => {
    for (const r of items) if (r.saltataIl === undefined) r.saltataIl = null;
  }
);

export const righeAttivazione = _store.items;

export type Passo = {
  chiave: Chiave;
  esito: "da_fare" | "saltata" | "collegata";
  soggetto: string | null;
};

export function segnaSaltata(chiave: Chiave): void {
  const esistente = righeAttivazione.find(r => r.chiave === chiave);
  if (esistente) esistente.saltataIl = new Date();
  else
    righeAttivazione.push({
      id: _store.prossimoId(),
      chiave,
      saltataIl: new Date(),
    });
  _store.save();
}

export async function passiAttivazione(ctx: Ctx): Promise<Passo[]> {
  const visibili = REGISTRO.filter(
    a => a.permesso !== "direzione" || ctx.user?.role === "admin"
  );
  return Promise.all(
    visibili.map(async a => {
      const s = await a.stato(ctx);
      const saltata = righeAttivazione.find(r => r.chiave === a.chiave)?.saltataIl;
      return {
        chiave: a.chiave,
        esito: s.collegato ? "collegata" : saltata ? "saltata" : "da_fare",
        soggetto: s.soggetto,
      } as Passo;
    })
  );
}
