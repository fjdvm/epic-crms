# Pickup instructions (#559)

Part of #554. An Admin sets where and when a Customer collects a Pickup Order: the shop address (the shared address picker, #558), the hours, and a free-text note. Saved without a deploy.

- Stored in `crms.pickup_instructions` (one row; migration `docs/db/crms-pickup-instructions.sql`, run `node --env-file=.env scripts/deploy/migrate-pickup-instructions.mjs` as `creoms_writer`). No row means not set yet.
- `features/settings/pickup-instructions.ts` holds validation (the address is checked against the PSGC list, street and hours are required, length limits) and `loadPickupInstructions`; `pickup-instructions-server.ts` holds `savePickupInstructions`.
- `GET /api/pickup-instructions` (Admin, CEO, Manager) reads; `PUT` saves (Admin only). Staff are refused both. Same Portal Settings bearer handle as Automatic checks.
- Each save is audited as `pickup_instructions.changed` under the Admin's name, with what changed.
- The Portal's Settings (general) form calls the endpoint, using `AddressPicker` (`initial` opens it on the saved address), with a confirm dialog before save.
