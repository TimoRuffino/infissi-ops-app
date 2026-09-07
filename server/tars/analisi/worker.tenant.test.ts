// Task 9 (WS2 «porta aperta»): il worker dell'analisi azienda gira per
// tenant, ognuno nel suo contesto. `deps.sedi` (dipendenzeAnalisiReali) ora
// legge `sediAttiveDelTenant(tenantCorrente() ?? TENANT_PREDEFINITO_ID)`:
// qui verifichiamo che, chiamato dentro `perOgniTenantAttivo` (come fa il
// tick di startAnalisiAziendaWorker), `giroAnalisi` veda solo le sedi del
// tenant nel contesto — e che un tenant in errore non fermi gli altri.
//
// `generaAnalisiAzienda` (chiamata per sede da `giroAnalisi`) vive nello
// stesso file di `giroAnalisi`: non è intercettabile con vi.mock da qui
// (stesso modulo). Si inietta invece un repository finto via `deps`,
// esattamente come fa il worker reale — nessun mock di modulo necessario.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __registraTenantNotoPerTest } from "../../_core/persistence";
import { getSediStore } from "../../routers/sedi";
import { conTenant, modalitaTenantStretta, tenantCorrente } from "../../tenants/contestoCorrente";
import { perOgniTenantAttivo } from "../../tenants/giri";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../../tenants/repository";
import type { RepositoryAnalisiAzienda } from "./repository";
import { dipendenzeAnalisiReali, giroAnalisi, type DipendenzeAnalisi } from "./worker";

const SEDE_T1 = 98_701;
const SEDE_T2_A = 98_702;
const SEDE_T2_B = 98_703;
const ORE_10_ROMA = new Date("2026-09-07T10:00:00+02:00");

function repositoryFinto(
  onSalva: (input: { sedeId: number }) => void | Promise<void>
): RepositoryAnalisiAzienda {
  return {
    async ensureSchema() {},
    async ultima() {
      return null;
    },
    async perGiorno() {
      return null; // niente analisi esistente: il giro genera sempre.
    },
    async salva(input) {
      await onSalva(input);
      return {
        id: 1,
        sedeId: input.sedeId,
        giorno: input.giorno,
        versione: input.versione,
        stato: input.stato,
        esito: input.esito,
        errore: input.errore,
        tentativi: input.stato === "errore" ? 1 : 0,
        generataAt: input.now,
      };
    },
    async aggiornaEsito() {},
  };
}

describe("analisi azienda per tenant (Task 9)", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    // `costruisciFotografia` (il default di generaAnalisiAzienda quando
    // deps.fotografia non è passato) legge store per tenant (commesse,
    // clienti...): senza istanze per il tenant 2, fallirebbe con «non
    // istanziato per il tenant 2» invece di eseguire il percorso pulito.
    __registraTenantNotoPerTest(2);
    // Store globale (ambito «globale»): azzerato a ogni test di questo file
    // per non accumulare le sedi del test precedente.
    getSediStore().length = 0;
    getSediStore().push(
      { id: SEDE_T1, tenantId: 1, nome: "A", attiva: true } as any,
      { id: SEDE_T2_A, tenantId: 2, nome: "B", attiva: true } as any,
      { id: SEDE_T2_B, tenantId: 2, nome: "C", attiva: true } as any
    );
  });
  afterEach(() => modalitaTenantStretta(false));

  it("dipendenzeAnalisiReali().sedi vede solo le sedi attive del tenant nel contesto (fallback al predefinito fuori contesto)", () => {
    const { sedi } = dipendenzeAnalisiReali();
    expect(sedi()).toEqual([SEDE_T1]); // fuori contesto, in modalità stretta: fallback tenant 1
    expect(conTenant(2, sedi)).toEqual([SEDE_T2_A, SEDE_T2_B]);
  });

  it("ogni sede gira nel contesto del proprio tenant (dipendenzeAnalisiReali reali, come il tick del worker)", async () => {
    const visti: Array<{ sedeId: number; tenant: number | null }> = [];
    const deps: DipendenzeAnalisi = {
      ...dipendenzeAnalisiReali(),
      repository: repositoryFinto(input => {
        visti.push({ sedeId: input.sedeId, tenant: tenantCorrente() });
      }),
      provider: () => null,
      now: () => ORE_10_ROMA,
    };

    // Come il tick di startAnalisiAziendaWorker dopo il fix: un giro per
    // tenant attivo, nel suo contesto.
    await perOgniTenantAttivo("tars-analisi", async () => {
      await giroAnalisi(deps);
    });

    expect(visti).toEqual([
      { sedeId: SEDE_T1, tenant: 1 },
      { sedeId: SEDE_T2_A, tenant: 2 },
      { sedeId: SEDE_T2_B, tenant: 2 },
    ]);
  });

  it("un tenant che fallisce non ferma gli altri", async () => {
    const visti: number[] = [];
    const deps: DipendenzeAnalisi = {
      ...dipendenzeAnalisiReali(),
      repository: {
        async ensureSchema() {},
        async ultima() {
          return null;
        },
        async perGiorno(sedeId: number) {
          if (sedeId === SEDE_T2_A) throw new Error("boom");
          return null;
        },
        async salva(input) {
          visti.push(input.sedeId);
          return {
            id: 1,
            sedeId: input.sedeId,
            giorno: input.giorno,
            versione: input.versione,
            stato: input.stato,
            esito: input.esito,
            errore: input.errore,
            tentativi: 0,
            generataAt: input.now,
          };
        },
        async aggiornaEsito() {},
      },
      provider: () => null,
      now: () => ORE_10_ROMA,
    };

    await perOgniTenantAttivo("tars-analisi", async () => {
      await giroAnalisi(deps);
    });

    // Il tenant 2 fallisce (perGiorno lancia per la sua prima sede, non
    // intercettato dentro giroAnalisi): perOgniTenantAttivo lo registra e
    // passa oltre. Il tenant 1, già eseguito, resta.
    expect(visti).toEqual([SEDE_T1]);
  });
});
