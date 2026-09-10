#!/usr/bin/env bash
# Upgrade a running dayMarkable VPS to the latest main and switch it to the two-host layout
# (public site on daymarkable.com, service on app.daymarkable.com). Idempotent; safe to rerun.
#
#   ssh root@<vps>  'bash -s' < scripts/vps-upgrade.sh
#   # or on the box:  cd /root/daymarkable && bash scripts/vps-upgrade.sh
#
# Refuses to point APP_URL at the apex until daymarkable.com actually resolves to this machine,
# because magic links and email CTAs are built from APP_URL and would otherwise dead-end.
set -euo pipefail

REPO="${REPO:-/root/daymarkable}"
DOMAIN="${DOMAIN:-daymarkable.com}"
cd "$REPO"

echo "== pulling main"
git pull --ff-only

# --- environment -----------------------------------------------------------------------------
ENV_FILE="$REPO/.env"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — run the setup checklist first"; exit 1; }
set_var() { # set_var KEY VALUE — add or replace KEY in .env
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}

MY_IP="$(curl -4 -s --max-time 10 https://api.ipify.org || true)"
APEX_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
APP_IP="$(getent ahostsv4 "app.$DOMAIN" | awk 'NR==1{print $1}' || true)"
echo "== this box: ${MY_IP:-?}   $DOMAIN -> ${APEX_IP:-unresolved}   app.$DOMAIN -> ${APP_IP:-unresolved}"

if [ -n "$MY_IP" ] && [ "$APEX_IP" = "$MY_IP" ] && [ "$APP_IP" = "$MY_IP" ]; then
  echo "== DNS is ready: public site on $DOMAIN, service on app.$DOMAIN"
  set_var APP_URL "https://$DOMAIN"
  set_var SERVICE_URL "https://app.$DOMAIN"
  set_var APP_DOMAIN "$DOMAIN"
  EDGE=1
else
  echo "!! $DOMAIN (and www, app) must all resolve to $MY_IP before the apex can take the public site."
  echo "!! Leaving APP_URL/APP_DOMAIN as they are; the app is upgraded on its current host only."
  echo "!! Add the A records in hPanel (@, www, app -> $MY_IP), wait for DNS, then rerun this script."
  EDGE=0
fi
grep -E "^(APP_URL|SERVICE_URL|APP_DOMAIN)=" "$ENV_FILE" || true

# --- build and roll --------------------------------------------------------------------------
echo "== building app"
docker compose build app
echo "== restarting app"
docker compose up -d app
if [ "$EDGE" = 1 ]; then
  echo "== reloading caddy with the two-host Caddyfile (obtains certificates for $DOMAIN, www, app)"
  docker compose --profile edge up -d --force-recreate caddy
fi

echo "== waiting for the app"
for _ in $(seq 1 30); do
  if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login | grep -q '^200$'; then echo "app answers on :3000"; break; fi
  sleep 3
done
docker compose ps
if [ "$EDGE" = 1 ]; then
  echo "== public checks"
  for u in "https://$DOMAIN/" "https://$DOMAIN/pricing" "https://app.$DOMAIN/today" "https://www.$DOMAIN/"; do
    printf '%-40s ' "$u"; curl -s -o /dev/null -m 20 -w '%{http_code} %{redirect_url}\n' "$u" || echo "unreachable (certificates may still be issuing; retry in a minute)"
  done
fi
echo "== done"
