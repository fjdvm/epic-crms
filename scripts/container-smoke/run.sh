#!/usr/bin/env bash
# Starts the production image with placeholder values and checks the three things a deploy depends on.
# Usage: scripts/container-smoke/run.sh [image]   (default: creoms:smoke)
set -euo pipefail

image="${1:-creoms:smoke}"
name="creoms-smoke-$$"
port="${SMOKE_PORT:-3000}"
base="http://127.0.0.1:$port"
secret="smoke-cron-secret-not-a-real-value"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker logs "$name" 2>&1 | tail -50 || true; fi
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Production-shaped placeholders: nothing here reaches a real database, Portal or gateway.
docker run -d --name "$name" -p "$port:3000" \
  -e NODE_ENV=production \
  -e PORTAL_URL=https://portal.invalid \
  -e PORTAL_SYSTEM_NAME=CRMS \
  -e PORTAL_SYSTEM_SECRET=smoke-portal-secret-placeholder \
  -e CREOMS_APP_URL="$base" \
  -e CREOMS_DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:5432/smoke \
  -e CREOMS_TICKETS_DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:5432/smoke \
  -e CREOMS_WRITER_DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:5432/smoke \
  -e CREOMS_FEEDBACK_DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:5432/smoke \
  -e CREOMS_GATEWAY_URL=https://gateway.invalid \
  -e CREOMS_GATEWAY_CALLER_KEY=smoke-caller-key-placeholder \
  -e CREOMS_STOREFRONT_URL=https://shop.invalid \
  -e CREOMS_SYNC_SECRET=smoke-sync-secret-placeholder \
  -e CREOMS_SERVICE_SECRET=smoke-service-secret-at-least-32-characters \
  -e CREOMS_SIGNAL_SECRET=smoke-signal-secret-at-least-32-characters \
  -e UNSUBSCRIBE_SECRET=smoke-unsubscribe-secret-placeholder \
  -e CRON_SECRET="$secret" \
  "$image" >/dev/null

for _ in $(seq 1 60); do
  if curl --silent --fail "$base/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

health=$(curl --silent --output /dev/null --write-out '%{http_code}' "$base/api/health")
test "$health" = 200 || { echo "::error::/api/health answered $health"; exit 1; }
echo "ok: /api/health 200"

read -r code location < <(curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}\n' "$base/customers")
case "$code $location" in
  "307 $base/signing-in?returnTo="*|"302 $base/signing-in?returnTo="*) ;;
  *) echo "::error::unauthenticated /customers gave $code $location"; exit 1 ;;
esac
echo "ok: unauthenticated page redirects to $location"

read -r code location < <(curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}\n' "$base/api/portal/login?returnTo=%2F")
case "$code $location" in
  3??" https://portal.invalid/"*) ;;
  *) echo "::error::sign-in start gave $code $location"; exit 1 ;;
esac
echo "ok: sign-in hands off to the Portal ($location)"

cron=$(curl --silent --output /dev/null --write-out '%{http_code}' "$base/api/cron/feedback-analysis")
test "$cron" = 401 || { echo "::error::cron route without secret answered $cron"; exit 1; }
cron=$(curl --silent --output /dev/null --write-out '%{http_code}' -H 'Authorization: Bearer wrong' "$base/api/cron/scheduled-announcements")
test "$cron" = 401 || { echo "::error::cron route with a wrong secret answered $cron"; exit 1; }
echo "ok: cron routes answer 401 without the secret"
