#!/usr/bin/env bash
# Empaquette, installe et lance une app Tizen sur la TV.
# Usage : poc/deploy-tv.sh [dossier_app] [profil_certificat]
#   ex. : poc/deploy-tv.sh poc/tizen-probe
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$(cd "${1:-$ROOT/poc/tizen-player}" && pwd)"
PROFILE="${2:-c411free}"
TV_IP="${TV_IP:-TV_IP}"
TIZEN_HOME="${TIZEN_HOME:-$HOME/tizen-studio-cli}"
export PATH="$TIZEN_HOME/tools:$TIZEN_HOME/tools/ide/bin:$PATH"

APP_ID="$(grep -o 'tizen:application id="[^"]*"' "$APP_DIR/config.xml" | cut -d'"' -f2)"
PKG_ID="${APP_ID%%.*}"
SERIAL="${TV_IP}:26101"
REMOTE="/home/owner/share/tmp/sdk_tools/tmp/${PKG_ID}.wgt"

echo "🔌 Connexion à la TV ${TV_IP}…"
sdb connect "$TV_IP" >/dev/null 2>&1 || true
sdb devices | grep -q "^${SERIAL}" || { echo "❌ TV non connectée (mode développeur, IP du Mac, redémarrage complet ?)"; exit 1; }

if [ -f "$APP_DIR/.needs-secrets" ]; then
  node "$ROOT/poc/make-secrets.mjs" "$APP_DIR"
fi

echo "📦 Empaquetage de ${APP_ID} (profil « ${PROFILE} »)…"
BUILD="$(mktemp -d)"
cp -R "$APP_DIR"/. "$BUILD"/
rm -f "$BUILD/.needs-secrets"
tizen package -t wgt -s "$PROFILE" -- "$BUILD" | grep -E "Package File|ERROR|rror" || true
# Le nom généré peut contenir des espaces, mal gérées par l'installeur de la TV
WGT="$BUILD/${PKG_ID}.wgt"
mv "$(ls "$BUILD"/*.wgt | head -1)" "$WGT"

echo "📲 Installation…"
sdb -s "$SERIAL" push "$WGT" "$REMOTE" >/dev/null
sdb -s "$SERIAL" shell 0 vd_appinstall "$PKG_ID" "$REMOTE" | tail -1
rm -rf "$BUILD"

echo "▶️  Lancement…"
sdb -s "$SERIAL" shell 0 was_execute "$APP_ID" | tail -1
