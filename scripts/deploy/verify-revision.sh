#!/usr/bin/env bash
set -euo pipefail
revision="$CONTAINER_APP--$REVISION_SUFFIX"
fail() { echo "::error::$*"; exit 1; }

# Wait until the revision is Healthy AND is the latest ready revision. Azure can
# report the revision Healthy slightly before latestReadyRevisionName updates,
# so check both in the same poll instead of asserting the second once.
ready=false
state=""
latest=""
for attempt in $(seq 1 120); do
  state=$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" --revision "$revision" --query properties.healthState -o tsv)
  latest=$(az containerapp show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" --query properties.latestReadyRevisionName -o tsv)
  if [ "$state" = Healthy ] && [ "$latest" = "$revision" ]; then ready=true; break; fi
  sleep 5
done
[ "$ready" = true ] || fail "revision $revision not ready after 10 minutes (healthState='$state', latestReadyRevisionName='$latest')"

fqdn=$(az containerapp show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" --query properties.configuration.ingress.fqdn -o tsv)
# Min 0 replicas: the first request may wake the app, so retry.
curl --fail --silent --show-error --retry 8 --retry-delay 5 --retry-all-errors "https://$fqdn/api/health" \
  || fail "https://$fqdn/api/health did not return success"
bound=$(az containerapp show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" \
  --query "properties.configuration.ingress.customDomains[?name=='creoms.buildwrite.me' && bindingType=='SniEnabled'] | length(@)" -o tsv)
[ "$bound" = 1 ] || fail 'creoms.buildwrite.me is not bound with SniEnabled'
curl --fail --silent --show-error --retry 8 --retry-delay 5 --retry-all-errors "$CREOMS_PUBLIC_URL/api/health" \
  || fail "$CREOMS_PUBLIC_URL/api/health did not return success"
echo "Healthy revision: $revision ($CREOMS_IMAGE)" >> "$GITHUB_STEP_SUMMARY"
