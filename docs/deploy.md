# Deploying creoms to Azure Container Apps

Every push to `main` runs the container smoke job, then the `deploy` job in `.github/workflows/container.yml`:
it builds the image, pushes `ghcr.io/fjdvm/epic-crms:<sha>` with the workflow's own token, logs into Azure with
OIDC and rolls out a new revision of `ca-creoms` (resource group `rg-brenraphaels`, environment
`cae-brenraphaels`, Indonesia Central). The job passes when the new revision is Healthy and `/api/health`
answers; its default address is printed in the workflow summary. Pull requests and manual runs never deploy.

The app runs at min 0 replicas (the first request after idle may take a few seconds), max 2, 0.5 vCPU / 1 GiB.
The app is created on the first run. The public address `https://creoms.buildwrite.me` is baked in as the
`NEXT_PUBLIC_APP_URL` build argument; until the domain is bound, use the default address from the summary.

## GitHub secrets

Set in **Settings > Secrets and variables > Actions** of `fjdvm/epic-crms`. The deploy reads every key of
`.env.example` as a secret, except the public values the workflow fixes (`PORTAL_URL`, `PORTAL_SYSTEM_NAME`,
`CREOMS_APP_URL`, `CREOMS_STOREFRONT_URL`, `CREOMS_GATEWAY_URL`). The renderer fails and names any missing one
(never its value).

- Database: `CREOMS_DATABASE_URL`, `CREOMS_TICKETS_DATABASE_URL`, `CREOMS_WRITER_DATABASE_URL`, `CREOMS_FEEDBACK_DATABASE_URL`
- Gateway and signing: `CREOMS_GATEWAY_CALLER_KEY`, `CREOMS_SERVICE_SECRET`, `CREOMS_SIGNAL_SECRET`, `CREOMS_SYNC_SECRET`, `UNSUBSCRIBE_SECRET`, `CRON_SECRET`
- AI: `GROQ_API_KEY`, `GROQ_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_MODEL`
- `PORTAL_SYSTEM_SECRET`: set at the Portal cutover (the Portal only stores its hash). Until then the deploy uses a
  placeholder and warns; the app starts but Portal sign-in fails.
- Optional: `CREOMS_UPLOAD_SECRET` (left out of the app when unset).
- Delivery: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `GHCR_PULL_TOKEN`, variable `GHCR_USERNAME`.

Values become Container Apps secrets referenced by environment entries, so they never appear in logs. Secrets
are application-scoped: after changing a GitHub secret, push to `main` (or re-run the workflow) to roll it out.
`CREOMS_APP_URL` as a GitHub secret is separate: the two schedule workflows call it, so repoint it to
`https://creoms.buildwrite.me` at cutover (#204).

## Rollback

Up to 10 previous revisions stay available. Roll back to one:

```sh
az containerapp revision list -g rg-brenraphaels -n ca-creoms -o table
az containerapp revision set-mode -g rg-brenraphaels -n ca-creoms --mode multiple
az containerapp revision activate -g rg-brenraphaels -n ca-creoms --revision <previous>
az containerapp ingress traffic set -g rg-brenraphaels -n ca-creoms --revision-weight <previous>=100
```

The next deploy restores single-revision mode. Secrets are shared by all revisions, so they do not roll back: if a changed secret caused the failure, restore
the GitHub secret and redeploy. Alternatively revert the bad commit on `main`.
