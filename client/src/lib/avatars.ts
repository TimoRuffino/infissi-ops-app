// Avatar del team: asset statici sotto `client/public/avatars`, nessun campo
// server e nessuna query aggiuntiva. La shell ha già il nome dell'utente.
//
// La sessione espone soltanto `name`, costruito come «Cognome Nome»
// (server/routers.ts, auth.login), quindi il match scorre i token dall'ultimo
// al primo: nella convenzione il nome proprio è l'ultimo token, ma un valore
// già ridotto al solo nome proprio funziona ugualmente.

export const AVATAR_SLUGS = [
  "alessandro",
  "francesco",
  "lidia",
  "marco",
  "micol",
  "nicolas",
  "stefano",
  "timothy",
] as const;

export type AvatarSlug = (typeof AVATAR_SLUGS)[number];

const SLUG_NOTI: ReadonlySet<string> = new Set(AVATAR_SLUGS);

// Confronto insensibile a maiuscole e accenti: «Nicolás» e «NICOLAS» sono la
// stessa persona.
function normalizza(token: string): string {
  return token
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function avatarSlugForName(
  nome: string | null | undefined
): AvatarSlug | null {
  if (!nome) return null;
  const token = nome.split(/\s+/).filter(Boolean);
  for (let i = token.length - 1; i >= 0; i -= 1) {
    const candidato = normalizza(token[i]);
    if (SLUG_NOTI.has(candidato)) return candidato as AvatarSlug;
  }
  return null;
}

export function avatarUrlForName(
  nome: string | null | undefined
): string | null {
  const slug = avatarSlugForName(nome);
  return slug ? `/avatars/${slug}.png` : null;
}

// Variante retina: il 512 serve solo ai display ad alta densità.
export function avatarSrcSetForName(
  nome: string | null | undefined
): string | null {
  const slug = avatarSlugForName(nome);
  return slug ? `/avatars/${slug}.png 1x, /avatars/${slug}@2x.png 2x` : null;
}
