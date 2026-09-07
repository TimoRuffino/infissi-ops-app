// server/tenants/comandi.ts
// Schemi dei payload di `tenant_comandi`, condivisi da script (produttore) e
// server (esecutore). Nessun accesso a store o database qui.
import { hostname } from "node:os";
import { z } from "zod";
import { isHashed } from "../_core/password";
import { SLUG_RE } from "./costanti";

const slug = z.string().regex(SLUG_RE, "Slug non valido: minuscole, cifre e trattini interni, max 40");
const testo = (max: number) => z.string().trim().min(1).max(max);

export const schemaPayloadCrea = z.object({
  slug,
  nome: testo(120),
  sede: z.object({
    nome: testo(120),
    citta: z.string().trim().max(80).nullable().optional(),
  }),
  proprietario: z.object({
    nome: testo(80),
    cognome: testo(80),
    email: z.string().trim().email(),
    telefono: z.string().trim().max(40).nullable().optional(),
    // Mai in chiaro: lo script hasha prima di accodare.
    passwordHash: z.string().refine(isHashed, "passwordHash deve essere un hash scrypt"),
  }),
});
export type PayloadCrea = z.infer<typeof schemaPayloadCrea>;

export const schemaPayloadStato = z.object({
  slug,
  motivo: z.string().trim().min(3).max(500),
});

export const schemaPayloadProprietario = z.object({
  slug,
  email: z.string().trim().email(),
});

export function richiestoDa(): string {
  return `script:tenant@${hostname()}`;
}
