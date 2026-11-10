#!/usr/bin/env bash
set -euo pipefail
revision="$CONTAINER_APP--$REVISION_SUFFIX"
ready=false
for attempt in $(seq 1 120); do
  state=$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" --revision "$revision" --query properties.healthState -o tsv)
  if [ "$state" = Healthy ]; then ready=true; break; fi
  sleep 5
done
test "$ready" = true
fqdn=$(az containerapp show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" --query properties.configuration.ingress.fqdn -o tsv)
latest=$(az containerapp show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" --query properties.latestReadyRevisionName -o tsv)
test "$latest" = "$revision"
# Min 0 replicas: the first request may wake the app, so retry.
curl --fail --silent --show-error --retry 8 --retry-delay 5 --retry-all-errors "https://$fqdn/api/health"
bound=$(az containerapp show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" \
  --query "properties.configuration.ingress.customDomains[?name=='creoms.buildwrite.me' && bindingType=='SniEnabled'] | length(@)" -o tsv)
test "$bound" = 1 || { echo '::error::creoms.buildwrite.me is not bound with SniEnabled'; exit 1; }
curl --fail --silent --show-error --retry 8 --retry-delay 5 --retry-all-errors "$CREOMS_PUBLIC_URL/api/health"
echo "Healthy revision: $revision ($CREOMS_IMAGE)" >> "$GITHUB_STEP_SUMMARY"
