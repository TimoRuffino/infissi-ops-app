import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  date,
} from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Squadre (Teams) ─────────────────────────────────────────────────────────

export const squadre = mysqlTable("squadre", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 200 }).notNull(),
  caposquadra: varchar("caposquadra", { length: 200 }),
  telefono: varchar("telefono", { length: 30 }),
  note: text("note"),
  attiva: boolean("attiva").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Squadra = typeof squadre.$inferSelect;
export type InsertSquadra = typeof squadre.$inferInsert;

// ─── Commesse (Jobs/Projects) ────────────────────────────────────────────────

export const commesse = mysqlTable("commesse", {
  id: int("id").autoincrement().primaryKey(),
  codice: varchar("codice", { length: 50 }).notNull().unique(),
  cliente: varchar("cliente", { length: 300 }).notNull(),
  indirizzo: varchar("indirizzo", { length: 500 }),
  citta: varchar("citta", { length: 200 }),
  telefono: varchar("telefono", { length: 30 }),
  email: varchar("email", { length: 320 }),
  stato: mysqlEnum("stato", [
    "aperta",
    "in_rilievo",
    "in_lavorazione",
    "in_posa",
    "chiusa",
    "archiviata",
  ]).default("aperta").notNull(),
  priorita: mysqlEnum("priorita", ["bassa", "media", "alta", "urgente"]).default("media").notNull(),
  squadraId: int("squadraId"),
  dataApertura: date("dataApertura"),
  dataConsegnaPrevista: date("dataConsegnaPrevista"),
  dataChiusura: date("dataChiusura"),
  note: text("note"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Commessa = typeof commesse.$inferSelect;
export type InsertCommessa = typeof commesse.$inferInsert;

// ─── Aperture (Openings / Window units) ──────────────────────────────────────

export const aperture = mysqlTable("aperture", {
  id: int("id").autoincrement().primaryKey(),
  commessaId: int("commessaId").notNull(),
  codice: varchar("codice", { length: 50 }).notNull(),
  descrizione: varchar("descrizione", { length: 500 }),
  piano: varchar("piano", { length: 50 }),
  locale: varchar("locale", { length: 200 }),
  tipologia: mysqlEnum("tipologia", [
    "finestra",
    "portafinestra",
    "porta",
    "scorrevole",
    "fisso",
    "altro",
  ]).default("finestra").notNull(),
  larghezza: decimal("larghezza", { precision: 8, scale: 2 }),
  altezza: decimal("altezza", { precision: 8, scale: 2 }),
  profondita: decimal("profondita", { precision: 8, scale: 2 }),
  materiale: varchar("materiale", { length: 100 }),
  colore: varchar("colore", { length: 100 }),
  vetro: varchar("vetro", { length: 200 }),
  stato: mysqlEnum("stato_apertura", [
    "da_rilevare",
    "rilevata",
    "ordinata",
    "consegnata",
    "in_posa",
    "posata",
    "verificata",
  ]).default("da_rilevare").notNull(),
  noteRilievo: text("noteRilievo"),
  criticitaAccesso: text("criticitaAccesso"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Apertura = typeof aperture.$inferSelect;
export type InsertApertura = typeof aperture.$inferInsert;

// ─── Interventi (Interventions / Scheduled work) ─────────────────────────────

export const interventi = mysqlTable("interventi", {
  id: int("id").autoincrement().primaryKey(),
  commessaId: int("commessaId").notNull(),
  squadraId: int("squadraId"),
  tipo: mysqlEnum("tipo", ["rilievo", "posa", "assistenza", "sopralluogo", "altro"])
    .default("posa")
    .notNull(),
  stato: mysqlEnum("stato_intervento", [
    "pianificato",
    "in_corso",
    "completato",
    "sospeso",
    "annullato",
  ]).default("pianificato").notNull(),
  dataPianificata: date("dataPianificata"),
  dataInizio: timestamp("dataInizio"),
  dataFine: timestamp("dataFine"),
  indirizzo: varchar("indirizzo", { length: 500 }),
  note: text("note"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Intervento = typeof interventi.$inferSelect;
export type InsertIntervento = typeof interventi.$inferInsert;

// ─── Checklist Items ─────────────────────────────────────────────────────────

export const checklistItems = mysqlTable("checklist_items", {
  id: int("id").autoincrement().primaryKey(),
  interventoId: int("interventoId").notNull(),
  aperturaId: int("aperturaId"),
  ordine: int("ordine").default(0).notNull(),
  descrizione: varchar("descrizione", { length: 500 }).notNull(),
  completato: boolean("completato").default(false).notNull(),
  obbligatorio: boolean("obbligatorio").default(false).notNull(),
  fotoObbligatoria: boolean("fotoObbligatoria").default(false).notNull(),
  note: text("note"),
  completatoAt: timestamp("completatoAt"),
  completatoDa: int("completatoDa"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChecklistItem = typeof checklistItems.$inferSelect;
export type InsertChecklistItem = typeof checklistItems.$inferInsert;

// ─── Anomalie (Defects / Issues) ─────────────────────────────────────────────

export const anomalie = mysqlTable("anomalie", {
  id: int("id").autoincrement().primaryKey(),
  commessaId: int("commessaId").notNull(),
  aperturaId: int("aperturaId"),
  interventoId: int("interventoId"),
  categoria: mysqlEnum("categoria", [
    "materiale_difettoso",
    "misura_errata",
    "danno_trasporto",
    "difetto_posa",
    "problema_accessorio",
    "non_conformita",
    "altro",
  ]).notNull(),
  priorita: mysqlEnum("priorita_anomalia", ["bassa", "media", "alta", "critica"])
    .default("media")
    .notNull(),
  stato: mysqlEnum("stato_anomalia", ["aperta", "in_gestione", "risolta", "chiusa"])
    .default("aperta")
    .notNull(),
  descrizione: text("descrizione").notNull(),
  risoluzione: text("risoluzione"),
  segnalataBy: int("segnalataBy"),
  risoltaBy: int("risoltaBy"),
  risoltaAt: timestamp("risoltaAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Anomalia = typeof anomalie.$inferSelect;
export type InsertAnomalia = typeof anomalie.$inferInsert;

// ─── Ticket Post-Vendita ─────────────────────────────────────────────────────

export const ticket = mysqlTable("ticket", {
  id: int("id").autoincrement().primaryKey(),
  commessaId: int("commessaId").notNull(),
  aperturaId: int("aperturaId"),
  oggetto: varchar("oggetto", { length: 500 }).notNull(),
  descrizione: text("descrizione"),
  categoria: mysqlEnum("categoria_ticket", [
    "difetto_prodotto",
    "difetto_posa",
    "regolazione",
    "sostituzione",
    "garanzia",
    "altro",
  ]).notNull(),
  priorita: mysqlEnum("priorita_ticket", ["bassa", "media", "alta", "urgente"])
    .default("media")
    .notNull(),
  stato: mysqlEnum("stato_ticket", [
    "aperto",
    "assegnato",
    "in_lavorazione",
    "risolto",
    "chiuso",
  ]).default("aperto").notNull(),
  assegnatoA: int("assegnatoA"),
  dataRisoluzione: timestamp("dataRisoluzione"),
  esitoIntervento: text("esitoIntervento"),
  apertoBy: int("apertoBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Ticket = typeof ticket.$inferSelect;
export type InsertTicket = typeof ticket.$inferInsert;

// ─── Documenti / Media ───────────────────────────────────────────────────────

export const documenti = mysqlTable("documenti", {
  id: int("id").autoincrement().primaryKey(),
  commessaId: int("commessaId"),
  aperturaId: int("aperturaId"),
  interventoId: int("interventoId"),
  anomaliaId: int("anomaliaId"),
  ticketId: int("ticketId"),
  tipo: mysqlEnum("tipo_documento", [
    "foto_rilievo",
    "foto_posa",
    "foto_anomalia",
    "foto_prima",
    "foto_dopo",
    "verbale_pdf",
    "dossier_pdf",
    "nota_vocale",
    "documento_garanzia",
    "altro",
  ]).notNull(),
  nome: varchar("nome", { length: 500 }).notNull(),
  url: varchar("url", { length: 2000 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  dimensione: int("dimensione"),
  descrizione: text("descrizione"),
  uploadBy: int("uploadBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Documento = typeof documenti.$inferSelect;
export type InsertDocumento = typeof documenti.$inferInsert;

// ─── Garanzie (Warranties) ───────────────────────────────────────────────────

export const garanzie = mysqlTable("garanzie", {
  id: int("id").autoincrement().primaryKey(),
  commessaId: int("commessaId").notNull(),
  aperturaId: int("aperturaId"),
  tipo: varchar("tipo", { length: 200 }).notNull(),
  fornitore: varchar("fornitore", { length: 300 }),
  dataInizio: date("dataInizio").notNull(),
  dataScadenza: date("dataScadenza").notNull(),
  stato: mysqlEnum("stato_garanzia", ["attiva", "scaduta", "utilizzata"])
    .default("attiva")
    .notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Garanzia = typeof garanzie.$inferSelect;
export type InsertGaranzia = typeof garanzie.$inferInsert;

// ─── Verbali Chiusura (Completion Reports) ───────────────────────────────────

export const verbali = mysqlTable("verbali", {
  id: int("id").autoincrement().primaryKey(),
  commessaId: int("commessaId").notNull(),
  interventoId: int("interventoId"),
  dataVerbale: date("dataVerbale").notNull(),
  noteCliente: text("noteCliente"),
  noteIntervento: text("noteIntervento"),
  firmaClienteUrl: varchar("firmaClienteUrl", { length: 2000 }),
  pdfUrl: varchar("pdfUrl", { length: 2000 }),
  stato: mysqlEnum("stato_verbale", ["bozza", "firmato", "archiviato"])
    .default("bozza")
    .notNull(),
  compilatoDa: int("compilatoDa"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Verbale = typeof verbali.$inferSelect;
export type InsertVerbale = typeof verbali.$inferInsert;
