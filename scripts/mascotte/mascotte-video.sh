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
LARGHEZZA=360         # ~2.5x della resa a schermo (~140px)
FPS=24

# nome_uscita  clip_sorgente  inizio  durata
SEGMENTI=(
  "idle:idle:0.30:2.90"
  "evento:idle:3.20:6.60"
  "indica:indica:0.40:4.40"
  "cartello:cartello:0.40:4.40"
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
  IFS=':' read -r nome clip inizio durata <<< "$riga"
  echo "── $nome  (da $clip, ${inizio}s +${durata}s)"

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

  # yuva420p + alpha_mode nel contenitore + auto-alt-ref spento: senza tutti
  # e tre, libvpx scrive un VP9 valido ma senza alpha.
  ffmpeg -v error -y -framerate "$FPS" -i "$TMP/rgba/%04d.png" \
    -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 34 \
    -metadata:s:v:0 alpha_mode="1" -an "$OUT/$nome.webm"

  printf "   → %s  %s\n" "$nome.webm" "$(du -h "$OUT/$nome.webm" | cut -f1)"
done

echo "fatto."
