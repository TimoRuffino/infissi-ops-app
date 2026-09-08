/**
 * Identità del prodotto.
 *
 * Serve alle sole stringhe costruite a runtime — intestazioni ICS, titolo
 * delle notifiche push, firma dei PDF di backup, fonti citate da Tars — dove
 * il nome viene concatenato e dimenticarne una è facile.
 *
 * Nel JSX e nei documenti si scrive «Wyndoor» in chiaro: una costante infilata
 * dentro una frase di interfaccia peggiora la leggibilità senza aggiungere
 * sicurezza.
 */
export const PRODOTTO = "Wyndoor";

export const PRODOTTO_PAYOFF = "Gestionale commesse infissi";
