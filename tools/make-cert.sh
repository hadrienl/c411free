#!/usr/bin/env bash
# Génère les certificats Samsung (auteur + distributeur liés au DUID de la TV)
# avec l'outil tizencertificates, dans Docker.
# Usage : tools/make-cert.sh <email_compte_samsung>
set -euo pipefail

EMAIL="${1:?Usage : tools/make-cert.sh <email_compte_samsung>}"
DUID="${DUID:-TV_DUID}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/secrets/tizen-cert"
PASSWORD="$(cat "$ROOT/secrets/tizen-cert.password")"
LOGIN_URL="https://account.samsung.com/mobile/account/check.do?serviceID=v285zxnl3h&actionID=StartOAuth2&accessToken=Y&redirect_uri=http://localhost:4794/signin/callback"

mkdir -p "$WORK"
rm -f "$WORK"/certificates/*.p12

echo "🔐 Serveur de certificats sur http://localhost:4794 (TV $DUID, compte $EMAIL)"
echo "👉 Connectez-vous à votre compte Samsung dans le navigateur qui s'ouvre."
(sleep 4 && open "$LOGIN_URL") &

# Port publié sur 127.0.0.1 uniquement : le serveur n'est pas exposé sur le réseau local
docker run --rm --name c411free-tizencert \
  -p 127.0.0.1:4794:4794 \
  -v "$WORK":/work \
  c411free-tizencert tv --device-id "$DUID" --email "$EMAIL" --cert-password "$PASSWORD"
