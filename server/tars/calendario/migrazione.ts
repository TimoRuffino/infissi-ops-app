// T4/D2 — Migrazione degli appuntamenti Google negli interventi del CRM
// (mandato direzione 03/09 sera: «importa gli ultimi 2 mesi e quello
// corrente»; il futuro entra per costruzione — un CRM-fonte senza le pose
// già fissate sarebbe monco).
//
// Deterministica e RILANCIABILE: ogni evento porta la chiave
// `google:<sorgente>:<uid>:<data>` in `origineEsterna` — chi c'è già non
// si duplica. La commessa si collega SOLO quando il match è univoco
// (codice COM-… nel titolo, o cognome del cliente presente e una sola
// commessa attiva candidata); tutto il resto resta senza commessa, da
// collegare poi.

import { TIPI_INTERVENTO } from "../../routers/interventi";

export type EventoEsterno = {
  sourceId: number | string;
  sourceNome: string;
  uid?: string;
  /** L'id composito della procedura events (`<src>:<uid>:<date>`), se c'è. */
  id?: string;
  titolo: string;
  location?: string | null;
  dataPianificata: string; // YYYY-MM-DD
  oraInizio: string | null;
  oraFine: string | null;
  allDay?: boolean;
};

export type CommessaCandidata = {
  id: number;
  codice?: string | null;
  cliente?: string | null;
  indirizzo?: string | null;
  archivedAt?: unknown;
};

export type PianoEvento = {
  chiave: string;
  tipo: (typeof TIPI_INTERVENTO)[number];
  commessaId: number | null;
  motivoCommessa: string | null;
  data: string;
  oraInizio: string | null;
  oraFine: string | null;
  indirizzo: string | null;
  note: string;
  titolo: string;
};

/** Dal 1° giorno di (mese corrente − 2) a oggi + futuroGiorni. */
export function finestraMigrazione(
  adesso: Date,
  futuroGiorni = 180
): { da: string; a: string } {
  const inizio = new Date(adesso.getFullYear(), adesso.getMonth() - 2, 1, 12);
  const fine = new Date(adesso.getTime() + futuroGiorni * 86_400_000);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { da: iso(inizio), a: iso(fine) };
}

export function chiaveEvento(evento: EventoEsterno): string {
  const uid = evento.uid ?? evento.id ?? evento.titolo;
  return `google:${evento.sourceId}:${uid}:${evento.dataPianificata}`.slice(0, 200);
}

export function tipoDaTitolo(titolo: string): PianoEvento["tipo"] {
  const t = titolo.toLowerCase();
  if (/\bposa\b|montagg/.test(t)) return "posa";
  if (/rilievo|sopralluogo|misur/.test(t)) return "rilievo";
  // Prima di assistenza: «ritiro riparazioni» è una consegna/ritiro,
  // non l'intervento di riparazione.
  if (/consegn|ritir/.test(t)) return "consegna";
  if (/assistenz|riparaz|regolaz|intervent/.test(t)) return "assistenza";
  if (/\bferie\b|permess|chiusur|festiv/.test(t)) return "ferie";
  if (/riunion|meeting/.test(t)) return "riunione";
  if (/appuntament|showroom/.test(t)) return "appuntamento";
  return "altro";
}

/**
 * Match PRUDENTE della commessa: codice esplicito, oppure cognome del
 * cliente come parola intera e UNA sola commessa attiva candidata.
 */
export function commessaPerEvento(
  evento: EventoEsterno,
  commesse: readonly CommessaCandidata[]
): { commessaId: number | null; motivo: string | null } {
  const testo = `${evento.titolo} ${evento.location ?? ""}`.toLowerCase();
  const attive = commesse.filter(c => !c.archivedAt);
  const perCodice = attive.find(
    c => c.codice && testo.includes(String(c.codice).toLowerCase())
  );
  if (perCodice) return { commessaId: perCodice.id, motivo: `codice ${perCodice.codice} nel titolo` };

  const candidate = attive.filter(c => {
    const cognome = String(c.cliente ?? "").trim().split(/\s+/)[0]?.toLowerCase();
    if (!cognome || cognome.length < 4) return false;
    return new RegExp(`(^|[^a-zà-ù])${cognome}([^a-zà-ù]|$)`, "i").test(testo);
  });
  if (candidate.length === 1) {
    return {
      commessaId: candidate[0].id,
      motivo: `cliente «${candidate[0].cliente}» nel titolo, unica candidata`,
    };
  }
  return { commessaId: null, motivo: null };
}

/** Il piano: cosa verrebbe creato, evento per evento (senza scrivere). */
export function pianoMigrazione(input: {
  eventi: readonly EventoEsterno[];
  commesse: readonly CommessaCandidata[];
  esistenti: ReadonlySet<string>;
}): { daCreare: PianoEvento[]; giaImportati: number } {
  const daCreare: PianoEvento[] = [];
  let giaImportati = 0;
  for (const evento of input.eventi) {
    const chiave = chiaveEvento(evento);
    if (input.esistenti.has(chiave)) {
      giaImportati += 1;
      continue;
    }
    const { commessaId, motivo } = commessaPerEvento(evento, input.commesse);
    daCreare.push({
      chiave,
      tipo: tipoDaTitolo(evento.titolo),
      commessaId,
      motivoCommessa: motivo,
      data: evento.dataPianificata,
      oraInizio: evento.allDay ? null : evento.oraInizio,
      oraFine: evento.allDay ? null : evento.oraFine,
      indirizzo: evento.location?.trim() || null,
      note: `Importato dal calendario Google «${evento.sourceNome}»: ${evento.titolo}`.slice(0, 900),
      titolo: evento.titolo,
    });
  }
  return { daCreare, giaImportati };
}
