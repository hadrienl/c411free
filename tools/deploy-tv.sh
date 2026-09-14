#!/usr/bin/env bash
# Génère la configuration, empaquette, installe et lance l'app C411free sur la TV.
# Usage : tools/deploy-tv.sh [profil_certificat]          (ou npm run deploy)
#   DEBUG_LOG=1 tools/deploy-tv.sh → journal de débogage envoyé à ce Mac (npm run deploy:debug, puis npm run logs)
# Variables : TV_IP (secrets/local.env), TIZEN_HOME (~/tizen-studio-cli), LOG_HOST (IP du Mac, détectée), LOG_PORT (8765)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/app"
PROFILE="${1:-c411free}"
# Réglages propres à l'installation (IP de la TV…) : secrets/local.env, non versionné (modèle : tools/local.env.example)
if [ -f "$ROOT/secrets/local.env" ]; then . "$ROOT/secrets/local.env"; fi
TV_IP="${TV_IP:?Définissez TV_IP dans secrets/local.env (voir tools/local.env.example)}"
TIZEN_HOME="${TIZEN_HOME:-$HOME/tizen-studio-cli}"
export PATH="$TIZEN_HOME/tools:$TIZEN_HOME/tools/ide/bin:$PATH"

APP_ID="$(grep -o 'tizen:application id="[^"]*"' "$APP_DIR/config.xml" | cut -d'"' -f2)"
PKG_ID="${APP_ID%%.*}"
SERIAL="${TV_IP}:26101"
REMOTE="/home/owner/share/tmp/sdk_tools/tmp/${PKG_ID}.wgt"

echo "🔌 Connexion à la TV ${TV_IP}…"
sdb connect "$TV_IP" >/dev/null 2>&1 || true
sdb devices | grep -q "^${SERIAL}" || { echo "❌ TV non connectée (mode développeur, IP du Mac, redémarrage complet ?)"; exit 1; }

DEBUG_LOG_URL=""
if [ "${DEBUG_LOG:-0}" = 1 ]; then
  LOG_HOST="${LOG_HOST:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}"
  [ -n "$LOG_HOST" ] || { echo "❌ IP du Mac introuvable : définissez LOG_HOST"; exit 1; }
  DEBUG_LOG_URL="http://${LOG_HOST}:${LOG_PORT:-8765}/log"
  echo "📡 Journal de débogage → ${DEBUG_LOG_URL} (npm run logs)"
fi

echo "📦 Empaquetage de ${APP_ID} (profil « ${PROFILE} »)…"
# Copie de travail : la configuration (secrets) n'est écrite que dans le paquet, jamais dans app/
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
cp -R "$APP_DIR"/. "$BUILD"/
DEBUG_LOG_URL="$DEBUG_LOG_URL" node "$ROOT/tools/make-config.mjs" "$BUILD/config.js"
tizen package -t wgt -s "$PROFILE" -- "$BUILD" | grep -E "Package File|ERROR|rror" || true
# Le nom généré peut contenir des espaces, mal gérées par l'installeur de la TV
WGT="$BUILD/${PKG_ID}.wgt"
mv "$(ls "$BUILD"/*.wgt | head -1)" "$WGT"

echo "📲 Installation…"
sdb -s "$SERIAL" push "$WGT" "$REMOTE" >/dev/null
# Verdict de la TV affiché : une installation refusée (ex. « Author certificate not match ») ne doit pas passer inaperçue
INSTALL="$(sdb -s "$SERIAL" shell 0 vd_appinstall "$PKG_ID" "$REMOTE" 2>&1)"
echo "$INSTALL" | grep -E "install (completed|failed)|reason" | tail -2
if ! echo "$INSTALL" | grep -q "install completed"; then echo "❌ Installation refusée par la TV"; exit 1; fi

echo "▶️  Lancement…"
sdb -s "$SERIAL" shell 0 was_execute "$APP_ID" | tail -1
