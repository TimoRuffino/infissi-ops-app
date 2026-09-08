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

// `ricalcola_storage` (Task 4): il tenant si risolve dallo slug come gli
// altri comandi da script; il server accetta anche `comando.tenantId` diretto
// (es. dal ciclo interno), lo slug serve solo quando arriva da `pnpm tenant`.
export const schemaPayloadStorage = z.object({ slug });

// `ripristina_archivi` (Task 8): `backup` è una data «AAAA-MM-GG» o l'id di
// una cartella di Drive; `solo` limita gli store da sostituire (null = tutti
// quelli del backup). `scrivi` distingue la prova (il server legge il Drive e
// confronta, senza toccare nulla) dal ripristino vero — la prova la fa il
// server perché è lui a parlare col Drive dell'azienda, non lo script.
export const schemaPayloadRipristino = z.object({
  slug,
  backup: testo(120),
  solo: z.array(z.string().trim().min(1)).nullable().optional(),
  scrivi: z.boolean(),
  ancheTenant1: z.boolean().optional(),
});

export function richiestoDa(): string {
  return `script:tenant@${hostname()}`;
}
