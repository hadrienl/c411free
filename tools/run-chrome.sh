#!/usr/bin/env bash
set -euo pipefail

# Lance C411free dans Google Chrome sur le Mac, en 1920×1080, avec la vraie configuration
# (clé c411, jeton Freebox) : pratique pour développer sans repasser par la TV à chaque fois.
# Ne modifie jamais app/ : on travaille sur une copie temporaire, comme tools/deploy-tv.sh.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/app"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "❌ Google Chrome introuvable dans /Applications"; exit 1; }

echo "📦 Préparation du paquet de développement…"
BUILD="${TMPDIR:-/tmp}/c411free-chrome"
rm -rf "$BUILD"
mkdir -p "$BUILD"
cp -R "$APP_DIR"/. "$BUILD"/
node "$ROOT/tools/make-config.mjs" "$BUILD/config.js"
cp "$ROOT/tools/desktop-shim.js" "$BUILD/desktop-shim.js"

# $WEBAPIS/webapis/webapis.js n'existe que sur la TV : dans Chrome il échoue en 404, autant l'enlever.
sed -i '' '\#<script src="\$WEBAPIS/webapis/webapis.js"></script>#d' "$BUILD/index.html"
# Le shim (clavier + stub tizen) doit être posé avant js/core.js pour que ses écouteurs, en phase
# de capture, s'exécutent avant ceux de js/nav.js.
sed -i '' 's#<script src="js/core.js"></script>#<script src="desktop-shim.js"></script>\
<script src="js/core.js"></script>#' "$BUILD/index.html"

grep -q 'desktop-shim.js' "$BUILD/index.html" || { echo "❌ Insertion du shim échouée"; exit 1; }
grep -q 'webapis.js' "$BUILD/index.html" && { echo "❌ Retrait de webapis.js échoué"; exit 1; }

# Profil Chrome dédié et persistant (hors de $BUILD, qui est recréé à chaque lancement) : garde le
# localStorage (profils, vus, reprises…) d'une session à l'autre, comme le stockage de l'app sur la TV.
PROFILE_DIR="$HOME/Library/Application Support/c411free-chrome"
mkdir -p "$PROFILE_DIR"

# file:// est un contexte sécurisé sous Chrome (vérifié : window.isSecureContext vaut true, crypto.subtle
# est disponible), nécessaire à la session Freebox (HMAC via SubtleCrypto). Pas besoin de serveur local.
# --disable-web-security contourne CORS vers c411 et la Freebox, exactement comme l'app privilégiée sur la
# TV : c'est pour ça qu'on utilise un profil dédié, à ne jamais utiliser pour naviguer ailleurs.
echo "🚀 Lancement de Chrome…"
open -na "Google Chrome" --args \
  --user-data-dir="$PROFILE_DIR" \
  --disable-web-security \
  --window-size=1920,1080 \
  --window-position=0,0 \
  --no-first-run \
  --no-default-browser-check \
  --app="file://$BUILD/index.html"

cat <<'EOF'

Touches :
  Flèches      → déplacement
  Entrée       → OK
  Échap        → RETOUR
EOF
