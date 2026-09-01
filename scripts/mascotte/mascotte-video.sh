#!/bin/bash
# Catena video della mascotte Tars: da due MP4 opachi a un WebM con alpha.
#
# Higgsfield "scontorna" ma restituisce yuv420p, cioè il soggetto spalmato su
# nero: nessun canale alpha. Un key sulla luminanza non è praticabile perché
# lo schermo del volto è antracite e verrebbe bucato col fondo. Avendo però
# gli stessi fotogrammi su due fondi diversi, l'alpha si risolve esattamente
# (vedi scripts/mascotte/matte-da-coppia.mjs).
#
# Uso: mascotte-video.sh <dir-sorgenti> <dir-uscita>
# Attende in <dir-sorgenti>: <nome>-grigio.mp4 e <nome>-nero.mp4
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SRC="${1:?serve la cartella sorgenti}"
OUT="${2:?serve la cartella di uscita}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FONDO="219,215,211"   # colore del fondo nei render, campionato dall'angolo
NEUTRA="$(dirname "$0")/posa-neutra.png"  # posa di riposo: vedi «chiudi»
LARGHEZZA=360         # ~2.5x della resa a schermo (~140px)
FPS=24

# Le clip in loop non possono partire da un taglio qualunque: il video
# generato deriva lentamente, quindi l'ultimo fotogramma non ricongiunge mai
# il primo e a ogni giro si vede uno scatto. Due rimedi, secondo il modo:
#
#   avanti       si gioca una volta e basta: il taglio è libero
#   aggancia     come chiudi, ma anche in entrata: per le clip che non nascono
#                dal render della posa neutra
#   chiudi       come avanti, ma le ultime battute vengono fuse verso la posa
#                neutra. Il modello «torna in piedi» a fine clip senza però
#                atterrare sul fotogramma esatto da cui era partito, e al
#                rientro nell'idle restava un salto di ~20: quanto quello del
#                loop. Così invece l'ultimo fotogramma È dove l'idle ricomincia.
#   andirivieni  si gioca avanti e poi a ritroso, così l'ultimo fotogramma È
#                il primo e la cucitura vale zero per costruzione. Gli estremi
#                vanno scelti su fotogrammi quieti, o il giro di boa rimbalza.
#
# nome_uscita  clip_sorgente  inizio  durata  modo
SEGMENTI=(
  # Da fotogramma zero apposta: lì c'è la posa del render, la stessa da cui
  # parte e a cui torna ogni siparietto. Essendo ad andirivieni l'idle ci
  # comincia E ci finisce, così ogni giunzione fra clip cade sulla stessa
  # posa e non si vede nessun taglio. Il capo lontano (1.9s) è un fotogramma
  # quieto: è lì che il movimento inverte.
  "idle:idle:0:1.917:andirivieni"
  # Nascono da un render diverso e non partono dalla posa neutra. Agganciare
  # anche la TESTA però peggiora: fondere due pose diverse dà due corpi
  # sovrapposti e antenne doppie, un fantasma al posto di uno stacco netto.
  # Si aggancia solo la coda; l'entrata resta un cambio di posa vero, e per
  # quello la dissolvenza del player è il trattamento giusto.
  "evento:idle:3.20:6.60:chiudi"
  "indica:indica:1.567:2.833:andirivieni"
  "cartello:cartello:0.40:4.40:chiudi"
  # I siparietti nati dopo partono tutti dallo STESSO render in piedi, quindi
  # il loro primo fotogramma è già la posa neutra: si tagliano da 0 e tornano
  # da soli alla neutra in coda. È questo che li fa incatenare senza salti.
  "saluta:saluta:0:5.0:chiudi"
  "pensa:pensa:0:5.0:chiudi"
  "dorme:dorme:0:5.0:chiudi"
  "esulta:esulta:0:5.0:chiudi"
  "curioso:curioso:0:5.0:chiudi"
  "boxa:boxa:0:5.0:chiudi"
  "calcio:calcio:0:5.0:chiudi"
)

# Con un terzo argomento si rigenera solo quel segmento, senza rifare gli altri.
if [ -n "${3:-}" ]; then
  SOLO="$3"
  filtrati=()
  for r in "${SEGMENTI[@]}"; do
    [ "${r%%:*}" = "$SOLO" ] && filtrati+=("$r")
  done
  [ ${#filtrati[@]} -gt 0 ] || { echo "segmento sconosciuto: $SOLO"; exit 1; }
  SEGMENTI=("${filtrati[@]}")
fi

mkdir -p "$OUT"

for riga in "${SEGMENTI[@]}"; do
  IFS=':' read -r nome clip inizio durata modo <<< "$riga"
  echo "── $nome  (da $clip, ${inizio}s +${durata}s, $modo)"

  for fondo in grigio nero; do
    rm -rf "$TMP/$fondo"; mkdir -p "$TMP/$fondo"
    # Seek in uscita (dopo -i): è preciso al fotogramma, mentre il seek in
    # ingresso salta al keyframe e disallineerebbe le due versioni.
    ffmpeg -v error -i "$SRC/$clip-$fondo.mp4" -ss "$inizio" -t "$durata" \
      -vf "fps=$FPS,scale=$LARGHEZZA:-2" "$TMP/$fondo/%04d.png"
  done

  g=$(ls "$TMP/grigio" | wc -l | tr -d ' ')
  n=$(ls "$TMP/nero" | wc -l | tr -d ' ')
  [ "$g" = "$n" ] || { echo "   fotogrammi disallineati: grigio=$g nero=$n"; exit 1; }

  rm -rf "$TMP/rgba"; mkdir -p "$TMP/rgba"
  node "$(dirname "$0")/matte-da-coppia.mjs" "$TMP/grigio" "$TMP/nero" "$TMP/rgba" "$FONDO"

  # Andirivieni: si accoda la stessa sequenza a ritroso, senza ripetere i due
  # estremi (starebbero fermi un fotogramma in più a ogni giro di boa).
  case "$modo" in
    chiudi|aggancia)
      [ -f "$NEUTRA" ] || { echo "   manca la posa neutra: $NEUTRA"; exit 1; }
      dove=coda
      [ "$modo" = "aggancia" ] && dove=entrambi
      node "$(dirname "$0")/chiudi-sul-riposo.mjs" "$TMP/rgba" "$NEUTRA" 8 "$dove"
      ;;
  esac

  if [ "$modo" = "andirivieni" ]; then
    rm -rf "$TMP/loop"; mkdir -p "$TMP/loop"
    # niente mapfile: il bash di macOS è il 3.2 e non ce l'ha
    avanti=()
    while IFS= read -r f; do avanti+=("$f"); done < <(ls "$TMP/rgba"/*.png | sort)
    tot=${#avanti[@]}
    k=0
    for f in "${avanti[@]}"; do
      k=$((k + 1)); cp "$f" "$TMP/loop/$(printf '%04d' $k).png"
    done
    idx=$((tot - 2))
    while [ "$idx" -gt 0 ]; do
      k=$((k + 1)); cp "${avanti[$idx]}" "$TMP/loop/$(printf '%04d' $k).png"
      idx=$((idx - 1))
    done
    rm -rf "$TMP/rgba"; mv "$TMP/loop" "$TMP/rgba"
    echo "   andirivieni: $tot → $k fotogrammi"
  fi

  # yuva420p + alpha_mode nel contenitore + auto-alt-ref spento: senza tutti
  # e tre, libvpx scrive un VP9 valido ma senza alpha.
  ffmpeg -v error -y -framerate "$FPS" -i "$TMP/rgba/%04d.png" \
    -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 34 \
    -metadata:s:v:0 alpha_mode="1" -an "$OUT/$nome.webm"

  printf "   → %s  %s\n" "$nome.webm" "$(du -h "$OUT/$nome.webm" | cut -f1)"
done

echo "fatto."
