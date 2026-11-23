"""Render an Azure CLI manifest for the creoms Container App to a private file; never print secret values."""
import json
import os
from pathlib import Path
import re
import sys

secrets = json.loads(os.environ['DEPLOY_SECRETS'])
keys = re.findall(r'^([A-Z_]+)=', Path('.env.example').read_text(), re.M)

# Public values: fixed here, not read from GitHub secrets (the local .env holds localhost ones).
public_url = os.environ['CREOMS_PUBLIC_URL']
fixed = {
    'PORTAL_URL': 'https://portal.buildwrite.me',
    'PORTAL_SYSTEM_NAME': 'CRMS',
    'CREOMS_APP_URL': public_url,
    'CREOMS_STOREFRONT_URL': 'https://shop.buildwrite.me',
    'CREOMS_GATEWAY_URL': 'https://api.buildwrite.me',
}
# Optional: left out of the container when no GitHub secret is set.
optional = ['CREOMS_UPLOAD_SECRET', 'OWNER_ALERT_EMAIL', 'IMS_CREOMS_SECRET_PREVIOUS']
# The Portal only stores a hash of this, so it is set from the Portal seed at cutover (#203/#204).
# Until then a placeholder lets the app start; sign-in is refused by the Portal.
PLACEHOLDER = 'pending-portal-seed-not-a-real-secret'
if not secrets.get('PORTAL_SYSTEM_SECRET'):
    print('::warning::PORTAL_SYSTEM_SECRET is not set; deploying with a placeholder, so Portal sign-in will fail until it is set.')
    secrets['PORTAL_SYSTEM_SECRET'] = PLACEHOLDER

runtime = [k for k in keys if k not in fixed]
runtime = [k for k in runtime if k not in optional or secrets.get(k)]
required = [k for k in runtime] + ['GHCR_PULL_TOKEN']
missing = [key for key in required if not secrets.get(key)]
if missing:
    sys.exit('Missing GitHub secrets: ' + ', '.join(missing))

def secret_name(key):
    return key.lower().replace('_', '-')

# `az containerapp create --yaml` replaces the whole configuration, so an already-bound custom
# domain must be carried over or every deploy silently unbinds it (see the Portal's #220).
custom_domains = json.loads(os.environ.get('EXISTING_CUSTOM_DOMAINS') or '[]')
ingress = {'external': True, 'targetPort': 3000, 'transport': 'auto', 'allowInsecure': False,
           'traffic': [{'latestRevision': True, 'weight': 100}]}
if custom_domains:
    ingress['customDomains'] = custom_domains

manifest = {
    'location': 'indonesiacentral',
    'properties': {
        'environmentId': os.environ['CONTAINER_ENVIRONMENT_ID'],
        'configuration': {
            'activeRevisionsMode': 'Single',
            'maxInactiveRevisions': 10,
            'secrets': [{'name': secret_name(k), 'value': secrets[k]} for k in required],
            'registries': [{'server': 'ghcr.io', 'username': os.environ['GHCR_USERNAME'],
                            'passwordSecretRef': 'ghcr-pull-token'}],
            'ingress': ingress,
        },
        'template': {
            'revisionSuffix': os.environ['REVISION_SUFFIX'],
            'containers': [{
                'name': 'creoms', 'image': os.environ['CREOMS_IMAGE'],
                'resources': {'cpu': 0.5, 'memory': '1Gi'},
                'env': ([{'name': k, 'secretRef': secret_name(k)} for k in runtime]
                        + [{'name': k, 'value': v} for k, v in fixed.items()]),
                'probes': [{
                    'type': kind,
                    'httpGet': {'path': '/api/ready' if kind == 'Readiness' else '/api/health', 'port': 3000, 'scheme': 'HTTP'},
                    'initialDelaySeconds': delay, 'periodSeconds': 10,
                    'timeoutSeconds': 5, 'failureThreshold': failures,
                } for kind, delay, failures in [('Startup', 5, 30), ('Readiness', 5, 3), ('Liveness', 30, 3)]],
            }],
            'scale': {'minReplicas': 1, 'maxReplicas': 2},
        },
    },
}
path = Path(sys.argv[1])
# O_EXCL prevents overwriting an existing file/symlink containing other data.
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    json.dump(manifest, output)
