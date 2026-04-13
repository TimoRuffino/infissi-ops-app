import { relations } from "drizzle-orm";
import {
  users,
  squadre,
  commesse,
  aperture,
  interventi,
  checklistItems,
  anomalie,
  ticket,
  documenti,
  garanzie,
  verbali,
} from "./schema";

export const commesseRelations = relations(commesse, ({ one, many }) => ({
  squadra: one(squadre, { fields: [commesse.squadraId], references: [squadre.id] }),
  createdByUser: one(users, { fields: [commesse.createdBy], references: [users.id] }),
  aperture: many(aperture),
  interventi: many(interventi),
  anomalie: many(anomalie),
  ticket: many(ticket),
  documenti: many(documenti),
  garanzie: many(garanzie),
  verbali: many(verbali),
}));

export const apertureRelations = relations(aperture, ({ one, many }) => ({
  commessa: one(commesse, { fields: [aperture.commessaId], references: [commesse.id] }),
  checklistItems: many(checklistItems),
  anomalie: many(anomalie),
  ticket: many(ticket),
  documenti: many(documenti),
  garanzie: many(garanzie),
}));

export const interventiRelations = relations(interventi, ({ one, many }) => ({
  commessa: one(commesse, { fields: [interventi.commessaId], references: [commesse.id] }),
  squadra: one(squadre, { fields: [interventi.squadraId], references: [squadre.id] }),
  checklistItems: many(checklistItems),
  anomalie: many(anomalie),
  documenti: many(documenti),
  verbali: many(verbali),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  intervento: one(interventi, { fields: [checklistItems.interventoId], references: [interventi.id] }),
  apertura: one(aperture, { fields: [checklistItems.aperturaId], references: [aperture.id] }),
}));

export const anomalieRelations = relations(anomalie, ({ one, many }) => ({
  commessa: one(commesse, { fields: [anomalie.commessaId], references: [commesse.id] }),
  apertura: one(aperture, { fields: [anomalie.aperturaId], references: [aperture.id] }),
  intervento: one(interventi, { fields: [anomalie.interventoId], references: [interventi.id] }),
  documenti: many(documenti),
}));

export const ticketRelations = relations(ticket, ({ one, many }) => ({
  commessa: one(commesse, { fields: [ticket.commessaId], references: [commesse.id] }),
  apertura: one(aperture, { fields: [ticket.aperturaId], references: [aperture.id] }),
  documenti: many(documenti),
}));

export const documentiRelations = relations(documenti, ({ one }) => ({
  commessa: one(commesse, { fields: [documenti.commessaId], references: [commesse.id] }),
  apertura: one(aperture, { fields: [documenti.aperturaId], references: [aperture.id] }),
  intervento: one(interventi, { fields: [documenti.interventoId], references: [interventi.id] }),
  anomalia: one(anomalie, { fields: [documenti.anomaliaId], references: [anomalie.id] }),
  ticket: one(ticket, { fields: [documenti.ticketId], references: [ticket.id] }),
}));

export const garanzieRelations = relations(garanzie, ({ one }) => ({
  commessa: one(commesse, { fields: [garanzie.commessaId], references: [commesse.id] }),
  apertura: one(aperture, { fields: [garanzie.aperturaId], references: [aperture.id] }),
}));

export const verbaliRelations = relations(verbali, ({ one }) => ({
  commessa: one(commesse, { fields: [verbali.commessaId], references: [commesse.id] }),
  intervento: one(interventi, { fields: [verbali.interventoId], references: [interventi.id] }),
}));

export const squadreRelations = relations(squadre, ({ many }) => ({
  commesse: many(commesse),
  interventi: many(interventi),
}));
