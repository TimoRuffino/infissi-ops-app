// Import anagrafica clienti da un export Fatture in Cloud.
//
// L'export contiene anche gli anni passati, quindi la maggior parte delle
// righe è già nel CRM: il valore di questo modulo non è creare, è NON creare.
// Un doppione in anagrafica si propaga per anni — due schede per la stessa
// persona, commesse spartite fra le due, fatture che agganciano quella
// sbagliata — ed è molto più costoso di un cliente mancante.
//
// Le regole di riconoscimento sono le stesse che il sync FiC usa già
// (`normKey`, `COMPANY_RE`, `splitPersona`): due strade diverse per gli
// stessi dati devono decidere allo stesso modo, altrimenti l'import crea
// proprio i doppioni che il sync evitava.

export type RigaImport = {
  denominazione: string;
  indirizzo: string;
  comune: string;
  cap: string;
  provincia: string;
  email: string;
  referente: string;
  telefono: string;
  partitaIva: string;
  codiceFiscale: string;
  note: string;
};

export type ClienteEsistente = {
  id: number;
  sedeId?: number;
  nome?: string | null;
  cognome?: string | null;
  partitaIva?: string | null;
  codiceFiscale?: string | null;
  email?: string | null;
  telefono?: string | null;
  indirizzo?: string | null;
  citta?: string | null;
  cap?: string | null;
  note?: string | null;
};

export type EsitoRiga =
  | { esito: "creato"; riga: RigaImport }
  | {
      esito: "gia_presente";
      riga: RigaImport;
      clienteId: number;
      criterio: "partita_iva" | "codice_fiscale" | "nome";
      campiArricchiti: string[];
    }
  | { esito: "duplicato_nel_file"; riga: RigaImport; criterio: string }
  | { esito: "scartato"; riga: RigaImport; motivo: string };

export type ReportImport = {
  dryRun: boolean;
  sedeId: number;
  righeLette: number;
  creati: number;
  giaPresenti: number;
  duplicatiNelFile: number;
  scartati: number;
  campiArricchiti: number;
  esiti: EsitoRiga[];
};

// ── Normalizzazioni ─────────────────────────────────────────────────────────

function stripAcc(valore: string): string {
  return valore.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Stessa chiave del sync FiC: accenti via, minuscolo, parole ordinate. */
export function normKeyNome(valore: string): string {
  return stripAcc(valore)
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Variante larga: toglie anche apostrofi e attaccature.
 *
 * `normKeyNome` conserva l'apostrofo perché è la chiave del sync FiC e
 * cambiarla sposterebbe anche quel comportamento. Ma "D'Amico Nicolò" e
 * "D AMICO NICOLO" sono la stessa persona, e in un'anagrafica scritta a mano
 * negli anni quella differenza c'è. Questa chiave serve solo come secondo
 * tentativo dell'import: non decide da sola nulla che le altre non vedano.
 */
export function chiaveLarga(valore: string): string {
  return stripAcc(valore)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function normFiscale(valore: unknown, togliIt = false): string {
  const n = String(valore ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return togliIt && n.startsWith("IT") ? n.slice(2) : n;
}

function pulito(valore: unknown): string {
  return String(valore ?? "").trim();
}

// ── Parsing CSV ─────────────────────────────────────────────────────────────

/** Parser CSV minimo ma corretto su virgolette, virgole e ritorni a capo. */
export function parseCsv(testo: string): string[][] {
  const righe: string[][] = [];
  let campo = "";
  let riga: string[] = [];
  let dentroVirgolette = false;
  const contenuto = testo.replace(/^﻿/, "");

  for (let i = 0; i < contenuto.length; i++) {
    const c = contenuto[i];
    if (dentroVirgolette) {
      if (c === '"') {
        if (contenuto[i + 1] === '"') {
          campo += '"';
          i++;
        } else dentroVirgolette = false;
      } else campo += c;
      continue;
    }
    if (c === '"') dentroVirgolette = true;
    else if (c === ",") {
      riga.push(campo);
      campo = "";
    } else if (c === "\n") {
      riga.push(campo);
      righe.push(riga);
      riga = [];
      campo = "";
    } else if (c !== "\r") campo += c;
  }
  if (campo !== "" || riga.length > 0) {
    riga.push(campo);
    righe.push(riga);
  }
  return righe.filter(r => r.some(v => v.trim() !== ""));
}

// Le intestazioni dell'export FiC. Confronto normalizzato: l'export cambia
// maiuscole e punteggiatura fra una versione e l'altra.
const COLONNE: Record<keyof RigaImport, string[]> = {
  denominazione: ["denominazione", "ragione sociale", "nome"],
  indirizzo: ["indirizzo"],
  comune: ["comune", "citta"],
  cap: ["cap"],
  provincia: ["provincia"],
  email: ["indirizzo e mail", "email", "e mail"],
  referente: ["referente"],
  telefono: ["telefono", "cellulare"],
  partitaIva: ["p iva tax id", "p iva", "partita iva"],
  codiceFiscale: ["codice fiscale"],
  note: ["note"],
};

function normIntestazione(valore: string): string {
  return stripAcc(valore)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function leggiRighe(testo: string): RigaImport[] {
  const griglia = parseCsv(testo);
  if (griglia.length < 2) return [];
  const intestazione = griglia[0].map(normIntestazione);
  const indice = {} as Record<keyof RigaImport, number>;
  for (const [campo, alias] of Object.entries(COLONNE)) {
    indice[campo as keyof RigaImport] = intestazione.findIndex(h =>
      alias.includes(h)
    );
  }
  return griglia.slice(1).map(riga => {
    const leggi = (campo: keyof RigaImport) => {
      const i = indice[campo];
      return i >= 0 ? pulito(riga[i]) : "";
    };
    return {
      denominazione: leggi("denominazione"),
      indirizzo: leggi("indirizzo"),
      comune: leggi("comune"),
      cap: leggi("cap"),
      provincia: leggi("provincia"),
      email: leggi("email"),
      referente: leggi("referente"),
      telefono: leggi("telefono"),
      partitaIva: leggi("partitaIva"),
      codiceFiscale: leggi("codiceFiscale"),
      note: leggi("note"),
    };
  });
}

// ── Import ──────────────────────────────────────────────────────────────────

export type DipendenzeImport = {
  clientiEsistenti: ClienteEsistente[];
  sedeId: number;
  /** Crea il cliente e ne restituisce l'id. */
  crea: (dati: {
    sedeId: number;
    cognome: string;
    nome: string;
    tipo: "privato" | "azienda" | "condominio" | "ente_pubblico";
    partitaIva?: string;
    codiceFiscale?: string;
    email?: string;
    telefono?: string;
    indirizzo?: string;
    citta?: string;
    cap?: string;
    note?: string;
  }) => number;
  /** Scrive i campi mancanti su un cliente già presente. */
  arricchisci: (clienteId: number, campi: Record<string, string>) => void;
  salva: () => void;
  isAzienda: (nome: string) => boolean;
  dividiPersona: (
    nome: string,
    cf: string | null
  ) => { cognome: string; nome: string };
};

/**
 * Un cliente vale la pena di essere importato? Una riga senza denominazione
 * non è un cliente, è una riga vuota dell'export.
 */
function rigaValida(riga: RigaImport): string | null {
  if (!riga.denominazione) return "senza denominazione";
  if (normKeyNome(riga.denominazione).length < 2) {
    return "denominazione non significativa";
  }
  return null;
}

export function importaClienti(
  righe: readonly RigaImport[],
  opzioni: { apply: boolean; arricchisci: boolean },
  deps: DipendenzeImport
): ReportImport {
  // Indici sulle tre identità, dal più forte al più debole. La partita IVA e
  // il codice fiscale identificano; il nome somiglia soltanto, ma è tutto
  // quello che c'è per i privati senza CF a registro.
  const perPiva = new Map<string, ClienteEsistente>();
  const perCf = new Map<string, ClienteEsistente>();
  const perNome = new Map<string, ClienteEsistente>();
  const perNomeLargo = new Map<string, ClienteEsistente>();
  for (const c of deps.clientiEsistenti) {
    if ((c.sedeId ?? 1) !== deps.sedeId) continue;
    const piva = normFiscale(c.partitaIva, true);
    if (piva) perPiva.set(piva, c);
    const cf = normFiscale(c.codiceFiscale);
    if (cf) perCf.set(cf, c);
    const nome = normKeyNome(`${c.cognome ?? ""} ${c.nome ?? ""}`);
    // Il primo vince: se l'anagrafica ha già due omonimi, l'import non deve
    // aggiungerne un terzo scegliendo a caso.
    if (nome && !perNome.has(nome)) perNome.set(nome, c);
    const largo = chiaveLarga(`${c.cognome ?? ""} ${c.nome ?? ""}`);
    if (largo && !perNomeLargo.has(largo)) perNomeLargo.set(largo, c);
  }

  const report: ReportImport = {
    dryRun: !opzioni.apply,
    sedeId: deps.sedeId,
    righeLette: righe.length,
    creati: 0,
    giaPresenti: 0,
    duplicatiNelFile: 0,
    scartati: 0,
    campiArricchiti: 0,
    esiti: [],
  };

  // Il file stesso può ripetere lo stesso soggetto: una riga per sede di
  // fatturazione, o la stessa persona con e senza partita IVA.
  const vistiPiva = new Set<string>();
  const vistiCf = new Set<string>();
  const vistiNome = new Set<string>();
  const vistiNomeLargo = new Set<string>();

  for (const riga of righe) {
    const motivo = rigaValida(riga);
    if (motivo) {
      report.scartati++;
      report.esiti.push({ esito: "scartato", riga, motivo });
      continue;
    }

    const piva = normFiscale(riga.partitaIva, true);
    const cf = normFiscale(riga.codiceFiscale);
    const chiaveNome = normKeyNome(riga.denominazione);
    const chiaveNomeLarga = chiaveLarga(riga.denominazione);

    const duplicatoFile =
      (piva && vistiPiva.has(piva) && "partita IVA ripetuta nel file") ||
      (cf && vistiCf.has(cf) && "codice fiscale ripetuto nel file") ||
      (vistiNome.has(chiaveNome) && "denominazione ripetuta nel file") ||
      (vistiNomeLargo.has(chiaveNomeLarga) &&
        "denominazione ripetuta nel file, con punteggiatura diversa");
    if (duplicatoFile) {
      report.duplicatiNelFile++;
      report.esiti.push({
        esito: "duplicato_nel_file",
        riga,
        criterio: duplicatoFile,
      });
      continue;
    }

    const esistente =
      (piva && perPiva.get(piva)) ||
      (cf && perCf.get(cf)) ||
      perNome.get(chiaveNome) ||
      perNomeLargo.get(chiaveNomeLarga) ||
      null;

    if (esistente) {
      const criterio =
        piva && perPiva.get(piva)
          ? ("partita_iva" as const)
          : cf && perCf.get(cf)
            ? ("codice_fiscale" as const)
            : ("nome" as const);

      // Arricchimento: SOLO campi vuoti. Un dato già nel CRM è stato messo o
      // corretto da una persona, e l'export di FiC non ha titolo per
      // sovrascriverlo.
      const campi: Record<string, string> = {};
      const forse = (chiave: keyof ClienteEsistente, valore: string) => {
        if (!valore) return;
        const attuale = pulito(esistente[chiave] as string);
        if (!attuale) campi[chiave] = valore;
      };
      if (opzioni.arricchisci) {
        forse("email", riga.email);
        forse("telefono", riga.telefono);
        forse("indirizzo", riga.indirizzo);
        forse("citta", riga.comune);
        forse("cap", riga.cap);
        forse("partitaIva", riga.partitaIva ? normFiscale(riga.partitaIva, true) : "");
        forse("codiceFiscale", cf);
      }
      const arricchiti = Object.keys(campi);
      if (opzioni.apply && arricchiti.length > 0) {
        deps.arricchisci(esistente.id, campi);
      }

      report.giaPresenti++;
      report.campiArricchiti += arricchiti.length;
      report.esiti.push({
        esito: "gia_presente",
        riga,
        clienteId: esistente.id,
        criterio,
        campiArricchiti: arricchiti,
      });
      if (piva) vistiPiva.add(piva);
      if (cf) vistiCf.add(cf);
      vistiNome.add(chiaveNome);
      vistiNomeLargo.add(chiaveNomeLarga);
      continue;
    }

    // Nuovo. Azienda o persona si decide come nel sync: una partita IVA
    // reale, o una forma societaria nel nome.
    const azienda = (!!piva && piva !== "0") || deps.isAzienda(riga.denominazione);
    const tipo = /condominio/i.test(riga.denominazione)
      ? ("condominio" as const)
      : azienda
        ? ("azienda" as const)
        : ("privato" as const);
    const nomi = azienda
      ? { cognome: riga.denominazione, nome: " " }
      : deps.dividiPersona(riga.denominazione, cf || null);

    if (opzioni.apply) {
      deps.crea({
        sedeId: deps.sedeId,
        cognome: nomi.cognome,
        nome: nomi.nome,
        tipo,
        partitaIva: piva || undefined,
        // Un codice fiscale valido ha 16 caratteri; per le aziende coincide
        // con la partita IVA e non va duplicato nel campo sbagliato.
        codiceFiscale: /^[A-Z0-9]{16}$/.test(cf) ? cf : undefined,
        email: riga.email || undefined,
        telefono: riga.telefono || undefined,
        indirizzo: riga.indirizzo || undefined,
        citta: riga.comune || undefined,
        cap: riga.cap || undefined,
        note: [riga.referente ? `Referente: ${riga.referente}` : "", riga.note]
          .filter(Boolean)
          .join(" · ") || undefined,
      });
    }

    report.creati++;
    report.esiti.push({ esito: "creato", riga });
    if (piva) vistiPiva.add(piva);
    if (cf) vistiCf.add(cf);
    vistiNome.add(chiaveNome);
    vistiNomeLargo.add(chiaveNomeLarga);
  }

  if (opzioni.apply) deps.salva();
  return report;
}
