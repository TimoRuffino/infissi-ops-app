// Le aree delle evidenze della proposta di contratto (06/09/2026, anteprime
// «Dove l'ho letto»): ogni campo proposto con un'evidenza verificata riceve
// il riquadro, la riga e il contesto sulla pagina resa, dalla geometria del
// parser. Le evidenze dell'arricchimento WnD non hanno la posizione: si
// cercano per frammento. Non cambia un valore, non decide niente.

import type { GeometriaPagina } from "@shared/documenti/evidenze";
import type { CampoProposto, PropostaContratto, RigaProposta } from "@shared/contratti/estrazione";
import { annotaEvidenza } from "../../documenti/localizzatore";

export function annotaAreeProposta(
  proposta: PropostaContratto,
  geometria?: ReadonlyArray<GeometriaPagina | null>
): PropostaContratto {
  const campo = <T>(c: CampoProposto<T>): CampoProposto<T> =>
    c.evidenza
      ? { ...c, evidenza: { ...c.evidenza, area: annotaEvidenza(geometria, c.evidenza) } }
      : c;
  const riga = (r: RigaProposta): RigaProposta => ({
    ...r,
    categoria: campo(r.categoria),
    tipologia: campo(r.tipologia),
    descrizione: campo(r.descrizione),
    quantita: campo(r.quantita),
    larghezzaMm: campo(r.larghezzaMm),
    altezzaMm: campo(r.altezzaMm),
    prezzoTotCent: campo(r.prezzoTotCent),
    oscuranteIntegrato: campo(r.oscuranteIntegrato),
    oscuranteTipologia: campo(r.oscuranteTipologia),
  });
  return {
    ...proposta,
    righe: proposta.righe.map(riga),
    pattuitoCent: campo(proposta.pattuitoCent),
    pattuitoTipo: campo(proposta.pattuitoTipo),
    posaInclusa: campo(proposta.posaInclusa),
    posaCent: campo(proposta.posaCent),
    rate: campo(proposta.rate),
    comuneCantiere: campo(proposta.comuneCantiere),
    indirizzoCantiere: campo(proposta.indirizzoCantiere),
    piano: campo(proposta.piano),
    dataFirma: campo(proposta.dataFirma),
    riferimento: campo(proposta.riferimento),
    clienteCitato: campo(proposta.clienteCitato),
    detrazioneTipo: campo(proposta.detrazioneTipo),
  };
}
