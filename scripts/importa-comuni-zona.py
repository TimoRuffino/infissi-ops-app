#!/usr/bin/env python3
# scripts/importa-comuni-zona.py — una tantum.
#
# Fonte: non esiste un CSV ENEA/BibLus scaricabile qui (rete non disponibile
# per questo agente); la fonte è il PDF pubblico dell'Allegato A del DPR
# 412/93 (Tabella A, gradi/giorno dei Comuni italiani), reperito da:
#   https://stem.elearning.unipd.it/pluginfile.php/462059/mod_resource/content/1/dpr412-93_allA_tabellagradigiorno.pdf
#
# Il PDF elenca i Comuni per Regione/Provincia con righe del tipo:
#   "PR Z GRADI ALT Nome del comune"   es. "TO E 2748 260 Borgomasino"
# più intestazioni ripetute ("pr z gr-g alt comune"), note a piè di pagina
# numerate ("(31)", "(31) Così sostituito dal D.M. ...") e, occasionalmente,
# nomi di comune spezzati su due righe da un salto pagina o da un a-capo di
# impaginazione (es. "Santo Stefano in" / "Aspromonte").
#
# pypdf.extract_text(extraction_mode="layout") preserva l'ordine visivo delle
# colonne (la modalità di default confonde l'ordine quando ci sono molte note
# a piè di pagina sulla stessa pagina, es. pag. 32 del PDF).
#
# Uso: python3 scripts/importa-comuni-zona.py tabellaA.pdf
import json
import re
import sys
import unicodedata

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("serve pypdf: pip install pypdf")

if len(sys.argv) < 2:
    sys.exit("uso: importa-comuni-zona.py <tabellaA.pdf>")


def norm(s: str) -> str:
    """Stessa normalizzazione di normalizzaNomeComune() in server/computo/zone.ts."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(s.lower().replace("'", " ").replace("-", " ").split())


RIGA = re.compile(r"^\s*([A-Za-z]{2,3})\s+([A-F])\s+(\S+)\s+(\S+)\s+(\S.*\S|\S)\s*$")
# Riga con la stessa forma ma senza la zona (difetto di estrazione isolato,
# es. "MT 1885 548 Irsina" a pag. 128 del PDF: la colonna Z è andata persa).
RIGA_SENZA_ZONA = re.compile(r"^\s*([A-Za-z]{2,3})\s+(\d+)\s+(\d+)\s+(\S.*\S|\S)\s*$")
# Continuazione di un nome di comune spezzato su due righe: solo lettere,
# apostrofi e spazi, eventualmente seguita da un rimando a nota "(NN)".
CONTINUAZIONE_NOME = re.compile(r"^[A-ZÀ-Ý][A-Za-zÀ-ÿ' ]*(\(\d+\))?$")
NOTA_A_PIE_PAGINA = re.compile(r"^\(\d+\)")
FOOTER_PARENTESI = re.compile(r"\s*\(\d+\)\s*$")

INTESTAZIONI_STATICHE = (
    "allegato a",
    "tabella dei gradi",
    "note:",
    "legenda:",
    "pr = provincia",
    "z = zona",
    "gr-g = gradi",
    "alt = altezza",
)

# Difetti di estrazione isolati e verificati a mano contro le righe vicine
# nella stessa tabella (stessa provincia, gradi/giorno coerenti con i comuni
# alfabeticamente adiacenti). Chiave: (provincia, nome normalizzato).
CORREZIONI_ZONA = {
    ("MT", "irsina"): "D",  # tra Grottole (D) e Matera (D), 1885 GG coerente con D
}

# Sigle di provincia mal estratte dal PDF (glifo ambiguo): "Bl" (minuscolo)
# precede in tabella la sola voce di Miagliano, appesa subito dopo la
# provincia di Vercelli — Biella (BI) fu scorporata da Vercelli nel 1992 e
# aggiunta in coda alla tabella originale; non è la Belluno (BL) del Veneto,
# che compare altrove nel documento sempre con sigla maiuscola corretta.
CORREZIONI_PROVINCIA = {
    "Bl": "BI",
}


def riga_di_intestazione_o_nota(collassata: str) -> bool:
    if NOTA_A_PIE_PAGINA.match(collassata):
        return True
    for prefisso in INTESTAZIONI_STATICHE:
        if collassata.lower().startswith(prefisso):
            return True
    if collassata.lower().replace("  ", " ").startswith("pr z"):
        return True
    return False


def numero(token: str) -> int:
    return int(token.replace("O", "0").replace("°", "0"))


def provincia_di(pr: str) -> str:
    return CORREZIONI_PROVINCIA.get(pr, pr).upper()


reader = PdfReader(sys.argv[1])
righe = []
for pagina in reader.pages:
    testo = pagina.extract_text(extraction_mode="layout") or ""
    righe.extend(testo.split("\n"))

record = []
avvisi = []
ultimo = None
for grezza in righe:
    riga = grezza.strip()
    if not riga:
        continue
    collassata = re.sub(r"\s+", " ", riga)

    m = RIGA.match(riga)
    if m:
        pr, z, gg, alt, nome = m.groups()
        ultimo = {
            "provincia": provincia_di(pr),
            "zona": z,
            "gradiGiorno": gg,
            "nome": FOOTER_PARENTESI.sub("", nome).strip(),
        }
        record.append(ultimo)
        continue

    if riga_di_intestazione_o_nota(collassata):
        continue

    m = RIGA_SENZA_ZONA.match(riga)
    if m:
        pr, gg, alt, nome = m.groups()
        nome_pulito = FOOTER_PARENTESI.sub("", nome).strip()
        zona = CORREZIONI_ZONA.get((provincia_di(pr), norm(nome_pulito)))
        if zona is None:
            avvisi.append(f"zona mancante e non corretta a mano: {riga!r}")
            continue
        ultimo = {
            "provincia": provincia_di(pr),
            "zona": zona,
            "gradiGiorno": gg,
            "nome": nome_pulito,
        }
        record.append(ultimo)
        continue

    if CONTINUAZIONE_NOME.match(collassata) and ultimo is not None:
        # Nome di comune spezzato su due righe (a-capo o salto pagina):
        # es. "Sant'Angelo di Piove di" + "Sacco", "Santo Stefano in" + "Aspromonte".
        pezzo = FOOTER_PARENTESI.sub("", collassata).strip()
        ultimo["nome"] = f"{ultimo['nome']} {pezzo}".strip()
        continue

    avvisi.append(f"riga non riconosciuta, scartata: {riga!r}")

for avviso in avvisi:
    print(f"AVVISO: {avviso}", file=sys.stderr)

out, visti = [], set()
for r in record:
    zona = r["zona"].strip().upper()[:1]
    if zona not in "ABCDEF":
        continue
    chiave = (norm(r["nome"]), norm(r["provincia"]))
    if chiave in visti:
        continue
    visti.add(chiave)
    out.append(
        {
            "codiceIstat": None,
            "nome": r["nome"],
            "provincia": r["provincia"],
            "regione": "",
            "zona": zona,
            "gradiGiorno": numero(r["gradiGiorno"]),
        }
    )

assert len(out) > 7000, len(out)

with open("shared/limiti/comuni-zona.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

print(len(out), "comuni")
