#!/usr/bin/env bash
# Enregistre les certificats générés comme profil de signature « c411free » dans la CLI tizen.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERTS="$ROOT/secrets/tizen-cert/certificates"
PASSWORD="$(cat "$ROOT/secrets/tizen-cert.password")"
PROFILE="${1:-c411free}"
TIZEN="${TIZEN_HOME:-$HOME/tizen-studio}/tools/ide/bin/tizen"

for f in author.p12 distributor.p12; do
  [ -s "$CERTS/$f" ] || { echo "❌ $CERTS/$f manquant : lancez d'abord poc/make-cert.sh"; exit 1; }
done

"$TIZEN" security-profiles remove -n "$PROFILE" >/dev/null 2>&1 || true
"$TIZEN" security-profiles add -n "$PROFILE" -A -f \
  -a "$CERTS/author.p12" -p "$PASSWORD" \
  -d "$CERTS/distributor.p12" -dp "$PASSWORD"
"$TIZEN" security-profiles list
