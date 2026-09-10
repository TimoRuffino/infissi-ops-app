// client/src/lib/feedbackImmagine.ts
// Preparare l'immagine di una segnalazione PRIMA di spedirla: chi segnala
// allega la schermata intera di un portatile in Retina — 3–8 MB di PNG — e
// dentro una mail non ci sta. Qui si rimpicciolisce e si comprime nel
// browser, così quello che parte è un allegato leggibile da 200–400 kB.
//
// L'immagine non tocca mai lo storage dell'azienda: viaggia dentro la mail
// (v. `server/piattaforma/feedback.ts`). Questi limiti sono la cortesia
// verso chi carica; la difesa vera è quella del server.

/** Deve restare uguale a `IMMAGINE_MAX_BYTE` del server. */
export const IMMAGINE_MAX_BYTE = 2 * 1024 * 1024;
/** Il lato lungo oltre il quale l'immagine viene rimpicciolita. */
export const LATO_MASSIMO = 1600;
export const TIPI_AMMESSI = ["image/png", "image/jpeg", "image/webp"] as const;

export type ImmagineAllegata = {
  nome: string;
  tipo: string;
  /** Solo i byte, senza il prefisso `data:…;base64,`. */
  contenutoBase64: string;
  /** La stessa immagine come data URL, per l'anteprima nel dialogo. */
  anteprima: string;
  byte: number;
};

/** I byte dopo il `base64,` di un data URL. Stringa vuota se non lo è. */
export function base64Da(dataUrl: string): string {
  const taglio = dataUrl.indexOf("base64,");
  return taglio < 0 ? "" : dataUrl.slice(taglio + 7);
}

/** I byte veri dietro una stringa base64, senza decodificarla. */
export function byteDaBase64(base64: string): number {
  const pulito = base64.replace(/\s/g, "");
  if (!pulito) return 0;
  const riempimento = pulito.endsWith("==") ? 2 : pulito.endsWith("=") ? 1 : 0;
  return Math.floor((pulito.length * 3) / 4) - riempimento;
}

/** Il lato lungo entro `LATO_MASSIMO`, mantenendo le proporzioni. */
export function misuraRidotta(
  larghezza: number,
  altezza: number,
  massimo = LATO_MASSIMO
): { larghezza: number; altezza: number } {
  const lato = Math.max(larghezza, altezza);
  if (lato <= massimo || lato === 0) {
    return { larghezza, altezza };
  }
  const fattore = massimo / lato;
  return {
    larghezza: Math.max(1, Math.round(larghezza * fattore)),
    altezza: Math.max(1, Math.round(altezza * fattore)),
  };
}

export function tipoAmmesso(tipo: string): boolean {
  return (TIPI_AMMESSI as readonly string[]).includes(tipo);
}

function caricaImmagine(file: File): Promise<HTMLImageElement> {
  return new Promise((risolvi, rifiuta) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      risolvi(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rifiuta(new Error("Non riesco a leggere questa immagine."));
    };
    img.src = url;
  });
}

/**
 * Rimpicciolisce e comprime. Torna sempre un JPEG: uno screenshot non ha
 * bisogno della trasparenza e un PNG dello stesso schermo pesa cinque volte
 * tanto. Se anche dopo la compressione l'immagine supera il limite, lancia
 * con la frase che l'utente deve leggere — meglio dirlo qui che farsi
 * rifiutare dal server dopo aver caricato due megabyte.
 */
export async function preparaImmagine(file: File): Promise<ImmagineAllegata> {
  if (!tipoAmmesso(file.type)) {
    throw new Error("Si possono allegare solo immagini PNG, JPEG o WebP.");
  }
  const img = await caricaImmagine(file);
  const misura = misuraRidotta(img.naturalWidth, img.naturalHeight);
  const tela = document.createElement("canvas");
  tela.width = misura.larghezza;
  tela.height = misura.altezza;
  const contesto = tela.getContext("2d");
  if (!contesto) throw new Error("Non riesco a preparare l'immagine su questo browser.");
  // Uno screenshot ha spesso fondo trasparente: senza questo, il JPEG lo
  // riempie di nero e il testo scuro sparisce.
  contesto.fillStyle = "#ffffff";
  contesto.fillRect(0, 0, tela.width, tela.height);
  contesto.drawImage(img, 0, 0, tela.width, tela.height);

  const anteprima = tela.toDataURL("image/jpeg", 0.82);
  const contenutoBase64 = base64Da(anteprima);
  const byte = byteDaBase64(contenutoBase64);
  if (byte > IMMAGINE_MAX_BYTE) {
    throw new Error("L'immagine resta troppo grande: ritaglia la parte che conta.");
  }
  // L'estensione segue il contenuto, non il file di partenza: quello che
  // parte è sempre un JPEG, anche quando arriva un PNG.
  const radice = file.name.replace(/\.[^.]+$/, "").slice(0, 60).trim();
  return {
    nome: `${radice || "schermata"}.jpg`,
    tipo: "image/jpeg",
    contenutoBase64,
    anteprima,
    byte,
  };
}

/** «312 kB»: il peso dell'allegato, accanto all'anteprima. */
export function pesoLeggibile(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} kB`;
  return `${(byte / (1024 * 1024)).toFixed(1)} MB`;
}
