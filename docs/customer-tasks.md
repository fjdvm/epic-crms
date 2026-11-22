# Customer Tasks backend (#420)

Tasks belong to verified Customers and live in `crms.customer_tasks`, with no foreign key into storefront tables. The five server actions in `features/customer-profiles/task-actions.ts` require the Customer Profiles Module and a stable caller-generated operation id. Staff create their own Tasks and can mark done, reopen or change due dates only while they own them. Managers may do those actions for any owner and may assign at creation or reassign. Assignment resolves the canonical name from the Portal and requires an active Staff or Manager with Customer Profiles access. Admin writes are refused. There is no edit-description or delete action.

The Profile loader includes Tasks open first, sorted by due date within each state. `tasks: null` means the Task store is unavailable. Due dates are `YYYY-MM-DD` strings; overdue means open with a due date earlier than today's date in Asia/Manila. Dates are not interpreted in the database session's timezone.

Operation receipts are committed atomically with changes, retaining the original result and audit payload. Actor-scoped operation ids cannot be reused for a different request. Concurrent duplicate requests serialize and return the original receipt, even after later changes. Audit delivery uses the existing gateway boundary and its stable idempotency key; due-date and reassignment metadata retain old and new values. Task receipts use acknowledged gateway delivery; failures leave the audit payload pending for a retry of the same action. The gateway deduplicates uncertain deliveries. Other modules retain their existing best-effort audit policy. No polling or automatic Task actions are added.

## Migration

`docs/db/crms-customer-tasks.sql` is additive and rerunnable, and is also included in the full schema document. Apply it as `creoms_writer` before deployment. The runner converts Neon pooled endpoint hostnames to their direct equivalents and uses a direct connection and wraps the migration in a transaction:

```sh
node --env-file=.env.migration.azure-writer scripts/deploy/migrate-customer-tasks.mjs
```

The environment file must supply `CREOMS_WRITER_DATABASE_URL`. Production execution and reading production secrets require the owner's approval of this exact command. Production execution is recorded in the verification issue linked from the implementation PR.

## Verification

`tests/customer-tasks.test.ts` calls the server actions against PostgreSQL through PGlite and a real postgres.js connection, loading the migration twice. It covers all four Roles, ownership, fixed description and input limits, all five actions, replay and concurrent retries, old/new audit metadata, failed audit-adapter delivery, Profile integration and Task-store failure, and the Philippine midnight boundary. Production migration and live checks are tracked separately.
