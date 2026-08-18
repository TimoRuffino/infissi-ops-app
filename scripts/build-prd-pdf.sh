#!/usr/bin/env bash
# Build PRD_infissi_ops_v4.pdf from documento_requisiti_infissi_ops.md.
#
# Pipeline:
#   1) Convert markdown → HTML via the `marked` CLI (npx, no install).
#   2) Wrap the HTML body in a styled A4 template (CSS in this file).
#   3) Render the HTML to PDF with headless Chrome.
#
# Requirements:
#   - Node + npx in PATH (for `marked`).
#   - Google Chrome installed at the standard macOS path.
#
# Re-run any time after editing the markdown PRD to refresh the PDF.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MD="$ROOT/documento_requisiti_infissi_ops.md"
OUT="$ROOT/PRD_infissi_ops_v4.pdf"
TMP="$ROOT/tmp/prd-build"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -f "$MD" ]]; then
  echo "PRD markdown not found: $MD" >&2
  exit 1
fi
if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome not found at $CHROME" >&2
  exit 1
fi

mkdir -p "$TMP"

echo "[prd-pdf] markdown → html (marked)"
npx --yes marked@13 -i "$MD" > "$TMP/body.html"

cat > "$TMP/head.html" <<'HEAD'
<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>PRD — Ruffino Flow v4.5</title>
<style>
  @page { size: A4; margin: 1.6cm 1.4cm; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #111;
  }
  body { font-size: 10.5pt; line-height: 1.5; }
  h1 {
    font-size: 22pt;
    border-bottom: 2px solid #f59e0b;
    padding-bottom: 0.3em;
    margin-top: 1.2em;
  }
  h1:first-of-type { margin-top: 0; }
  h2 {
    font-size: 16pt;
    margin-top: 1.4em;
    color: #b45309;
    border-bottom: 1px solid #fde68a;
    padding-bottom: 0.2em;
    page-break-after: avoid;
  }
  h3 { font-size: 12.5pt; margin-top: 1em; color: #92400e; page-break-after: avoid; }
  h4 { font-size: 11pt; color: #78350f; page-break-after: avoid; }
  p, li { hyphens: auto; }
  ul, ol { padding-left: 1.4em; }
  table {
    border-collapse: collapse;
    margin: 0.6em 0;
    width: 100%;
    font-size: 9.5pt;
  }
  th, td {
    border: 1px solid #e5e7eb;
    padding: 0.35em 0.55em;
    vertical-align: top;
  }
  th { background: #fef3c7; text-align: left; }
  code {
    background: #f4f4f5;
    padding: 0.05em 0.3em;
    border-radius: 3px;
    font-size: 0.92em;
  }
  pre {
    background: #f4f4f5;
    padding: 0.7em;
    border-radius: 5px;
    overflow-x: auto;
    font-size: 9pt;
  }
  pre code { background: transparent; padding: 0; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
  blockquote {
    border-left: 3px solid #f59e0b;
    margin: 0.6em 0;
    padding: 0.2em 0.8em;
    color: #555;
    background: #fffbeb;
  }
  strong { color: #111; }
</style>
</head>
<body>
HEAD

cat > "$TMP/tail.html" <<'TAIL'
</body>
</html>
TAIL

cat "$TMP/head.html" "$TMP/body.html" "$TMP/tail.html" > "$TMP/prd.html"

echo "[prd-pdf] html → pdf (chrome headless)"
"$CHROME" \
  --headless=new \
  --disable-gpu \
  --no-pdf-header-footer \
  --print-to-pdf="$OUT" \
  "file://$TMP/prd.html"

echo "[prd-pdf] done → $OUT"
