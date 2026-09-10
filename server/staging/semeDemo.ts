import type { TrpcContext } from "../_core/context";
import { ambienteStaging } from "../_core/ambiente";
import { conTenant } from "../tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";

/**
 * Dati dimostrativi per l'ambiente staging. Gira al boot, SOLO se
 * AMBIENTE=staging e gli store clienti+commesse sono entrambi vuoti (stessa
 * filosofia del seed dell'admin, server/routers/utenti.ts:121: mai
 * riscrivere sopra dati veri). Passa esclusivamente dai percorsi di
 * dominio (createClienteFromSync, creaCommessa): niente record costruiti a
 * mano, niente contatori di id locali.
 */
export async function eseguiSemeDemo(): Promise<{ seminato: boolean; motivo?: string }> {
  if (!ambienteStaging()) return { seminato: false, motivo: "non-staging" };
  return conTenant(TENANT_PREDEFINITO_ID, async () => {
    const { getClientiStore, createClienteFromSync, saveClientiStore } = await import(
      "../routers/clienti"
    );
    const { getCommesseStore, creaCommessa } = await import("../routers/commesse");
    const { getUtentiStore } = await import("../routers/utenti");

    if (getClientiStore().length > 0 || getCommesseStore().length > 0) {
      return { seminato: false, motivo: "store-non-vuoti" };
    }
    const admin = (getUtentiStore() as any[]).find(
      u => u.attivo && (u.ruoli ?? []).includes("direzione")
    );
    if (!admin) return { seminato: false, motivo: "nessun-utente-direzione" };

    // Il ctx minimo che `authorizeCoreOperation` (server/authz/enforcement.ts)
    // consuma da `ctx.user`: `id` (proprietà delle risorse, attore
    // dell'audit) e `ruoli` (derivazione delle capability, `direzione` = set
    // completo). `attivo` lo forza sempre a true la funzione stessa.
    const ctx = {
      user: { id: admin.id, ruoli: admin.ruoli },
      sedeId: 1,
      sediIds: [1],
    } as unknown as Pick<TrpcContext, "user" | "sedeId" | "sediIds">;

    // ── Clienti ─────────────────────────────────────────────────────────
    // `createClienteFromSync` non accetta `ragioneSociale`: per aziende,
    // condomini ed enti la denominazione sta indivisa in `cognome` (nome
    // resta vuoto, come vuole la convenzione — server/fatture/cliente.ts:46
    // e `clienteDisplay` in server/routers/commesse.ts), e il campo
    // `ragioneSociale` va assegnato dopo, come fa `importaDaCsv`
    // (server/routers/clienti.ts:468-490) con i campi che il creatore non
    // conosce.
    const porta = (dati: {
      tipo: "privato" | "azienda" | "condominio" | "ente_pubblico";
      nome: string;
      cognome: string;
      ragioneSociale?: string;
      citta: string;
      telefono?: string;
      email?: string;
      partitaIva?: string;
    }) => {
      const record: any = createClienteFromSync({
        sedeId: 1,
        nome: dati.nome,
        cognome: dati.cognome,
        tipo: dati.tipo,
        partitaIva: dati.partitaIva,
        citta: dati.citta,
        telefono: dati.telefono ?? null,
        email: dati.email ?? null,
      });
      if (dati.ragioneSociale) record.ragioneSociale = dati.ragioneSociale;
      return record;
    };

    const condominio = porta({
      tipo: "condominio", nome: "", cognome: "Condominio Via Roma 12",
      ragioneSociale: "Condominio Via Roma 12", citta: "Sarzana",
      email: "amministratore@viaroma12.demo", telefono: "0187 000001",
    });
    const bianchi = porta({
      tipo: "azienda", nome: "", cognome: "Bianchi Serramenti Srl",
      ragioneSociale: "Bianchi Serramenti Srl", citta: "La Spezia",
      partitaIva: "01234567890", email: "info@bianchiserramenti.demo",
    });
    const moretti = porta({ tipo: "privato", nome: "Luca", cognome: "Moretti", citta: "La Spezia", telefono: "333 0000001" });
    const fontana = porta({ tipo: "privato", nome: "Giulia", cognome: "Fontana", citta: "Lerici", telefono: "333 0000002" });
    const vanni = porta({ tipo: "privato", nome: "Paolo", cognome: "Vanni", citta: "Massa", telefono: "333 0000003" });
    const grassi = porta({ tipo: "privato", nome: "Elena", cognome: "Grassi", citta: "Carrara", telefono: "333 0000004" });

    // `createClienteFromSync` salva già ogni cliente al momento della
    // creazione; il campo `ragioneSociale`, assegnato dopo, va persistito a
    // parte — un salvataggio solo, non uno per cliente.
    saveClientiStore();

    // ── Commesse (percorso di dominio: policy, sede, collegamento cliente) ─
    const commesse: Array<Parameters<typeof creaCommessa>[1]> = [
      { clienteId: condominio.id, importoTotale: 28_500, priorita: "alta", consegnaIndicativa: "90",
        prodotti: [{ nome: "Finestra PVC bianco 120x140", quantita: 24 }],
        note: "Sostituzione serramenti parti comuni e alloggi, ponteggio condiviso." },
      { clienteId: moretti.id, importoTotale: 9_800, priorita: "media", consegnaIndicativa: "60",
        prodotti: [{ nome: "Portoncino d'ingresso alluminio", quantita: 1 }, { nome: "Finestra alluminio taglio termico", quantita: 6 }] },
      { clienteId: fontana.id, importoTotale: 4_800, priorita: "media", consegnaIndicativa: "30",
        prodotti: [{ nome: "Finestra PVC 100x120", quantita: 4 }, { nome: "Zanzariera a rullo", quantita: 2 }] },
      { clienteId: vanni.id, importoTotale: 6_400, priorita: "bassa", consegnaIndicativa: "60",
        prodotti: [{ nome: "Persiana alluminio effetto legno", quantita: 8 }] },
      { clienteId: grassi.id, importoTotale: 5_900, priorita: "urgente", consegnaIndicativa: "30",
        prodotti: [{ nome: "Porta blindata classe 3", quantita: 1 }, { nome: "Finestra bagno vasistas", quantita: 1 }],
        note: "Cliente in ristrutturazione: coordinarsi con l'impresa." },
      { clienteId: bianchi.id, importoTotale: 14_200, priorita: "media", consegnaIndicativa: "90",
        prodotti: [{ nome: "Telaio PVC grezzo per rivendita", quantita: 12 }] },
    ];
    for (const input of commesse) await creaCommessa(ctx, input);

    console.log("[staging] seme demo: 6 clienti e 6 commesse creati");
    return { seminato: true };
  });
}
