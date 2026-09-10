// server/_core/bustaEmail.ts
// La busta delle mail di piattaforma: funzione PURA che da un contenuto
// struttura HTML e testo insieme. Nessuno store, nessuna rete, nessun
// `new Date()` — quello che entra è tutto quello che serve.
//
// Perché una busta condivisa e non l'HTML dentro ogni testo: l'invito è la
// PRIMA cosa che un cliente vede di Wyndoor, ma non sarà l'ultima (scadenza
// della prova, abbonamento sospeso, quota vicina). Se ognuna si scrive il
// suo markup, in tre mail si hanno tre marchi, tre bottoni e tre pieghi
// diversi. Qui la forma sta in un posto solo e i testi portano solo parole.
//
// Perché le tabelle e non il CSS moderno: Outlook su Windows rende con il
// motore di Word — niente flex, niente grid, `border-radius` e `padding`
// ignorati sui link. Le tabelle e la versione VML del bottone (`v:roundrect`)
// non sono nostalgia: sono l'unico modo perché il bottone esista anche lì.
// Il `<style>` in testa serve solo a ciò che si può perdere senza danno
// (schermi stretti, tema scuro): la resa di base sta negli attributi inline,
// che nessun client toglie.
//
// L'HTML e il testo nascono dalla STESSA struttura di proposito: due
// funzioni separate divergono al primo ritocco, e il destinatario che legge
// in testo semplice finisce con una mail diversa da quella che abbiamo
// scritto.

/** Una riga della scheda dati: l'etichetta e il suo valore. */
export type RigaScheda = { voce: string; valore: string };

/** Il bottone: cosa fa e dove porta. Il ripiego in chiaro lo aggiunge la busta. */
export type AzioneEmail = { etichetta: string; href: string };

export type ContenutoEmail = {
  /** Titolo grande e `<title>` del documento. */
  titolo: string;
  /** La riga che la casella mostra nell'elenco, accanto all'oggetto. */
  preheader: string;
  /** «Ciao Mario»: facoltativo, non tutte le mail salutano. */
  saluto?: string;
  paragrafi: string[];
  scheda?: RigaScheda[];
  azione?: AzioneEmail;
  /** Il carattere piccolo sotto l'azione: validità, avvertenze. */
  note?: string[];
  /** L'indirizzo a cui rispondere, nel piede. Assente = piede senza contatto. */
  contatto?: string;
  /** La base dell'app: da qui nasce l'indirizzo del marchio. */
  baseUrl: string;
};

/**
 * Escapa i cinque caratteri che aprono markup HTML; le virgolette servono
 * per il testo dentro un attributo. Vive qui perché la busta è il solo
 * punto in cui un valore che arriva da fuori diventa markup: `baseUrl` può
 * nascere dall'header `Host` della richiesta (v. `baseUrlDa`), che chi manda
 * la richiesta sceglie.
 */
export const escapaHtml = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  );

/** Senza barra finale: `https://app.wyndoor.com/` + `/icon-192.png` farebbe `//`. */
const senzaBarra = (s: string): string => s.trim().replace(/\/+$/, "");

const FONT =
  "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * I colori di Modular Control (client/src/index.css) ricopiati come esadecimali:
 * una mail non ha `var()`, non ha il nostro CSS e non ha il nostro `<html>`.
 * Se la palette cambia di là va cambiata anche qui — sono nove valori, e
 * `bustaEmail.test.ts` non li verifica: li verifica l'occhio, con
 * `pnpm posta:anteprima`.
 */
const C = {
  canvas: "#f7f5f6",
  superficie: "#ffffff",
  incavo: "#f2eef0",
  inchiostro: "#20171b",
  smorzato: "#71656a",
  filo: "#e6dde0",
  brand: "#8b1e3f",
  suBrand: "#ffffff",
  marchio: "#d92f55",
} as const;

/** Solo http e https diventano un link: `javascript:` in un `href` no. */
function assicuraIndirizzoWeb(href: string): string {
  if (!/^https?:\/\//i.test(href.trim())) {
    throw new Error(`Indirizzo non valido per una mail: ${href.slice(0, 20)}`);
  }
  return href.trim();
}

/** Il `<style>` in testa: schermi stretti e tema scuro, tutto perdibile. */
function foglio(): string {
  return [
    "<style>",
    `  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}`,
    `  table{border-collapse:collapse}`,
    `  img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}`,
    `  a{color:${C.brand}}`,
    "  @media only screen and (max-width:620px){",
    "    .lato{padding-left:24px!important;padding-right:24px!important}",
    "    .bottone{display:block!important;width:100%!important;box-sizing:border-box!important}",
    "    .titolo{font-size:24px!important;line-height:32px!important}",
    "  }",
    "  @media (prefers-color-scheme:dark){",
    "    .sfondo{background-color:#151216!important}",
    "    .foglio{background-color:#201b20!important;border-color:#473b42!important}",
    "    .incavo{background-color:#171217!important}",
    "    .inchiostro{color:#fcf8f9!important}",
    "    .smorzato{color:#bdafb5!important}",
    "    .filo{border-color:#473b42!important}",
    "    .filoAlto{background-color:#d92f55!important}",
    "    .bottone{background-color:#f09ab2!important;color:#32101b!important}",
    "    a{color:#f09ab2!important}",
    "  }",
    "</style>",
  ].join("\n");
}

/**
 * Il marchio: le due ante come immagine, la parola come testo VIVO accanto.
 * `alt=""` di proposito — il segno è decorativo proprio perché la parola gli
 * sta a fianco come testo (stessa regola di `WyndoorMark`): con un
 * `alt="Wyndoor"` un client che blocca le immagini — Outlook lo fa di suo —
 * scriverebbe «Wyndoor Wyndoor». Bloccata l'immagine, l'intestazione resta
 * comunque leggibile e giusta.
 */
function intestazione(baseUrl: string): string {
  // `marchio-email.png`, non `icon-192.png`: quello nasce su fondo pieno per
  // iOS, e in tema scuro sarebbe un quadrato bianco. Lo genera `pnpm icone`.
  const logo = `${escapaHtml(senzaBarra(baseUrl))}/marchio-email.png`;
  return [
    `<tr><td class="lato" style="padding:28px 40px 4px 40px;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td width="40" style="padding-right:10px;vertical-align:middle;">`,
    `<img src="${logo}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;">`,
    `</td>`,
    `<td class="inchiostro" style="vertical-align:middle;font-family:${FONT};font-size:19px;font-weight:800;letter-spacing:-0.02em;color:${C.inchiostro};">Wyndoor</td>`,
    `</tr></table>`,
    `</td></tr>`,
  ].join("\n");
}

function schedaHtml(righe: RigaScheda[]): string {
  const celle = righe
    .map(
      (r, i) =>
        `<tr>` +
        `<td class="smorzato" style="padding:${i === 0 ? "0" : "8px"} 12px 0 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.smorzato};white-space:nowrap;vertical-align:top;">${escapaHtml(r.voce)}</td>` +
        `<td class="inchiostro" style="padding:${i === 0 ? "0" : "8px"} 0 0 0;font-family:${FONT};font-size:15px;font-weight:600;line-height:22px;color:${C.inchiostro};vertical-align:top;word-break:break-word;">${escapaHtml(r.valore)}</td>` +
        `</tr>`
    )
    .join("\n");
  return [
    `<tr><td class="lato" style="padding:20px 40px 0 40px;">`,
    `<table role="presentation" class="incavo filo" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.incavo};border:1px solid ${C.filo};border-radius:12px;">`,
    `<tr><td style="padding:16px 18px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
    celle,
    `</table>`,
    `</td></tr></table>`,
    `</td></tr>`,
  ].join("\n");
}

function azioneHtml(azione: AzioneEmail): string {
  const href = escapaHtml(assicuraIndirizzoWeb(azione.href));
  const etichetta = escapaHtml(azione.etichetta);
  return [
    `<tr><td class="lato" align="center" style="padding:26px 40px 0 40px;">`,
    `<!--[if mso]>`,
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:50px;v-text-anchor:middle;width:320px;" arcsize="24%" stroke="f" fillcolor="${C.brand}">`,
    `<w:anchorlock/>`,
    `<center style="color:${C.suBrand};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${etichetta}</center>`,
    `</v:roundrect>`,
    `<![endif]-->`,
    `<!--[if !mso]><!-->`,
    `<a class="bottone" href="${href}" style="display:inline-block;background-color:${C.brand};color:${C.suBrand};font-family:${FONT};font-size:16px;font-weight:700;line-height:22px;text-decoration:none;padding:14px 30px;border-radius:12px;text-align:center;">${etichetta}</a>`,
    `<!--<![endif]-->`,
    `</td></tr>`,
    `<tr><td class="lato" style="padding:16px 40px 0 40px;">`,
    `<p class="smorzato" style="margin:0 0 4px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.smorzato};">Se il bottone non si apre, copia questo indirizzo nel browser:</p>`,
    `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;word-break:break-all;"><a href="${href}" style="color:${C.brand};">${href}</a></p>`,
    `</td></tr>`,
  ].join("\n");
}

function piedeHtml(note: string[], contatto?: string): string {
  const righeNote = note
    .map(
      n =>
        `<p class="smorzato" style="margin:0 0 8px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.smorzato};">${escapaHtml(n)}</p>`
    )
    .join("\n");
  const firma = contatto
    ? `Wyndoor · Gestionale commesse infissi · <a href="mailto:${escapaHtml(contatto)}" style="color:${C.smorzato};">${escapaHtml(contatto)}</a>`
    : `Wyndoor · Gestionale commesse infissi`;
  return [
    `<tr><td class="lato" style="padding:26px 40px 0 40px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="filo" style="border-top:1px solid ${C.filo};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>`,
    `</td></tr>`,
    `<tr><td class="lato" style="padding:18px 40px 28px 40px;">`,
    righeNote,
    `<p class="smorzato" style="margin:12px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.smorzato};">${firma}</p>`,
    `</td></tr>`,
  ].join("\n");
}

/**
 * Il documento HTML e la versione testo dello stesso contenuto.
 * Lancia solo su un `azione.href` che non sia http o https.
 */
export function componiEmail(c: ContenutoEmail): {
  html: string;
  testo: string;
} {
  const paragrafi = c.paragrafi
    .map(
      p =>
        `<p class="inchiostro" style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${C.inchiostro};">${escapaHtml(p)}</p>`
    )
    .join("\n");

  const html = [
    `<!doctype html>`,
    `<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="x-apple-disable-message-reformatting">`,
    `<meta name="color-scheme" content="light dark">`,
    `<meta name="supported-color-schemes" content="light dark">`,
    `<title>${escapaHtml(c.titolo)}</title>`,
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->`,
    foglio(),
    `</head>`,
    `<body class="sfondo" style="margin:0;padding:0;width:100%;background-color:${C.canvas};">`,
    // Il preheader: nascosto nella pagina, letto dall'elenco dei messaggi. I
    // caratteri invisibili in coda spingono via il testo che seguirebbe,
    // altrimenti l'anteprima continuerebbe con «Ciao Mario, …».
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};opacity:0;">${escapaHtml(c.preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`,
    `<table role="presentation" class="sfondo" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.canvas};">`,
    `<tr><td align="center" style="padding:32px 16px;">`,
    `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->`,
    `<table role="presentation" class="foglio" align="center" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${C.superficie};border:1px solid ${C.filo};border-radius:16px;overflow:hidden;">`,
    `<tr><td class="filoAlto" style="height:4px;line-height:4px;font-size:0;background-color:${C.brand};">&nbsp;</td></tr>`,
    intestazione(c.baseUrl),
    `<tr><td class="lato" style="padding:18px 40px 0 40px;">`,
    c.saluto
      ? `<p class="smorzato" style="margin:0 0 6px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.smorzato};">${escapaHtml(c.saluto)},</p>`
      : "",
    `<h1 class="titolo inchiostro" style="margin:0 0 14px 0;font-family:${FONT};font-size:27px;line-height:34px;font-weight:800;letter-spacing:-0.02em;color:${C.inchiostro};">${escapaHtml(c.titolo)}</h1>`,
    paragrafi,
    `</td></tr>`,
    c.scheda?.length ? schedaHtml(c.scheda) : "",
    c.azione ? azioneHtml(c.azione) : "",
    piedeHtml(c.note ?? [], c.contatto),
    `</table>`,
    `<!--[if mso]></td></tr></table><![endif]-->`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ]
    .filter(riga => riga !== "")
    .join("\n");

  const righeTesto: string[] = [];
  if (c.saluto) righeTesto.push(`${c.saluto},`, "");
  righeTesto.push(c.titolo, "");
  for (const p of c.paragrafi) righeTesto.push(p, "");
  if (c.scheda?.length) {
    for (const r of c.scheda) righeTesto.push(`${r.voce}: ${r.valore}`);
    righeTesto.push("");
  }
  if (c.azione) {
    righeTesto.push(
      `${c.azione.etichetta}:`,
      assicuraIndirizzoWeb(c.azione.href),
      ""
    );
  }
  for (const n of c.note ?? []) righeTesto.push(n, "");
  righeTesto.push("--");
  righeTesto.push("Wyndoor · Gestionale commesse infissi");
  if (c.contatto) righeTesto.push(c.contatto);

  return { html, testo: righeTesto.join("\n") };
}
