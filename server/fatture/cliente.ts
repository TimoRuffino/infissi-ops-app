// server/fatture/cliente.ts
// Lo snapshot del cliente sulla fattura e i controlli anagrafici che la
// fattura elettronica richiede. Lo snapshot è una fotografia: la fattura
// deve restare leggibile com'era anche se l'anagrafica cambia dopo
// l'emissione. Funzioni pure: il servizio (servizio.ts) le chiama e
// persiste.
import { codiceFiscaleValido, normalizzaProvincia, partitaIvaValida } from "@shared/fatturazione/fiscale";
import { PRATICHE_EDILIZIE, type ClienteSnapshot, type Fattura, type PraticaEdilizia } from "@shared/fatturazione/tipi";
import type { Controllo } from "./servizio";

/** La pratica edilizia com'è in anagrafica: i record che non l'hanno mai avuta (o portano un valore che il CRM non conosce più) valgono "nessuna". */
function praticaEdiliziaDi(valore: unknown): PraticaEdilizia {
  return PRATICHE_EDILIZIE.includes(valore as PraticaEdilizia) ? (valore as PraticaEdilizia) : "nessuna";
}

/**
 * Il nome del cliente segue la convenzione del CRM (requisiti §5.2, come
 * `clienteDisplay` in `server/routers/commesse.ts`): per aziende,
 * condomini ed enti la denominazione sta indivisa in `cognome` e `nome` è
 * uno spazio, quindi `"${cognome} ${nome}".trim()` la ricompone senza
 * spezzarla. `ragioneSociale`, quando c'è (record arrivati da import o
 * sincronizzazioni), ha comunque la precedenza; l'ultima risorsa è il
 * nome già scritto sulla commessa.
 */
export function snapshotCliente(
  cliente: any | null,
  commessa: { cliente?: string | null; indirizzo?: string | null; citta?: string | null }
): ClienteSnapshot {
  const tipo = (cliente?.tipo ?? "privato") as ClienteSnapshot["tipo"];
  const ragione = String(cliente?.ragioneSociale ?? "").trim();
  const nome =
    ragione ||
    `${cliente?.cognome ?? ""} ${cliente?.nome ?? ""}`.trim() ||
    String(commessa.cliente ?? "").trim();
  // La città in anagrafica arriva spesso come «Sarzana (SP)»: la sigla
  // finisce in `provincia` e il nome resta pulito per la fattura.
  const citta = String(cliente?.citta ?? commessa.citta ?? "").trim();
  return {
    clienteId: cliente?.id ?? null,
    nome,
    tipo,
    codiceFiscale: cliente?.codiceFiscale ? String(cliente.codiceFiscale).trim().toUpperCase() : null,
    partitaIva: cliente?.partitaIva ? String(cliente.partitaIva).trim() : null,
    indirizzo: String(cliente?.indirizzo ?? commessa.indirizzo ?? "").trim(),
    cap: String(cliente?.cap ?? "").trim(),
    citta: citta.replace(/\s*\([A-Za-z]{2}\)\s*$/, ""),
    provincia: normalizzaProvincia(citta) ?? "",
    email: cliente?.email ?? null,
    pec: cliente?.pec ?? null,
    // "0000000" è il recapito SdI dei privati senza PEC: assente non è un
    // errore, è il default previsto dal tracciato.
    codiceDestinatario: String(cliente?.codiceDestinatario ?? "0000000").trim().toUpperCase(),
    ficEntityId: cliente?.ficEntityId ?? null,
    praticaEdilizia: praticaEdiliziaDi(cliente?.praticaEdilizia),
  };
}

/**
 * Cosa manca all'anagrafica perché la fattura elettronica passi (spec
 * §7.4). Solo errori: quello che non blocca l'emissione non è un
 * controllo di questa funzione. Con l'anagrafica in regola torna un
 * singolo esito «ok», così la UI ha sempre qualcosa da mostrare.
 */
export function controlliCliente(s: ClienteSnapshot, detrazioneTipo: Fattura["detrazioneTipo"]): Controllo[] {
  const c: Controllo[] = [];
  const errore = (codice: string, messaggio: string) => c.push({ codice, esito: "errore", messaggio });
  if (!s.nome) errore("cliente_nome", "Cliente senza nome.");
  if (!s.indirizzo) errore("cliente_indirizzo", "Indirizzo del cliente mancante.");
  if (!/^\d{5}$/.test(s.cap)) errore("cliente_cap", "CAP del cliente mancante o non valido.");
  if (!s.citta) errore("cliente_citta", "Città del cliente mancante.");
  if (!/^[A-Z]{2}$/.test(s.provincia)) {
    errore("cliente_provincia", "Provincia del cliente mancante (sigla di due lettere).");
  }
  if (s.tipo === "privato") {
    if (!s.codiceFiscale || !codiceFiscaleValido(s.codiceFiscale)) {
      errore("cliente_cf", "Codice fiscale mancante o non valido.");
    }
  } else {
    const pivaOk = !!s.partitaIva && partitaIvaValida(s.partitaIva);
    // Un condominio non ha partita IVA: il suo codice fiscale numerico a
    // 11 cifre è il codice identificativo che lo SdI accetta.
    const cfNumerico = !!s.codiceFiscale && /^\d{11}$/.test(s.codiceFiscale);
    if (!pivaOk && !(s.tipo === "condominio" && cfNumerico)) {
      errore("cliente_piva", "Partita IVA mancante o non valida.");
    }
    if (!(s.codiceDestinatario.length === 7 && s.codiceDestinatario !== "0000000") && !s.pec) {
      errore("cliente_sdi", "Serve il codice destinatario SdI (7 caratteri) o la PEC.");
    }
  }
  if (detrazioneTipo !== "nessuna" && !s.codiceFiscale) {
    errore("cliente_cf_bonus", "Con la detrazione il codice fiscale è obbligatorio.");
  }
  if (c.length === 0) {
    c.push({ codice: "cliente", esito: "ok", messaggio: "Anagrafica completa per la fattura elettronica." });
  }
  return c;
}
