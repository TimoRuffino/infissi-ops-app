type WyndoorMarkProps = {
  /** Lato in pixel. Sotto i 16 il segno non è più leggibile. */
  size?: number;
  className?: string;
  /**
   * Nome accessibile. Ometterlo rende il segno decorativo, che è giusto
   * quando accanto c'è già la parola «Wyndoor» come testo.
   */
  title?: string;
};

/**
 * Il segno Wyndoor: l'anta fissa e l'anta in apertura, viste in prospettiva.
 * Geometria canonica nella spec del 07/09/2026, Appendice A.
 *
 * L'anta fissa prende `currentColor`: chi lo ospita decide il colore passando
 * un `className`, normalmente `text-brand-mark` (il colore normativo
 * dell'anta fissa, spec §3.3 — mai `text-primary`: in Modular Control
 * `--primary` è un altro borgogna, `--primitive-brand`, e monterebbe il
 * marchio in un colore diverso da sistema a sistema). L'anta in apertura
 * prende `--brand-accent` direttamente, che cambia da sé fra chiaro e scuro
 * e non dipende dal `className` dell'elemento. Nessun filtro CSS deve
 * toccare questo elemento: il vecchio `.sidebar-logo` faceva
 * `filter: brightness(0)` e appiattiva il marchio a silhouette, cancellando
 * il colore — ma teneva anche il logo leggibile sopra la barra laterale
 * verde, forzandolo a bianco pieno.
 *
 * La variante a una tinta sola — timbri, stampa in bianco e nero, fondi
 * pieni, o un fondo (come la barra legacy) dove il borgogna normativo non
 * regge il contrasto — non ha bisogno di una prop: basta ridefinire
 * `--brand-accent` a `currentColor` sull'elemento che ospita il segno. Se
 * quell'elemento (o `WyndoorLockup`) ha già applicato `text-brand-mark`
 * all'anta fissa, va ridefinito anche `--brand-mark` allo stesso modo.
 * `text-brand-mark` compila come `color: var(--brand-mark)`: `@theme inline`
 * fa sì che Tailwind inserisca il riferimento dichiarato in `:root`/`.dark`
 * direttamente nell'utility generata, invece di indirizzare a un token
 * `--color-brand-mark` intermedio — verificato sul CSS compilato, non solo
 * letto sulla carta. Per questo ridefinire `--brand-mark` qui è sufficiente
 * ed è risolto dal vivo nel punto d'uso, non dove `--brand-mark` è
 * dichiarato:
 *
 *     <span
 *       style={{
 *         "--brand-mark": "currentColor",
 *         "--brand-accent": "currentColor",
 *       } as CSSProperties}
 *     >
 *       <WyndoorLockup />
 *     </span>
 *
 * Le due ante restano separate dal solo varco: è la stessa funzione che
 * svolgeva il filtro rimosso, non un ripiego. Esempio reale:
 * `LegacyDashboardLayout.tsx`, dove il marchio sta sulla barra verde.
 */
export function WyndoorMark({ size = 24, className, title }: WyndoorMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="9 5 82 90"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <rect x="12" y="16" width="27" height="68" rx="4" fill="currentColor" />
      <path
        fill="var(--brand-accent)"
        d="M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 L88 75.162 A4 4 0 0 1 85.321 78.938 L53.321 90.138 A4 4 0 0 1 48 86.362 L48 13.638 A4 4 0 0 1 53.321 9.862 Z"
      />
    </svg>
  );
}
