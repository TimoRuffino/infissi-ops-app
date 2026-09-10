import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { SEED_FORNITORI_TENANT_1 } from "@shared/fornitori";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import {
  fornitoriDiSede,
  storeFornitori as _fornitoriStore,
  type Fornitore,
} from "../fornitori/anagrafica";
import { DEFAULT_SEDE_ID } from "./sedi";
import {
  oppureNotFound,
  recordOppureNotFound,
  requireDirezioneOAmministrazione,
} from "../_core/permissions";
import {
  FORNITORE_DA_RICONOSCERE,
  chiaviRicercaFornitore,
  collegaVoceArchivio,
  confermeDiSede,
  consegneInArrivo,
  eseguiGiroArchivioFornitori,
  getArchivioFornitoriStore,
  riapriVoceArchivio,
  riepilogoFornitori,
  rileggiVoceArchivio,
  scartaVoceArchivio,
} from "../fornitori/archivio";
import { listComunicazioni } from "../comunicazioni/comunicazioni";
import { linkComunicazione } from "../tars/smistamento/segnali";

// ── Types ───────────────────────────────────────────────────────────────────


type OrdineFornitore = {
  id: number;
  sedeId?: number;
  fornitoreId: number;
  commessaId: number;
  codiceOrdine: string;
  stato: "bozza" | "inviato" | "confermato" | "in_transito" | "ricevuto_parziale" | "ricevuto" | "contestato";
  dataOrdine: string;
  dataConsegnaPrevista?: string;
  dataConsegnaEffettiva?: string;
  // `RigaOrdine.id` è progressivo DENTRO questo ordine (1, 2, 3 — `idx + 1`
  // alla creazione), non un id globale: due ordini hanno entrambi una riga 1.
  // Cercare una riga significa sempre partire dal suo ordine.
  righe: RigaOrdine[];
  noteOrdine?: string;
  noteRicevimento?: string;
  importoTotale?: number;
  createdAt: Date;
  updatedAt: Date;
};

type RigaOrdine = {
  id: number;
  descrizione: string;
  codiceArticolo?: string;
  quantita: number;
  quantitaRicevuta: number;
  unitaMisura: string;
  prezzoUnitario?: number;
  lotto?: string;
  conforme?: boolean;
  noteDifetto?: string;
};

type Listino = {
  id: number;
  sedeId?: number;
  fornitoreId: number;
  nome: string;
  versione: string;
  dataValidita: string;
  nomeFile: string;
  tipo: "pdf" | "excel" | "altro";
  note?: string;
  createdAt: Date;
};

// ── In-memory data ──────────────────────────────────────────────────────────

const fornitori = _fornitoriStore.items;

const _ordiniStore = persistedStore<OrdineFornitore>("fornitori_ordini", (loaded) => {
  for (const o of loaded) {
    if ((o as any).sedeId === undefined) (o as any).sedeId = 1;
  }
});
const ordini = _ordiniStore.items;

const _listiniStore = persistedStore<Listino>("fornitori_listini", (loaded) => {
  for (const l of loaded) {
    if ((l as any).sedeId === undefined) (l as any).sedeId = 1;
  }
});
const listini = _listiniStore.items;

// Margine (P0.2): supplier orders of a commessa with the fornitore name
// resolved — consumed by commesse.margine / commesse.marginalita.
export function getOrdiniPerMargine(commessaId: number, sedeId: number | null) {
  return ordini
    .filter(
      (o) =>
        o.commessaId === commessaId &&
        (sedeId == null || (o as any).sedeId === sedeId)
    )
    .map((o) => ({
      id: o.id,
      codiceOrdine: o.codiceOrdine,
      fornitoreNome:
        fornitori.find((f) => f.id === o.fornitoreId)?.ragioneSociale ?? "?",
      stato: o.stato,
      importoTotale: o.importoTotale ?? 0,
    }));
}

// Analisi documentale (D7): l'ordine con il nome del fornitore risolto,
// senza passare dal router. Chi chiama applica lo scope di sede.
export function getOrdineFornitoreById(id: number) {
  const ordine = ordini.find((o) => o.id === id);
  if (!ordine) return null;
  return {
    ordine,
    fornitoreNome:
      fornitori.find((f) => f.id === ordine.fornitoreId)?.ragioneSociale ??
      null,
  };
}

// L'UNICO modo giusto di risolvere un ordine dentro una sede: fallisce
// chiuso (null) su qualunque mismatch. Usato da router e azioni del
// gateway al posto delle copie locali con `?? 1` (revisione).
export function getOrdineFornitoreInSede(id: number, sedeId: number) {
  const trovato = getOrdineFornitoreById(id);
  if (!trovato) return null;
  if (((trovato.ordine as any).sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    return null;
  }
  return trovato;
}

// Collegamento assistito (D7 slice 2): tutti gli ordini della sede con il
// fornitore risolto — il bacino dei candidati per un documento.
export function getOrdiniFornitoreDiSede(sedeId: number) {
  return ordini
    .filter((o) => ((o as any).sedeId ?? DEFAULT_SEDE_ID) === sedeId)
    .map((ordine) => ({
      ordine,
      fornitoreNome:
        fornitori.find((f) => f.id === ordine.fornitoreId)?.ragioneSociale ??
        null,
    }));
}

// Centro Azioni (D7 slice 3): lettura degli ordini per i segnali di
// conflitto consegna/posa. MAI mutare da fuori.
export function getOrdiniFornitoriStore(): readonly OrdineFornitore[] {
  return ordini;
}

// Approval gateway (D7 slice 3): l'UNICO comando che aggiorna la data di
// consegna prevista di un ordine dopo la creazione. Non è un endpoint: lo
// invoca soltanto `applicaProposta` del gateway, dopo approvazione umana
// con doppia capability e con lo snapshot ancora fresco. Non tocca stato,
// righe, prezzi o quantità.
export function aggiornaDataConsegnaOrdine(
  ordineId: number,
  sedeId: number,
  nuovaData: string
): OrdineFornitore {
  const ordine = oppureNotFound(ordini.find(
    (o) => o.id === ordineId && ((o as any).sedeId ?? DEFAULT_SEDE_ID) === sedeId
  ));
  ordine.dataConsegnaPrevista = nuovaData;
  ordine.updatedAt = new Date();
  _ordiniStore.save();
  return ordine;
}

// ── Router ──────────────────────────────────────────────────────────────────

export const fornitoriRouter = router({
  // ── Fornitori CRUD ──────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        categoria: z.string().optional(),
        attivo: z.boolean().optional(),
      }).optional()
    )
    .query(({ input, ctx }) => {
      let result = fornitori.filter((f) => (f as any).sedeId === ctx.sedeId);
      if (input?.categoria) result = result.filter((f) => f.categoria === input.categoria);
      if (input?.attivo !== undefined) result = result.filter((f) => f.attivo === input.attivo);
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          (f) =>
            f.ragioneSociale.toLowerCase().includes(q) ||
            f.citta?.toLowerCase().includes(q) ||
            f.email?.toLowerCase().includes(q)
        );
      }
      return result.sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale));
    }),

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const f = fornitori.find((f) => f.id === input);
    if (!f || (f as any).sedeId !== ctx.sedeId) return null;
    return f;
  }),

  create: adminProcedure
    .input(
      z.object({
        ragioneSociale: z.string().min(1),
        /** Facoltativa: per riconoscere il mittente di una conferma non serve. */
        partitaIva: z.string().min(1).optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        categoria: z.enum(["pvc", "alluminio", "vetro", "ferramenta", "persiane", "blindati", "accessori", "guarnizioni", "altro"]),
        chiavi: z.array(z.string().trim().toLowerCase().min(2).max(60)).max(20).optional(),
        canale: z.enum(["mail", "portale", "altro"]).optional(),
        portaleDomini: z.array(z.string().trim().toLowerCase().min(2).max(60)).max(10).optional(),
        referenteCommerciale: z.string().optional(),
        scontistica: z.number().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const fornitore: Fornitore = {
        id: _fornitoriStore.prossimoId(),
        ...input,
        // I campi del riconoscimento nascono sempre presenti: chi legge non
        // deve dover distinguere «vuoto» da «mai scritto».
        chiavi: input.chiavi ?? [],
        canale: input.canale ?? "mail",
        portaleDomini: input.portaleDomini ?? [],
        sedeId: ctx.sedeId ?? 1,
        attivo: true,
        createdAt: now,
        updatedAt: now,
      } as any;
      fornitori.push(fornitore);
      _fornitoriStore.save();
      return fornitore;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        ragioneSociale: z.string().optional(),
        partitaIva: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        categoria: z.enum(["pvc", "alluminio", "vetro", "ferramenta", "persiane", "blindati", "accessori", "guarnizioni", "altro"]).optional(),
        chiavi: z.array(z.string().trim().toLowerCase().min(2).max(60)).max(20).optional(),
        canale: z.enum(["mail", "portale", "altro"]).optional(),
        portaleDomini: z.array(z.string().trim().toLowerCase().min(2).max(60)).max(10).optional(),
        referenteCommerciale: z.string().optional(),
        scontistica: z.number().optional(),
        note: z.string().optional(),
        attivo: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const idx = fornitori.findIndex((f) => f.id === input.id);
      recordOppureNotFound(fornitori[idx] as any, ctx.sedeId);
      const { id, ...updates } = input;
      fornitori[idx] = { ...fornitori[idx], ...updates, updatedAt: new Date() };
      _fornitoriStore.save();
      return fornitori[idx];
    }),

  delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
    const idx = fornitori.findIndex((f) => f.id === input);
    recordOppureNotFound(fornitori[idx] as any, ctx.sedeId);
    fornitori.splice(idx, 1);
    _fornitoriStore.save();
    return { success: true };
  }),

  /**
   * I mittenti da cui è arrivata una conferma e che nell'anagrafica non ci
   * sono ancora. È così che un'azienda nuova si popola l'elenco: conferma
   * quello che le è già arrivato invece di battere venticinque nomi.
   */
  candidati: protectedProcedure.query(({ ctx }) => {
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const gia = new Set(
      fornitoriDiSede(sedeId).map(f => f.ragioneSociale.toLowerCase())
    );
    const conteggio = new Map<string, { dominio: string | null; conferme: number }>();
    for (const v of getArchivioFornitoriStore()) {
      if (v.sedeId !== sedeId) continue;
      const nome = String(v.fornitore ?? "").trim();
      if (!nome || nome === FORNITORE_DA_RICONOSCERE) continue;
      if (gia.has(nome.toLowerCase())) continue;
      const at = String(v.mittente ?? "").lastIndexOf("@");
      const dominio = at > 0 ? String(v.mittente).slice(at + 1).toLowerCase() : null;
      const riga = conteggio.get(nome) ?? { dominio, conferme: 0 };
      riga.conferme += 1;
      if (!riga.dominio && dominio) riga.dominio = dominio;
      conteggio.set(nome, riga);
    }
    return [...conteggio.entries()]
      .map(([nome, r]) => ({ nome, ...r }))
      .sort((a, b) => b.conferme - a.conferme || a.nome.localeCompare(b.nome));
  }),

  /**
   * I venticinque della Ruffino Group nell'anagrafica del tenant 1. UNA
   * TANTUM e su richiesta: la riga di `kv_store` esiste già, quindi un seed
   * al `firstBoot` non partirebbe mai, e uno senza quella guardia
   * calpesterebbe l'elenco di chi li ha cancellati apposta.
   */
  importaSeed: adminProcedure.mutation(({ ctx }) => {
    if ((ctx.tenantId ?? TENANT_PREDEFINITO_ID) !== TENANT_PREDEFINITO_ID) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Questo elenco è dei fornitori della Ruffino Group.",
      });
    }
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const gia = new Set(
      fornitoriDiSede(sedeId).map(f => f.ragioneSociale.toLowerCase())
    );
    const now = new Date();
    let creati = 0;
    // Le voci di portale del seed non sono fornitori a sé: confluiscono nel
    // produttore a cui riconducono.
    for (const voce of SEED_FORNITORI_TENANT_1) {
      if (voce.portaleDi) continue;
      if (gia.has(voce.nome.toLowerCase())) continue;
      const portali = SEED_FORNITORI_TENANT_1
        .filter(p => p.portaleDi === voce.nome)
        .flatMap(p => [...p.chiavi]);
      fornitori.push({
        id: _fornitoriStore.prossimoId(),
        sedeId,
        ragioneSociale: voce.nome,
        categoria: "altro",
        chiavi: [...voce.chiavi],
        canale: portali.length > 0 ? "portale" : "mail",
        portaleDomini: portali,
        attivo: true,
        createdAt: now,
        updatedAt: now,
      } as Fornitore);
      gia.add(voce.nome.toLowerCase());
      creati += 1;
    }
    if (creati > 0) _fornitoriStore.save();
    return { creati };
  }),

  stats: protectedProcedure.query(({ ctx }) => {
    const scopedF = fornitori.filter((f) => (f as any).sedeId === ctx.sedeId);
    const scopedO = ordini.filter((o) => (o as any).sedeId === ctx.sedeId);
    const totale = scopedF.filter((f) => f.attivo).length;
    const perCategoria = scopedF.reduce((acc, f) => {
      if (f.attivo) acc[f.categoria] = (acc[f.categoria] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const ordiniAttivi = scopedO.filter((o) => !["ricevuto", "contestato"].includes(o.stato)).length;
    const importoPendente = scopedO
      .filter((o) => !["ricevuto", "contestato"].includes(o.stato))
      .reduce((sum, o) => sum + (o.importoTotale ?? 0), 0);
    return { totale, perCategoria, ordiniAttivi, importoPendente };
  }),

  // ── Ordini Fornitori ────────────────────────────────────────────────────
  ordini: router({
    list: protectedProcedure
      .input(
        z.object({
          fornitoreId: z.number().optional(),
          commessaId: z.number().optional(),
          stato: z.string().optional(),
        }).optional()
      )
      .query(({ input, ctx }) => {
        let result = ordini.filter((o) => (o as any).sedeId === ctx.sedeId);
        if (input?.fornitoreId) result = result.filter((o) => o.fornitoreId === input.fornitoreId);
        if (input?.commessaId) result = result.filter((o) => o.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((o) => o.stato === input.stato);
        // Enrich w/ fornitore name
        return result
          .map((o) => ({
            ...o,
            fornitoreNome: fornitori.find((f) => f.id === o.fornitoreId)?.ragioneSociale ?? "?",
          }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
      const o = ordini.find((o) => o.id === input);
      if (!o || (o as any).sedeId !== ctx.sedeId) return null;
      return {
        ...o,
        fornitoreNome: fornitori.find((f) => f.id === o.fornitoreId)?.ragioneSociale ?? "?",
      };
    }),

    create: adminProcedure
      .input(
        z.object({
          fornitoreId: z.number(),
          commessaId: z.number(),
          codiceOrdine: z.string().min(1),
          dataConsegnaPrevista: z.string().optional(),
          righe: z.array(
            z.object({
              descrizione: z.string().min(1),
              codiceArticolo: z.string().optional(),
              quantita: z.number().min(1),
              unitaMisura: z.string(),
              prezzoUnitario: z.number().optional(),
            })
          ),
          noteOrdine: z.string().optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        const now = new Date();
        const sedeId = ctx.sedeId ?? 1;
        // Le righe non sono uno store con ambito proprio: sono un array
        // annidato in un unico ordine, creato una sola volta qui (mai
        // aggiunte in seguito a un ordine esistente — solo mutate sul posto,
        // vedi sotto). Un indice locale basta: gli id vanno confrontati solo
        // dentro le righe dello stesso ordine.
        const righe: RigaOrdine[] = input.righe.map((r, idx) => ({
          id: idx + 1,
          ...r,
          quantitaRicevuta: 0,
        }));
        const importoTotale = righe.reduce(
          (sum, r) => sum + (r.prezzoUnitario ?? 0) * r.quantita,
          0
        );
        const ordine: OrdineFornitore = {
          id: _ordiniStore.prossimoId(),
          sedeId,
          fornitoreId: input.fornitoreId,
          commessaId: input.commessaId,
          codiceOrdine: input.codiceOrdine,
          stato: "bozza",
          dataOrdine: now.toISOString().split("T")[0],
          dataConsegnaPrevista: input.dataConsegnaPrevista,
          righe,
          noteOrdine: input.noteOrdine,
          importoTotale,
          createdAt: now,
          updatedAt: now,
        };
        ordini.push(ordine);
        _ordiniStore.save();
        return ordine;
      }),

    updateStato: adminProcedure
      .input(
        z.object({
          id: z.number(),
          stato: z.enum(["bozza", "inviato", "confermato", "in_transito", "ricevuto_parziale", "ricevuto", "contestato"]),
          noteRicevimento: z.string().optional(),
          dataConsegnaEffettiva: z.string().optional(),
          righeAggiornate: z
            .array(
              z.object({
                id: z.number(),
                quantitaRicevuta: z.number(),
                lotto: z.string().optional(),
                conforme: z.boolean().optional(),
                noteDifetto: z.string().optional(),
              })
            )
            .optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        const idx = ordini.findIndex((o) => o.id === input.id);
        recordOppureNotFound(ordini[idx] as any, ctx.sedeId);
        ordini[idx].stato = input.stato;
        ordini[idx].updatedAt = new Date();
        if (input.noteRicevimento) ordini[idx].noteRicevimento = input.noteRicevimento;
        if (input.dataConsegnaEffettiva) ordini[idx].dataConsegnaEffettiva = input.dataConsegnaEffettiva;
        if (input.righeAggiornate) {
          for (const ra of input.righeAggiornate) {
            const rigaIdx = ordini[idx].righe.findIndex((r) => r.id === ra.id);
            if (rigaIdx !== -1) {
              ordini[idx].righe[rigaIdx] = { ...ordini[idx].righe[rigaIdx], ...ra };
            }
          }
        }
        _ordiniStore.save();
        return ordini[idx];
      }),

    delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
      const idx = ordini.findIndex((o) => o.id === input);
      recordOppureNotFound(ordini[idx] as any, ctx.sedeId);
      ordini.splice(idx, 1);
      _ordiniStore.save();
      return { success: true };
    }),
  }),

  // ── Listini ──────────────────────────────────────────────────────────────
  listini: router({
    list: protectedProcedure
      .input(z.object({ fornitoreId: z.number().optional() }).optional())
      .query(({ input, ctx }) => {
        let result = listini.filter((l) => (l as any).sedeId === ctx.sedeId);
        if (input?.fornitoreId) result = result.filter((l) => l.fornitoreId === input.fornitoreId);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: adminProcedure
      .input(z.object({
        fornitoreId: z.number(),
        nome: z.string().min(1),
        versione: z.string().min(1),
        dataValidita: z.string(),
        nomeFile: z.string().min(1),
        tipo: z.enum(["pdf", "excel", "altro"]),
        note: z.string().optional(),
      }))
      .mutation(({ input, ctx }) => {
        const listino: Listino = {
          id: _listiniStore.prossimoId(),
          sedeId: ctx.sedeId ?? 1,
          ...input,
          createdAt: new Date(),
        };
        listini.push(listino);
        _listiniStore.save();
        return listino;
      }),

    delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
      const idx = listini.findIndex((l) => l.id === input);
      recordOppureNotFound(listini[idx] as any, ctx.sedeId);
      listini.splice(idx, 1);
      _listiniStore.save();
      return { success: true };
    }),
  }),

  // ── Archivio fornitori (07/09/2026) ────────────────────────────────────
  // Ogni conferma d'ordine arrivata da un fornitore, con quello che la
  // lettura ha capito. Le certe sono già nel fascicolo; le altre aspettano
  // che una persona dica di quale commessa sono. Dominio in
  // `server/fornitori/archivio.ts`: qui solo sede, permessi e forma.
  archivio: router({
    /** I fornitori con conferme in archivio, chi ha più lavoro in cima. */
    fornitori: protectedProcedure.query(({ ctx }) => {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const righe = riepilogoFornitori(sedeId);
      const somma = (prendi: (r: (typeof righe)[number]) => number) =>
        righe.reduce((n, r) => n + prendi(r), 0);
      return {
        fornitori: righe,
        totali: {
          fornitori: righe.length,
          daCollegare: somma(r => r.daCollegare),
          incerte: somma(r => r.incerte),
          collegateTars: somma(r => r.collegateTars),
          nelFascicolo: somma(r => r.nelFascicolo),
          scartate: somma(r => r.scartate),
          inArrivo: somma(r => r.inArrivo),
          inRitardo: somma(r => r.inRitardo),
        },
      };
    }),

    /**
     * L'elenco unico delle conferme d'ordine: quelle che Tars ha archiviato
     * da sé, quelle incerte, quelle da collegare a mano e quelle già nel
     * fascicolo per altra via. Chi chiede una decisione sta in cima.
     */
    conferme: protectedProcedure
      .input(
        z
          .object({
            fornitore: z.string().trim().min(1).max(80).optional(),
            gruppo: z
              .enum(["collegata_tars", "nel_fascicolo", "incerta", "da_collegare", "scartata"])
              .optional(),
            limite: z.number().int().min(1).max(300).optional(),
          })
          .optional()
      )
      .query(({ input, ctx }) =>
        confermeDiSede({
          sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
          fornitore: input?.fornitore ?? null,
          gruppo: input?.gruppo ?? null,
          limite: input?.limite,
        })
      ),

    /**
     * Il magazzino visto dal fornitore: cosa deve ancora arrivare, per quale
     * commessa, con quanto ritardo. Da qui si segna ricevuto senza aprire
     * commessa per commessa (`magazzino.segnaRicevute`).
     */
    inArrivo: protectedProcedure
      .input(
        z
          .object({
            fornitore: z.string().trim().min(1).max(80).optional(),
            includiRicevute: z.boolean().optional(),
          })
          .optional()
      )
      .query(({ input, ctx }) =>
        consegneInArrivo({
          sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
          fornitore: input?.fornitore ?? null,
          includiRicevute: input?.includiRicevute ?? false,
        })
      ),

    /** Le comunicazioni di un fornitore: mittente cercato per le sue chiavi. */
    comunicazioni: protectedProcedure
      .input(
        z.object({
          fornitore: z.string().trim().min(1).max(80),
          limite: z.number().int().min(1).max(50).optional(),
        })
      )
      .query(async ({ input, ctx }) => {
        const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
        const limite = input.limite ?? 20;
        const viste = new Map<number, any>();
        for (const chiave of chiaviRicercaFornitore(input.fornitore, sedeId)) {
          const righe = await listComunicazioni({ sedeId, search: chiave, limit: limite });
          for (const c of righe) if (!viste.has(c.id)) viste.set(c.id, c);
          if (viste.size >= limite * 2) break;
        }
        return [...viste.values()]
          .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
          .slice(0, limite)
          .map(c => ({
            id: c.id,
            canale: c.canale,
            mittente: c.mittenteNome?.trim() || c.mittente,
            oggetto: c.oggetto,
            estratto: c.testo.length > 180 ? `${c.testo.slice(0, 180)}…` : c.testo,
            allegati: c.allegati.map((a: any) => a.nome),
            commessaId: c.commessaId,
            ricevutaIl: c.receivedAt,
            link: linkComunicazione(c),
          }));
      }),

    /**
     * «È di questa commessa»: la conferma entra nel fascicolo e da lì
     * nascono il costo fornitore e la consegna a magazzino. Come per il
     * riscontro delle conferme automatiche, decide direzione o
     * amministrazione: è un effetto sul margine.
     */
    collega: protectedProcedure
      .input(
        z.object({
          voceId: z.number().int().positive(),
          commessaId: z.number().int().positive(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        requireDirezioneOAmministrazione(ctx.user);
        try {
          const esito = await collegaVoceArchivio({
            voceId: input.voceId,
            commessaId: input.commessaId,
            sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
            utenteId: Number((ctx.user as any).id) || 0,
            nomeUtente: String((ctx.user as any).name ?? "un operatore"),
          });
          return {
            documentoId: esito.documentoId,
            commessaId: esito.commessaId,
            costo: esito.costo,
            consegne: esito.consegne,
          };
        } catch (errore) {
          throw comeErroreArchivio(errore);
        }
      }),

    /** Non è una conferma da collegare: resta a registro con chi lo ha detto. */
    scarta: protectedProcedure
      .input(
        z.object({
          voceId: z.number().int().positive(),
          motivo: z.string().trim().max(200).optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        requireDirezioneOAmministrazione(ctx.user);
        try {
          return scartaVoceArchivio({
            voceId: input.voceId,
            sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
            utenteId: Number((ctx.user as any).id) || 0,
            nomeUtente: String((ctx.user as any).name ?? "un operatore"),
            motivo: input.motivo ?? null,
          });
        } catch (errore) {
          throw comeErroreArchivio(errore);
        }
      }),

    /** Scartata per sbaglio: torna in coda. */
    riapri: protectedProcedure
      .input(z.object({ voceId: z.number().int().positive() }))
      .mutation(({ input, ctx }) => {
        requireDirezioneOAmministrazione(ctx.user);
        try {
          return riapriVoceArchivio({
            voceId: input.voceId,
            sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
          });
        } catch (errore) {
          throw comeErroreArchivio(errore);
        }
      }),

    /** Rilegge il file: la lettura può essere migliorata dopo una correzione. */
    rileggi: protectedProcedure
      .input(z.object({ voceId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        requireDirezioneOAmministrazione(ctx.user);
        try {
          return await rileggiVoceArchivio({
            voceId: input.voceId,
            sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
          });
        } catch (errore) {
          throw comeErroreArchivio(errore);
        }
      }),

    /** Un giro subito, invece di aspettare il worker (direzione). */
    aggiorna: protectedProcedure.mutation(async ({ ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      return eseguiGiroArchivioFornitori({ sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID });
    }),
  }),
});

/** Gli errori del dominio archivio arrivano già scritti per chi legge. */
function comeErroreArchivio(errore: unknown): TRPCError {
  const messaggio = errore instanceof Error ? errore.message : "Operazione non riuscita.";
  const codice = messaggio.startsWith("NOT_FOUND")
    ? "NOT_FOUND"
    : messaggio.startsWith("CONFLICT")
      ? "CONFLICT"
      : messaggio.startsWith("PRECONDITION_FAILED")
        ? "PRECONDITION_FAILED"
        : "BAD_REQUEST";
  return new TRPCError({
    code: codice as any,
    message: messaggio.replace(/^[A-Z_]+:\s*/, ""),
  });
}
