#!/usr/bin/env bash
# Upgrade a running ScriptumIQ VPS to the latest main and keep it on the two-host layout
# (public site on scriptumiq.com, service on app.scriptumiq.com). Idempotent; safe to rerun.
#
#   ssh root@<vps>  'bash -s' < scripts/vps-upgrade.sh
#   # or on the box:  cd /root/daymarkable && bash scripts/vps-upgrade.sh
#
# Refuses to point APP_URL at a domain until it actually resolves to this machine, because magic
# links and email CTAs are built from APP_URL and would otherwise dead-end. That same rule is what
# moves the box from daymarkable.com to scriptumiq.com: until scriptumiq.com resolves here, the
# app is upgraded in place on the domain it already has, and the rename waits.
#
# The directory, the Compose project and the database keep the product's old name (see the top of
# docker-compose.yml): the volumes are named after the project, and renaming it would start an
# empty database beside the real one. Nothing a customer sees.
set -euo pipefail

REPO="${REPO:-/root/daymarkable}"
DOMAIN="${DOMAIN:-scriptumiq.com}"
# The product's previous domain. Once DOMAIN takes over, this one redirects to it (Caddyfile).
LEGACY="${LEGACY:-daymarkable.com}"
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
  # Never equal to APP_DOMAIN: the two Caddy blocks would claim the same hostnames and Caddy would
  # refuse to start. Deploying on the old domain on purpose (DOMAIN=$LEGACY) puts it back to the
  # harmless placeholder instead.
  if [ "$DOMAIN" = "$LEGACY" ]; then
    set_var LEGACY_DOMAIN "legacy.localhost"
  else
    set_var LEGACY_DOMAIN "$LEGACY"
    echo "== $LEGACY now redirects to $DOMAIN (its /api/* is still served, for installed apps and webhooks)"
  fi
  EDGE=1
else
  echo "!! $DOMAIN (and www, app) must all resolve to $MY_IP before it can take the site."
  echo "!! Leaving APP_URL/APP_DOMAIN as they are; the app is upgraded on its current domain only."
  echo "!! Add the A records for $DOMAIN in hPanel (@, www, app -> $MY_IP), wait for DNS, then rerun."
  EDGE=0
fi
grep -E "^(APP_URL|SERVICE_URL|APP_DOMAIN|LEGACY_DOMAIN)=" "$ENV_FILE" || true

# --- build and roll --------------------------------------------------------------------------
# Both images, always. The render service is its own container, and a change there is invisible
# from the app: page rendering keeps working and whatever the change added silently does not
# happen. Docker skips the build when nothing in that directory moved, so this costs nothing on
# a deploy that only touched the web app.
echo "== building app and render"
docker compose build app render
echo "== restarting app and render"
docker compose up -d app render
if [ "$EDGE" = 1 ]; then
  echo "== reloading caddy with the two-host Caddyfile (obtains certificates for $DOMAIN, www, app)"
  docker compose --profile edge up -d --force-recreate caddy
fi

# --- reclaim build cache ---------------------------------------------------------------------
# BuildKit keeps every intermediate layer, and this script is run often. On 2026-09-13 that was
# 39.9 GB of cache against 88 MB of actual application state, at 43% of the disk. A week is long
# enough to keep a rollback fast and short enough that it never becomes the biggest thing on the
# box. Runs after the build, so nothing this deploy needs is thrown away.
echo "== pruning build cache older than a week"
docker builder prune -f --filter until=168h >/dev/null 2>&1 || echo "!! build cache prune failed; check 'docker system df'"
docker system df --format '{{.Type}}	{{.Size}}	{{.Reclaimable}}' 2>/dev/null || true
df -h /

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
  if [ "$DOMAIN" != "$LEGACY" ]; then
    # Pages should answer 308 to the same path on $DOMAIN. The webhook should answer a 4xx to this GET
    # with NO redirect — that means it was served here, which is what Stripe needs, since it will not
    # follow a redirect.
    echo "== $LEGACY checks (pages 308 to $DOMAIN; the webhook answers here, 4xx and no redirect)"
    for u in "https://$LEGACY/pricing?x=1" "https://app.$LEGACY/today" "https://$LEGACY/api/stripe/webhook"; do
      printf '%-44s ' "$u"; curl -s -o /dev/null -m 20 -w '%{http_code} %{redirect_url}\n' "$u" || echo "unreachable (certificates may still be issuing; retry in a minute)"
    done
  fi
fi
echo "== done"
