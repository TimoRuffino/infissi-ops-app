type WyndorMarkProps = {
  /** Lato in pixel. Sotto i 16 il segno non è più leggibile. */
  size?: number;
  className?: string;
  /**
   * Nome accessibile. Ometterlo rende il segno decorativo, che è giusto
   * quando accanto c'è già la parola «Wyndor» come testo.
   */
  title?: string;
};

/**
 * Il segno Wyndor: l'anta fissa e l'anta in apertura, viste in prospettiva.
 * Geometria canonica nella spec del 07/09/2026, Appendice A.
 *
 * L'anta fissa prende `currentColor`, così il colore lo decide chi lo ospita;
 * quella in apertura prende `--brand-accent`, che cambia da sé fra chiaro e
 * scuro. Nessun filtro CSS deve toccare questo elemento: il vecchio
 * `.sidebar-logo` faceva `filter: brightness(0)` e appiattiva il marchio a
 * silhouette, cancellando il colore.
 *
 * La variante a una tinta sola — timbri, stampa in bianco e nero, fondi
 * pieni — non ha bisogno di una prop: basta ridefinire il token
 * sull'elemento che lo ospita, e le due ante restano separate dal solo varco.
 *
 *     <span style={{ "--brand-accent": "currentColor" } as CSSProperties}>
 *       <WyndorMark size={32} />
 *     </span>
 */
export function WyndorMark({ size = 24, className, title }: WyndorMarkProps) {
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
